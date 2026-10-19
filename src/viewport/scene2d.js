// Scene 2D: top-down canvas of the island. Pan, zoom, pick, move / rotate / scale with snapping, overlays.
import { h } from '../core/dom.js';
import { CAMP_R, DEPOSIT_R, PLAYER_R, PILE_MAX, islandRA } from '../core/heft-data.js';
import { view2, zoomAt, frameBox, gridStep, sceneItems, pickAt, idsInRect, rectOf, boundsOf, moveDelta, sweepRot, snapTo, DEG, pileSlot, gizmoHit, clamp } from './geom.js';
import { tbtn, popover, viewMenu, closePopover, moreButton } from './ui.js';

const COL = { water: '#3b7f92', sand: '#d9c088', grass: '#7c9f4f', ring: '#ffcf6a', sel: '#ffa43d', tree: ['#3f6b3a', '#6a9440', '#d08a33'],
  trunk: '#6b4a2f', rock: ['#8f897d', '#8a8478'], wood: '#9a6a3c', stone: '#8d877c', wall: '#8f5f36', bench: '#ae7d43', player: '#e2a57a',
  x: '#e2504c', z: '#4b8cf5', acc: '#3d8bfd' };
const gone = o => o.removed || !(o.hp > 0);
const HCUR = { x: 'ew-resize', sx: 'ew-resize', z: 'ns-resize', sz: 'ns-resize', xz: 'move', u: 'nwse-resize', rot: 'grab' };

export function scene2d(sh) {
  const { ctx } = sh, { store, data } = ctx;
  const canvas = h('canvas', { class: 'vp-canvas' }), readout = h('div', { class: 'vp-read' });
  const g = canvas.getContext('2d');
  const area = h('div', { class: 'vp-view' }, canvas, readout);
  let cam = { cx: 0, cz: 0, scale: 4 }, W = 0, H = 0, dpr = 1, framed = false, dirty = true, drag = null, gid = 0, cursor = [0, 0];
  let btnGrid, btnLink, disposed = false, hovH = null;   // hovH: gizmo handle under the pointer
  const self = {};
  const ac = new AbortController(), L = { signal: ac.signal };   // every DOM listener of this view goes through this signal

  const view = () => view2(cam.cx, cam.cz, cam.scale, W, H);
  const items = () => sceneItems(store.project, data.STRUCT);
  // Handle geometry for the current selection: pivot at the bounds centre, R in metres for the rotate ring and scale handle.
  const pivotOf = ids => {
    const b = boundsOf(sh.starts(ids).map(s => ({ x: s.x, z: s.z })));
    return b && { x: b.cx, z: b.cz, R: Math.max(1.2, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 0.8) };
  };
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const px = n => n / cam.scale;   // screen pixels to metres at the current zoom

  function resize() {
    W = area.clientWidth; H = area.clientHeight; dpr = Math.min(devicePixelRatio || 1, 2);
    if (W < 2 || H < 2) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!framed) { cam = frameBox({ cx: 0, cz: 0, minX: -48, maxX: 48, minZ: -48, maxZ: 48 }, W, H); framed = true; }
    dirty = true;
  }

  function info() {
    const t = store.ui.tool, s = store.ui.snap ? `snap ${store.ui.snapMove} m` : 'snap off';
    readout.textContent = `x ${cursor[0].toFixed(2)}  z ${cursor[1].toFixed(2)}   ·   ${cam.scale.toFixed(1)} px/m   ·   ${t}   ·   ${s}`;
  }

  // ---------------------------------------------------------------- input
  canvas.addEventListener('pointerdown', e => {
    if (!W) return;
    const [sx, sy] = local(e), [wx, wz] = view().toWorld(sx, sy);
    const mod = e.ctrlKey || e.metaKey || e.shiftKey, tool = store.ui.tool, ids = store.selection;
    if (e.button === 1 || (e.button === 0 && (e.altKey || sh.space))) {
      drag = { kind: 'pan', sx, sy, cx: cam.cx, cz: cam.cz };
      canvas.setPointerCapture(e.pointerId); e.preventDefault();   // middle button: no autoscroll, drag keeps tracking outside the canvas
    } else if (e.button === 0) {
      canvas.setPointerCapture(e.pointerId);
      const pv = ids.length && sh.gizmos ? pivotOf(ids) : null, hh = pv ? gizmoHit(tool, pv, wx, wz, px(1)) : null;
      if (hh === 'rot') drag = { kind: 'rotate', ...pv, a: Math.atan2(wz - pv.z, wx - pv.x), t: 0, starts: sh.starts(ids), key: 'rot' + ++gid };
      else if (hh === 'u') drag = { kind: 'scale', ...pv, d0: Math.hypot(wx - pv.x, wz - pv.z) || 1, starts: sh.starts(ids), key: 'scl' + ++gid };
      else if (hh === 'sx' || hh === 'sz') drag = { kind: 'spread', ...pv, axis: hh, f0: (hh === 'sx' ? wx - pv.x : wz - pv.z) || 1, starts: sh.starts(ids), key: 'spr' + ++gid };
      else if (hh) drag = { kind: 'move', sx, sy, w0: [wx, wz], starts: sh.starts(ids), anchor: { x: pv.x, z: pv.z }, moved: false, click: null, axis: hh, key: 'mv' + ++gid };
      else {
        const hit = pickAt(items(), wx, wz, px(6));
        if (hit && mod) drag = { kind: 'click', hit, e };
        else if (hit) {
          const pre = ids.includes(hit);
          if (!pre) sh.select([hit], e);
          const starts = sh.starts(store.selection), b = boundsOf(starts.map(s => ({ x: s.x, z: s.z })));
          drag = { kind: 'move', sx, sy, w0: [wx, wz], starts, anchor: { x: b.cx, z: b.cz }, moved: false, click: pre ? hit : null, axis: 'xz', key: 'mv' + ++gid };
        } else drag = { kind: 'marquee', x0: sx, y0: sy, x1: sx, y1: sy, e, moved: false };
      }
    }
    canvas.style.cursor = drag?.kind === 'pan' ? 'grabbing' : '';
    dirty = true;
  }, L);

  canvas.addEventListener('pointermove', e => {
    if (!W) return;
    const [sx, sy] = local(e), v = view(), [wx, wz] = v.toWorld(sx, sy);
    cursor = [wx, wz]; info();
    if (!drag) {
      sh.setHover(pickAt(items(), wx, wz, px(6)));
      const pv = sh.gizmos && store.selection.length ? pivotOf(store.selection) : null, hh = pv ? gizmoHit(store.ui.tool, pv, wx, wz, px(1)) : null;
      if (hh !== hovH) { hovH = hh; dirty = true; }
      canvas.style.cursor = HCUR[hh] ?? '';
      return;
    }
    const d = drag;
    if (d.kind === 'pan') {
      cam.cx = d.cx - (sx - d.sx) / cam.scale; cam.cz = d.cz - (sy - d.sy) / cam.scale;
      sh.linkFrom(self, cam.cx, cam.cz); dirty = true;
    } else if (d.kind === 'move') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
      d.moved = true;
      const m = moveDelta(d.anchor, { dx: wx - d.w0[0], dz: wz - d.w0[1] }, store.ui.snap, store.ui.snapMove);
      if (d.axis === 'x') m.dz = 0; else if (d.axis === 'z') m.dx = 0;   // arrows constrain; the centre square moves freely
      sh.commit('Move', d.starts, { kind: 'move', dx: m.dx, dz: m.dz }, d.key);
    } else if (d.kind === 'rotate') {
      const a = Math.atan2(wz - d.z, wx - d.x);
      d.t += sweepRot(d.a, a); d.a = a;
      const t = store.ui.snap ? snapTo(d.t, store.ui.snapRotate / DEG) : d.t;
      sh.commit('Rotate', d.starts, { kind: 'rotate', px: d.x, pz: d.z, t }, d.key);
    } else if (d.kind === 'scale') {
      const f = Math.hypot(wx - d.x, wz - d.z) / d.d0;
      sh.commit('Scale', d.starts, { kind: 'scale', f, snap: store.ui.snap }, d.key);
    } else if (d.kind === 'spread') {
      const r = clamp((d.axis === 'sx' ? wx - d.x : wz - d.z) / d.f0, 0.1, 5), f = store.ui.snap ? clamp(snapTo(r, 0.05), 0.1, 5) : r;
      sh.commit('Scale', d.starts, { kind: 'spread', px: d.x, pz: d.z, fx: d.axis === 'sx' ? f : 1, fz: d.axis === 'sz' ? f : 1 }, d.key);
    } else if (d.kind === 'marquee') {
      d.x1 = sx; d.y1 = sy;
      if (!d.moved && Math.hypot(sx - d.x0, sy - d.y0) < 3) return;
      d.moved = true; dirty = true;
    }
  }, L);

  const end = e => {
    const d = drag; drag = null; canvas.style.cursor = '';
    if (!d || !W) return;
    if (d.kind === 'marquee') {
      const v = view(), [sx, sy] = local(e);
      const ids = d.moved ? idsInRect(items(), (x, z) => v.toScreen(x, z), rectOf(d.x0, d.y0, sx, sy)) : [];
      sh.select(ids, d.e);
    } else if (d.kind === 'click') sh.select([d.hit], e);
    else if (d.kind === 'move' && !d.moved && d.click) sh.select([d.click], e);
    dirty = true;
  };
  canvas.addEventListener('pointerup', end, L);
  canvas.addEventListener('pointercancel', end, L);
  canvas.addEventListener('pointerleave', () => { if (hovH) { hovH = null; dirty = true; } }, L);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = local(e);
    cam = zoomAt(view(), sx, sy, Math.exp(-e.deltaY * 0.0015));
    sh.linkFrom(self, cam.cx, cam.cz); dirty = true; info();
  }, { passive: false, signal: ac.signal });

  // ---------------------------------------------------------------- draw
  function draw() {
    const v = view(), c = g, L = store.project.level, STR = data.STRUCT, s = cam.scale;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = COL.water; c.fillRect(0, 0, W, H);
    const shore = inset => {
      c.beginPath();
      for (let i = 0; i <= 180; i++) {
        const a = i / 180 * Math.PI * 2, R = islandRA(a) + inset, [x, y] = v.toScreen(Math.cos(a) * R, Math.sin(a) * R);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath();
    };
    shore(0.9); c.fillStyle = COL.sand; c.fill();
    shore(-1.0); c.fillStyle = COL.grass; c.fill();

    if (sh.grid) {
      const step = gridStep(s), [x0, z0] = v.toWorld(0, 0), [x1, z1] = v.toWorld(W, H);
      c.lineWidth = 1;
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        c.strokeStyle = Math.round(x / step) % 5 ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.26)';
        const sx = Math.round(v.toScreen(x, 0)[0]) + 0.5; c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, H); c.stroke();
      }
      for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) {
        c.strokeStyle = Math.round(z / step) % 5 ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.26)';
        const sy = Math.round(v.toScreen(0, z)[1]) + 0.5; c.beginPath(); c.moveTo(0, sy); c.lineTo(W, sy); c.stroke();
      }
    }

    // camp rings: claim radius and deposit ring
    const disc = (x, z, r) => { const [sx, sy] = v.toScreen(x, z); c.beginPath(); c.arc(sx, sy, r * s, 0, Math.PI * 2); };
    c.lineWidth = 1.5;
    disc(0, 0, CAMP_R); c.setLineDash([8, 6]); c.strokeStyle = 'rgba(255,207,106,.65)'; c.stroke(); c.setLineDash([]);
    disc(0, 0, DEPOSIT_R); c.fillStyle = 'rgba(255,207,106,.14)'; c.fill(); c.strokeStyle = COL.ring; c.stroke();
    const [cx0, cy0] = v.toScreen(0, 0); c.fillStyle = COL.ring; c.fillRect(cx0 - 2, cy0 - 2, 4, 4);

    // structure claim circles (faint) and stock piles
    for (const st of L.structures) {
      const cr = STR[st.type]?.claim; if (!cr) continue;
      disc(st.x, st.z, cr); c.setLineDash([3, 5]); c.strokeStyle = 'rgba(255,195,90,.28)'; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
    }
    const rect = (x, z, w, d, rot) => {
      const [sx, sy] = v.toScreen(x, z); c.save(); c.translate(sx, sy); c.rotate(-rot); c.fillRect(-w * s / 2, -d * s / 2, w * s, d * s); c.restore();
    };
    c.fillStyle = COL.wood;
    for (let i = 0; i < Math.min(PILE_MAX, L.stock.wood); i++) { const p = pileSlot('wood', i); rect(p.x, p.z, 0.86, 0.24, p.rot); }
    c.fillStyle = COL.stone;
    for (let i = 0; i < Math.min(PILE_MAX, L.stock.stone); i++) { const p = pileSlot('stone', i); disc(p.x, p.z, 0.2); c.fill(); }

    // resources
    for (const o of L.resources) {
      if (o.kind === 'tree') {
        if (gone(o)) { disc(o.x, o.z, 0.2 * o.s); c.fillStyle = COL.trunk; c.fill(); continue; }
        disc(o.x, o.z, 0.95 * o.s); c.fillStyle = COL.tree[o.v] ?? COL.tree[0]; c.fill();
        c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1; c.stroke();
        disc(o.x, o.z, 0.12 * o.s); c.fillStyle = COL.trunk; c.fill();
      } else if (gone(o)) {
        for (const [dx, dz] of [[0.3, 0.1], [-0.2, 0.25], [0, -0.3]]) { disc(o.x + dx * o.s, o.z + dz * o.s, 0.12); c.fillStyle = COL.rock[1]; c.fill(); }
      } else {
        c.beginPath();
        for (let k = 0; k < 7; k++) {
          const a = o.rot - k * Math.PI * 2 / 7, r = 0.9 * o.s * (0.85 + 0.15 * Math.sin(k * 2.3 + o.id)), [sx, sy] = v.toScreen(o.x + Math.cos(a) * r, o.z - Math.sin(a) * r);
          k ? c.lineTo(sx, sy) : c.moveTo(sx, sy);
        }
        c.closePath(); c.fillStyle = COL.rock[o.v] ?? COL.rock[0]; c.fill(); c.strokeStyle = 'rgba(0,0,0,.3)'; c.stroke();
      }
    }

    // structures
    for (const st of L.structures) {
      if (st.type === 'campfire') {
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; disc(st.x + Math.cos(a) * 0.55, st.z + Math.sin(a) * 0.55, 0.17); c.fillStyle = COL.stone; c.fill(); }
        disc(st.x, st.z, 0.45); c.fillStyle = 'rgba(255,140,60,.45)'; c.fill();
        disc(st.x, st.z, 0.2); c.fillStyle = '#ffb347'; c.fill();
      } else if (st.type === 'wall') {
        c.fillStyle = COL.wall; rect(st.x, st.z, 2.3, 0.25, st.rot ?? 0);
      } else if (st.type === 'workbench') {
        c.fillStyle = COL.bench; rect(st.x, st.z, 1.5, 0.75, st.rot ?? 0);
      } else { disc(st.x, st.z, STR[st.type]?.foot ?? 0.8); c.fillStyle = COL.bench; c.fill(); }
    }

    // player with facing arrow (figure faces +z at rot 0)
    const P = L.player, [px0, py0] = v.toScreen(P.x, P.z);
    disc(P.x, P.z, PLAYER_R); c.fillStyle = COL.player; c.fill(); c.strokeStyle = '#1d1410'; c.lineWidth = 1.5; c.stroke();
    const fx = Math.sin(P.rot ?? 0), fz = Math.cos(P.rot ?? 0), [tx, ty] = v.toScreen(P.x + fx * 0.9, P.z + fz * 0.9);
    c.beginPath(); c.moveTo(px0, py0); c.lineTo(tx, ty); c.strokeStyle = '#1d1410'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(tx, ty, 3.5, 0, Math.PI * 2); c.fillStyle = '#1d1410'; c.fill();

    // selection outlines, hover, handles
    const all = items(), byId = new Map(all.map(i => [i.id, i]));
    c.lineWidth = 2;
    for (const id of store.selection) {
      const it = byId.get(id); if (!it) continue;
      disc(it.x, it.z, it.r + px(3)); c.strokeStyle = COL.sel; c.stroke();
    }
    if (sh.hover && !store.selection.includes(sh.hover) && byId.has(sh.hover)) {
      const it = byId.get(sh.hover); disc(it.x, it.z, it.r + px(2)); c.strokeStyle = '#8ec5ff'; c.lineWidth = 1; c.stroke();   // thin light blue, apart from the orange selection
    }
    if (sh.gizmos && store.selection.length) {
      const pv = pivotOf(store.selection);
      if (pv) {
        const [qx, qy] = v.toScreen(pv.x, pv.z), tool = store.ui.tool;
        if (tool === 'scale') {
          const b = boundsOf(sh.starts(store.selection).map(q => ({ x: q.x, z: q.z })));
          const [a0, b0] = v.toScreen(b.minX, b.minZ), [a1, b1] = v.toScreen(b.maxX, b.maxZ);
          c.setLineDash([4, 3]); c.strokeStyle = COL.sel; c.lineWidth = 1; c.strokeRect(a0, b0, a1 - a0, b1 - b0); c.setLineDash([]);
        }
        const lit = name => hovH === name || drag?.axis === name;   // hovered, or the handle being dragged
        if (tool === 'move') {
          const arrow = (name, x1, y1, col) => {
            const on = lit(name), k = on ? '#fff' : col;
            c.beginPath(); c.moveTo(qx, qy); c.lineTo(x1, y1); c.strokeStyle = k; c.lineWidth = on ? 3.5 : 2; c.stroke();
            const a = Math.atan2(y1 - qy, x1 - qx); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4)); c.lineTo(x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)); c.closePath(); c.fillStyle = k; c.fill();
          };
          arrow('x', ...v.toScreen(pv.x + px(60), pv.z), COL.x); arrow('z', ...v.toScreen(pv.x, pv.z + px(60)), COL.z);
          c.fillStyle = lit('xz') ? '#fff' : COL.acc; c.fillRect(qx - 5, qy - 5, 10, 10);
        }
        if (tool === 'rotate') { disc(pv.x, pv.z, pv.R); c.setLineDash([5, 4]); c.strokeStyle = COL.sel; c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); const [hx, hy] = v.toScreen(pv.x, pv.z - pv.R); c.beginPath(); c.arc(hx, hy, 5, 0, Math.PI * 2); c.fillStyle = COL.sel; c.fill(); }
        if (tool === 'scale') {
          const knob = (name, ax, az) => { const [hx, hy] = v.toScreen(pv.x + ax, pv.z + az), on = lit(name); c.beginPath(); c.moveTo(qx, qy); c.lineTo(hx, hy); c.strokeStyle = on ? '#fff' : COL.sel; c.lineWidth = on ? 2 : 1; c.stroke(); c.fillStyle = on ? '#fff' : COL.sel; c.fillRect(hx - 4, hy - 4, 8, 8); };
          knob('sx', pv.R, 0); knob('sz', 0, pv.R); knob('u', pv.R * 0.7071, pv.R * 0.7071);
        }
        c.beginPath(); c.arc(qx, qy, 3, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
      }
    }
    if (drag?.kind === 'marquee' && drag.moved) {
      const r = rectOf(drag.x0, drag.y0, drag.x1, drag.y1);
      c.fillStyle = 'rgba(61,139,253,.16)'; c.fillRect(r.x, r.y, r.w, r.h); c.strokeStyle = COL.acc; c.lineWidth = 1; c.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }

    for (const o of ctx.bag.overlays) if (o.enabled && o.draw2d) { c.save(); o.draw2d(c, v); c.restore(); }

    // scale bar
    const step = gridStep(s), bar = step * s;
    // top-left, because the cursor readout already sits bottom-left
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(8, 8, bar + 12, 18);
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(14, 17); c.lineTo(14 + bar, 17); c.stroke();
    c.fillStyle = '#fff'; c.font = '11px ' + getComputedStyle(canvas).fontFamily; c.fillText(`${step} m`, 14 + bar + 6, 21);
    btnGrid?.classList.toggle('on', sh.grid); btnLink?.classList.toggle('on', sh.link);
  }

  // ---------------------------------------------------------------- panel
  const btnFrame = tbtn('Frame', 'Frame selection (F)', false, () => sh.frame(store.selection));
  btnGrid = tbtn('Grid', 'Grid (G)', sh.grid, () => { sh.grid = !sh.grid; sh.redraw(); });
  btnLink = tbtn('Link', 'Link cameras: 2D centre to 3D target', sh.link, () => {
    sh.link = !sh.link; if (sh.link) sh.linkFrom(self, cam.cx, cam.cz); sh.redraw();
  });
  const btnOv = tbtn('Overlays ▾', 'Overlays, gizmos and grid', false, () => popover(btnOv, viewMenu(sh)));
  const more = moreButton(() => [
    { label: 'Frame selection', checked: false, run: () => btnFrame.click() },
    { label: 'Link cameras', checked: sh.link, run: () => btnLink.click() },
    ...viewMenu(sh),
  ]);
  const bar = h('div', { class: 'vp-bar' }, h('span', { class: 'vp-title' }, 'Scene 2D · Top'), h('span', { class: 'sp' }), h('div', { class: 'vp-grp vp-collapse' }, btnFrame, btnGrid, btnLink, btnOv), more);
  const root = h('div', { class: 'vp' }, bar, area);

  const ro = new ResizeObserver(() => !disposed && resize()); ro.observe(area);
  Object.assign(self, {
    element: root,
    update() { dirty = true; },
    onResize: resize,
    dirty() { dirty = true; },
    tick() { if (!disposed && dirty && W > 1) { dirty = false; draw(); } },
    centre: () => ({ x: cam.cx, z: cam.cz }),
    scale: () => cam.scale,
    setCentre(x, z) { cam.cx = x; cam.cz = z; dirty = true; info(); },
    frame(b) {
      if (W < 2) return;
      cam = frameBox(b, W, H); sh.linkFrom(self, cam.cx, cam.cz); dirty = true; info();
    },
    dispose() {
      if (disposed) return; disposed = true;
      ac.abort(); ro.disconnect(); closePopover();
      drag = null; sh.views.delete(self); if (sh.v2 === self) sh.v2 = null;
    },
  });
  sh.views.add(self); sh.v2 = self;
  info();
  return self;
}
