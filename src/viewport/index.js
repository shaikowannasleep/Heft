// Pillar 1 entry: Scene 2D + Scene 3D share one store and one frame loop. See docs/ARCHITECTURE.md.
import { sceneItems, boundsOf, startsOf, xformed, applySelection, modeOf } from './geom.js';
import { scene2d } from './scene2d.js';
import { scene3d } from './scene3d.js';
import './viewport.css';

export function install(ctx) {
  const { store, data } = ctx;
  const sh = {
    ctx, views: new Set(), v2: null, v3: null,
    grid: true, gizmos: true, link: false, space: false, hover: null, animate: false,
    setHover(id) { if (id !== this.hover) { this.hover = id; this.redraw(); } },
    redraw() { for (const v of this.views) v.dirty(); },
    commit(label, starts, op, key) {
      store.update(label, d => { for (const st of starts) { const n = ctx.draftNode(d, st.id); if (n) Object.assign(n, xformed(st, op)); } }, key);
    },
    starts: ids => startsOf(ids, ctx.getNode),
    select: (ids, e) => store.select(applySelection(store.selection, ids, modeOf(e))),
    linkFrom(src, x, z) { if (sh.link) for (const v of sh.views) if (v !== src) v.setCentre(x, z); },
    frame(ids) {
      const all = sceneItems(store.project, data.STRUCT);
      const pick = all.filter(i => ids.includes(i.id));
      const b = boundsOf((pick.length ? pick : all).map(i => ({ x: i.x, z: i.z })));
      if (!b) return;
      for (const v of sh.views) v.frame(b);
    },
    preset: p => sh.v3?.preset(p),
    toggleProj: () => sh.v3?.toggleProj(),
  };
  // One loop for both views, so a store change lands in the same frame in 2D and 3D.
  const loop = now => { for (const v of sh.views) v.tick(now); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  ctx.bag.redraw = () => sh.redraw();   // pillars call this after changing an overlay (enabled / rev / data)

  ctx.registerPanel({ id: 'scene2d', title: 'Scene 2D', area: 'center', noScroll: true, create: () => scene2d(sh) });
  ctx.registerPanel({ id: 'scene3d', title: 'Scene 3D', area: 'center', noScroll: true, create: () => scene3d(sh) });

  const cmd = (id, label, run, extra = {}) => ctx.registerCommand({ id, label, menu: 'View', run, ...extra });
  cmd('view.top', 'Top view (Numpad 7)', () => sh.preset('top'));
  cmd('view.iso', 'Iso view (Numpad 1)', () => sh.preset('iso'));
  cmd('view.persp', 'Perspective toggle (Numpad 5)', () => sh.toggleProj());
  cmd('view.grid', 'Grid', () => { sh.grid = !sh.grid; sh.redraw(); }, { keys: 'G' });

  // Numpad keys carry e.code, not e.key, so the shell's hotkey table cannot route them.
  addEventListener('keydown', e => {
    if (e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    if (e.code === 'Space') { sh.space = true; e.preventDefault(); return; }
    const p = { Numpad7: 'top', Numpad1: 'iso' }[e.code];
    if (p) { e.preventDefault(); sh.preset(p); }
    else if (e.code === 'Numpad5') { e.preventDefault(); sh.toggleProj(); }
  });
  addEventListener('keyup', e => { if (e.code === 'Space') sh.space = false; });
  addEventListener('blur', () => { sh.space = false; });

  // Services for the other pillars and the shell.
  const bag = ctx.bag;
  bag.frame = ids => sh.frame(ids);
  bag.viewCenter = () => sh.v2 ? sh.v2.centre() : sh.v3 ? sh.v3.centre() : { x: 0, z: 0 };
  // Debug hook for tools/viewport-shots.mjs; not a public API.
  bag.viewport = {
    stats: () => sh.v3?.stats() ?? null,
    where: () => ({ cam2: sh.v2?.centre(), scale2: sh.v2?.scale(), cam3: sh.v3?.where() ?? null }),
    preset: p => sh.preset(p),
    project: (x, z) => sh.v3?.project(x, z) ?? null,
  };
}
