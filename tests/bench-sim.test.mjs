// Bench sim: determinism, hand-calculated game numbers, and a hand-built level the bot must clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/core/heft-data.js';
import { runSim, capacityOf, toolMulOf, speedFactorOf, swingDurOf, costOf } from '../src/bench/sim.js';

const level = D.newProject(42).level;
const bare = (resources) => ({ day: 1, dayTime: 0.06, player: { x: 1.4, z: 4.2 }, stock: { wood: 0, stone: 0 }, upgrades: { pack: 0, tool: 0 }, structures: [], resources });

test('same seed and level give identical runs', () => {
  const a = runSim(level, { days: 1, seed: 7, strategy: 'claims' }), b = runSim(level, { days: 1, seed: 7, strategy: 'claims' });
  const strip = r => ({ ...r, trail: Array.from(r.trail) });
  assert.deepEqual(strip(a), strip(b));
  assert.ok(a.deps.length > 0, 'the default level produces deposits in a day');
});

test('hand-calculated game numbers', () => {
  assert.equal(capacityOf(0), D.BASE_CAPACITY);                    // 12
  assert.equal(capacityOf(3), 30);                                 // 12 + 3*6
  assert.ok(Math.abs(toolMulOf(2) - 1.44) < 1e-9);                 // 1 + 2*0.22
  assert.ok(Math.abs(swingDurOf(0) - 0.42) < 1e-9);
  assert.ok(Math.abs(swingDurOf(3) - 0.42 / 1.66) < 1e-9);
  assert.ok(Math.abs(speedFactorOf(0.5) - 0.7205) < 1e-3);         // 1 - 0.62 * 0.5^1.15
  assert.equal(speedFactorOf(0), 1);
  assert.deepEqual(costOf('pack1'), { wood: 5, stone: 3 });        // 5 + 0*3, 3 + 0*3
  assert.deepEqual(costOf('tool3'), { wood: 9, stone: 10 });       // 3 + 2*3, 4 + 2*3
  assert.deepEqual(costOf('workbench'), { wood: 5, stone: 3 });
});

test('a lone tree next to spawn is chopped to zero and nothing else is taken', () => {
  const lvl = bare([{ id: 1, kind: 'tree', v: 0, x: 4.2, z: 4.2, s: 1, hp: 3, max: 3, regrowAt: 0 }]);
  const r = runSim(lvl, { days: 1, seed: 1, strategy: 'roam' });
  // each full cycle is three hits on the hp-3 tree; the tree regrows about 220 s after it is cut
  assert.equal(r.harvest.wood, 3 * (1 + r.regrow.wood));
  assert.ok(r.harvest.wood >= 3);
  assert.equal(r.harvest.stone, 0);
});

test('walled-in tree is never harvested', () => {
  const ring = Array.from({ length: 12 }, (_, k) => ({ id: 10 + k, kind: 'rock', v: 0, x: 3 * Math.cos(k * Math.PI / 6), z: 10 + 3 * Math.sin(k * Math.PI / 6), s: 1, hp: 3, max: 3, regrowAt: 0 }));
  const lvl = bare([{ id: 1, kind: 'tree', v: 0, x: 0, z: 10, s: 1, hp: 3, max: 3, regrowAt: 0 }, ...ring]);
  const r = runSim(lvl, { days: 1, seed: 1, strategy: 'roam' });
  assert.equal(r.harvest.wood, 0);
});

// Round 2 P2-9: milestones carry the level's start day and dayTime offset
import * as Dsim from '../src/core/heft-data.js';
test('milestones are absolute game times: start day and dayTime offset included', () => {
  const lvl = { ...Dsim.newProject(42).level, day: 3, dayTime: 0.69, upgrades: { pack: 3, tool: 3 } };
  const r = runSim(lvl, { days: 1, seed: 1, strategy: 'claims' });
  assert.deepEqual(r.milestones.allUpgrades, { t: 0, day: 3, sec: Math.round(0.69 * Dsim.DAY_LEN) });
  const rb = runSim(Dsim.newProject(42).level, { days: 2, seed: 1, strategy: 'claims' });
  const cf = rb.milestones.campfire;
  assert.ok(cf && cf.day >= 1 && cf.sec >= 0 && cf.sec < Dsim.DAY_LEN, JSON.stringify(cf));
  assert.equal(cf.day, 1 + Math.floor((rb.dayTime0 * Dsim.DAY_LEN + cf.t) / Dsim.DAY_LEN));
});
