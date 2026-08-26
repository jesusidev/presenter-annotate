import { type AnnotationColor, isNamedColor, type NamedColor, type Point } from './types';

/**
 * The coordinate system, which is the part of this package worth keeping.
 *
 * There are TWO boxes, and conflating them is the bug that makes naive shared
 * annotation useless:
 *
 *   stage — spans the viewport. The SVG is sized to this, so a mark can sit
 *           anywhere on screen, including outside the content.
 *   frame — the content column inside the stage, marked with
 *           `[data-annotation-frame]`. Marks are STORED as fractions of this.
 *
 * The frame rather than the stage, because the stage is the wrong ruler: a
 * content column is typically a fixed width and the viewport is not, so
 * widening the window slides every viewport-fraction sideways while the words
 * stay put. Measured on the original: a point on a target drawn at 1920px
 * landed 81px to the right of it at 1280px. Against the column the same point
 * is exact at every width wide enough to show the column.
 *
 * Below the frame's own width the page reflows — text takes more lines, so the
 * content is genuinely taller, and a fraction of total height stops pointing at
 * the same paragraph. That is what the ANCHOR below exists to solve.
 *
 * Measured against a real page (a 1140px column at 1728px, reopened narrower):
 *
 *   viewer 1280px   0px off        nothing reflows above the column's cap
 *   viewer 1000px   14px off       21px of reflow
 *   viewer  900px   48px off       106px of reflow
 *   viewer  800px   61px off       159px of reflow
 *
 * An ANCHOR fixes that. A committed mark records the element underneath it and
 * stores its points against THAT element's box instead of the page's. A box
 * drawn around a button keeps hugging the button at any width, because the
 * button is the ruler — and a page that reflowed by 159px moved the button and
 * the mark together.
 *
 * An anchor is measured per axis, against the element's real width and height.
 * A first attempt scaled both axes by the element's width, on the theory that
 * one unit for both axes keeps a square square. Two real browsers disproved it:
 * a checkbox button went 1066px wide to 726px while staying 67px tall, so
 * uniform scaling squashed the box to 57px and it no longer contained the thing
 * it was drawn around. Marks track the element's shape, deliberately — what the
 * facilitator drew was "around this", not "a square".
 */
export type Frame = { left: number; top: number; width: number; height: number };

/** Relay at most this often while drawing. ~30fps of network, 60fps of local. */
export const LIVE_RELAY_MS = 33;

/** Freehand points closer together than this are dropped as noise. */
export const MIN_POINT_DELTA = 0.004;

/** A drag shorter than this is a misfire, not a zero-length arrow. */
export const MIN_TRAVEL = 0.01;

export const STROKE: Record<NamedColor, string> = {
  amber: '#b97e1e',
  red: '#d9100d',
  brand: '#0086e7',
};

/** The pale tint the highlighter lays down. Hand-picked for the three names. */
export const WASH: Record<NamedColor, string> = {
  amber: '#ffeccc',
  red: '#ffb4b5',
  brand: '#d7ecfd',
};

/** How far a picked colour is mixed toward white to become a highlighter wash. */
const WASH_LIGHTEN = 0.72;

function parseHex(hex: string): [number, number, number] | null {
  const value = hex.slice(1);
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (full.length !== 6) return null;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** The line colour for a mark, named or picked. */
export function strokeFor(color: AnnotationColor): string {
  if (isNamedColor(color)) return STROKE[color];
  return parseHex(color) ? color : STROKE.amber;
}

/**
 * The highlighter's wash for a mark.
 *
 * The three named colours have hand-tuned tints. A picked colour is mixed
 * toward white instead — without this the highlighter would lay down the full
 * saturated colour and bury the text it is supposed to be drawing attention to.
 */
export function washFor(color: AnnotationColor): string {
  if (isNamedColor(color)) return WASH[color];
  const rgb = parseHex(color);
  if (!rgb) return WASH.amber;
  return toHex(rgb.map((c) => c + (255 - c) * WASH_LIGHTEN) as [number, number, number]);
}

/** A stored fraction, projected into the stage coordinates the SVG draws in. */
export const projectX = (fx: number, frame: Frame) => frame.left + fx * frame.width;
export const projectY = (fy: number, frame: Frame) => frame.top + fy * frame.height;

/** A pointer position in stage coordinates, back to a storable fraction. */
export function toFraction(clientX: number, clientY: number, rect: DOMRect): Point | null {
  if (rect.width === 0 || rect.height === 0) return null;
  return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height];
}

/** An SVG path for a freehand stroke, smoothed with quadratic midpoints. */
export function penPath(points: Point[], frame: Frame): string {
  if (points.length === 0) return '';
  const px = (p: Point) => `${projectX(p[0], frame)},${projectY(p[1], frame)}`;
  if (points.length < 3) return `M ${points.map(px).join(' L ')}`;

  let d = `M ${px(points[0] as Point)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i] as Point;
    const next = points[i + 1] as Point;
    const midX = (projectX(current[0], frame) + projectX(next[0], frame)) / 2;
    const midY = (projectY(current[1], frame) + projectY(next[1], frame)) / 2;
    d += ` Q ${projectX(current[0], frame)},${projectY(current[1], frame)} ${midX},${midY}`;
  }
  const last = points[points.length - 1] as Point;
  d += ` L ${px(last)}`;
  return d;
}

/** The two barbs of an arrow head, in stage coordinates. */
export function arrowHead(from: Point, to: Point, frame: Frame): string {
  const x1 = projectX(from[0], frame);
  const y1 = projectY(from[1], frame);
  const x2 = projectX(to[0], frame);
  const y2 = projectY(to[1], frame);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  // Scaled to the line's own length so a short arrow does not get a huge head,
  // then clamped so a long one does not get a comical one.
  const length = Math.min(18, Math.max(8, Math.hypot(x2 - x1, y2 - y1) * 0.22));
  const spread = 0.42;
  const ax = x2 - length * Math.cos(angle - spread);
  const ay = y2 - length * Math.sin(angle - spread);
  const bx = x2 - length * Math.cos(angle + spread);
  const by = y2 - length * Math.sin(angle + spread);
  return `M ${ax},${ay} L ${x2},${y2} L ${bx},${by}`;
}

/** Box corners from two opposite points, normalised so any drag direction works. */
export function boxRect(from: Point, to: Point, frame: Frame) {
  const x1 = projectX(from[0], frame);
  const y1 = projectY(from[1], frame);
  const x2 = projectX(to[0], frame);
  const y2 = projectY(to[1], frame);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
