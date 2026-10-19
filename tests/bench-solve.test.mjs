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
const fakeRun = (safeRes, allUpgradesDay, days = 4) => ({ days, night1: { safeRes }, milestones: { allUpgradesDay } });

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

test('claims before night 1 is a warn check at NIGHT1_MIN_RES', () => {
  const stat = staticAnalysis(level);
  const low = verdict(level, stat, [fakeRun(NIGHT1_MIN_RES - 1, 2)]);
  assert.equal(low.checks.find(c => c.id === 'night1').ok, false);
  assert.equal(low.verdict, 'AT RISK');
  assert.equal(verdict(level, stat, [fakeRun(NIGHT1_MIN_RES, 2)]).checks.find(c => c.id === 'night1').ok, true);
});

test('late upgrades are a warning, not a block', () => {
  const stat = staticAnalysis(level);
  const v = verdict(level, stat, [fakeRun(14, GOAL_DAY + 1)]);
  assert.equal(v.checks.find(c => c.id === 'goal').ok, false);
  assert.equal(v.verdict, 'AT RISK');
});

// ---- Round 2 regressions
test('P0-1: a level that starts with every upgrade owned runs and is not blocked by the budget', () => {
  const maxed = { ...level, day: 3, dayTime: 0.69, upgrades: { pack: 3, tool: 3 } };
  const run = runSim(maxed, { days: 4, seed: 1, strategy: 'claims' });
  assert.equal(run.milestones.allUpgradesDay, 1, 'already owned: the milestone is the start of the sim');
  assert.equal(run.milestones.allUpgrades.day, 3, 'absolute day includes the level start day');
  const v = verdict(maxed, staticAnalysis(maxed), [run]);
  assert.equal(v.budget.need.wood, 0 + (level.structures.some(s => s.type === 'workbench') ? 0 : 5));
  assert.notEqual(v.verdict, 'STATIC OK');
});

test('P1-3: regrowth within the horizon counts toward the budget; trees left standing put the budget AT RISK, not UNSOLVABLE', () => {
  // two trees left (the critic's "delete most trees" repro): sim harvests ~36 wood in 4 days, and trees keep regrowing
  const lvl = { ...level, resources: level.resources.filter(o => o.kind !== 'tree' || o.id === 0 || o.id === 1) };
  const stat = staticAnalysis(lvl);
  const v = verdict(lvl, stat, []);
  assert.ok(v.budget.regrow.wood > 0, 'regrowth is counted');
  assert.equal(v.budget.have.wood, v.budget.stock.wood + v.reach.wood.hp + v.budget.regrow.wood);
  assert.equal(v.checks.find(c => c.id === 'budget').ok, false, 'the 47 wood budget is still short by day 4');
  assert.equal(v.checks.find(c => c.id === 'budget').sev, 'warn');
  assert.notEqual(v.verdict, 'UNSOLVABLE');
  assert.equal(v.verdict, 'AT RISK');
});

test('P1-4: night 1 starting too early (dayTime 0.69) is AT RISK (pacing heuristic)', () => {
  const lvl = { ...level, dayTime: 0.69 };
  const v = verdict(lvl, staticAnalysis(lvl), [runSim(lvl, { days: 4, seed: 1, strategy: 'claims' })]);
  const c = v.checks.find(x => x.id === 'night1');
  assert.equal(c.ok, false, c.value);
  assert.equal(c.sev, 'warn');
  assert.equal(v.verdict, 'AT RISK');
});

test('P1-5: every walled-in and outside-shore resource is a warning, even with reachable ones of the same kind', () => {
  // reachable tree at the spawn, a walled-in tree in the ring, and a tree outside the island shore
  const ring = Array.from({ length: 12 }, (_, k) => rock(10 + k, 3 * Math.cos(k * Math.PI / 6), 10 + 3 * Math.sin(k * Math.PI / 6)));
  const lvl = bare([tree(1, 4.2, 4.2), tree(2, 0, 10), tree(3, 60, 0), ...ring]);
  const stat = staticAnalysis(lvl);
  assert.deepEqual(stat.walled.map(r => r.id).sort(), [2, 3]);
  const v = verdict(lvl, stat, []);
  assert.equal(v.checks.find(c => c.id === 'reach-wood').ok, true, 'reachable wood exists, so the block check passes');
  const w2 = v.issues.find(i => i.node === 'r:2'), w3 = v.issues.find(i => i.node === 'r:3');
  assert.equal(w2?.sev, 'warn');
  assert.match(w2.text, /Oak Tree #2|Pine Tree #2|Autumn Tree #2/);
  assert.match(w2.text, /walled in by .*#1[0-9]/, 'names the nearest ring rocks, not raw ids');
  assert.equal(w3?.sev, 'warn');
  assert.match(w3.text, /outside the island shore/);
  assert.ok(!/s:|r:\d/.test(w2.text + w3.text), 'no raw node ids in the text');
});

test('P2-6: two palisades must both go to free a walled-in tree; the pair is suggested by name', () => {
  // 12 palisades on a radius-2.6 ring: removing one leaves its neighbours overlapping, so no single cut frees the tree
  const walls = Array.from({ length: 12 }, (_, k) => { const a = k * Math.PI / 6; return { id: 50 + k, type: 'wall', x: 2.6 * Math.cos(a), z: 10 + 2.6 * Math.sin(a), rot: a + Math.PI / 2 }; });
  const lvl = bare([tree(1, 0, 10)], { structures: walls });
  const stat = staticAnalysis(lvl);
  assert.deepEqual(stat.walled.map(r => r.id), [1]);
  assert.ok(stat.cuts.every(c => c.items.length === 2), 'no single palisade frees the tree');
  const pair = stat.cuts.find(c => c.frees.includes(1));
  assert.ok(pair, JSON.stringify(stat.cuts));
  assert.equal(pair.items.length, 2);
  const hint = verdict(lvl, stat, []).issues.find(i => i.sev === 'hint');
  assert.match(hint.text, /Removing Palisade #\d+ and Palisade #\d+ would free 1/);
  assert.ok(!/s:\d|r:\d/.test(hint.text), 'no raw node ids in the hint');
});

test('P2-7: "no stone in level" when none exists; goal wording says not done within the horizon', () => {
  const lvl = bare([tree(1, 4.2, 4.2)]);
  const v = verdict(lvl, staticAnalysis(lvl), []);
  assert.equal(v.checks.find(c => c.id === 'reach-stone').value, 'no stone in level');
  const withStone = { ...level };
  const g = verdict(withStone, staticAnalysis(withStone), [{ ...fakeRun(14, null), days: 4 }]);
  assert.equal(g.checks.find(c => c.id === 'goal').value, 'not done in 4 days');
  assert.match(g.checks.find(c => c.id === 'goal').detail, /not done within the 4 simulated days/);
});

test('P1-5: a walled-in resource alone moves a SOLVABLE level to AT RISK, and hints come before the warnings', () => {
  const ring = Array.from({ length: 12 }, (_, k) => rock(10 + k, 3 * Math.cos(k * Math.PI / 6), 10 + 3 * Math.sin(k * Math.PI / 6)));
  const lvl = bare([tree(1, 4.2, 4.2), tree(2, 0, 10), ...ring]);
  const v = verdict(lvl, staticAnalysis(lvl), []);
  assert.equal(v.verdict, 'AT RISK');
  const firstWarn = v.issues.findIndex(i => i.sev === 'warn' && /walled in/.test(i.text));
  const firstHint = v.issues.findIndex(i => i.sev === 'hint');
  assert.ok(firstHint >= 0 && firstHint < firstWarn, 'cut hints are listed before the per-resource warnings');
});
