// Solvability engine: known-good level is SOLVABLE, hand-built unsolvable level is caught, verdict arithmetic pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/core/heft-data.js';
import { runSim, costOf, UP_ITEMS } from '../src/bench/sim.js';
import { staticAnalysis, verdict, NIGHT1_MIN_RES, GOAL_DAY } from '../src/bench/solve.js';

const level = D.newProject(42).level;
const bare = (resources, extra = {}) => ({ day: 1, dayTime: 0.06, player: { x: 1.4, z: 4.2 }, stock: { wood: 0, stone: 0 }, upgrades: { pack: 0, tool: 0 }, structures: [], resources, ...extra });
const rock = (id, x, z) => ({ id, kind: 'rock', v: 0, x, z, s: 1, hp: 3, max: 3, regrowAt: 0 });
const tree = (id, x, z) => ({ id, kind: 'tree', v: 0, x, z, s: 1, hp: 3, max: 3, regrowAt: 0 });
const fakeRun = (safeRes, allUpgradesDay) => ({ night1: { safeRes }, milestones: { allUpgradesDay } });

test('default level is SOLVABLE with no walled-in resources', () => {
  const stat = staticAnalysis(level);
  assert.equal(stat.walled.length, 0);
  const v = verdict(level, stat, [runSim(level, { days: 6, seed: 1, strategy: 'claims' })]);
  assert.equal(v.verdict, 'SOLVABLE', JSON.stringify(v.issues));
});

test('hand-built walled-in tree is UNSOLVABLE and a single rock cut is suggested', () => {
  // 12 rocks on a radius-3 ring around the only tree. Adjacent rock discs overlap, so the ring is closed.
  const ring = Array.from({ length: 12 }, (_, k) => rock(10 + k, 3 * Math.cos(k * Math.PI / 6), 10 + 3 * Math.sin(k * Math.PI / 6)));
  const lvl = bare([tree(1, 0, 10), ...ring]);
  const stat = staticAnalysis(lvl);
  assert.deepEqual(stat.walled.map(r => r.id), [1]);
  const v = verdict(lvl, stat, []);
  assert.equal(v.verdict, 'UNSOLVABLE');
  assert.equal(v.checks.find(c => c.id === 'reach-wood').ok, false);
  assert.equal(v.checks.find(c => c.id === 'reach-stone').ok, true);
  assert.ok(stat.cuts.some(c => c.frees.includes(1)), 'removing one ring rock frees the tree');
});

test('no tree anywhere is UNSOLVABLE (outside the island is blocked)', () => {
  const lvl = bare([rock(1, -40, 40)]);
  assert.equal(verdict(lvl, staticAnalysis(lvl), []).verdict, 'UNSOLVABLE');
});

test('budget counts every remaining upgrade plus a missing workbench', () => {
  const lvl = bare([tree(1, 4.2, 4.2)]);
  const v = verdict(lvl, staticAnalysis(lvl), []);
  const want = { wood: 0, stone: 0 };
  for (const it of UP_ITEMS) { want.wood += costOf(it).wood; want.stone += costOf(it).stone; }
  want.wood += 5; want.stone += 3;                                       // workbench
  assert.deepEqual(v.budget.need, want);
  assert.deepEqual(v.budget.need, { wood: 47, stone: 42 });              // 42 + 5, 39 + 3
});

test('claims before night 1 is a block check at NIGHT1_MIN_RES', () => {
  const stat = staticAnalysis(level);
  const low = verdict(level, stat, [fakeRun(NIGHT1_MIN_RES - 1, 2)]);
  assert.equal(low.checks.find(c => c.id === 'night1').ok, false);
  assert.equal(low.verdict, 'UNSOLVABLE');
  assert.equal(verdict(level, stat, [fakeRun(NIGHT1_MIN_RES, 2)]).checks.find(c => c.id === 'night1').ok, true);
});

test('late upgrades are a warning, not a block', () => {
  const stat = staticAnalysis(level);
  const v = verdict(level, stat, [fakeRun(14, GOAL_DAY + 1)]);
  assert.equal(v.checks.find(c => c.id === 'goal').ok, false);
  assert.equal(v.verdict, 'AT RISK');
});
