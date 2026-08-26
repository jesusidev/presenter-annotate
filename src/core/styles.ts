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

.pa-toolbar {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483001;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 11px;
  border: 1px solid rgba(48, 58, 82, 0.14);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 22px rgba(16, 24, 40, 0.16);
  font-family: system-ui, -apple-system, sans-serif;
}

@media (prefers-color-scheme: dark) {
  .pa-toolbar {
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
