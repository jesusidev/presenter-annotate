/**
 * The shape model and wire protocol, shared by every consumer.
 *
 * Framework-free on purpose: the React binding, the script-tag embed and the
 * relay server all import from here, so there is exactly one definition of what
 * a mark is and what crosses the wire.
 */

/** The drawing tools. `off` means annotation is idle and the page stays usable. */
export type AnnotationTool = 'off' | 'arrow' | 'box' | 'pen' | 'highlight';

export type DrawTool = Exclude<AnnotationTool, 'off'>;

/** Amber first because it is the "look here" colour in the Meridian palette. */
export type AnnotationColor = 'amber' | 'red' | 'brand';

/** `[x, y]`, each 0–1, relative to the frame. Never pixels. See geometry.ts. */
export type Point = [number, number];

/**
 * The element a mark is pinned to.
 *
 * The frame is a good ruler until the page reflows — below the content
 * column's own width text takes more lines, the page gets taller, and a
 * fraction of total height stops pointing at the same paragraph. Measured on a
 * real page: 48px off at 900px, 61px at 800px.
 *
 * So a committed mark also records the element underneath it. `points` here are
 * measured against that element's box, per axis — which pins the mark to the
 * thing it was drawn on, and lets a box drawn around a button keep hugging that
 * button even when the button itself changes shape.
 *
 * Optional throughout. A mark whose anchor cannot be resolved — the element is
 * gone, the selector no longer matches, the mark predates this field — falls
 * back to the frame fractions in `AnnotationShape.points` and renders exactly
 * as it always did.
 */
export type Anchor = {
  /** A CSS selector resolving to the anchor element. */
  path: string;
  /** Points against the anchor's box, both axes scaled by its width. */
  points: Point[];
};

/**
 * A mark drawn over a page.
 *
 * Points are FRACTIONS of the frame box, never pixels. The presenter is on a
 * 27-inch display and half the room is on a laptop, so a pixel coordinate would
 * land somewhere different on every screen — the one thing an arrow cannot
 * afford to do.
 *
 * `scope` keeps a mark tied to one page or view, so moving on does not drag old
 * arrows along. In the lab that is a lesson slug; on an arbitrary site it
 * defaults to the pathname.
 */
export type AnnotationShape = {
  id: string;
  scope: string;
  tool: DrawTool;
  color: AnnotationColor;
  points: Point[];
  /** Where this mark is pinned. Absent on live strokes and on older marks. */
  anchor?: Anchor | null;
  at: number;
  by: string;
};

/** Sent by a drawing client. */
export type ClientMessage =
  /**
   * A mark still being drawn. Throttled while the pointer moves and never
   * stored, so a half-finished arrow does not survive a reconnect.
   */
  | { type: 'annotate-live'; shape: AnnotationShape }
  /** A finished mark. Stored, so someone joining late still sees it. */
  | { type: 'annotate'; shape: AnnotationShape }
  | { type: 'annotate-undo'; scope: string }
  /** Clear one scope, or everything when `scope` is null. */
  | { type: 'annotate-clear'; scope: string | null };

/** Sent by the relay. */
export type ServerMessage =
  /** Every stored mark, sent on connect so late joiners are caught up. */
  | { type: 'annotations'; shapes: AnnotationShape[] }
  | { type: 'annotate-live'; shape: AnnotationShape }
  | { type: 'annotate'; shape: AnnotationShape }
  | { type: 'annotate-undo'; id: string }
  | { type: 'annotate-clear'; scope: string | null };

export type AnyMessage = ClientMessage | ServerMessage;

/**
 * How marks reach other browsers.
 *
 * This is the seam that makes the package reusable. The bundled WebSocket
 * transport covers a throwaway site; an app with its own authenticated socket
 * — passcodes, signed cookies, an existing room protocol — implements this
 * against the socket it already has rather than opening a second, unprotected
 * one.
 */
export type Transport = {
  send(message: ClientMessage): void;
  /** Returns an unsubscribe function. */
  onMessage(handler: (message: ServerMessage) => void): () => void;
  close(): void;
};

export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Narrow an unknown payload off the wire. Returns null rather than throwing. */
export function parseMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const message = raw as { type?: unknown };
  switch (message.type) {
    case 'annotations':
    case 'annotate-live':
    case 'annotate':
    case 'annotate-undo':
    case 'annotate-clear':
      return raw as ServerMessage;
    default:
      return null;
  }
}

const isPointList = (value: unknown): value is Point[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  );

/**
 * An anchor is valid or absent — never half-formed.
 *
 * A malformed anchor is rejected rather than the whole mark, because the frame
 * fractions still render it correctly. Losing the pin is a worse mark; losing
 * the mark is a missing one.
 */
function isValidAnchor(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const anchor = value as Partial<Anchor>;
  return typeof anchor.path === 'string' && anchor.path.length > 0 && isPointList(anchor.points);
}

/** Shape-level validation, so a malformed mark cannot break a viewer's render. */
export function isShape(value: unknown): value is AnnotationShape {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<AnnotationShape>;
  return (
    typeof s.id === 'string' &&
    typeof s.scope === 'string' &&
    typeof s.color === 'string' &&
    (s.tool === 'arrow' || s.tool === 'box' || s.tool === 'pen' || s.tool === 'highlight') &&
    isPointList(s.points) &&
    isValidAnchor(s.anchor)
  );
}
