import { createStore, lastDrawnBy, type Store } from './store';
import { injectStyles } from './styles';
import { createSurface, type Surface } from './surface';
import { createToolbar, type Toolbar } from './toolbar';
import {
  type AnnotationColor,
  type AnnotationTool,
  createId,
  type Transport,
} from './types';

export * from './geometry';
export * from './store';
export * from './styles';
export * from './surface';
export * from './toolbar';
export * from './transport';
export * from './types';

export type AnnotatorOptions = {
  /** The element the overlay covers. Defaults to document.body. */
  stage?: HTMLElement;
  /** How marks reach other browsers. */
  transport: Transport;
  /** Ties marks to one page or view. Defaults to the pathname. */
  scope?: string;
  /** Whether this client may draw. Viewers get false. */
  canDraw?: boolean;
  /** Whether to render the presenter toolbar. Defaults to `canDraw`. */
  toolbar?: boolean;
  /** Identifies this client's own marks, so undo removes yours and not theirs. */
  by?: string;
};

/**
 * Everything wired together: store, transport, drawing surface and toolbar.
 *
 * This is what both bindings call. The React component mounts one in an effect;
 * the script embed constructs one on load. Neither reimplements the geometry.
 */
export function createAnnotator(options: AnnotatorOptions) {
  injectStyles();

  const stage = options.stage ?? document.body;
  const by = options.by ?? createId();
  let scope = options.scope ?? location.pathname;
  let canDraw = options.canDraw ?? false;

  // The stage needs to be a positioning context for the absolutely-positioned
  // overlay. Setting it here rather than asking the host to remember.
  if (getComputedStyle(stage).position === 'static') {
    stage.classList.add('pa-stage');
  }

  const store: Store = createStore();

  const unsubscribeTransport = options.transport.onMessage((message) => {
    store.apply(message);
  });

  const surface: Surface = createSurface({
    stage,
    store,
    by,
    onDraw: (shape) => options.transport.send({ type: 'annotate', shape }),
    onLiveDraw: (shape) => options.transport.send({ type: 'annotate-live', shape }),
  });

  surface.setScope(scope);
  surface.setCanDraw(canDraw);

  const undo = () => {
    const mine = lastDrawnBy(store.getState(), by, scope);
    if (!mine) return;
    store.applyLocal({ type: 'annotate-undo', id: mine.id });
    options.transport.send({ type: 'annotate-undo', scope });
  };

  const clear = () => {
    store.applyLocal({ type: 'annotate-clear', scope });
    options.transport.send({ type: 'annotate-clear', scope });
  };

  let toolbar: Toolbar | null = null;
  const wantsToolbar = options.toolbar ?? canDraw;
  if (wantsToolbar) {
    toolbar = createToolbar({
      mount: document.body,
      onTool: (tool) => surface.setTool(tool),
      onColor: (color) => surface.setColor(color),
      onUndo: undo,
      onClear: clear,
    });
  }

  return {
    store,
    surface,
    toolbar,
    setScope(next: string) {
      scope = next;
      surface.setScope(next);
    },
    setCanDraw(next: boolean) {
      canDraw = next;
      surface.setCanDraw(next);
    },
    setTool(tool: AnnotationTool) {
      surface.setTool(tool);
      toolbar?.setTool(tool);
    },
    setColor(color: AnnotationColor) {
      surface.setColor(color);
      toolbar?.setColor(color);
    },
    undo,
    clear,
    destroy() {
      unsubscribeTransport();
      surface.destroy();
      toolbar?.destroy();
    },
  };
}

export type Annotator = ReturnType<typeof createAnnotator>;
