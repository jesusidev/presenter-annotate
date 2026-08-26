import { STROKE } from './geometry';
import type { AnnotationColor, AnnotationTool } from './types';

/**
 * The presenter's controls, with no UI-kit dependency.
 *
 * The original used Mantine's Tooltip and Tabler icons, neither of which can
 * ship in a package meant to drop into an arbitrary page. Icons are inline SVG
 * paths and the tooltip is a `title` attribute — less pretty, and it works
 * everywhere without pulling a design system along.
 *
 * Every button has a single-key shortcut, because reaching for a toolbar
 * mid-sentence is exactly the friction that stops people annotating at all.
 */

const ICONS: Record<string, string> = {
  // pointer / off
  off: 'M4 3l7 17 2.5-6.5L20 11z',
  arrow: 'M7 17L17 7M17 7H9M17 7v8',
  box: 'M4 5h16v14H4z',
  pen: 'M3 21l4-1 11-11a2.1 2.1 0 10-3-3L4 17z',
  highlight: 'M4 19h16M6 15l6-9 5 3-6 9z',
  undo: 'M9 14L4 9l5-5M4 9h9a7 7 0 010 14H8',
  clear: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
};

const TOOLS: { tool: AnnotationTool; key: string; label: string }[] = [
  { tool: 'off', key: 'v', label: 'Pointer — page stays usable (V)' },
  { tool: 'arrow', key: 'a', label: 'Arrow (A)' },
  { tool: 'box', key: 'b', label: 'Box (B)' },
  { tool: 'pen', key: 'p', label: 'Pen (P)' },
  { tool: 'highlight', key: 'h', label: 'Highlight (H)' },
];

const COLORS: { color: AnnotationColor; key: string; label: string }[] = [
  { color: 'amber', key: '1', label: 'Amber — look here (1)' },
  { color: 'red', key: '2', label: 'Red — a problem (2)' },
  { color: 'brand', key: '3', label: 'Blue — a step (3)' },
];

export type ToolbarOptions = {
  mount: HTMLElement;
  onTool(tool: AnnotationTool): void;
  onColor(color: AnnotationColor): void;
  onUndo(): void;
  onClear(): void;
};

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '17');
  svg.setAttribute('height', '17');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

export function createToolbar(options: ToolbarOptions) {
  let tool: AnnotationTool = 'off';
  let color: AnnotationColor = 'amber';

  const bar = document.createElement('div');
  bar.className = 'pa-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Annotation tools');

  const toolButtons = new Map<AnnotationTool, HTMLButtonElement>();
  const colorButtons = new Map<AnnotationColor, HTMLButtonElement>();

  for (const entry of TOOLS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pa-tool';
    button.title = entry.label;
    button.setAttribute('aria-label', entry.label);
    button.appendChild(icon(ICONS[entry.tool] as string));
    button.addEventListener('click', () => setTool(entry.tool));
    bar.appendChild(button);
    toolButtons.set(entry.tool, button);
  }

  const divider = () => {
    const d = document.createElement('span');
    d.className = 'pa-divider';
    bar.appendChild(d);
  };

  divider();

  for (const entry of COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pa-swatch';
    button.title = entry.label;
    button.setAttribute('aria-label', entry.label);
    button.style.setProperty('--pa-swatch', STROKE[entry.color]);
    button.addEventListener('click', () => setColor(entry.color));
    bar.appendChild(button);
    colorButtons.set(entry.color, button);
  }

  divider();

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'pa-tool';
  undo.title = 'Undo your last mark (U)';
  undo.setAttribute('aria-label', 'Undo your last mark');
  undo.appendChild(icon(ICONS.undo as string));
  undo.addEventListener('click', () => options.onUndo());
  bar.appendChild(undo);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'pa-tool';
  clear.title = 'Clear this page (C)';
  clear.setAttribute('aria-label', 'Clear this page');
  clear.appendChild(icon(ICONS.clear as string));
  clear.addEventListener('click', () => options.onClear());
  bar.appendChild(clear);

  function paint() {
    for (const [key, button] of toolButtons) {
      button.setAttribute('data-active', String(key === tool));
    }
    for (const [key, button] of colorButtons) {
      button.setAttribute('data-active', String(key === color));
    }
  }

  function setTool(next: AnnotationTool) {
    tool = next;
    paint();
    options.onTool(next);
  }

  function setColor(next: AnnotationColor) {
    color = next;
    paint();
    options.onColor(next);
  }

  /**
   * Shortcuts, ignored while the user is typing.
   *
   * Without the guard, typing "a box" into any input on the page silently arms
   * the arrow tool and then the box tool.
   */
  function onKeyDown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        return;
      }
    }

    const key = event.key.toLowerCase();
    if (key === 'escape') return setTool('off');
    const toolMatch = TOOLS.find((t) => t.key === key);
    if (toolMatch) return setTool(toolMatch.tool);
    const colorMatch = COLORS.find((c) => c.key === key);
    if (colorMatch) return setColor(colorMatch.color);
    if (key === 'u') return options.onUndo();
    if (key === 'c') return options.onClear();
  }

  document.addEventListener('keydown', onKeyDown);
  options.mount.appendChild(bar);
  paint();

  return {
    element: bar,
    setTool,
    setColor,
    destroy() {
      document.removeEventListener('keydown', onKeyDown);
      bar.remove();
    },
  };
}

export type Toolbar = ReturnType<typeof createToolbar>;
