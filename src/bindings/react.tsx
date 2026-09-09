'use client';

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { type Annotator, createAnnotator } from '../core';
import { createWebSocketTransport } from '../core/transport';
import type { AnnotationState } from '../core/store';
import type { ToolbarPosition } from '../core/toolbar';
import type { Transport } from '../core/types';

/**
 * The React binding.
 *
 * Deliberately thin. The geometry, rendering, pointer handling and toolbar all
 * live in the framework-free core, so this file is lifecycle and nothing else —
 * which is also why the script-tag build is not a second implementation.
 */

export type AnnotationProviderProps = {
  children: ReactNode;
  /** Supply your own to reuse an authenticated socket. */
  transport?: Transport;
  /** Used only when `transport` is omitted. */
  url?: string;
  room?: string;
  /** Ties marks to one view. Defaults to the pathname. */
  scope?: string;
  canDraw?: boolean;
  toolbar?: boolean;
  /**
   * Which edge or corner the toolbar sits on: `'top-left'`, `'top-center'`,
   * `'top-right'`, `'left-center'`, `'right-center'`, `'bottom-left'`,
   * `'bottom-center'` (the default) or `'bottom-right'`.
   */
  toolbarPosition?: ToolbarPosition;
  /** Start collapsed to a floating pencil, and collapse again whenever this changes. */
  toolbarMinimized?: boolean;
  by?: string;
  className?: string;
};

/**
 * Wraps the content you want to draw over.
 *
 * Mark the content column inside it with `data-annotation-frame` — that element
 * becomes the ruler marks are stored against, so they land on the same words on
 * every screen. Without it the whole wrapper is used, which is correct but
 * drifts when the window is wider than the content.
 */
export function AnnotationProvider({
  children,
  transport,
  url,
  room,
  scope,
  canDraw = false,
  toolbar,
  toolbarPosition,
  toolbarMinimized,
  by,
  className,
}: AnnotationProviderProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const annotatorRef = useRef<Annotator | null>(null);

  // Created once. A transport that reconnects on every render would drop the
  // socket mid-stroke.
  const ownedTransport = useMemo(() => {
    if (transport) return null;
    if (typeof window === 'undefined') return null;
    return createWebSocketTransport({
      url: url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/annotate`,
      room,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const active = transport ?? ownedTransport;
    if (!stage || !active) return;

    const annotator = createAnnotator({
      stage,
      transport: active,
      scope,
      canDraw,
      toolbar,
      toolbarPosition,
      toolbarMinimized,
      by,
    });
    annotatorRef.current = annotator;

    return () => {
      annotator.destroy();
      annotatorRef.current = null;
    };
    // Mount once: the setters below handle prop changes without a remount,
    // because tearing down the surface would drop every mark on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, ownedTransport]);

  useEffect(() => {
    if (scope !== undefined) annotatorRef.current?.setScope(scope);
  }, [scope]);

  useEffect(() => {
    annotatorRef.current?.setCanDraw(canDraw);
  }, [canDraw]);

  useEffect(() => {
    if (toolbarPosition) annotatorRef.current?.setToolbarPosition(toolbarPosition);
  }, [toolbarPosition]);

  /**
   * Follows the prop when it CHANGES, and otherwise leaves it alone.
   *
   * That makes the prop usable as a control — a host with its own "hide the
   * tools" button can drive it — without the effect fighting the presenter
   * every time they use the toolbar's own minimize button, since their click
   * does not change the prop.
   */
  useEffect(() => {
    if (toolbarMinimized !== undefined) {
      annotatorRef.current?.setToolbarMinimized(toolbarMinimized);
    }
  }, [toolbarMinimized]);

  useEffect(() => () => ownedTransport?.close(), [ownedTransport]);

  return (
    <div ref={stageRef} className={className} style={{ position: 'relative' }}>
      {children}
    </div>
  );
}

const EMPTY: AnnotationState = { shapes: [], live: null };

/**
 * Read the current marks, for a host app that wants to show a count or a
 * "clear" button of its own.
 */
export function useAnnotations(): AnnotationState {
  const annotator = useRef<Annotator | null>(null);
  return useSyncExternalStore(
    (listener) => annotator.current?.store.subscribe(listener) ?? (() => undefined),
    () => annotator.current?.store.getState() ?? EMPTY,
    () => EMPTY
  );
}

/**
 * The one-liner.
 *
 * Drop `<PresenterAnnotate />` into a root layout, run
 * `npx presenter-annotate serve`, and the page is annotatable. `present`
 * decides whether this browser draws or only watches.
 */
export function PresenterAnnotate(props: Omit<AnnotationProviderProps, 'children'> & {
  present?: boolean;
}) {
  const { present, ...rest } = props;
  // Default to the URL saying so, which means one build serves presenter and
  // viewers without a rebuild or an env var.
  const isPresenter =
    present ??
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('present'));

  return (
    <AnnotationProvider {...rest} canDraw={isPresenter}>
      <div data-annotation-frame style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    </AnnotationProvider>
  );
}

export { createAnnotator } from '../core';
export { createLocalTransport, createWebSocketTransport } from '../core/transport';
export { TOOLBAR_POSITIONS, type ToolbarPosition } from '../core/toolbar';
export type { AnnotationColor, AnnotationShape, AnnotationTool, Transport } from '../core/types';
