import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { gameModels, gameBuilderParts } from '../tools/modeling-gamesrc.mjs';
import { DEFAULTS } from '../src/modeling/defaults.js';
import { KEYS, bakeModel, bakePart, weldsOf, validParts, mergeGeo } from '../src/modeling/recipe.js';

const gamePath = new URL('../../repo-app/index.html', import.meta.url);
const skip = !fs.existsSync(gamePath) && 'repo-app not checked out next door';
const G = skip ? null : gameModels(fs.readFileSync(gamePath, 'utf8'));

// The game's geometry for each model key, as a list of geometries (player is the builder's meshes in the root frame).
function gameGeoms(key) {
  if (key.startsWith('tree.')) return [G.TREE_GEOS[+key[5]]];
  if (key.startsWith('rock.')) return [G.ROCK_GEOS[+key[5]]];
  if (key === 'player') return gameBuilderParts(G);
  return [G.STRUCT_GEO[key]];
}
const boundsOf = list => {
  const b = new THREE.Box3();
  for (const g of list) { g.computeBoundingBox(); b.union(g.boundingBox); }
  return b;
};

test('default recipes are valid and bake deterministically', () => {
  for (const k of KEYS) {
    assert.ok(validParts(DEFAULTS[k]), k);
    assert.deepEqual(bakeModel(DEFAULTS[k]).attributes.position.array, bakeModel(DEFAULTS[k]).attributes.position.array, k);
  }
});

test('editor recipes match the game: vertex count and bounds within 1 cm', { skip }, () => {
  for (const k of KEYS) {
    const game = gameGeoms(k), gameVerts = game.reduce((n, g) => n + g.attributes.position.count, 0);
    const ed = bakeModel(DEFAULTS[k]);
    assert.equal(ed.attributes.position.count, gameVerts, `${k} vertex count`);
    const gb = boundsOf(game), eb = boundsOf([ed]);
    for (const axis of ['min', 'max']) for (const c of ['x', 'y', 'z']) {
      assert.ok(Math.abs(gb[axis][c] - eb[axis][c]) < 0.01, `${k} ${axis}.${c}: game ${gb[axis][c]} editor ${eb[axis][c]}`);
    }
  }
});

test('welds: a box is 8 corners; vertex offsets move only the targeted vertices', () => {
  const box = { prim: 'box', args: [1, 1, 1], color: 0x808080, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], jit: 0.07, grad: 0.22, warp: 0, seed: 7 };
  assert.equal(weldsOf(bakePart(box, false)).length, 8);
  const moved = bakePart({ ...box, vx: { 0: [0.5, 0, 0] } });
  const base = bakePart(box, false).attributes.position;
  const now = moved.attributes.position;
  for (let i = 1; i < now.count; i++) assert.equal(now.getX(i), base.getX(i));
  assert.ok(Math.abs(now.getX(0) - base.getX(0) - 0.5) < 1e-6);
});

test('validParts refuses malformed recipes at the trust boundary', () => {
  const ok = { prim: 'cyl', args: [0.1, 0.1, 1, 6], color: 0xffffff, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
  assert.ok(validParts([ok]));
  assert.ok(!validParts([{ ...ok, prim: 'torus' }]));
  assert.ok(!validParts([{ ...ok, args: [0.1, 0.1, 1, 1e9] }]));
  assert.ok(!validParts([{ ...ok, pos: [NaN, 0, 0] }]));
  assert.ok(!validParts([{ ...ok, color: 0x1000000 }]));
  assert.ok(!validParts([{ ...ok, vx: { x: [0, 0, 0] } }]));
  assert.ok(!validParts([]));
  assert.ok(!validParts(null));
});

test('merged geometry keeps the parts in order', () => {
  const a = bakePart(DEFAULTS['tree.1'][0]), g = mergeGeo([a]);
  assert.equal(g.attributes.position.count, a.attributes.position.count);
});
