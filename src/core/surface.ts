import {
  arrowHead,
  boxRect,
  clampToFrame,
  type Frame,
  LIVE_RELAY_MS,
  MIN_POINT_DELTA,
  isUsableAnchor,
  MIN_TRAVEL,
  penPath,
  projectX,
  projectY,
  strokeFor,
  toFraction,
  washFor,
} from './geometry';
import { type AnnotationState, type Store, visibleLive, visibleShapes } from './store';
import {
  type Anchor,
  type AnnotationColor,
  type AnnotationShape,
  type AnnotationTool,
  createId,
  type DrawTool,
  type Point,
} from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * How far up the tree a selector path may go.
 *
 * Deep enough to be specific, shallow enough that the path stays short and
 * does not encode every wrapper div between the mark and the body.
 */
const MAX_ANCHOR_DEPTH = 12;

export type SurfaceOptions = {
  /** The element the SVG is sized to. Marks may sit anywhere inside it. */
  stage: HTMLElement;
  store: Store;
  /** Who this client is, so undo only removes your own marks. */
  by: string;
  /** Emitted when a mark is finished. Wire this to your transport. */
  onDraw(shape: AnnotationShape): void;
  /** Emitted while drawing, already throttled. */
  onLiveDraw(shape: AnnotationShape): void;
};

/**
 * The drawing surface: an SVG overlay, pointer handling, and the measuring
 * that keeps marks on the same words at every window size.
 *
 * Deliberately free of any framework. The React binding mounts one of these in
 * an effect and the script embed constructs one directly, so the geometry and
 * event handling exist once rather than once per binding.
 */
export function createSurface(options: SurfaceOptions) {
  const { stage, store, by } = options;

  let tool: AnnotationTool = 'off';
  let color: AnnotationColor = 'amber';
  let scope = '';
  let canDraw = false;

  let frame: Frame = { left: 0, top: 0, width: 0, height: 0 };
  let box = { width: 0, height: 0 };

  let drawing: Point[] | null = null;
  let lastRelay = 0;
  let strokeId = '';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'pa-surface');
  svg.setAttribute('aria-hidden', 'true');
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = 'Marks drawn during the walkthrough';
  svg.appendChild(title);
  stage.appendChild(svg);

  const armed = () => canDraw && tool !== 'off';

  /** The column marks are measured against, or the stage when none is marked. */
  const frameElement = (): HTMLElement =>
    stage.querySelector<HTMLElement>('[data-annotation-frame]') ?? stage;

  function measure() {
    const stageRect = stage.getBoundingClientRect();
    const rect = frameElement().getBoundingClientRect();
    box = { width: stageRect.width, height: stageRect.height };
    frame = {
      left: rect.left - stageRect.left,
      top: rect.top - stageRect.top,
      width: rect.width,
      height: rect.height,
    };
    svg.setAttribute('width', String(box.width));
    svg.setAttribute('height', String(box.height));
    svg.setAttribute('viewBox', `0 0 ${Math.max(box.width, 1)} ${Math.max(box.height, 1)}`);
    render();
  }

  // ------------------------------------------------------------------ anchors

  /**
   * A selector for an element, stable enough to resolve in another browser
   * showing the same page.
   *
   * `nth-of-type` rather than `nth-child` so that a conditionally rendered
   * sibling of a different tag does not shift the index. A host app can do
   * better by putting `data-annotation-id` on the things worth pointing at,
   * which is honoured first and ends the path immediately.
   */
  function selectorPath(element: HTMLElement): string | null {
    const parts: string[] = [];
    let node: HTMLElement | null = element;
    let depth = 0;

    while (node && node !== document.body && depth < MAX_ANCHOR_DEPTH) {
      const explicit = node.getAttribute('data-annotation-id');
      if (explicit) {
        parts.unshift(`[data-annotation-id="${CSS.escape(explicit)}"]`);
        return parts.join(' ');
      }

      const parent: HTMLElement | null = node.parentElement;
      if (!parent) return null;

      const tag = node.tagName.toLowerCase();
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node?.tagName);
      parts.unshift(`${tag}:nth-of-type(${sameTag.indexOf(node) + 1})`);

      node = parent;
      depth += 1;
    }

    if (parts.length === 0) return null;
    // Anchored at body when we walked all the way; otherwise a loose descendant
    // selector, which is what makes a capped path still resolve.
    return node === document.body ? `body > ${parts.join(' > ')}` : parts.join(' > ');
  }

  /**
   * The topmost page element at a point, ignoring our own overlay.
   *
   * `elementsFromPoint` rather than `elementFromPoint` because while a tool is
   * armed the SVG has pointer-events and would otherwise be the only answer.
   */
  function elementAt(stageX: number, stageY: number): HTMLElement | null {
    if (typeof document.elementsFromPoint !== 'function') return null;
    const stageRect = stage.getBoundingClientRect();
    const clientX = stageX + stageRect.left;
    const clientY = stageY + stageRect.top;
    if (clientX < 0 || clientY < 0 || clientX > innerWidth || clientY > innerHeight) return null;

    for (const candidate of document.elementsFromPoint(clientX, clientY)) {
      // The SVG overlay is an SVGElement, so this excludes it outright.
      if (!(candidate instanceof HTMLElement)) continue;
      if (candidate.closest('.pa-toolbar')) continue;
      if (candidate === document.body || candidate === document.documentElement) continue;
      return candidate;
    }
    return null;
  }

  /** An anchor's box in stage coordinates, or null when it no longer resolves. */
  function resolveAnchor(path: string): Frame | null {
    let element: HTMLElement | null = null;
    try {
      element = document.querySelector<HTMLElement>(path);
    } catch {
      return null; // A path that is not valid CSS is simply not an anchor.
    }
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    // A zero-sized box is not a ruler. Either axis being flat would divide by
    // zero on the way in and multiply by zero on the way out.
    if (rect.width === 0 || rect.height === 0) return null;

    const stageRect = stage.getBoundingClientRect();

    // A full-width wrapper is the window wearing a disguise. Refusing it here
    // rather than at capture means an anchor recorded before this check — or
    // one that has since grown to fill the viewport — is refused too.
    if (!isUsableAnchor(rect.width, frame.width, stageRect.width)) return null;

    return {
      left: rect.left - stageRect.left,
      top: rect.top - stageRect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * The point a mark should be pinned by.
   *
   * An arrow is pinned by its TIP, because the tip is the thing being pointed
   * at — pinning it by its middle would anchor it to whatever blank space the
   * shaft crosses. Everything else is pinned by the centre of its extent, which
   * for a box drawn around a button is the button, even though the drag started
   * outside it.
   */
  function probePoint(tool: DrawTool, points: Point[]): Point | null {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return null;
    if (tool === 'arrow') return last;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  /**
   * Re-measure a finished mark against the element underneath it.
   *
   * Done at commit rather than at pointer-down on purpose: only the finished
   * mark knows its own extent, and it is the extent — not the corner the drag
   * happened to start at — that says what the mark is about.
   */
  function buildAnchor(tool: DrawTool, points: Point[]): Anchor | null {
    const probe = probePoint(tool, points);
    if (!probe) return null;

    const element = elementAt(projectX(probe[0], frame), projectY(probe[1], frame));
    if (!element) return null;

    const path = selectorPath(element);
    if (!path) return null;

    // Must round-trip: if the path does not resolve back to a box, an anchor
    // would be a promise we cannot keep at render time.
    const ruler = resolveAnchor(path);
    if (!ruler) return null;

    const anchored = points.map<Point>(([fx, fy]) => [
      (projectX(fx, frame) - ruler.left) / ruler.width,
      (projectY(fy, frame) - ruler.top) / ruler.height,
    ]);

    return { path, points: anchored };
  }

  // ------------------------------------------------------------------ render

  function markElement(shape: AnnotationShape, live: boolean): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-shape', shape.id);
    if (live) g.setAttribute('opacity', '0.85');

    const stroke = strokeFor(shape.color);

    /**
     * Anchor first, frame second.
     *
     * When the anchor resolves the mark is drawn against the element it was
     * pinned to, which is what keeps it on that element at a different window
     * width. When it does not — element gone, page changed, mark older than
     * this field — the frame fractions still describe the mark, so it renders
     * the way it always did rather than not at all.
     */
    const anchored = shape.anchor ? resolveAnchor(shape.anchor.path) : null;
    const ruler = anchored ?? frame;
    const points = anchored && shape.anchor ? shape.anchor.points : shape.points;

    const first = points[0] as Point;
    const last = points[points.length - 1] as Point;

    const line = (d: string, width: number, opacity = 1, cap: 'round' | 'butt' = 'round') => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', String(width));
      path.setAttribute('stroke-linecap', cap);
      path.setAttribute('stroke-linejoin', 'round');
      if (opacity !== 1) path.setAttribute('opacity', String(opacity));
      g.appendChild(path);
    };

    switch (shape.tool) {
      case 'pen':
        line(penPath(points, ruler), 3);
        break;

      case 'arrow': {
        if (points.length < 2) break;
        const d = `M ${projectX(first[0], ruler)},${projectY(first[1], ruler)} L ${projectX(last[0], ruler)},${projectY(last[1], ruler)}`;
        line(d, 3);
        line(arrowHead(first, last, ruler), 3);
        break;
      }

      case 'box': {
        if (points.length < 2) break;
        const r = boxRect(first, last, ruler);
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(r.x));
        rect.setAttribute('y', String(r.y));
        rect.setAttribute('width', String(r.width));
        rect.setAttribute('height', String(r.height));
        rect.setAttribute('rx', '4');
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', stroke);
        rect.setAttribute('stroke-width', '3');
        g.appendChild(rect);
        break;
      }

      case 'highlight': {
        if (points.length < 2) break;
        // A thick, low-opacity band along the drag — the marker-pen look, which
        // reads better over text than a filled rectangle.
        const d = `M ${projectX(first[0], ruler)},${projectY(first[1], ruler)} L ${projectX(last[0], ruler)},${projectY(last[1], ruler)}`;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', washFor(shape.color));
        path.setAttribute('stroke-width', '20');
        path.setAttribute('stroke-linecap', 'butt');
        path.setAttribute('opacity', '0.55');
        g.appendChild(path);
        break;
      }
    }

    return g;
  }

  function render() {
    const state: AnnotationState = store.getState();
    // Rebuild rather than diff. A walkthrough holds tens of shapes, not
    // thousands, and a correct rebuild beats a clever patch that drifts.
    while (svg.lastChild && svg.lastChild !== title) svg.removeChild(svg.lastChild);
    for (const shape of visibleShapes(state, scope)) svg.appendChild(markElement(shape, false));
    const live = visibleLive(state, scope);
    if (live) svg.appendChild(markElement(live, true));
    svg.setAttribute('data-armed', String(armed()));
  }

  // ----------------------------------------------------------------- drawing

  const buildShape = (points: Point[]): AnnotationShape => ({
    id: strokeId,
    scope,
    tool: (tool === 'off' ? 'arrow' : tool) as DrawTool,
    color,
    points,
    at: Date.now(),
    by,
  });

  function pointFrom(event: PointerEvent): Point | null {
    // Read the frame live rather than trusting the cached measurement, so a
    // mark started during a layout change still lands where it was aimed.
    const point = toFraction(event.clientX, event.clientY, frameElement().getBoundingClientRect());
    // Held inside the content, so a mark can never be about margin that does
    // not exist at another width. The live preview clamps too, which is what
    // shows the presenter they have reached the edge.
    return point && clampToFrame(point);
  }

  function onPointerDown(event: PointerEvent) {
    if (!armed()) return;
    const point = pointFrom(event);
    if (!point) return;
    svg.setPointerCapture(event.pointerId);
    strokeId = createId();
    drawing = [point];
    lastRelay = 0;
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (!armed() || !drawing) return;
    const point = pointFrom(event);
    if (!point) return;

    if (tool === 'pen') {
      const previous = drawing[drawing.length - 1] as Point;
      if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < MIN_POINT_DELTA) return;
      drawing.push(point);
    } else {
      // Arrows, boxes and highlights are two-point shapes: the second point
      // just tracks the pointer.
      drawing[1] = point;
    }

    const shape = buildShape([...drawing]);
    store.applyLocal({ type: 'annotate-live', shape });
    render();

    // Relay on a throttle. Dropping a preview frame costs viewers a little
    // smoothness and nothing else — the committed shape is what lasts.
    const now = performance.now();
    if (now - lastRelay >= LIVE_RELAY_MS) {
      lastRelay = now;
      options.onLiveDraw(shape);
    }
  }

  function finish() {
    const points = drawing;
    drawing = null;
    if (!points) return;

    // A click with no drag is almost always a misfire, not a zero-length arrow.
    if (points.length < 2) {
      store.applyLocal({ type: 'annotate-clear', scope: null });
      return;
    }
    if (tool !== 'pen') {
      const [from, to] = points as [Point, Point];
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) < MIN_TRAVEL) return;
    }

    // Pin the finished mark to whatever it was drawn on. Live strokes stay
    // frame-only: they are ephemeral, and probing the DOM 30 times a second to
    // pin something that is about to be replaced would be work for nothing.
    const base = buildShape(points);
    const shape: AnnotationShape = { ...base, anchor: buildAnchor(base.tool, points) };

    store.applyLocal({ type: 'annotate', shape });
    options.onDraw(shape);
    render();
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', () => {
    drawing = null;
    render();
  });

  // --------------------------------------------------------------- measuring

  /**
   * A ResizeObserver on BOTH boxes rather than a window listener: the frame
   * also changes height when a page's own interactive parts expand, and the
   * frame's height is half the ruler.
   */
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
  observer?.observe(stage);
  const initialFrame = frameElement();
  if (observer && initialFrame !== stage) observer.observe(initialFrame);

  // Web fonts change how text wraps, which moves the bottom of the column.
  document.fonts?.ready.then(measure).catch(() => undefined);

  const unsubscribe = store.subscribe(render);
  measure();

  return {
    setTool(next: AnnotationTool) {
      tool = next;
      svg.setAttribute('data-armed', String(armed()));
    },
    setColor(next: AnnotationColor) {
      color = next;
    },
    setScope(next: string) {
      scope = next;
      render();
    },
    setCanDraw(next: boolean) {
      canDraw = next;
      svg.setAttribute('data-armed', String(armed()));
    },
    measure,
    destroy() {
      unsubscribe();
      observer?.disconnect();
      svg.remove();
    },
  };
}

export type Surface = ReturnType<typeof createSurface>;
