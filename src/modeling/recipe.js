// Model recipes: the game's procedural props as data (a list of P() calls). Pure, no DOM, so the editor, the
// viewport (bag.models), the tests and the compare page all bake the same geometry. The game-side twin is
// buildModel() in repo-app/index.html; keep the maths in step with its P() helper.
import * as THREE from 'three';
import { mulberry32 } from '../core/heft-data.js';

export const GROUPS = ['root', 'legL', 'legR', 'torso', 'head', 'armL', 'armR'];   // player rig groups a part may belong to
export const KEYS = ['tree.0', 'tree.1', 'tree.2', 'rock.0', 'rock.1', 'campfire', 'wall', 'workbench', 'player'];
export const NAMES = { 'tree.0': 'Pine', 'tree.1': 'Oak', 'tree.2': 'Autumn tree', 'rock.0': 'Boulder', 'rock.1': 'Mossy rock',
  campfire: 'Campfire', wall: 'Palisade', workbench: 'Workbench', player: 'Builder (rest pose)' };
// prim -> [argument count, factory]; the same primitives as the game's box/cyl/cone/ico/dode helpers.
export const PRIMS = {
  box: [3, a => new THREE.BoxGeometry(a[0], a[1], a[2])],
  cyl: [4, a => new THREE.CylinderGeometry(a[0], a[1], a[2], a[3])],
  cone: [3, a => new THREE.ConeGeometry(a[0], a[1], a[2])],
  ico: [2, a => new THREE.IcosahedronGeometry(a[0], a[1])],
  dode: [1, a => new THREE.DodecahedronGeometry(a[0], 0)],
};
export const ARG_NAMES = { box: ['w', 'h', 'd'], cyl: ['rTop', 'rBottom', 'h', 'seg'], cone: ['r', 'h', 'seg'], ico: ['r', 'detail'], dode: ['r'] };
export const NEW_ARGS = { box: [0.5, 0.5, 0.5], cyl: [0.2, 0.2, 1, 8], cone: [0.3, 0.6, 7], ico: [0.3, 0], dode: [0.3] };
const SEG = { cyl: 3, cone: 2 };

function hashInt(k) { let x = k | 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

// One part -> non-indexed geometry (position, normal, color). Mirrors the game's P(): warp, transform, per-face
// jitter, vertical gradient. Jitter is seeded (the game uses Math.random), so the same recipe always bakes the same.
// withVx: apply the part's vertex offsets (model space, after the transform).
export function bakePart(p, withVx = true) {
  const src = PRIMS[p.prim][1](p.args), g = src.index ? src.toNonIndexed() : src;
  g.deleteAttribute('uv');
  const pos = g.attributes.position, n = pos.count, seed = p.seed ?? 7;
  if (p.warp) {
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = (Math.round(x * 1000) * 73856093) ^ (Math.round(y * 1000) * 19349663) ^ (Math.round(z * 1000) * 83492791) ^ seed;
      pos.setXYZ(i, x + (hashInt(k) - 0.5) * p.warp, y + (hashInt(k + 1) - 0.5) * p.warp, z + (hashInt(k + 2) - 0.5) * p.warp);
    }
    g.computeVertexNormals();
  }
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2]));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), q, new THREE.Vector3(...p.scale)));
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const col = new Float32Array(n * 3), base = new THREE.Color(p.color), jit = p.jit ?? 0.07, grad = p.grad ?? 0.22, rnd = mulberry32(seed);
  for (let f = 0; f < n; f += 3) {
    const j = 1 + (rnd() - 0.5) * 2 * jit;
    for (let k = 0; k < 3; k++) {
      const i = f + k, ty = maxY > minY ? (pos.getY(i) - minY) / (maxY - minY) : 0.5, sh = j * (1 - grad * 0.5 + grad * ty);
      col[i * 3] = base.r * sh; col[i * 3 + 1] = base.g * sh; col[i * 3 + 2] = base.b * sh;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (withVx && p.vx) for (const [i, d] of Object.entries(p.vx)) {
    const v = +i; if (v < n) pos.setXYZ(v, pos.getX(v) + d[0], pos.getY(v) + d[1], pos.getZ(v) + d[2]);
  }
  return g;
}

export function mergeGeo(list) {
  let total = 0; for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, off * 3); nor.set(g.attributes.normal.array, off * 3); col.set(g.attributes.color.array, off * 3);
    off += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.computeBoundingSphere(); m.computeBoundingBox();
  return m;
}
export const bakeModel = parts => mergeGeo(parts.map(p => bakePart(p)));

// Vertex-mode unit: the vertices of one part that share a base position (a box corner is three vertices).
// Offsets are stored per vertex index, so a weld's members always move together.
export function weldsOf(geo) {
  const pos = geo.attributes.position, byKey = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    if (!byKey.has(k)) byKey.set(k, { p: [x, y, z], m: [] });
    byKey.get(k).m.push(i);
  }
  return [...byKey.values()];
}

// Trust boundary: recipes come from opened project files and from postMessage in the game. Anything else is refused.
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(v => Number.isFinite(v));
export function validParts(parts) {
  return Array.isArray(parts) && parts.length >= 1 && parts.length <= 400 && parts.every(p => {
    const spec = p && PRIMS[p.prim]; if (!spec || !finite(p.args, spec[0]) || !p.args.every(v => Math.abs(v) <= 64)) return false;
    const si = SEG[p.prim];
    if (si !== undefined && !(Number.isInteger(p.args[si]) && p.args[si] >= 3 && p.args[si] <= 64)) return false;
    if (p.prim === 'ico' && !(Number.isInteger(p.args[1]) && p.args[1] >= 0 && p.args[1] <= 3)) return false;
    return finite(p.pos, 3) && finite(p.rot, 3) && finite(p.scale, 3) && Number.isInteger(p.color) && p.color >= 0 && p.color <= 0xffffff
      && [p.jit ?? 0, p.grad ?? 0, p.warp ?? 0].every(v => Number.isFinite(v) && Math.abs(v) <= 2) && (p.g === undefined || GROUPS.includes(p.g))
      && Number.isInteger(p.seed ?? 7) && (!p.vx || Object.entries(p.vx).every(([k, d]) => /^\d+$/.test(k) && finite(d, 3) && d.every(v => Math.abs(v) <= 64)));
  });
}
