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

/** Shape-level validation, so a malformed mark cannot break a viewer's render. */
export function isShape(value: unknown): value is AnnotationShape {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<AnnotationShape>;
  return (
    typeof s.id === 'string' &&
    typeof s.scope === 'string' &&
    typeof s.color === 'string' &&
    (s.tool === 'arrow' || s.tool === 'box' || s.tool === 'pen' || s.tool === 'highlight') &&
    Array.isArray(s.points) &&
    s.points.length > 0 &&
    s.points.every(
      (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
    )
  );
}
