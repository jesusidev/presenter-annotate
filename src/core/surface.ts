import {
  arrowHead,
  boxRect,
  type Frame,
  LIVE_RELAY_MS,
  MIN_POINT_DELTA,
  MIN_TRAVEL,
  penPath,
  projectX,
  projectY,
  STROKE,
  toFraction,
  WASH,
} from './geometry';
import { type AnnotationState, type Store, visibleLive, visibleShapes } from './store';
import {
  type AnnotationColor,
  type AnnotationShape,
  type AnnotationTool,
  createId,
  type DrawTool,
  type Point,
} from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

  // ------------------------------------------------------------------ render

  function markElement(shape: AnnotationShape, live: boolean): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-shape', shape.id);
    if (live) g.setAttribute('opacity', '0.85');

    const stroke = STROKE[shape.color] ?? STROKE.amber;
    const points = shape.points;
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
        line(penPath(points, frame), 3);
        break;

      case 'arrow': {
        if (points.length < 2) break;
        const d = `M ${projectX(first[0], frame)},${projectY(first[1], frame)} L ${projectX(last[0], frame)},${projectY(last[1], frame)}`;
        line(d, 3);
        line(arrowHead(first, last, frame), 3);
        break;
      }

      case 'box': {
        if (points.length < 2) break;
        const r = boxRect(first, last, frame);
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
        const d = `M ${projectX(first[0], frame)},${projectY(first[1], frame)} L ${projectX(last[0], frame)},${projectY(last[1], frame)}`;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', WASH[shape.color] ?? WASH.amber);
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
    return toFraction(event.clientX, event.clientY, frameElement().getBoundingClientRect());
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

    const shape = buildShape(points);
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
