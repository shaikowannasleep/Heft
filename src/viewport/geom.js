// Pure viewport math: 2D view transforms, picking, marquee, selection, snapping and transforms.
// No DOM or three.js imports, so tests/viewport-geom.test.mjs runs under plain node.
// Orientation: world +x is screen right and world +z is screen down (a right-handed top view, the same as the 3D Top preset).
import { r2, r3, clamp, WOOD_PILE, STONE_PILE } from '../core/heft-data.js';
export { clamp };

export const DEG = 180 / Math.PI;

export function view2(cx, cz, scale, w, h) {
  return {
    cx, cz, scale, w, h,
    toScreen: (x, z) => [w / 2 + (x - cx) * scale, h / 2 + (z - cz) * scale],
    toWorld: (sx, sy) => [cx + (sx - w / 2) / scale, cz + (sy - h / 2) / scale],
  };
}

// Zoom about a screen point: the world point under the cursor stays where it is.
export function zoomAt(v, sx, sy, factor, min = 1.5, max = 150) {
  const [wx, wz] = v.toWorld(sx, sy);
  const scale = clamp(v.scale * factor, min, max);
  return { cx: wx - (sx - v.w / 2) / scale, cz: wz - (sy - v.h / 2) / scale, scale };
}

export function boundsOf(pts) {
  if (!pts.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

// Scale that fits a box in a w x h view, with a little room around it.
export function frameBox(b, w, h) {
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6) * 1.3 + 2;
  return { cx: b.cx, cz: b.cz, scale: clamp(Math.min(w, h) / span, 1.5, 150) };
}

const GRID_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50];
// Metres between grid lines so that neighbouring lines are at least ~28 px apart.
export const gridStep = scale => GRID_STEPS.find(s => s * scale >= 28) ?? GRID_STEPS.at(-1);

// Scene items for picking and drawing: footprint radius r (m) and pick height h (m) for ray tests.
export function sceneItems(p, STRUCT) {
  const L = p.level, out = [{ id: 'player', kind: 'player', x: L.player.x, z: L.player.z, r: 0.5, h: 1.8, obj: L.player }];
  for (const s of L.structures) out.push({ id: 's:' + s.id, kind: s.type, x: s.x, z: s.z, r: STRUCT[s.type]?.foot ?? 0.8, h: 2.2, obj: s });
  for (const o of L.resources) {
    const gone = o.removed || !(o.hp > 0);
    const r = gone ? 0.3 : o.kind === 'tree' ? 0.95 * o.s : 0.9 * o.s, h = gone ? 0.4 : o.kind === 'tree' ? 3.2 * o.s : 1.0 * o.s;
    out.push({ id: 'r:' + o.id, kind: o.kind, x: o.x, z: o.z, r, h, obj: o });
  }
  return out;
}

// Nearest item whose footprint (plus pad, in metres) contains the point.
export function pickAt(items, x, z, pad = 0) {
  let best = null, bk = Infinity;
  for (const it of items) {
    const d = Math.hypot(it.x - x, it.z - z), rr = it.r + pad;
    if (d <= rr && d / rr < bk) { bk = d / rr; best = it.id; }
  }
  return best;
}

// Ray (origin o, direction d) against vertical cylinders that stand on y = 0. Returns the nearest id or null.
export function pickRay(items, o, d) {
  let best = null, bt = Infinity;
  for (const it of items) {
    const t = rayCylinder(o, d, it.x, it.z, it.r, it.h);
    if (t < bt) { bt = t; best = it.id; }
  }
  return best;
}

export function rayCylinder(o, d, cx, cz, r, h) {
  const a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-12) return Infinity;
  const ex = o[0] - cx, ez = o[2] - cz;
  const b = 2 * (ex * d[0] + ez * d[2]), c = ex * ex + ez * ez - r * r, disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
    if (t < 0) continue;
    const y = o[1] + t * d[1];
    if (y >= 0 && y <= h) return t;
  }
  return Infinity;
}

export const rectOf = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });

// Ids whose centre projects inside the screen rectangle. project(x, z) => [sx, sy].
export function idsInRect(items, project, rc) {
  const out = [];
  for (const it of items) {
    const [sx, sy] = project(it.x, it.z);
    if (sx >= rc.x && sx <= rc.x + rc.w && sy >= rc.y && sy <= rc.y + rc.h) out.push(it.id);
  }
  return out;
}

// mode: 'set' (plain click or drag), 'add' (Shift), 'toggle' (Ctrl / Cmd).
export const modeOf = e => (e.ctrlKey || e.metaKey) ? 'toggle' : e.shiftKey ? 'add' : 'set';
export function applySelection(cur, ids, mode) {
  if (mode === 'add') return [...new Set([...cur, ...ids])];
  if (mode === 'toggle') { const hit = new Set(ids); return [...cur.filter(i => !hit.has(i)), ...ids.filter(i => !cur.includes(i))]; }
  return [...new Set(ids)];
}

export const snapTo = (v, step) => step > 0 ? Math.round(v / step) * step : v;

// Snapped move: the anchor (selection pivot) lands on the grid, so the whole group keeps its spacing.
export function moveDelta(anchor, raw, snap, step) {
  if (!snap) return { dx: raw.dx, dz: raw.dz };
  return { dx: snapTo(anchor.x + raw.dx, step) - anchor.x, dz: snapTo(anchor.z + raw.dz, step) - anchor.z };
}

export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
// Three.js rotation.y = t turns the world point (x, z) so that its atan2(z, x) angle drops by t. This gives the t for a cursor sweep.
export const sweepRot = (a0, a1) => -wrapAngle(a1 - a0);
// Rotation about +Y, the same as three.js rotation.y.
export function rotY(x, z, t) { const c = Math.cos(t), s = Math.sin(t); return [x * c + z * s, -x * s + z * c]; }

// Uniform scale factor from a three.js scale change. The axis that changed most wins, so one handle scales the object.
export function scaleFactor(s, s0) {
  let f = 1;
  for (let k = 0; k < 3; k++) { const r = s[k] / s0[k]; if (Math.abs(Math.log(r)) > Math.abs(Math.log(f))) f = r; }
  return f;
}

// Snapshot of the selected nodes the transform ops work from. Structures have no s.
export function startsOf(ids, getNode) {
  const out = [];
  for (const id of ids) {
    const o = getNode(id)?.obj;
    if (o) out.push({ id, x: o.x, z: o.z, rot: o.rot ?? 0, s: o.s });
  }
  return out;
}

// New transform of one node after a move, rotate or scale op (pure; the store recipe assigns the result).
export function xformed(st, op) {
  if (op.kind === 'move') return { x: r2(st.x + op.dx), z: r2(st.z + op.dz) };
  if (op.kind === 'rotate') {
    const [nx, nz] = rotY(st.x - op.px, st.z - op.pz, op.t);
    return { x: r2(op.px + nx), z: r2(op.pz + nz), rot: r3(st.rot + op.t) };
  }
  if (st.s == null) return {};
  let s = st.s * op.f;
  if (op.snap) s = snapTo(s, 0.05);
  return { s: r2(clamp(s, 0.5, 2)) };
}

// Orbit camera position around a target for yaw and elevation. yaw = PI/4, el = 0.64 is the game's iso view.
export function orbitPos(t, yaw, el, dist) {
  return [t[0] + Math.sin(yaw) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(yaw) * Math.cos(el) * dist];
}

// Ground claim field for the shader (port of the game's rebuildClaims): 0..255 per cell, 128 is the claim edge.
export function territoryField(claims, res, span) {
  const field = new Uint8Array(res * res), cell = span / res;
  for (const c of claims) {
    const R = c.r + 4;
    const i0 = Math.max(0, Math.floor((c.x - R + span / 2) / cell)), i1 = Math.min(res - 1, Math.ceil((c.x + R + span / 2) / cell));
    const j0 = Math.max(0, Math.floor((c.z - R + span / 2) / cell)), j1 = Math.min(res - 1, Math.ceil((c.z + R + span / 2) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const wx = (i + 0.5) * cell - span / 2, wz = (j + 0.5) * cell - span / 2;
      const v = Math.round(clamp((c.r - Math.hypot(wx - c.x, wz - c.z)) / 8 + 0.5, 0, 1) * 255), k = j * res + i;
      if (v > field[k]) field[k] = v;
    }
  }
  return field;
}

// World position and yaw of stock item i, ported from the game's pileSlot (jitter left out, so piles are a little tidier).
export function pileSlot(type, i) {
  if (type === 'wood') {
    const layer = Math.floor(i / 6), k = i % 6, c = k % 2, row = Math.floor(k / 2);
    const lay = layer % 2 === 0
      ? { x: (c - 0.5) * 0.86, z: (row - 1) * 0.52, rot: 0 }
      : { x: (row - 1) * 0.52, z: (c - 0.5) * 0.86, rot: Math.PI / 2 };
    return { x: WOOD_PILE.x + lay.x, z: WOOD_PILE.z + lay.z, y: 0.18 + layer * 0.24, rot: lay.rot };
  }
  const layer = Math.floor(i / 12), k = i % 12, c = k % 4, row = Math.floor(k / 4);
  return { x: STONE_PILE.x + (c - 1.5) * 0.56 + (layer % 2) * 0.14, z: STONE_PILE.z + (row - 1) * 0.6, y: 0.2 + layer * 0.3, rot: 0 };
}
