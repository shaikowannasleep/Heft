// Heft game rules and world generation, ported verbatim from repo-app/index.html.
// shortcut: duplicated from the game (it is one HTML file with no module exports); tests/heft-data.test.mjs
// compares these constants against repo-app when it is checked out next door. Upgrade: make the game import this file.
export const DAY_LEN = 300;                       // seconds for a full day/night
export const BASE_SPEED = 5.4;
export const BASE_CAPACITY = 12;
export const SPAN = 100;                          // territory texture covers [-50, 50]
export const CAMP_R = 8;
export const DEPOSIT_R = 2.3;
export const PLAYER_R = 0.36;
export const PILE_MAX = 60;
export const PLAYER_START = { x: 1.4, z: 4.2 };
export const WOOD_PILE = { x: -4.4, z: 0.6 };
export const STONE_PILE = { x: -3.1, z: 3.9 };
export const ITEM = { wood: { w: 1, h: 0.24 }, stone: { w: 2, h: 0.40 } };
export const TREE_HP = [3, 4, 4], ROCK_HP = [3, 4];
export const STRUCT = {
  campfire:  { name: 'Campfire',  cost: { wood: 3, stone: 2 }, claim: 6.5, foot: 0.8 },
  wall:      { name: 'Palisade',  cost: { wood: 2, stone: 1 }, claim: 3.0, foot: 1.2 },
  workbench: { name: 'Workbench', cost: { wood: 5, stone: 3 }, claim: 4.5, foot: 1.0 },
};
export const UPGRADES = {
  pack: { name: 'Reinforced Frame', desc: '+6 carry capacity', max: 3, cost: l => ({ wood: 5 + l * 3, stone: 3 + l * 3 }) },
  tool: { name: 'Honed Tools', desc: 'Swing ~22% faster', max: 3, cost: l => ({ wood: 3 + l * 3, stone: 4 + l * 3 }) },
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
export function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, z) => vnoise(x, z) * 0.6 + vnoise(x * 2.1 + 7, z * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, z * 4.3 + 9) * 0.1;
export const islandRA = a => 43 + 2.6 * Math.sin(3 * a + 1.3) + 1.6 * Math.sin(5 * a + 0.4) + 1.0 * Math.sin(9 * a + 2.1);
export const islandR = (x, z) => islandRA(Math.atan2(z, x));
export const inIsland = (x, z, m = 0) => Math.hypot(x, z) < islandR(x, z) - m;
export const SAVE_VERSION = 1;
export function generateResources(seed) {
  const rng = mulberry32(seed), res = []; let id = 0;
  const free = (x, z, m) => res.every(r => (r.x - x) ** 2 + (r.z - z) ** 2 >= m * m);
  let trees = 0, rocks = 0, tries = 0;
  // a few easy first pickings close to camp
  for (const [a, d, kind] of [[0.9, 11, 'tree'], [1.4, 12.5, 'tree'], [2.2, 11.5, 'tree'], [4.2, 12, 'tree'], [5.4, 11, 'rock'], [3.3, 12.5, 'rock'], [-0.4, 13, 'rock']]) {
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (kind === 'tree') { res.push({ id: id++, kind, v: 1, x: r2(x), z: r2(z), rot: r3(rng() * 6.28), s: 1, hp: 4, max: 4, regrowAt: 0 }); trees++; }
    else { res.push({ id: id++, kind, v: 0, x: r2(x), z: r2(z), rot: r3(rng() * 6.28), s: 0.9, hp: 3, max: 3, regrowAt: 0 }); rocks++; }
  }
  while (trees < 150 && tries++ < 8000) {
    const a = rng() * Math.PI * 2, d = 10 + rng() * 35, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!inIsland(x, z, 3)) continue;
    const forest = fbm(x * 0.07 + seed % 97, z * 0.07 + 1.1);
    if (rng() > forest * 1.7 - 0.3) continue;
    if (!free(x, z, 2.1)) continue;
    const v = forest > 0.6 ? 0 : (rng() < 0.75 ? 1 : 2);
    res.push({ id: id++, kind: 'tree', v, x: r2(x), z: r2(z), rot: r3(rng() * 6.28), s: r3(0.85 + rng() * 0.4), hp: TREE_HP[v], max: TREE_HP[v], regrowAt: 0 }); trees++;
  }
  tries = 0;
  while (rocks < 55 && tries++ < 6000) {
    const a = rng() * Math.PI * 2, d = 10 + rng() * 35, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!inIsland(x, z, 2.5) || !free(x, z, 2.5)) continue;
    const v = rng() < 0.65 ? 0 : 1;
    res.push({ id: id++, kind: 'rock', v, x: r2(x), z: r2(z), rot: r3(rng() * 6.28), s: r3(0.8 + rng() * 0.4), hp: ROCK_HP[v], max: ROCK_HP[v], regrowAt: 0 }); rocks++;
  }
  return res;
}
export function newState(seed = (Math.random() * 1e9) | 0) {
  return { game: 'Heft', version: SAVE_VERSION, seed, clock: 0, day: 1, dayTime: 0.06,
    player: { x: PLAYER_START.x, z: PLAYER_START.z, rot: Math.PI * 0.25, hp: 100 }, stack: [], stock: { wood: 0, stone: 0 },
    upgrades: { pack: 0, tool: 0 }, resources: generateResources(seed), structures: [{ type: 'campfire', x: 3.4, z: 2.2, rot: 0 }],
    drops: [], wolves: [], stats: { gathered: 0, built: 0, nights: 0 } };
}
export function validState(s) {
  return s && s.game === 'Heft' && typeof s.version === 'number' && Array.isArray(s.resources) && Array.isArray(s.structures) && s.player && s.stock;
}

// ---- editor-side level helpers
// Structures get a stable editor id (the game ignores unknown fields and re-derives everything else).
export function newProject(seed = 1, name = 'Island ' + seed) {
  const level = newState(seed);
  level.structures = level.structures.map((s, i) => ({ id: i + 1, ...s }));
  return { format: 'heft-studio', version: 1, name, level, models: {}, meta: { created: new Date().toISOString() } };
}
export function nextId(list) { return list.reduce((m, o) => Math.max(m, o.id), 0) + 1; }
// Level exactly as the game expects it (save-file shape), for playtest and export.
export function toGameState(project) {
  const { level } = project;
  return { ...level, savedAt: new Date().toISOString(), structures: level.structures.map(({ type, x, z, rot }) => ({ type, x, z, rot })) };
}
export function fromGameState(state, name = 'Imported') {
  if (!validState(state)) throw new Error('not a Heft level/save');
  return { format: 'heft-studio', version: 1, name, models: {}, meta: { created: new Date().toISOString() },
    level: { ...state, structures: state.structures.map((s, i) => ({ id: i + 1, type: s.type, x: s.x, z: s.z, rot: s.rot || 0 })) } };
}
export const RES_V = { tree: ['Pine', 'Oak', 'Autumn'], rock: ['Boulder', 'Slab'] };
