import { build } from 'esbuild';

/**
 * The claim this package rests on: a mark drawn at one window size lands on the
 * same content at another.
 *
 * The original documented a measured failure — a point drawn at 1920px landed
 * 81px right of its target at 1280px when normalised against the WINDOW. This
 * reproduces both rulers and asserts the frame-relative one is exact while the
 * window-relative one is not, so the reason for the design is checked rather
 * than just written down in a comment.
 */

const bundle = await build({
  entryPoints: ['src/core/geometry.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const geometry = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const { projectX, projectY, toFraction, penPath, boxRect, arrowHead } = geometry;

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`
  );
  ok ? (pass += 1) : (fail += 1);
};
const near = (name, actual, expected, tolerance = 0.01) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${actual}, expected ~${expected}`}`
  );
  ok ? (pass += 1) : (fail += 1);
};

/** A centred content column of fixed width inside a viewport. */
const COLUMN = 1140;
const frameAt = (viewport) => ({
  left: Math.max(0, (viewport - COLUMN) / 2),
  top: 0,
  width: Math.min(COLUMN, viewport),
  height: 800,
});

// ------------------------------------------------------------ round trip
const wide = frameAt(1920);
const fraction = toFraction(900, 300, {
  left: wide.left,
  top: wide.top,
  width: wide.width,
  height: wide.height,
});
// projectX returns STAGE coordinates (frame.left + offset), because that is
// the space the SVG draws in — so a client x of 900 round-trips back to 900,
// not to 900 minus the frame offset.
near('round trip x survives project(toFraction(x))', projectX(fraction[0], wide), 900);
near('round trip y survives project(toFraction(y))', projectY(fraction[1], wide), 300);

// ------------------------------------- THE claim: same content, any width
//
// A mark on a word 200px into the column. Against the FRAME it must stay 200px
// into the column at every viewport wide enough to show the column.
const targetInColumn = 200;
const stored = targetInColumn / COLUMN;

for (const viewport of [1280, 1440, 1920, 2560]) {
  const frame = frameAt(viewport);
  const landed = projectX(stored, frame) - frame.left;
  near(`frame ruler: exact at ${viewport}px`, landed, targetInColumn, 0.001);
}

// The window ruler, for contrast — this is the bug the design avoids.
const storedAgainstWindow = (1920 - COLUMN) / 2 / 1920 + targetInColumn / 1920;
const atNarrow = storedAgainstWindow * 1280 - frameAt(1280).left;
const drift = Math.abs(atNarrow - targetInColumn);
const driftsBadly = drift > 50;
console.log(
  `${driftsBadly ? 'PASS' : 'FAIL'}  window ruler drifts, which is why it is not used — ${Math.round(drift)}px off at 1280`
);
driftsBadly ? (pass += 1) : (fail += 1);

// ------------------------------------------------------------- the anchor
//
// The claim: a box drawn around a button still surrounds that button in a
// window of a different size.
//
// These numbers are the real ones, measured in two headless browsers against
// the lab's own page. The checkpoint button goes 1066px wide to 726px while
// staying 67.25px tall, and the page above it reflows by 159px.
{
  const presenterButton = { left: 331, top: 870, width: 1066, height: 67.25 };
  const viewerButton = { left: 37, top: 1029, width: 726, height: 67.25 };
  const PAD = 8;

  // Boxed with 8px of clearance on every side.
  const store = (x, y) => [
    (x - presenterButton.left) / presenterButton.width,
    (y - presenterButton.top) / presenterButton.height,
  ];
  const topLeft = store(presenterButton.left - PAD, presenterButton.top - PAD);
  const bottomRight = store(
    presenterButton.left + presenterButton.width + PAD,
    presenterButton.top + presenterButton.height + PAD
  );

  const landed = boxRect(topLeft, bottomRight, viewerButton);

  const gapLeft = landed.x - viewerButton.left;
  const gapTop = landed.y - viewerButton.top;
  const gapRight = landed.x + landed.width - (viewerButton.left + viewerButton.width);
  const gapBottom = landed.y + landed.height - (viewerButton.top + viewerButton.height);

  const surrounds = gapLeft < 0 && gapTop < 0 && gapRight > 0 && gapBottom > 0;
  console.log(
    `${surrounds ? 'PASS' : 'FAIL'}  an anchored box still surrounds its button after reflow — gaps ${gapLeft.toFixed(1)} ${gapTop.toFixed(1)} ${gapRight.toFixed(1)} ${gapBottom.toFixed(1)}`
  );
  surrounds ? (pass += 1) : (fail += 1);

  // Vertical clearance is exact, because the button's height did not change.
  near('anchored box keeps its top clearance exactly', gapTop, -PAD, 0.01);
  near('anchored box keeps its bottom clearance exactly', gapBottom, PAD, 0.01);

  // Horizontal clearance shrinks WITH the button, which is the intent: the
  // mark is proportional to the thing it is drawn around.
  near('horizontal clearance scales with the element', gapLeft, -PAD * (726 / 1066), 0.01);

  // Scaling both axes by the element's WIDTH — the first attempt — squashes
  // the box until it no longer contains the button. Kept as a guard so the
  // idea does not come back.
  const uniform = { left: viewerButton.left, top: viewerButton.top, width: 726, height: 726 };
  const uniformTopLeft = [
    (presenterButton.left - PAD - presenterButton.left) / presenterButton.width,
    (presenterButton.top - PAD - presenterButton.top) / presenterButton.width,
  ];
  const uniformBottomRight = [
    (presenterButton.left + presenterButton.width + PAD - presenterButton.left) /
      presenterButton.width,
    (presenterButton.top + presenterButton.height + PAD - presenterButton.top) /
      presenterButton.width,
  ];
  const squashed = boxRect(uniformTopLeft, uniformBottomRight, uniform);
  const tooShort = squashed.height < viewerButton.height;
  console.log(
    `${tooShort ? 'PASS' : 'FAIL'}  scaling both axes by width squashes the box below the button — ${squashed.height.toFixed(1)}px tall vs ${viewerButton.height}px`
  );
  tooShort ? (pass += 1) : (fail += 1);

  // And for contrast, the FRAME: it points at where the page used to be.
  const frameWide = { left: 294, top: 60, width: 1140, height: 2419 };
  const frameNarrow = { left: 37, top: 60, width: 800, height: 2578 };
  const onFrame = (presenterButton.top - frameWide.top) / frameWide.height;
  const missedBy = Math.abs(projectY(onFrame, frameNarrow) - viewerButton.top);
  const missesBadly = missedBy > 40;
  console.log(
    `${missesBadly ? 'PASS' : 'FAIL'}  the frame ruler misses the reflowed element — ${Math.round(missedBy)}px off`
  );
  missesBadly ? (pass += 1) : (fail += 1);
}

// ------------------------------------------------------------- rendering
check('empty pen path is empty', penPath([], wide), '');
check(
  'two-point pen path is a straight line',
  penPath(
    [
      [0, 0],
      [1, 1],
    ],
    { left: 0, top: 0, width: 100, height: 100 }
  ),
  'M 0,0 L 100,100'
);
check('a three-point pen path smooths with a quadratic', penPath(
  [
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ],
  { left: 0, top: 0, width: 100, height: 100 }
).includes('Q'), true);

// A box drawn right-to-left, upward, must still be a positive rectangle.
check(
  'box normalises a backwards drag',
  boxRect([0.8, 0.9], [0.2, 0.1], { left: 0, top: 0, width: 100, height: 100 }),
  { x: 20, y: 10, width: 60, height: 80 }
);

check(
  'arrow head is a two-segment path',
  arrowHead([0, 0], [1, 1], { left: 0, top: 0, width: 100, height: 100 }).split('L').length,
  3
);

// A zero-size frame must not produce Infinity.
check(
  'a zero-width frame yields no fraction rather than Infinity',
  toFraction(10, 10, { left: 0, top: 0, width: 0, height: 100 }),
  null
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
