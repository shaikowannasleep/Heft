import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../src/core/heft-data.js';

test('newProject builds a valid game state with stable structure ids', () => {
  const p = D.newProject(42);
  assert.ok(D.validState(D.toGameState(p)));
  assert.equal(p.level.resources.length, 205);
  assert.deepEqual(p.level.structures.map(s => s.id), [1]);
  assert.equal(D.toGameState(p).structures[0].id, undefined);
});

test('generation is deterministic per seed', () => {
  assert.deepEqual(D.generateResources(9), D.generateResources(9));
  assert.notDeepEqual(D.generateResources(9), D.generateResources(10));
});

test('round trip game state -> project -> game state', () => {
  const s = D.toGameState(D.newProject(3));
  const back = D.toGameState(D.fromGameState(s));
  assert.deepEqual({ ...back, savedAt: 0 }, { ...s, savedAt: 0 });
});

// Ported constants must match the game while both repos sit side by side.
const game = new URL('../../repo-app/index.html', import.meta.url);
test('ported constants match repo-app', { skip: !fs.existsSync(game) && 'repo-app not checked out next door' }, () => {
  const src = fs.readFileSync(game, 'utf8');
  for (const k of ['BASE_CAPACITY', 'BASE_SPEED', 'CAMP_R', 'DAY_LEN', 'PILE_MAX']) {
    assert.equal(+new RegExp(`const ${k} = ([\\d.]+)`).exec(src)[1], D[k], k);
  }
  assert.ok(src.includes(D.generateResources.toString().replace(/^export /, '')), 'generateResources drifted from the game');
});
