import { build } from 'esbuild';

/**
 * The toolbar's placement, checked against the stylesheet that implements it.
 *
 * The toolbar itself needs a DOM, and this package deliberately has no jsdom
 * dependency — so what is tested here is the seam where the mistakes actually
 * happen: a position exists in the type but nothing in the CSS matches it. The
 * consequence of that is not a crash or a type error. It is a toolbar sitting
 * unpositioned in the corner of the viewport, on someone else's page, which is
 * exactly the kind of thing nobody notices until a presentation.
 *
 * The behaviour that needs a browser — hiding, showing, and the surface being
 * disarmed on the way down — is checked by a Playwright run against the lab.
 */

async function load(entry) {
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  );
}

const toolbar = await load('src/core/toolbar.ts');
const styles = await load('src/core/styles.ts');

const { TOOLBAR_POSITIONS, DEFAULT_POSITION, isToolbarPosition } = toolbar;
const { STYLES } = styles;

let pass = 0;
let fail = 0;
const t = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (ok) pass += 1;
  else fail += 1;
};

// --- The list itself -------------------------------------------------------

t('eight positions are offered', TOOLBAR_POSITIONS.length === 8, `${TOOLBAR_POSITIONS.length}`);

// Existing callers pass no position at all, and their toolbar must not move.
t('the default is bottom-center', DEFAULT_POSITION === 'bottom-center', DEFAULT_POSITION);
t('and the default is one of the offered positions', TOOLBAR_POSITIONS.includes(DEFAULT_POSITION));

for (const position of TOOLBAR_POSITIONS) {
  t(`isToolbarPosition accepts ${position}`, isToolbarPosition(position));
}

for (const junk of ['center', 'top', 'TOP-LEFT', 'bottom center', '', undefined, null, 3, {}]) {
  t(`isToolbarPosition rejects ${JSON.stringify(junk)}`, !isToolbarPosition(junk));
}

// --- Every position is actually implemented --------------------------------

for (const position of TOOLBAR_POSITIONS) {
  t(
    `the bar has CSS for ${position}`,
    STYLES.includes(`.pa-toolbar[data-position='${position}']`)
  );
  t(
    `the pencil has CSS for ${position}`,
    STYLES.includes(`.pa-launcher[data-position='${position}']`)
  );
}

/**
 * A position rule that sets no offset would compile fine and place the element
 * at the viewport origin, so check each one names at least one edge.
 */
for (const position of TOOLBAR_POSITIONS) {
  const rule = STYLES.split(`.pa-launcher[data-position='${position}']`)[1] ?? '';
  const body = rule.slice(0, rule.indexOf('}') + 1);
  const [vertical, horizontal] = position.split('-');
  const namesVertical =
    vertical === 'left' || vertical === 'right'
      ? /top:\s*50%/.test(body)
      : new RegExp(`${vertical}:\\s*18px`).test(body);
  const namesHorizontal =
    horizontal === 'center'
      ? /left:\s*(50%|18px)|right:\s*18px/.test(body)
      : new RegExp(`${horizontal}:\\s*18px`).test(body);
  t(`${position} sets both offsets`, namesVertical && namesHorizontal, body.trim());
}

// --- Hiding and showing ----------------------------------------------------

t(
  'the bar is hidden when minimized',
  STYLES.includes(`.pa-toolbar[data-minimized='true'] { display: none; }`)
);
t(
  'and the pencil appears only then',
  STYLES.includes('.pa-launcher {') &&
    /\.pa-launcher \{[^}]*display: none/.test(STYLES) &&
    STYLES.includes(`.pa-launcher[data-minimized='true'] { display: inline-flex; }`)
);

// --- The two failure modes worth naming ------------------------------------

/**
 * On a side edge a horizontal bar would run off the screen, so those two
 * positions stack.
 */
for (const position of ['left-center', 'right-center']) {
  const stacks = new RegExp(
    `\\.pa-toolbar\\[data-position='${position}'\\][^{]*\\{[^}]*flex-direction: column`
  ).test(STYLES.replace(/\n/g, ' '));
  t(`${position} stacks the bar vertically`, stacks);
}

/**
 * The centred positions are placed with a translate, and the pencil's hover
 * also uses transform. Without a hover rule that reapplies the translate, the
 * button jumps to the edge of the screen the moment the mouse reaches it.
 */
for (const position of ['top-center', 'bottom-center', 'left-center', 'right-center']) {
  const hover = `.pa-launcher[data-position='${position}']:hover`;
  const index = STYLES.indexOf(hover);
  const body = index === -1 ? '' : STYLES.slice(index, STYLES.indexOf('}', index));
  t(
    `the pencil does not jump on hover at ${position}`,
    index !== -1 && /translate[XY]\(-50%\)\s*scale/.test(body.replace(/\n/g, ' ')),
    index === -1 ? 'no hover rule' : body
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
