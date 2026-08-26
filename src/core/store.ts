import { type AnnotationShape, isShape, type ServerMessage } from './types';

/**
 * Every mark the room can see, plus the one still being drawn.
 *
 * Framework-free and synchronous: React subscribes to it with
 * `useSyncExternalStore`, the script embed subscribes with a plain callback,
 * and the relay uses the same reducer to keep its own copy. One definition of
 * "what does this message do to the shape list" for all three.
 *
 * The live stroke is held apart from the committed list on purpose. It arrives
 * dozens of times a second, is never stored, and must vanish cleanly if the
 * drawer disconnects mid-stroke — keeping it in the main list would mean
 * pruning half-finished arrows on every reconnect.
 */
export type AnnotationState = {
  shapes: AnnotationShape[];
  live: AnnotationShape | null;
};

const EMPTY: AnnotationState = { shapes: [], live: null };

export function reduce(state: AnnotationState, message: ServerMessage): AnnotationState {
  switch (message.type) {
    case 'annotations': {
      const shapes = Array.isArray(message.shapes) ? message.shapes.filter(isShape) : [];
      return { shapes, live: null };
    }

    case 'annotate-live': {
      if (!isShape(message.shape)) return state;
      return { ...state, live: message.shape };
    }

    case 'annotate': {
      if (!isShape(message.shape)) return state;
      // Replace rather than append when the id is already known: the committed
      // shape carries the same id as the live preview it finishes, and a relay
      // may deliver a duplicate after a reconnect.
      const without = state.shapes.filter((s) => s.id !== message.shape.id);
      return { shapes: [...without, message.shape], live: null };
    }

    case 'annotate-undo': {
      return { ...state, shapes: state.shapes.filter((s) => s.id !== message.id) };
    }

    case 'annotate-clear': {
      const shapes =
        message.scope === null ? [] : state.shapes.filter((s) => s.scope !== message.scope);
      return { shapes, live: null };
    }

    default:
      return state;
  }
}

export type Store = {
  getState(): AnnotationState;
  /** Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  apply(message: ServerMessage): void;
  /** Optimistically show the local presenter's own mark before it round-trips. */
  applyLocal(message: ServerMessage): void;
  reset(): void;
};

export function createStore(): Store {
  let state: AnnotationState = EMPTY;
  const listeners = new Set<() => void>();

  const set = (next: AnnotationState) => {
    // Identity is the subscription signal, so skip the notify when nothing moved.
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply(message) {
      set(reduce(state, message));
    },
    applyLocal(message) {
      set(reduce(state, message));
    },
    reset() {
      set(EMPTY);
    },
  };
}

/** The shapes belonging to one scope, which is all a given page renders. */
export function visibleShapes(state: AnnotationState, scope: string): AnnotationShape[] {
  return state.shapes.filter((s) => s.scope === scope);
}

/** The live preview, but only when it belongs to the scope on screen. */
export function visibleLive(state: AnnotationState, scope: string): AnnotationShape | null {
  return state.live && state.live.scope === scope ? state.live : null;
}

/** The most recent mark this client drew, for undo. */
export function lastDrawnBy(
  state: AnnotationState,
  by: string,
  scope: string
): AnnotationShape | null {
  for (let i = state.shapes.length - 1; i >= 0; i -= 1) {
    const shape = state.shapes[i] as AnnotationShape;
    if (shape.by === by && shape.scope === scope) return shape;
  }
  return null;
}
