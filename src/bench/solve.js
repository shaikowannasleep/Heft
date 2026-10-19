// Solvability engine: static reachability, walled-in blockers and cut search, then a verdict from simulated runs.
// Pure JS (runs in the Worker and in node tests). The two thresholds are design choices, not game constants.
import * as D from '../core/heft-data.js';
import { buildWorld, GRID, UP_ITEMS, upKey, upLvl, costOf } from './sim.js';

export const NIGHT1_MIN_RES = 6;   // resources on claimed ground when night 1 starts
export const GOAL_DAY = 4;         // all upgrades bought by this game day (1-based); also the budget horizon
const { N } = GRID;
const HORIZON_S = GOAL_DAY * D.DAY_LEN;
const REGROW_MIN = { tree: 220, rock: 280 };  // minimum regrow delay per harvest.regrowAt in sim.js (repo-app deplete())
const NEAR = 4;                                // m: a structure or resource this close to a walled-in resource is a blocker candidate

export const structName = s => `${D.STRUCT[s.type]?.name ?? s.type} #${s.id}`;
export const resName = r => r.kind === 'tree' ? `${D.RES_V.tree[r.v]} Tree #${r.id}` : `${D.RES_V.rock[r.v]} #${r.id}`;

// Regrowth within the budget horizon: one upper-bound regrow per cycle, minus the first depletion (the stock in hand covers it).
const regrowHp = r => Math.max(0, Math.floor(HORIZON_S / REGROW_MIN[r.kind]) - 1) * r.max;

// Reachability from the spawn on the planning grid, walled-in resources with their nearest blockers.
export function staticAnalysis(level, { cut = true } = {}) {
  const W = buildWorld(level);
  const res = W.res.map(r => ({ id: r.id, kind: r.kind, v: r.v, x: r.x, z: r.z, max: r.max, name: resName(r), reach: r.reach, present: !r.removed && r.hp > 0, hp: r.hp }));
  const walled = res.filter(r => r.present && !r.reach).map(r => walledInfo(level, r));
  const blocked = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) blocked[c] = W.cover[c] > 0 || W.outside[c] ? 1 : 0;
  return { res, walled, cuts: cut && walled.length ? cutSearch(level, walled) : [], grid: { root: W.root, blocked } };
}

// Why a resource is walled in, and the nearest structures or other resources standing in the way.
function walledInfo(level, r) {
  if (!D.inIsland(r.x, r.z)) return { ...r, why: 'outside the island shore', blockers: [] };
  const near = [
    ...level.structures.map(s => ({ d: Math.hypot(s.x - r.x, s.z - r.z), node: 's:' + s.id, name: structName(s) })),
    ...level.resources.filter(o => o.id !== r.id && (o.kind === 'tree' || o.kind === 'rock') && !o.removed && o.hp > 0)
      .map(o => ({ d: Math.hypot(o.x - r.x, o.z - r.z), node: 'r:' + o.id, name: resName(o) })),
  ].filter(o => o.d < NEAR).sort((a, b) => a.d - b.d).slice(0, 3);
  return { ...r, why: 'walled in', blockers: near.map(({ node, name }) => ({ node, name })) };
}

// Tries removing each candidate (a structure, or a tree/rock within 4 m of a walled-in resource) and keeps those that free resources.
// When no single removal frees anything, pairs among the 8 candidates nearest to a walled-in resource are tried.
// Generator: yields after each rebuild so the Worker can cancel a stale request; returns the top 5 suggestions.
export function* cutSearchGen(level, walled) {
  const near = (x, z) => walled.some(u => Math.hypot(u.x - x, u.z - z) < NEAR);
  const single = [
    ...level.structures.map(s => ({ kind: 'structure', id: s.id, x: s.x, z: s.z, node: 's:' + s.id, name: structName(s),
      drop: L => ({ ...L, structures: L.structures.filter(o => o !== s) }) })),
    ...level.resources.filter(r => (r.kind === 'tree' || r.kind === 'rock') && !r.removed && r.hp > 0 && near(r.x, r.z))
      .map(r => ({ kind: 'resource', id: r.id, x: r.x, z: r.z, node: 'r:' + r.id, name: resName(r),
        drop: L => ({ ...L, resources: L.resources.map(o => o === r ? { ...o, removed: true } : o) }) })),
  ].slice(0, 30);   // shortcut: each candidate costs one full rebuild (~15 ms), so 30 singles at most; upgrade: rank by freed area
  const freed = drop => {
    const W = buildWorld(drop(level)), byId = new Map(W.res.map(r => [r.id, r]));
    return walled.filter(u => byId.get(u.id)?.reach).map(u => u.id);
  };
  const out = [];
  for (const c of single) { yield; const frees = freed(c.drop); if (frees.length) out.push({ items: [c], frees }); }
  if (!out.length && walled.length) {
    const ranked = single.map(c => ({ c, d: Math.min(...walled.map(u => Math.hypot(u.x - c.x, u.z - c.z))) }))
      .sort((a, b) => a.d - b.d).slice(0, 8).map(o => o.c);
    for (let i = 0; i < ranked.length; i++) for (let j = i + 1; j < ranked.length; j++) {
      yield;
      const a = ranked[i], b = ranked[j], frees = freed(L => b.drop(a.drop(L)));
      if (frees.length) out.push({ items: [a, b], frees });
    }
  }
  return out.sort((a, b) => b.frees.length - a.frees.length || a.items.length - b.items.length).slice(0, 5)
    .map(({ items, frees }) => ({ node: items[0].node, items: items.map(c => ({ node: c.node, name: c.name, x: c.x, z: c.z, kind: c.kind })), frees }));
}
export function cutSearch(level, walled) { const g = cutSearchGen(level, walled); let r; while (!(r = g.next()).done); return r.value; }

// Combines the static analysis with simulated runs into checks, issues and a verdict.
// A failed block-level check makes the level UNSOLVABLE; a failed warn-level check makes it AT RISK.
export function verdict(level, stat, runs = []) {
  const reach = { wood: { total: 0, reachable: 0, hp: 0, regrow: 0 }, stone: { total: 0, reachable: 0, hp: 0, regrow: 0 } };
  for (const r of stat.res) {
    if (!r.present) continue;
    const k = r.kind === 'tree' ? 'wood' : 'stone';
    reach[k].total++;
    if (r.reach) { reach[k].reachable++; reach[k].hp += r.hp; reach[k].regrow += regrowHp(r); }
  }
  const owned = level.upgrades ?? { pack: 0, tool: 0 }, need = { wood: 0, stone: 0 };
  const addCost = c => { need.wood += c.wood || 0; need.stone += c.stone || 0; };
  for (const it of UP_ITEMS) if (upLvl(it) > owned[upKey(it)]) addCost(costOf(it));
  if (!level.structures.some(s => s.type === 'workbench')) addCost(costOf('workbench'));
  const stock = level.stock ?? { wood: 0, stone: 0 };
  const have = { wood: stock.wood + reach.wood.hp + reach.wood.regrow, stone: stock.stone + reach.stone.hp + reach.stone.regrow };
  const checks = [], issues = [];
  const check = (id, label, sev, ok, value, detail, node) => {
    checks.push({ id, label, sev, ok, value, detail });
    if (ok === false) issues.push({ sev, text: detail, node });
  };
  const kindName = { wood: 'tree', stone: 'rock' };

  for (const k of ['wood', 'stone']) {
    const ok = need[k] === 0 || reach[k].reachable > 0;
    const w = stat.walled.find(u => (u.kind === 'tree') === (k === 'wood'));
    const value = reach[k].total === 0 ? `no ${k} in level` : `${reach[k].reachable}/${reach[k].total}`;
    const detail = reach[k].total === 0 ? `No ${k} in level (no ${kindName[k]} to harvest), but upgrades need ${need[k]} ${k}`
      : `No ${k} source can be reached from the spawn`;
    check('reach-' + k, `Reachable ${k}`, 'block', ok, value, detail, w ? 'r:' + w.id : undefined);
  }
  // regrowth keeps coming after day 4, so a reachable source only puts the budget at risk; no reachable source at all is a block
  const noSource = ['wood', 'stone'].some(k => need[k] > stock[k] && reach[k].reachable === 0);
  const budgetOk = have.wood >= need.wood && have.stone >= need.stone;
  check('budget', `Budget by day ${GOAL_DAY} (stock + reachable + regrowth)`, noSource ? 'block' : 'warn', budgetOk,
    `wood ${have.wood}/${need.wood}, stone ${have.stone}/${need.stone}`,
    `Upgrades need more than the supply by day ${GOAL_DAY}: wood ${have.wood}/${need.wood}, stone ${have.stone}/${need.stone}` +
      (noSource ? ', and a needed resource has no reachable source' : ' (regrowth continues after day ' + GOAL_DAY + ')'));

  // the level passes if the best strategy passes: a slow strategy is a finding in the bench table, not a broken level
  const n1 = runs.map(r => r.night1?.safeRes).filter(n => n != null), n1best = n1.length ? Math.max(...n1) : null;
  check('night1', `Claims before night 1 (need ${NIGHT1_MIN_RES} resources)`, 'warn', n1best == null ? null : n1best >= NIGHT1_MIN_RES,  // pacing heuristic, not a proof: AT RISK, never UNSOLVABLE
    n1best == null ? '-' : `${n1best} resources`, `Best strategy has only ${n1best} resources on claimed ground when night 1 starts (need ${NIGHT1_MIN_RES})`);

  const H = Math.max(0, ...runs.map(r => r.days ?? 0)), judged = runs.length > 0 && H >= GOAL_DAY;
  const upDays = runs.map(r => r.milestones.allUpgradesDay).filter(d => d != null), goalBest = upDays.length ? Math.min(...upDays) : null;
  // a fast pass shorter than the goal day cannot judge the goal: it stays pending until the full pass
  check('goal', `All upgrades by day ${GOAL_DAY}`, 'warn', judged ? goalBest != null && goalBest <= GOAL_DAY : null,
    !runs.length ? '-' : !judged ? 'full pass pending' : goalBest == null ? `not done in ${H} days` : `day ${goalBest}`,
    goalBest == null ? `Upgrades are not done within the ${H} simulated days (goal: day ${GOAL_DAY})`
      : `Fastest strategy finishes upgrades on day ${goalBest} (goal: day ${GOAL_DAY})`);

  // order: blocks, goal, cut hints, then one warning per walled-in resource (hints stay visible among many warnings)
  for (const c of stat.cuts) {
    const names = c.items.map(i => i.name).join(' and ');
    issues.push({ sev: 'hint', text: `Removing ${names} would free ${c.frees.length} walled-in resource(s)`, node: c.node });
  }
  // every walled-in or outside-shore resource is a warning, even when other resources of its kind are reachable
  for (const u of stat.walled) {
    const via = u.blockers.length ? ` by ${u.blockers.map(b => b.name).join(', ')}` : '';
    issues.push({ sev: 'warn', text: `${u.name} is ${u.why}${u.why === 'walled in' ? via : ''}`, node: 'r:' + u.id });
  }
  const blocks = issues.filter(i => i.sev === 'block').length, warns = issues.filter(i => i.sev === 'warn').length;
  const verdictText = blocks ? 'UNSOLVABLE' : warns ? 'AT RISK' : runs.length ? 'SOLVABLE' : 'STATIC OK';
  return { verdict: verdictText, checks, issues, budget: { need, have, stock, regrow: { wood: reach.wood.regrow, stone: reach.stone.regrow } }, reach, runs: runs.length };
}
