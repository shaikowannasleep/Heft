// Fallback meshes and ground in the game's low-poly vertex-colour style, ported from repo-app/index.html.
// Used for any key that bag.models (pillar 3) does not provide.
import * as THREE from 'three';
import { islandRA, islandR, inIsland, fbm, mulberry32, SPAN } from '../core/heft-data.js';

const vnoise = (x, z) => {
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
function hashInt(k) { let x = k | 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dode = r => new THREE.DodecahedronGeometry(r, 0);
const V3 = THREE.Vector3, UP = new V3(0, 1, 0);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3();

// One part, baked to non-indexed geometry with per-face colour jitter and a vertical gradient.
export function P(geo, color, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const pos = g.attributes.position, n = pos.count;
  if (o.warp) {
    const seed = o.seed ?? 7;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = (Math.round(x * 1000) * 73856093) ^ (Math.round(y * 1000) * 19349663) ^ (Math.round(z * 1000) * 83492791) ^ seed;
      pos.setXYZ(i, x + (hashInt(k) - 0.5) * o.warp, y + (hashInt(k + 1) - 0.5) * o.warp, z + (hashInt(k + 2) - 0.5) * o.warp);
    }
    g.computeVertexNormals();
  }
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e);
  _s.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1);
  _p.set(o.x || 0, o.y || 0, o.z || 0);
  g.applyMatrix4(_m4.compose(_p, _q, _s));
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const rnd = mulberry32((o.seed ?? 7) * 7919 + 1), col = new Float32Array(n * 3), base = new THREE.Color(color), jit = o.jit ?? 0.07, grad = o.grad ?? 0.22;
  for (let f = 0; f < n; f += 3) {
    const j = 1 + (rnd() - 0.5) * 2 * jit;
    for (let k = 0; k < 3 && f + k < n; k++) {
      const i = f + k, ty = maxY > minY ? (pos.getY(i) - minY) / (maxY - minY) : 0.5;
      const sh = j * (1 - grad * 0.5 + grad * ty);
      col[i * 3] = base.r * sh; col[i * 3 + 1] = base.g * sh; col[i * 3 + 2] = base.b * sh;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function merge(list) {
  let total = 0; for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, off * 3); nor.set(g.attributes.normal.array, off * 3); col.set(g.attributes.color.array, off * 3);
    off += g.attributes.position.count; g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.computeBoundingSphere(); m.computeBoundingBox();
  return m;
}

export const MAT = {
  vc: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff9a32, transparent: true, opacity: 0.92 }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xffe68a }),
  glow: new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  claim: new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.5, depthWrite: false }),
  foam: new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  hullSel: new THREE.MeshBasicMaterial({ color: 0xffa43d, side: THREE.BackSide }),
  hullHover: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0.5, depthWrite: false }),
};

// ---------------------------------------------------------------- geometry (keys match bag.models)
function treeGeo(v, seed) {
  const r = mulberry32(seed), parts = [];
  if (v === 0) {
    parts.push(P(cyl(0.13, 0.2, 1.0, 6), 0x6b4a2f, { y: 0.5 }));
    const greens = [0x3f6b3a, 0x4a7a40, 0x58884a];
    [[1.15, 1.3, 1.25], [0.9, 1.15, 1.95], [0.6, 0.95, 2.55]].forEach(([rad, h, y], i) =>
      parts.push(P(cone(rad, h, 7), greens[i], { y, ry: r() * 2, warp: 0.12, seed: seed + i, grad: 0.35 })));
  } else {
    const fol = v === 1 ? [0x6a9440, 0x7ea64a, 0x5d8a3a] : [0xd08a33, 0xc76a2c, 0xe0a542];
    parts.push(P(cyl(0.15, 0.24, 1.5, 6), 0x7a5634, { y: 0.75 }));
    parts.push(P(cyl(0.07, 0.1, 0.7, 5), 0x7a5634, { x: 0.3, y: 1.3, rz: -0.6 }));
    parts.push(P(ico(0.95, 0), fol[0], { y: 2.15, warp: 0.25, seed: seed + 1, grad: 0.4 }));
    parts.push(P(ico(0.68, 0), fol[1], { x: 0.62, y: 1.8, z: 0.15, warp: 0.2, seed: seed + 2, grad: 0.4 }));
    parts.push(P(ico(0.62, 0), fol[2], { x: -0.5, y: 1.85, z: -0.25, warp: 0.2, seed: seed + 3, grad: 0.4 }));
    parts.push(P(ico(0.5, 0), fol[1], { x: 0.05, y: 2.75, z: 0.2, warp: 0.15, seed: seed + 4, grad: 0.4 }));
  }
  return merge(parts);
}
const ROCKS = [
  merge([P(dode(0.85), 0x8f897d, { sx: 1.2, sy: 0.72, z: 0, y: 0.42, warp: 0.25, seed: 5, grad: 0.35 }),
    P(dode(0.42), 0x9d978a, { x: 0.75, y: 0.2, z: 0.35, sy: 0.7, warp: 0.12, seed: 9 }),
    P(dode(0.18), 0x7f7a70, { x: -0.7, y: 0.1, z: 0.5, warp: 0.06, seed: 4 })]),
  merge([P(dode(1.0), 0x8a8478, { sx: 1.0, sy: 0.95, y: 0.62, warp: 0.32, seed: 21, grad: 0.4 }),
    P(dode(0.55), 0xa09684, { x: -0.8, y: 0.3, z: -0.2, sy: 0.8, warp: 0.15, seed: 22 }),
    P(box(0.25, 0.08, 0.3), 0x6f8f4a, { y: 1.2, x: 0.1, ry: 0.4 })]),
];
const STUMP = merge([P(cyl(0.2, 0.26, 0.32, 7), 0x6b4a2f, { y: 0.16 }), P(cyl(0.17, 0.17, 0.02, 7), 0xd9b27a, { y: 0.33, jit: 0.02 })]);
const RUBBLE = merge([P(dode(0.18), 0x8f897d, { x: 0.3, y: 0.08, sy: 0.6 }), P(dode(0.14), 0x9d978a, { x: -0.25, y: 0.06, z: 0.2, sy: 0.6 }),
  P(dode(0.12), 0x7f7a70, { z: -0.3, y: 0.05, sy: 0.6 })]);
const STRUCT = {
  campfire: merge([
    ...Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2; return P(dode(0.17), 0x8d877c, { x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55, y: 0.08, sy: 0.7, warp: 0.05, seed: i, ry: a }); }),
    P(cyl(0.48, 0.48, 0.03, 10), 0x2e2620, { y: 0.015, jit: 0.02 }),
    ...[0, 1, 2].map(i => P(cyl(0.07, 0.08, 0.85, 6), 0x7a5030, { rz: Math.PI / 2, ry: i * 1.05, y: 0.1 + i * 0.06 })),
  ]),
  wall: merge([
    ...Array.from({ length: 5 }, (_, i) => {
      const x = -0.96 + i * 0.48, h = 1.35 + ((i * 37) % 5) * 0.05;
      return [P(cyl(0.13, 0.15, h, 6), 0x8f5f36, { x, y: h / 2 }), P(cone(0.13, 0.3, 6), 0xb08350, { x, y: h + 0.15 }),
        P(dode(0.2), 0x8a857a, { x, y: 0.07, z: i % 2 ? 0.16 : -0.16, sy: 0.6, warp: 0.05, seed: i })];
    }).flat(),
    P(box(2.3, 0.12, 0.08), 0x6a4226, { y: 0.45, z: 0.17 }),
    P(box(2.3, 0.12, 0.08), 0x6a4226, { y: 1.05, z: 0.17 }),
    ...[-0.72, 0.24].map(x => P(box(0.1, 0.7, 0.05), 0xcfb07a, { x, y: 0.75, z: 0.2, rz: 0.15 })),
  ]),
  workbench: merge([
    P(box(1.5, 0.12, 0.75), 0xae7d43, { y: 0.85 }),
    ...[[0.62, 0.28], [-0.62, 0.28], [0.62, -0.28], [-0.62, -0.28]].map(([x, z]) => P(box(0.11, 0.8, 0.11), 0x7a5230, { x, y: 0.4, z })),
    P(box(1.3, 0.06, 0.6), 0x8a5f34, { y: 0.25 }),
    P(box(0.5, 0.12, 0.3), 0xc9a466, { x: -0.3, y: 0.34 }),
    P(box(0.2, 0.18, 0.18), 0x7b828a, { x: 0.6, y: 0.99, z: 0.26 }),
    P(box(0.5, 0.02, 0.16), 0xc8ced4, { x: -0.3, y: 0.92, z: 0.1, ry: 0.2 }),
    P(box(0.1, 2.0, 0.1), 0x7a5230, { x: 0.72, y: 1.0, z: -0.42 }), P(box(0.1, 2.0, 0.1), 0x7a5230, { x: -0.72, y: 1.0, z: -0.42 }),
    P(box(1.9, 0.07, 1.1), 0x8a4a2c, { y: 2.0, z: -0.05, rx: 0.32 }),
    P(box(1.9, 0.05, 0.12), 0x6a3a22, { y: 1.88, z: 0.45, rx: 0.32 }),
  ]),
};
// Figure facing +z, like the game's builder.
const PLAYER = merge([
  P(box(0.13, 0.5, 0.15), 0x5b4634, { x: 0.12, y: 0.25 }), P(box(0.13, 0.5, 0.15), 0x5b4634, { x: -0.12, y: 0.25 }),
  P(box(0.15, 0.1, 0.22), 0x3a281c, { x: 0.12, y: 0.05, z: 0.02 }), P(box(0.15, 0.1, 0.22), 0x3a281c, { x: -0.12, y: 0.05, z: 0.02 }),
  P(box(0.6, 0.6, 0.36), 0xc4893f, { y: 0.8 }), P(box(0.62, 0.08, 0.38), 0x6a3e22, { y: 0.52 }),
  P(box(0.14, 0.5, 0.14), 0xc4893f, { x: 0.4, y: 0.82 }), P(box(0.14, 0.5, 0.14), 0xc4893f, { x: -0.4, y: 0.82 }),
  P(box(0.3, 0.3, 0.3), 0xe2a57a, { y: 1.28 }), P(box(0.32, 0.1, 0.32), 0x6a3a1c, { y: 1.46 }),
  P(box(0.16, 0.16, 0.12), 0x8a5a32, { x: 0.24, y: 0.8, z: 0.2 }),
  P(box(0.05, 0.05, 0.02), 0x1d1410, { x: 0.08, y: 1.3, z: 0.16 }), P(box(0.05, 0.05, 0.02), 0x1d1410, { x: -0.08, y: 1.3, z: 0.16 }),
]);

const GEO = new Map();
// Geometry for a bag.models key, built once and shared.
export function fallbackGeometry(key) {
  if (!GEO.has(key)) {
    const v = key.startsWith('tree.') ? treeGeo(+key.slice(5), 11 + (+key.slice(5)) * 17) : null;
    GEO.set(key, v ?? (key.startsWith('rock.') ? ROCKS[+key.slice(5)] : { stump: STUMP, rubble: RUBBLE, player: PLAYER }[key] ?? STRUCT[key]));
  }
  return GEO.get(key);
}

// Structure group: the mesh plus the campfire flame, which keeps a 'flame' name so the scene can flicker it.
export function structureGroup(type, geo) {
  const g = new THREE.Group(), m = new THREE.Mesh(geo, MAT.vc);
  m.castShadow = true; m.receiveShadow = type === 'workbench'; g.add(m);
  if (type === 'campfire') {
    const flame = new THREE.Mesh(cone(0.28, 0.8, 6), MAT.flame); flame.position.y = 0.5; flame.name = 'flame';
    const core = new THREE.Mesh(cone(0.15, 0.5, 6), MAT.flameCore); core.position.y = 0.4;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 16), MAT.glow); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04;
    g.add(flame, core, glow);
  }
  return g;
}

// ---------------------------------------------------------------- ground, water, foam, grass (static, built once per scene)
export function buildGround(terrTex) {
  const uniforms = { uTerr: { value: terrTex }, uNight: { value: 0 }, uTime: { value: 0 } };
  const root = new THREE.Group();
  const size = SPAN + 24, seg = 124;
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const cA = new THREE.Color(0x8aa851), cB = new THREE.Color(0x5f8c3e), cDry = new THREE.Color(0xb7a55c), cSand = new THREE.Color(0xdcc38f),
    cWet = new THREE.Color(0x9c8763), cDirt = new THREE.Color(0x9b7a52), c = new THREE.Color();
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), edge = r - islandR(x, z);
    let y = edge > 0 ? -Math.min(1.8, edge * 0.45) : (vnoise(x * 0.3, z * 0.3) - 0.5) * 0.06;
    if (edge > -2.5 && edge <= 0) y -= (edge + 2.5) * 0.03;
    p.setY(i, y);
    c.lerpColors(cB, cA, fbm(x * 0.08, z * 0.08));
    c.lerp(cDry, smooth(0.6, 0.8, fbm(x * 0.05 + 20, z * 0.05 - 7)) * 0.55);
    c.lerp(cSand, smooth(-3.2, -1.2, edge));
    if (edge > 0.3) c.lerp(cWet, smooth(0.3, 2, edge));
    c.lerp(cDirt, (1 - smooth(3.0, 7.0, r)) * 0.7);
    const sp = (vnoise(x * 3.1, z * 3.7) - 0.5) * 0.05;
    col[i * 3] = c.r + sp; col[i * 3 + 1] = c.g + sp; col[i * 3 + 2] = c.b + sp * 0.5;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Territory glow and dashed claim edge, as in the game's ground shader.
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTerrUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvTerrUv = (modelMatrix * vec4(transformed, 1.0)).xz / ${SPAN.toFixed(1)} + 0.5;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTerrUv;\nuniform sampler2D uTerr;\nuniform float uNight;\nuniform float uTime;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sdT = (texture2D(uTerr, vTerrUv).r - 0.5) * 8.0;
        float insideT = smoothstep(-0.15, 0.15, sdT);
        float edgeT = 1.0 - smoothstep(0.0, 0.2, abs(sdT));
        float dashT = step(0.5, fract((vTerrUv.x - vTerrUv.y) * 140.0 + uTime * 0.25));
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.08, 1.0, 0.84), insideT * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.68, 0.30), edgeT * (0.3 + 0.3 * dashT));
        vec3 terrGlow = vec3(1.0, 0.5, 0.18) * (edgeT * (0.25 + 0.25 * dashT) + insideT * 0.035) * uNight;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += terrGlow;');
  };
  const ground = new THREE.Mesh(g, mat); ground.receiveShadow = true; root.add(ground);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: 0x4a9bb0 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.42; root.add(water);
  const N = 160, fp = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, R = islandRA(a);
    fp.push(Math.cos(a) * (R + 0.5), -0.39, Math.sin(a) * (R + 0.5), Math.cos(a) * (R + 1.7), -0.39, Math.sin(a) * (R + 1.7));
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(idx);
  root.add(new THREE.Mesh(fg, MAT.foam));

  // grass tufts and flowers: instanced, one draw call each
  const rng = mulberry32(99);
  const tuftGeo = merge([P(cone(0.05, 0.38, 4), 0xffffff, { y: 0.19, rz: 0.12 }), P(cone(0.045, 0.3, 4), 0xffffff, { x: 0.07, y: 0.15, rz: -0.3 }),
    P(cone(0.045, 0.28, 4), 0xffffff, { x: -0.06, y: 0.14, z: 0.05, rz: 0.35 })]);
  const flowerGeo = merge([P(ico(0.075), 0xffffff, { y: 0.12, grad: 0.1 })]);
  const tufts = new THREE.InstancedMesh(tuftGeo, MAT.vc, 1300), flowers = new THREE.InstancedMesh(flowerGeo, MAT.vc, 320);
  const tc = new THREE.Color(), fcols = [0xf2d45c, 0xf6f0e2, 0xe07a5a, 0xb88ad8].map(hx => new THREE.Color(hx));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const place = (im, n, colorFn, sMin, sMax) => {
    let k = 0;
    while (k < n) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 46, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!inIsland(x, z, 3) || d < 3) continue;
      q.setFromAxisAngle(UP, rng() * 6.28);
      const s = sMin + rng() * (sMax - sMin);
      im.setMatrixAt(k, m4.compose(p3.set(x, 0, z), q, s3.set(s, s, s)));
      im.setColorAt(k, colorFn(x, z)); k++;
    }
    im.receiveShadow = true; root.add(im);
  };
  place(tufts, 1300, (x, z) => tc.setHSL(0.24 + rng() * 0.05, 0.45, 0.32 + fbm(x * 0.08, z * 0.08) * 0.12), 0.8, 1.6);
  place(flowers, 320, () => fcols[(rng() * fcols.length) | 0], 0.7, 1.2);
  return { root, uniforms };
}
