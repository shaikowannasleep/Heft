// The game's own recipes, ported line by line from repo-app/index.html (treeGeo, ROCK_GEOS, STRUCT_GEO, buildBuilder).
// Defaults mirror P(): jit 0.07, grad 0.22, seed 7. Seeded values (pine yaw, warp seeds) are evaluated here, so the
// recipe is plain data. tests/modeling-recipes.test.mjs checks the vertex counts and bounds against the game.
import { mulberry32 } from '../core/heft-data.js';
import { KEYS } from './recipe.js';

export const part = (prim, args, color, o = {}) => ({ prim, args, color, pos: [o.x || 0, o.y || 0, o.z || 0], rot: [o.rx || 0, o.ry || 0, o.rz || 0],
  scale: [o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1], jit: o.jit ?? 0.07, grad: o.grad ?? 0.22, warp: o.warp || 0, seed: o.seed ?? 7 });
const at = (parts, ox, oy, oz) => parts.map(p => ({ ...p, pos: [p.pos[0] + ox, p.pos[1] + oy, p.pos[2] + oz] }));

function tree(v, seed) {
  const r = mulberry32(seed), out = [];
  if (v === 0) { // pine
    out.push(part('cyl', [0.13, 0.2, 1.0, 6], 0x6b4a2f, { y: 0.5 }));
    const greens = [0x3f6b3a, 0x4a7a40, 0x58884a];
    [[1.15, 1.3, 1.25], [0.9, 1.15, 1.95], [0.6, 0.95, 2.55]].forEach(([rad, h, y], i) =>
      out.push(part('cone', [rad, h, 7], greens[i], { y, ry: r() * 2, warp: 0.12, seed: seed + i, grad: 0.35 })));
  } else {
    const fol = v === 1 ? [0x6a9440, 0x7ea64a, 0x5d8a3a] : [0xd08a33, 0xc76a2c, 0xe0a542];
    out.push(part('cyl', [0.15, 0.24, 1.5, 6], 0x7a5634, { y: 0.75 }));
    out.push(part('cyl', [0.07, 0.1, 0.7, 5], 0x7a5634, { x: 0.3, y: 1.3, rz: -0.6 }));
    out.push(part('ico', [0.95, 0], fol[0], { y: 2.15, warp: 0.25, seed: seed + 1, grad: 0.4 }));
    out.push(part('ico', [0.68, 0], fol[1], { x: 0.62, y: 1.8, z: 0.15, warp: 0.2, seed: seed + 2, grad: 0.4 }));
    out.push(part('ico', [0.62, 0], fol[2], { x: -0.5, y: 1.85, z: -0.25, warp: 0.2, seed: seed + 3, grad: 0.4 }));
    out.push(part('ico', [0.5, 0], fol[1], { x: 0.05, y: 2.75, z: 0.2, warp: 0.15, seed: seed + 4, grad: 0.4 }));
  }
  return out;
}

const campfire = () => [
  ...Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2; return part('dode', [0.17], 0x8d877c, { x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55, y: 0.08, sy: 0.7, warp: 0.05, seed: i, ry: a }); }),
  part('cyl', [0.48, 0.48, 0.03, 10], 0x2e2620, { y: 0.015, jit: 0.02 }),
  ...[0, 1, 2].map(i => part('cyl', [0.07, 0.08, 0.85, 6], 0x7a5030, { rz: Math.PI / 2, ry: i * 1.05, y: 0.1 + i * 0.06 })),
];

const wall = () => [
  ...Array.from({ length: 5 }, (_, i) => {
    const x = -0.96 + i * 0.48, h = 1.35 + ((i * 37) % 5) * 0.05;
    return [part('cyl', [0.13, 0.15, h, 6], 0x8f5f36, { x, y: h / 2 }), part('cone', [0.13, 0.3, 6], 0xb08350, { x, y: h + 0.15 }),
      part('dode', [0.2], 0x8a857a, { x, y: 0.07, z: i % 2 ? 0.16 : -0.16, sy: 0.6, warp: 0.05, seed: i })];
  }).flat(),
  part('box', [2.3, 0.12, 0.08], 0x6a4226, { y: 0.45, z: 0.17 }),
  part('box', [2.3, 0.12, 0.08], 0x6a4226, { y: 1.05, z: 0.17 }),
  ...[-0.72, 0.24].map(x => part('box', [0.1, 0.7, 0.05], 0xcfb07a, { x, y: 0.75, z: 0.2, rz: 0.15 })),
];

const workbench = () => [
  part('box', [1.5, 0.12, 0.75], 0xae7d43, { y: 0.85 }),
  ...[[0.62, 0.28], [-0.62, 0.28], [0.62, -0.28], [-0.62, -0.28]].map(([x, z]) => part('box', [0.11, 0.8, 0.11], 0x7a5230, { x, y: 0.4, z })),
  part('box', [1.3, 0.06, 0.6], 0x8a5f34, { y: 0.25 }),
  part('box', [0.5, 0.12, 0.3], 0xc9a466, { x: -0.3, y: 0.34 }),
  part('box', [0.2, 0.18, 0.18], 0x7b828a, { x: 0.6, y: 0.99, z: 0.26 }),
  part('box', [0.5, 0.02, 0.16], 0xc8ced4, { x: -0.3, y: 0.92, z: 0.1, ry: 0.2 }),
  part('box', [0.16, 0.05, 0.08], 0x6a3e22, { x: -0.6, y: 0.93, z: 0.16, ry: 0.2 }),
  part('box', [0.06, 0.04, 0.3], 0x9a6a3c, { x: 0.15, y: 0.93, z: -0.1, ry: -0.6 }),
  part('box', [0.12, 0.08, 0.08], 0x7b828a, { x: 0.05, y: 0.94, z: 0.0, ry: -0.6 }),
  part('box', [0.1, 2.0, 0.1], 0x7a5230, { x: 0.72, y: 1.0, z: -0.42 }), part('box', [0.1, 2.0, 0.1], 0x7a5230, { x: -0.72, y: 1.0, z: -0.42 }),
  part('box', [1.9, 0.07, 1.1], 0x8a4a2c, { y: 2.0, z: -0.05, rx: 0.32 }),
  part('box', [1.9, 0.05, 0.12], 0x6a3a22, { y: 1.88, z: 0.45, rx: 0.32 }),
];

// buildBuilder() flattened to rest pose: legs, torso, head and arms in the root frame (tools and the stack excluded).
const player = () => {
  const C = { skin: 0xe2a57a, tunic: 0xc4893f, tunicDark: 0x9e6c2e, trousers: 0x5b4634, boots: 0x3a281c, sole: 0x23180f,
    belt: 0x6a3e22, buckle: 0xe0b85a, pouch: 0x8a5a32, hair: 0x6a3a1c, band: 0xa8432c, eye: 0x1d1410, wood: 0x9a6a3c,
    iron: 0x8e959c, edge: 0xd4d9de, frame: 0x7a5232, rope: 0xcfb07a };
  const legs = s => at([part('box', [0.23, 0.5, 0.25], C.trousers, { y: -0.25 }), part('box', [0.2, 0.3, 0.22], C.trousers, { y: -0.6 }),
    part('box', [0.27, 0.07, 0.27], C.boots, { y: -0.67 }), part('box', [0.26, 0.22, 0.36], C.boots, { y: -0.81, z: 0.05 }),
    part('box', [0.27, 0.05, 0.38], C.sole, { y: -0.9, z: 0.05 })], 0.15 * s, 0.92, 0);
  const torso = at([part('box', [0.6, 0.24, 0.38], C.tunicDark, { y: 0.04 }), part('box', [0.6, 0.52, 0.36], C.tunic, { y: 0.42 }),
    part('box', [0.72, 0.14, 0.38], C.tunic, { y: 0.63 }), part('box', [0.15, 0.1, 0.03], C.skin, { y: 0.62, z: 0.18 }),
    part('box', [0.65, 0.11, 0.41], C.belt, { y: 0.15 }), part('box', [0.11, 0.09, 0.03], C.buckle, { y: 0.15, z: 0.21 }),
    part('box', [0.15, 0.17, 0.11], C.pouch, { x: 0.24, y: 0.06, z: 0.2 }), part('box', [0.12, 0.15, 0.1], C.pouch, { x: 0.33, y: 0.06, z: -0.05 }),
    part('cyl', [0.025, 0.025, 0.36, 5], C.wood, { x: -0.36, y: 0.02, z: 0.06 }), part('box', [0.1, 0.07, 0.17], C.iron, { x: -0.36, y: 0.19, z: 0.06 }),
    part('box', [0.03, 0.05, 0.2], C.wood, { x: -0.33, y: 0.12, z: -0.1 }), part('cyl', [0.09, 0.09, 0.12, 8], C.skin, { y: 0.74 }),
    part('box', [0.06, 1.1, 0.06], C.frame, { x: 0.27, y: 0.5, z: -0.24 }), part('box', [0.06, 1.1, 0.06], C.frame, { x: -0.27, y: 0.5, z: -0.24 }),
    part('box', [0.6, 0.05, 0.05], C.frame, { y: 0.32, z: -0.25 }), part('box', [0.6, 0.05, 0.05], C.frame, { y: 0.88, z: -0.25 }),
    part('box', [0.8, 0.06, 0.58], C.frame, { y: 0.1, z: -0.47 }), part('box', [0.05, 0.12, 0.58], C.frame, { x: 0.38, y: 0.15, z: -0.47 }),
    part('box', [0.05, 0.12, 0.58], C.frame, { x: -0.38, y: 0.15, z: -0.47 }),
    part('box', [0.08, 0.04, 0.42], C.rope, { x: 0.17, y: 0.71, z: -0.02 }), part('box', [0.08, 0.04, 0.42], C.rope, { x: -0.17, y: 0.71, z: -0.02 }),
    part('box', [0.07, 0.48, 0.03], C.rope, { x: 0.17, y: 0.46, z: 0.185 }), part('box', [0.07, 0.48, 0.03], C.rope, { x: -0.17, y: 0.46, z: 0.185 })], 0, 0.92, 0);
  const head = at([part('box', [0.34, 0.36, 0.34], C.skin, { y: 0.17 }), part('box', [0.36, 0.12, 0.36], C.hair, { y: 0.38 }),
    part('box', [0.37, 0.08, 0.37], C.band, { y: 0.31 }), part('box', [0.08, 0.16, 0.04], C.band, { x: -0.1, y: 0.24, z: -0.2, rz: 0.3 }),
    part('box', [0.36, 0.2, 0.08], C.hair, { y: 0.22, z: -0.15 }), part('box', [0.3, 0.15, 0.08], C.hair, { y: 0.03, z: 0.15 }),
    part('box', [0.2, 0.08, 0.06], C.hair, { y: -0.04, z: 0.14 }), part('box', [0.07, 0.09, 0.07], C.skin, { y: 0.15, z: 0.19 }),
    part('box', [0.05, 0.05, 0.02], C.eye, { x: 0.08, y: 0.21, z: 0.172 }), part('box', [0.05, 0.05, 0.02], C.eye, { x: -0.08, y: 0.21, z: 0.172 }),
    part('box', [0.09, 0.025, 0.02], C.hair, { x: 0.08, y: 0.26, z: 0.172 }), part('box', [0.09, 0.025, 0.02], C.hair, { x: -0.08, y: 0.26, z: 0.172 }),
    part('box', [0.05, 0.08, 0.06], C.skin, { x: 0.19, y: 0.17 }), part('box', [0.05, 0.08, 0.06], C.skin, { x: -0.19, y: 0.17 })], 0, 1.72, 0);
  const arm = s => at([part('box', [0.18, 0.32, 0.19], C.tunic, { y: -0.12 }), part('box', [0.15, 0.28, 0.16], C.skin, { y: -0.4 }),
    part('box', [0.17, 0.1, 0.18], C.belt, { y: -0.46 }), part('box', [0.15, 0.14, 0.16], C.skin, { y: -0.6 })], 0.39 * s, 1.54, 0);
  return [...legs(1), ...legs(-1), ...torso, ...head, ...arm(1), ...arm(-1)];
};

const rockParts = [
  () => [part('dode', [0.85], 0x8f897d, { sx: 1.2, sy: 0.72, z: 0, y: 0.42, warp: 0.25, seed: 5, grad: 0.35 }),
    part('dode', [0.42], 0x9d978a, { x: 0.75, y: 0.2, z: 0.35, sy: 0.7, warp: 0.12, seed: 9 }),
    part('dode', [0.18], 0x7f7a70, { x: -0.7, y: 0.1, z: 0.5, warp: 0.06, seed: 4 })],
  () => [part('dode', [1.0], 0x8a8478, { sx: 1.0, sy: 0.95, y: 0.62, warp: 0.32, seed: 21, grad: 0.4 }),
    part('dode', [0.55], 0xa09684, { x: -0.8, y: 0.3, z: -0.2, sy: 0.8, warp: 0.15, seed: 22 }),
    part('box', [0.25, 0.08, 0.3], 0x6f8f4a, { y: 1.2, x: 0.1, ry: 0.4 })], // mossy cap
];

const MAKE = {
  'tree.0': () => tree(0, 11), 'tree.1': () => tree(1, 28), 'tree.2': () => tree(2, 45),
  'rock.0': rockParts[0], 'rock.1': rockParts[1], campfire, wall, workbench, player,
};
export const DEFAULTS = Object.freeze(Object.fromEntries(KEYS.map(k => [k, Object.freeze(MAKE[k]())])));
