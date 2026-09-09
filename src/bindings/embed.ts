import { createAnnotator } from '../core';
import { isToolbarPosition, type ToolbarPosition } from '../core/toolbar';
import { createWebSocketTransport } from '../core/transport';

/**
 * The script-tag build, for a page that is not yours to rebuild.
 *
 *     <script src="http://localhost:7420/embed.js" data-present></script>
 *
 * Viewers load the same page without `data-present` and watch. Everything is
 * read off the script tag, so there is nothing to configure in code.
 *
 * Options, all optional:
 *   data-present            this browser may draw
 *   data-room="name"        share marks with everyone in the same room
 *   data-url="ws://..."     a relay other than the one that served this file
 *   data-scope="id"         tie marks to something other than the pathname
 *   data-frame="main"       CSS selector for the content column ruler
 *   data-position="top-right"  where the toolbar and its pencil sit
 *   data-minimized          start collapsed to the pencil
 */

type Config = {
  present: boolean;
  room?: string;
  url: string;
  scope?: string;
  frame?: string;
  position?: ToolbarPosition;
  minimized: boolean;
};

function readConfig(): Config {
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[src*="embed"]');

  const data = script?.dataset ?? {};

  // Default the relay to wherever this script came from, so the common case
  // needs no configuration at all.
  let url = data.url;
  if (!url && script?.src) {
    const origin = new URL(script.src, location.href);
    origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    origin.pathname = '/annotate';
    origin.search = '';
    url = origin.toString();
  }

  /**
   * A misspelled position falls back to the default instead of leaving the bar
   * unpositioned in the top-left corner of the viewport, which is what an
   * unmatched attribute selector would do — and would look like a bug in the
   * package rather than a typo in the script tag.
   */
  const position = isToolbarPosition(data.position) ? data.position : undefined;
  if (data.position && !position) {
    console.warn(
      `[presenter-annotate] data-position="${data.position}" is not a position; using bottom-center.`
    );
  }

  return {
    present: data.present !== undefined,
    room: data.room,
    url: url ?? `ws://localhost:7420/annotate`,
    scope: data.scope,
    frame: data.frame,
    position,
    minimized: data.minimized !== undefined,
  };
}

function start() {
  const config = readConfig();

  /**
   * Pick the ruler.
   *
   * On an arbitrary page there is no `data-annotation-frame`, so guess at the
   * main content column: an explicit selector wins, then the usual landmarks,
   * then the body. Getting this wrong does not break anything — marks are still
   * consistent between browsers at the same width — it just means they drift
   * when two people have very different window widths.
   */
  const frame =
    (config.frame ? document.querySelector<HTMLElement>(config.frame) : null) ??
    document.querySelector<HTMLElement>('[data-annotation-frame]') ??
    document.querySelector<HTMLElement>('main') ??
    document.querySelector<HTMLElement>('#root, #__next, #app') ??
    document.body;

  if (frame !== document.body) frame.setAttribute('data-annotation-frame', '');

  const transport = createWebSocketTransport({ url: config.url, room: config.room });

  const annotator = createAnnotator({
    stage: document.body,
    transport,
    scope: config.scope ?? location.pathname,
    canDraw: config.present,
    toolbar: config.present,
    toolbarPosition: config.position,
    toolbarMinimized: config.minimized,
  });

  // Handy for the console, and for a host page that wants to drive it.
  (window as unknown as { presenterAnnotate?: unknown }).presenterAnnotate = annotator;

  // Single-page apps change the URL without reloading; follow it so marks stay
  // tied to the view they were drawn on.
  let lastPath = location.pathname;
  const followRoute = () => {
    if (config.scope || location.pathname === lastPath) return;
    lastPath = location.pathname;
    annotator.setScope(lastPath);
  };
  addEventListener('popstate', followRoute);
  setInterval(followRoute, 400);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
