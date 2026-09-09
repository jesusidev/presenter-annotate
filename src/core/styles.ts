/**
 * Styles injected once, as a string.
 *
 * A package that drops into an arbitrary page cannot assume a CSS pipeline, a
 * bundler that handles `.css` imports, or a design system. So the styles ship
 * as a string and are injected into a `<style>` tag on first mount.
 *
 * Every selector is `pa-` prefixed and every value is literal — no CSS
 * variables from a host theme, because there may not be one.
 */
export const STYLES = `
.pa-stage { position: relative; }

.pa-surface {
  position: absolute;
  inset: 0;
  z-index: 2147483000;
  overflow: visible;
  /* Inert until armed, so the page underneath stays clickable. This is the
     line that decides whether the overlay is a tool or an obstruction. */
  pointer-events: none;
  touch-action: none;
}
.pa-surface[data-armed='true'] {
  pointer-events: auto;
  cursor: crosshair;
}

.pa-toolbar,
.pa-launcher {
  position: fixed;
  z-index: 2147483001;
  align-items: center;
  border-radius: 11px;
  border: 1px solid rgba(48, 58, 82, 0.14);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 22px rgba(16, 24, 40, 0.16);
  font-family: system-ui, -apple-system, sans-serif;
  color: #303a52;
}

.pa-toolbar {
  display: flex;
  gap: 4px;
  padding: 6px;
}

/* Hidden and shown by the same attribute, so the pair can never both be up. */
.pa-toolbar[data-minimized='true'] { display: none; }

/**
 * The pencil left behind when the bar is hidden.
 *
 * Deliberately the same shell as the toolbar — same border, blur and shadow —
 * so it reads as the toolbar folded up rather than as some other widget the
 * page has grown.
 */
.pa-launcher {
  display: none;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.pa-launcher[data-minimized='true'] { display: inline-flex; }
.pa-launcher:hover {
  transform: scale(1.08);
  box-shadow: 0 8px 26px rgba(16, 24, 40, 0.22);
}

/**
 * Placement.
 *
 * Every position is written out for both elements rather than composed from
 * edge and axis rules, because the two side positions also need the bar to
 * stack vertically and a partial rule set would put a horizontal bar half off
 * the left edge of the screen.
 */
.pa-toolbar[data-position='top-left'],
.pa-launcher[data-position='top-left'] { top: 18px; left: 18px; }

.pa-toolbar[data-position='top-center'],
.pa-launcher[data-position='top-center'] { top: 18px; left: 50%; transform: translateX(-50%); }

.pa-toolbar[data-position='top-right'],
.pa-launcher[data-position='top-right'] { top: 18px; right: 18px; }

.pa-toolbar[data-position='left-center'],
.pa-launcher[data-position='left-center'] { left: 18px; top: 50%; transform: translateY(-50%); }

.pa-toolbar[data-position='right-center'],
.pa-launcher[data-position='right-center'] { right: 18px; top: 50%; transform: translateY(-50%); }

.pa-toolbar[data-position='bottom-left'],
.pa-launcher[data-position='bottom-left'] { bottom: 18px; left: 18px; }

.pa-toolbar[data-position='bottom-center'],
.pa-launcher[data-position='bottom-center'] { bottom: 18px; left: 50%; transform: translateX(-50%); }

.pa-toolbar[data-position='bottom-right'],
.pa-launcher[data-position='bottom-right'] { bottom: 18px; right: 18px; }

/* On an edge rather than a corner, the bar runs down the screen. */
.pa-toolbar[data-position='left-center'],
.pa-toolbar[data-position='right-center'] { flex-direction: column; }

.pa-toolbar[data-position='left-center'] .pa-divider,
.pa-toolbar[data-position='right-center'] .pa-divider {
  width: 20px;
  height: 1px;
  margin: 3px 0;
}

/* Hover on the launcher already uses transform, so the centred positions have
   to reapply their own or the button jumps to the edge as the mouse arrives. */
.pa-launcher[data-position='top-center']:hover,
.pa-launcher[data-position='bottom-center']:hover { transform: translateX(-50%) scale(1.08); }
.pa-launcher[data-position='left-center']:hover,
.pa-launcher[data-position='right-center']:hover { transform: translateY(-50%) scale(1.08); }

@media (prefers-color-scheme: dark) {
  .pa-toolbar,
  .pa-launcher {
    border-color: rgba(255, 255, 255, 0.12);
    background: rgba(28, 32, 44, 0.94);
    color: #e8eaf0;
  }
}

.pa-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.pa-tool:hover { background: rgba(0, 134, 231, 0.12); }
.pa-tool[data-active='true'] { background: #0086e7; color: #fff; }

.pa-swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--pa-swatch, #b97e1e);
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease;
}
.pa-swatch:hover { transform: scale(1.12); }
.pa-swatch[data-active='true'] {
  border-color: currentColor;
  transform: scale(1.12);
}

/* The custom-colour input, reset to look like the swatches beside it. A colour
   input renders its value through a shadow part, so the roundness and the
   border have to be set on that part rather than on the input. */
.pa-swatch-custom {
  -webkit-appearance: none;
  appearance: none;
  overflow: hidden;
  /* An empty rainbow ring, so an untouched swatch reads as "pick anything"
     instead of as a fourth colour that happens to be the input's default. */
  background: conic-gradient(#d9100d, #b97e1e, #2fb344, #0086e7, #7c3aed, #d9100d);
}
.pa-swatch-custom::-webkit-color-swatch-wrapper { padding: 0; }
.pa-swatch-custom::-webkit-color-swatch { border: none; border-radius: 50%; }
.pa-swatch-custom::-moz-color-swatch { border: none; border-radius: 50%; }

/* Until it is used, let the rainbow show through instead of the value. */
.pa-swatch-custom[data-picked='false']::-webkit-color-swatch { opacity: 0; }
.pa-swatch-custom[data-picked='false']::-moz-color-swatch { opacity: 0; }

.pa-divider {
  width: 1px;
  height: 20px;
  margin: 0 3px;
  background: currentColor;
  opacity: 0.18;
}
`;

let injected = false;

export function injectStyles(doc: Document = document) {
  if (injected || doc.getElementById('pa-styles')) return;
  const style = doc.createElement('style');
  style.id = 'pa-styles';
  style.textContent = STYLES;
  doc.head.appendChild(style);
  injected = true;
}
