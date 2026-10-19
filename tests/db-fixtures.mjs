// Shared test data for the db pillar: a default-shaped level, a large synthetic level, and a seeded random project.
import * as D from '../src/core/heft-data.js';

export function bigLevel(n, seed = 7) {
  const p = D.newProject(1), rng = D.mulberry32(seed), R = [];
  for (let id = 0; id < n; id++) {
    const kind = rng() < 0.7 ? 'tree' : 'rock', v = kind === 'tree' ? Math.floor(rng() * 3) : Math.floor(rng() * 2);
    const a = rng() * Math.PI * 2, d = 10 + rng() * 35;
    R.push({ id, kind, v, x: Math.round(Math.cos(a) * d * 100) / 100, z: Math.round(Math.sin(a) * d * 100) / 100, rot: Math.round(rng() * 6280) / 1000, s: Math.round((0.85 + rng() * 0.4) * 1000) / 1000, hp: 4, max: 4, regrowAt: 0 });
  }
  p.level.resources = R;
  return p;
}

// Random JSON-like value with the awkward cases: -0, NaN, huge ints, unicode, a __proto__ key.
const KEYS = ['a', 'b', '__proto__', 'z ü', 'k'];
export function rnd(r, d = 0) {
  switch (Math.floor(r() * (d > 2 ? 6 : 8))) {
    case 0: return null;
    case 1: return r() < 0.5;
    case 2: return Math.floor((r() - 0.5) * 2 ** 40);
    case 3: return (r() - 0.5) * 10 ** Math.floor(r() * 20 - 10);
    case 4: return ['', 'a', 'ünï ✓', 'x'.repeat(Math.floor(r() * 40))][Math.floor(r() * 4)];
    case 5: return [NaN, Infinity, -Infinity, -0, 2 ** 53, -(2 ** 53) + 1, 5e-324, 1.7976931348623157e308][Math.floor(r() * 8)];
    case 6: return Array.from({ length: Math.floor(r() * 5) }, () => rnd(r, d + 1));
    default: {
      const o = {};
      for (let i = Math.floor(r() * 5); i > 0; i--) Object.defineProperty(o, KEYS[Math.floor(r() * KEYS.length)], { value: rnd(r, d + 1), enumerable: true, writable: true, configurable: true });
      return o;
    }
  }
}

// Level rows that mostly fit the columnar schema, with some that must take the generic path.
export function fuzzLevel(r) {
  const p = D.newProject(1 + Math.floor(r() * 99));
  const pick = a => a[Math.floor(r() * a.length)];
  p.level.resources = Array.from({ length: 40 + Math.floor(r() * 60) }, () => {
    const o = { id: Math.floor(r() * 1e6) - 5, kind: pick(['tree', 'rock', 'ruin']), v: Math.floor(r() * 16), x: r() < 0.8 ? Math.round(r() * 4000 - 2000) / 100 : r() * 100 - 50, z: r() * 100 - 50, rot: Math.round(r() * 6283) / 1000, s: r() < 0.9 ? 1 : r(), hp: Math.floor(r() * 256), max: Math.floor(r() * 256), regrowAt: Math.round(r() * 1e5) / 100 };
    if (r() < 0.2) o.removed = true;
    if (r() < 0.05) o.x = 'oops';
    if (r() < 0.05) o.extra = rnd(r);
    if (r() < 0.03) delete o.hp;
    return o;
  });
  p.level.structures = Array.from({ length: Math.floor(r() * 12) }, (_, i) => ({ id: i + 1, type: pick(['tree', 'wall', 'campfire', 'weird key']), x: r() * 40 - 20, z: r() * 40 - 20, rot: r() * 6.3, ...(r() < 0.1 ? { lit: true } : {}) }));
  p.models = { 'tree.0': rnd(r, 1), 'rock.0': { verts: [0, 1.5, -0] } };
  p.meta = { created: '2026-01-01T00:00:00.000Z', note: rnd(r) };
  return p;
}
