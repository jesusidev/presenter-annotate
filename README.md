# presenter-annotate

Draw over a page while you present it, and everyone watching sees the marks appear on their own screen.

Extracted from the annotation layer built for `pod-workflow-introduction`, made framework-free so it works in a React app **or** on any page via one script tag.

```
arrow · box · pen · highlight        amber · red · blue        undo · clear
```

---

## The bit that matters

Marks are stored as **fractions of the content column**, never pixels and never fractions of the window.

That sounds like a detail and it is the whole thing. The presenter is on a 27-inch display, half the room is on a laptop, and a pixel coordinate lands somewhere different on every screen — which is the one thing an arrow cannot afford to do. The window is the wrong ruler too: a content column is usually a fixed width and the viewport is not, so widening the window slides every window-fraction sideways while the words stay put.

`npm test` asserts this rather than trusting the comment: the frame-relative ruler is exact at 1280, 1440, 1920 and 2560px, and the window-relative one is measured drifting 123px off.

Below the column's own width the page reflows, so no single ruler can be exact. Marks are proportional there, not precise. That is a real limit, not a bug.

---

## Install

No registry. Install straight from a path or a git URL:

```bash
npm i github:jesusidev/presenter-annotate
npm i file:../presenter-annotate      # while working on it
```

---

## Use it: React

```tsx
import { PresenterAnnotate } from 'presenter-annotate/react';

export default function RootLayout({ children }) {
  return (
    <body>
      {children}
      <PresenterAnnotate />
    </body>
  );
}
```

Then:

```bash
npx presenter-annotate serve
```

Open the page with `?present` to draw. Everyone else opens it normally and watches.

**Mark your content column** so marks land on the same words at every width:

```tsx
<main data-annotation-frame>{children}</main>
```

Without it the whole wrapper is the ruler — correct, but it drifts when the window is much wider than the content.

### Wiring it to a socket you already have

An app with its own authenticated socket should **not** use the bundled transport — it would open a second, unprotected connection beside the one it already trusts. Implement `Transport` against the existing one:

```tsx
const transport = {
  send: (message) => myRoomSocket.send(JSON.stringify(message)),
  onMessage: (handler) => myRoomSocket.subscribe(handler),
  close: () => {},
};

<AnnotationProvider transport={transport} canDraw={isFacilitator}>
  {children}
</AnnotationProvider>
```

That is the seam the whole package is arranged around.

---

## Use it: any page, one script tag

For a site that is not yours to rebuild:

```html
<script src="http://localhost:7420/embed.js" data-present></script>
```

Viewers load the same page **without** `data-present`.

| Attribute | Does |
| --- | --- |
| `data-present` | This browser may draw. Omit it to watch |
| `data-room="x"` | Share marks with everyone in the same room |
| `data-url="ws://…"` | A relay other than the one that served the script |
| `data-scope="id"` | Tie marks to something other than the pathname |
| `data-frame="main"` | CSS selector for the content column ruler |

With no `data-frame`, it guesses: `[data-annotation-frame]`, then `main`, then `#root` / `#__next` / `#app`, then `body`. Guessing wrong does not break anything — marks stay consistent between browsers at the same width; they just drift when two people have very different windows.

The embed follows client-side route changes, so marks stay tied to the view they were drawn on in a single-page app.

---

## Shortcuts

| Key | |
| --- | --- |
| `V` | Pointer — page stays usable |
| `A` `B` `P` `H` | Arrow, box, pen, highlight |
| `1` `2` `3` | Amber, red, blue |
| `U` / `C` | Undo your last mark / clear this page |
| `Esc` | Back to pointer |

Ignored while you are typing in an input, so "a box" in a search field does not silently arm two tools.

---

## Security

**The bundled relay has no authentication.** Anyone who can reach the port can draw. That is fine for a laptop and a tunnel you take down afterwards; it is not fine for anything public or long-lived.

For anything with real users, implement `Transport` against your own authenticated socket and do not run the relay at all.

---

## How it fits together

```
src/core/          framework-free — geometry, store, SVG surface, toolbar
  types.ts         shapes and the wire protocol
  geometry.ts      the two-box coordinate system
  store.ts         shape list + message reducer (also used by the relay)
  surface.ts       SVG overlay, pointer handling, ResizeObserver measuring
  toolbar.ts       inline-SVG toolbar, no UI kit
  transport.ts     the seam, plus a reconnecting WebSocket default
src/bindings/
  react.tsx        thin lifecycle wrapper over the core
  embed.ts         IIFE for the script tag
server/relay.mjs   rooms, replay on join, live-stroke pass-through
bin/cli.mjs        npx presenter-annotate serve
```

Both bindings mount the **same** core. The React component is lifecycle and nothing else, which is why supporting a script tag did not double the work.

Two boxes, and conflating them is the classic bug:

- **stage** — spans the viewport, sizes the SVG, so a mark can sit anywhere on screen
- **frame** — the content column, marked `data-annotation-frame`, which marks are stored against

Re-measured with a `ResizeObserver` on both, plus on `document.fonts.ready`, because web fonts change how text wraps and that moves the bottom of the column.

---

## Checks

```bash
npm run type-check   # tsc --noEmit
npm run build        # esbuild → dist/
npm test             # relay (10) + geometry (13)
```

The relay test drives **real websocket clients through a real relay** — a mark drawn by one arriving at another, a late joiner being caught up, a half-finished stroke not being stored, rooms staying isolated. Those are protocol behaviours, so a unit test would not have proven them.

---

## Known gaps

- **No test drives real pointer events.** The geometry is tested directly and the protocol is tested over sockets, but nothing simulates a drag in a browser. That needs Playwright.
- **Undo is scoped, not per-person.** The relay has no identity, so it removes the newest mark in the scope. The client resolves "your last mark" locally, but two people drawing at once can undo each other's.
- **The toolbar is fixed bottom-centre** with no way to move it.
