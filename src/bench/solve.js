// Solvability engine: static reachability and walled-in cut search, then a verdict from simulated runs.
// Pure JS (runs in the Worker and in node tests). The two thresholds are design choices, not game constants.
import { buildWorld, GRID, UP_ITEMS, upKey, upLvl, costOf } from './sim.js';

export const NIGHT1_MIN_RES = 6;   // resources on claimed ground when night 1 starts
export const GOAL_DAY = 4;         // all upgrades bought by this game day (1-based)
const { N } = GRID;

// Reachability from the spawn on the planning grid, plus single-object cut suggestions for walled-in resources.
export function staticAnalysis(level, { cut = true } = {}) {
  const W = buildWorld(level);
  const res = W.res.map(r => ({ id: r.id, kind: r.kind, x: r.x, z: r.z, reach: r.reach, present: !r.removed && r.hp > 0, hp: r.hp }));
  const walled = res.filter(r => r.present && !r.reach);
  const blocked = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) blocked[c] = W.cover[c] > 0 || W.outside[c] ? 1 : 0;
  return { res, walled, cuts: cut && walled.length ? cutSearch(level, walled) : [], grid: { root: W.root, blocked } };
}

// Tries removing each candidate (any structure, or a tree/rock within 4 m of a walled-in resource) and keeps those that free resources.
function cutSearch(level, walled) {
  const cands = [
    ...level.structures.map(s => ({ kind: 'structure', id: s.id, type: s.type, x: s.x, z: s.z, node: 's:' + s.id,
      drop: L => ({ ...L, structures: L.structures.filter(o => o !== s) }) })),
    ...level.resources.filter(r => (r.kind === 'tree' || r.kind === 'rock') && !r.removed && r.hp > 0 && walled.some(u => Math.hypot(u.x - r.x, u.z - r.z) < 4))
      .map(r => ({ kind: 'resource', id: r.id, type: r.kind, x: r.x, z: r.z, node: 'r:' + r.id,
        drop: L => ({ ...L, resources: L.resources.map(o => o === r ? { ...o, removed: true } : o) }) })),
  ];
  const out = [];
  // shortcut: each candidate costs one full rebuild (~15 ms), so only the first 30 are tried (structures first), upgrade: rank candidates by freed area
  for (const c of cands.slice(0, 30)) {
    const W = buildWorld(c.drop(level)), byId = new Map(W.res.map(r => [r.id, r]));
    const frees = walled.filter(u => byId.get(u.id)?.reach).map(u => u.id);
    if (frees.length) out.push({ kind: c.kind, id: c.id, type: c.type, x: c.x, z: c.z, node: c.node, frees });
  }
  return out.sort((a, b) => b.frees.length - a.frees.length).slice(0, 5);
}

// Combines the static analysis with simulated runs into checks, issues and a verdict.
// A failed block-level check makes the level UNSOLVABLE; a failed warn-level check makes it AT RISK.
export function verdict(level, stat, runs = []) {
  const reach = { wood: { total: 0, reachable: 0, hp: 0 }, stone: { total: 0, reachable: 0, hp: 0 } };
  for (const r of stat.res) {
    if (!r.present) continue;
    const k = r.kind === 'tree' ? 'wood' : 'stone';
    reach[k].total++;
    if (r.reach) { reach[k].reachable++; reach[k].hp += r.hp; }
  }
  const owned = level.upgrades ?? { pack: 0, tool: 0 }, need = { wood: 0, stone: 0 };
  const addCost = c => { need.wood += c.wood || 0; need.stone += c.stone || 0; };
  for (const it of UP_ITEMS) if (upLvl(it) > owned[upKey(it)]) addCost(costOf(it));
  if (!level.structures.some(s => s.type === 'workbench')) addCost(costOf('workbench'));
  const stock = level.stock ?? { wood: 0, stone: 0 };
  const have = { wood: stock.wood + reach.wood.hp, stone: stock.stone + reach.stone.hp };
  const checks = [], issues = [];
  const check = (id, label, sev, ok, value, detail, node) => {
    checks.push({ id, label, sev, ok, value, detail });
    if (ok === false) issues.push({ sev, text: detail, node });
  };

  for (const k of ['wood', 'stone']) {
    const ok = need[k] === 0 || reach[k].reachable > 0;
    const w = stat.walled.find(u => (u.kind === 'tree') === (k === 'wood'));
    check('reach-' + k, `Reachable ${k}`, 'block', ok, `${reach[k].reachable}/${reach[k].total}`,
      `No ${k} source can be reached from the spawn`, w ? 'r:' + w.id : undefined);
  }
  check('budget', 'Budget (stock + reachable reserve)', 'block', have.wood >= need.wood && have.stone >= need.stone,
    `wood ${have.wood}/${need.wood}, stone ${have.stone}/${need.stone}`,
    `Remaining upgrades cost more than the reachable supply: wood ${have.wood}/${need.wood}, stone ${have.stone}/${need.stone}`);

  // the level passes if the best strategy passes: a slow strategy is a finding in the bench table, not a broken level
  const n1 = runs.map(r => r.night1?.safeRes).filter(n => n != null), n1best = n1.length ? Math.max(...n1) : null;
  check('night1', `Claims before night 1 (need ${NIGHT1_MIN_RES} resources)`, 'block', n1best == null ? null : n1best >= NIGHT1_MIN_RES,
    n1best == null ? '-' : `${n1best} resources`, `Best strategy has only ${n1best} resources on claimed ground when night 1 starts (need ${NIGHT1_MIN_RES})`);

  const upDays = runs.map(r => r.milestones.allUpgradesDay).filter(d => d != null), goalBest = upDays.length ? Math.min(...upDays) : null;
  check('goal', `All upgrades by day ${GOAL_DAY}`, 'warn', runs.length ? goalBest != null && goalBest <= GOAL_DAY : null,
    goalBest == null ? (runs.length ? 'not done' : '-') : `day ${goalBest}`,
    `Fastest strategy finishes upgrades on day ${goalBest ?? 'never'} (goal: day ${GOAL_DAY})`);

  const blocks = issues.filter(i => i.sev === 'block').length, warns = issues.length - blocks;
  // cut suggestions go last so the top issue is the blocking one
  for (const c of stat.cuts) issues.push({ sev: 'hint', text: `Removing ${c.node} would free ${c.frees.length} walled-in resource(s)`, node: c.node });
  const verdictText = blocks ? 'UNSOLVABLE' : warns ? 'AT RISK' : runs.length ? 'SOLVABLE' : 'STATIC OK';
  return { verdict: verdictText, checks, issues, budget: { need, have, stock }, reach, runs: runs.length };
}
