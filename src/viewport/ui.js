// Header controls shared by both scene panels. The popover reuses the shell's .menu / .mi classes.
import { h } from '../core/dom.js';

export const tbtn = (label, title, on, run) => h('button', { class: 'tb vp-b' + (on ? ' on' : ''), title, onclick: run }, label);

// items: [{ label, checked, run }]. Closes on pick or on any outside pointer down. Only one is open at a time.
let closeOpen = null;
export function closePopover() { closeOpen?.(); }
export function popover(anchor, items) {
  closeOpen?.();
  const away = e => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const close = () => { pop.remove(); removeEventListener('pointerdown', away, true); if (closeOpen === close) closeOpen = null; };
  const pop = h('div', { class: 'menu vp-pop' }, ...items.map(it => h('div', { class: 'mi', onclick: () => { close(); it.run(); } },
    h('span', {}, (it.checked ? '✓ ' : '   ') + it.label))));
  const r = anchor.getBoundingClientRect();
  Object.assign(pop.style, { left: r.left + 'px', top: r.bottom + 'px' });
  document.body.append(pop);
  addEventListener('pointerdown', away, true);   // added now: the opening click's pointerdown has already fired
  closeOpen = close;
}

// The ⋯ button of a narrow header: items() is read on each click, so the checks are current.
export function moreButton(items) { const b = tbtn('⋯', 'More view controls', false, () => popover(b, items())); b.classList.add('vp-more'); return b; }

// Gizmos, grid and overlays, shared by both views. Overlays come from ctx.bag.overlays.
export function viewMenu(sh) {
  const items = [
    { label: 'Grid', checked: sh.grid, run: () => { sh.grid = !sh.grid; sh.redraw(); } },
    { label: 'Gizmos', checked: sh.gizmos, run: () => { sh.gizmos = !sh.gizmos; sh.redraw(); } },
    ...sh.ctx.bag.overlays.map(o => ({ label: o.label, checked: o.enabled, run: () => { o.enabled = !o.enabled; sh.redraw(); } })),
  ];
  return items;
}
