// Headless Heft bot simulation. Pure JS, no DOM, runs inside the bench Worker.
// Each rule cites the repo-app function it mirrors. Fixed step DT, all randomness from a seeded RNG.
// Approximations (also listed in the panel): wolves are not simulated (night exposure is reported instead),
// the bot stands still while swinging (the game lets it drift at 40% speed), purchases are instant.
import * as D from '../core/heft-data.js';

export const DT = 1 / 30;
const DAY = D.DAY_LEN, NIGHT0 = 0.70, NIGHT1 = 0.965;     // repo-app NIGHT_START / NIGHT_END
const HALF = 50, CELL = 0.5, N = 201, BK = 4, PR = D.PLAYER_R, DEP = 2.0, CHUNK = 3000;
export const GRID = { N, CELL, HALF };                    // planning grid: cell (i,j) centre = (i*CELL-HALF, j*CELL-HALF)
const PAD = 0.1;                                          // margin kept when standing in reach of a resource
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// buildCamp() campColliders
export const CAMP_COLLIDERS = [
  { x: -3.4, z: -4.0, r: 1.3 }, { x: 3.4, z: -3.0, r: 0.5 }, { x: 2.6, z: -3.7, r: 0.4 },
  { x: D.WOOD_PILE.x, z: D.WOOD_PILE.z, r: 1.0 }, { x: D.STONE_PILE.x, z: D.STONE_PILE.z, r: 1.15 }, { x: 1.75, z: -1.45, r: 0.15 },
];
// Bot strategies: build order (purchase plan) and which resource it walks to first.
export const STRATEGIES = {
  claims: { label: 'Claims first', plan: ['campfire', 'workbench', 'pack1', 'tool1', 'campfire', 'pack2', 'tool2', 'pack3', 'tool3'], gather: 'camp' },
  upgrades: { label: 'Upgrades first', plan: ['workbench', 'pack1', 'tool1', 'pack2', 'tool2', 'pack3', 'tool3', 'campfire'], gather: 'camp' },
  roam: { label: 'Nearest first', plan: ['campfire', 'workbench', 'pack1', 'tool1', 'pack2', 'tool2', 'pack3', 'tool3'], gather: 'bot' },
};
export const UP_ITEMS = ['pack1', 'tool1', 'pack2', 'tool2', 'pack3', 'tool3'];

export const upKey = item => item.replace(/\d$/, '');
export const upLvl = item => +item.slice(-1);
export const costOf = item => /^(campfire|workbench|wall)$/.test(item) ? D.STRUCT[item].cost : D.UPGRADES[upKey(item)].cost(upLvl(item) - 1);
export const capacityOf = pack => D.BASE_CAPACITY + pack * 6;          // capacity()
export const toolMulOf = tool => 1 + tool * 0.22;                     // toolMul()
export const speedFactorOf = load => 1 - 0.62 * Math.pow(load, 1.15); // updatePlayer speedFactor
export const swingDurOf = tool => 0.42 / toolMulOf(tool);             // handleAction player.swingDur

// ---------------------------------------------------------------- grid + spatial index
const cellOf = v => Math.round((v + HALF) / CELL);
const cXY = c => [(c % N) * CELL - HALF, ((c / N) | 0) * CELL - HALF];
const bkey = (x, z) => ((Math.floor(x / BK) + 64) << 8) | (Math.floor(z / BK) + 64);
const resBlk = r => r.removed ? 0 : r.hp > 0 ? r.r : r.kind === 'tree' ? 0.24 : 0;  // resolveCollisions()
const typeOf = r => r.kind === 'tree' ? 'wood' : 'stone';
const present = r => !r.removed && r.hp > 0;                           // isPresent()

function stamp(W, x, z, R, d) {
  const i0 = Math.max(0, cellOf(x - R)), i1 = Math.min(N - 1, cellOf(x + R));
  const j0 = Math.max(0, cellOf(z - R)), j1 = Math.min(N - 1, cellOf(z + R));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const cx = i * CELL - HALF, cz = j * CELL - HALF;
    if ((cx - x) ** 2 + (cz - z) ** 2 <= R * R) W.cover[j * N + i] += d;
  }
}
// paints an obstacle's blocking disc (radius + player radius) into the planning grid; o.cov remembers the paint
function setCover(W, o, R) {
  if (o.cov === R) return;
  if (o.cov > 0) stamp(W, o.x, o.z, o.cov + PR, -1);
  if (R > 0) stamp(W, o.x, o.z, R + PR, 1);
  o.cov = R;
}
function insert(W, o) {
  const k = bkey(o.x, o.z), L = W.idx.get(k);
  if (L) L.push(o); else W.idx.set(k, [o]);
}
function eachObs(W, x, z, R, fn) {
  for (let bx = Math.floor((x - R) / BK); bx <= Math.floor((x + R) / BK); bx++)
    for (let bz = Math.floor((z - R) / BK); bz <= Math.floor((z + R) / BK); bz++) {
      const L = W.idx.get(((bx + 64) << 8) | (bz + 64));
      if (L) for (const o of L) fn(o);
    }
}
const eachRes = (W, x, z, R, fn) => eachObs(W, x, z, R, o => { if (o.res) fn(o.res); });
const blockedCell = (W, c) => W.cover[c] > 0 || W.outside[c] === 1;
function blockedAt(W, x, z) {
  const i = cellOf(x), j = cellOf(z);
  if (i < 0 || j < 0 || i >= N || j >= N) return true;
  return blockedCell(W, j * N + i);
}

// ---------------------------------------------------------------- physics (updatePlayer + resolveCollisions)
function collide(W, p, rad) {
  eachObs(W, p.x, p.z, 1.6 + rad, o => {
    const br = o.res ? resBlk(o.res) : o.r;
    if (!br) return;
    const dx = p.x - o.x, dz = p.z - o.z, d2 = dx * dx + dz * dz, m = br + rad;
    if (d2 < m * m) { const d = Math.sqrt(d2) || 0.001; p.x = o.x + dx / d * m; p.z = o.z + dz / d * m; }
  });
  const R = D.islandR(p.x, p.z) - 1.0, d = Math.hypot(p.x, p.z);
  if (d > R) { p.x *= R / d; p.z *= R / d; }
}
function moveBot(W, ix, iz, il) {
  const b = W.bot, load = weight(W) / capacityOf(W.up.pack);
  const maxSp = D.BASE_SPEED * speedFactorOf(load);
  const accel = (il > 0.05 ? 26 : 20) * (1 - 0.55 * load), step = accel * DT;
  const dvx = ix * maxSp - b.vx, dvz = iz * maxSp - b.vz, dl = Math.hypot(dvx, dvz);
  if (dl <= step) { b.vx += dvx; b.vz += dvz; } else { b.vx += dvx / dl * step; b.vz += dvz / dl * step; }
  b.x += b.vx * DT; b.z += b.vz * DT;
  collide(W, b, PR);
}
const weight = W => W.bot.stack.reduce((a, e) => a + e.w, 0);
const stackTop = W => W.bot.stack.reduce((a, e) => a + e.h, 0);
const canCarry = (W, type) => weight(W) + D.ITEM[type].w <= capacityOf(W.up.pack);
const isNight = dt => dt >= NIGHT0 && dt < NIGHT1;

// ---------------------------------------------------------------- territory (rebuildClaims / claimDepth)
function claimDepth(W, x, z) {
  let best = -99;
  for (const c of W.claims) { const d = c.r - Math.hypot(x - c.x, z - c.z); if (d > best) best = d; }
  return best;
}
const isSafe = (W, x, z) => claimDepth(W, x, z) > 0;
function claimedArea(W) {
  let n = 0;
  for (let c = 0; c < N * N; c++) { const [x, z] = cXY(c); if (claimDepth(W, x, z) > 0) n++; }
  return n * CELL * CELL;
}

// ---------------------------------------------------------------- world
export function buildWorld(level, opts = {}) {
  const strat = STRATEGIES[opts.strategy] ?? STRATEGIES.claims;
  const W = {
    t: 0, clock: 0, day: level.day, day0: level.day, dayTime: level.dayTime, dayTime0: level.dayTime, night: false, nightSeen: false, nextRegrow: 1, nextTrail: 0,
    rng: D.mulberry32(opts.seed ?? 1), strat, plan: [...strat.plan], pi: 0, idx: new Map(),
    cover: new Int32Array(N * N), outside: new Uint8Array(N * N), root: new Uint8Array(N * N),
    gs: new Uint32Array(N * N), cl: new Uint32Array(N * N), gv: new Float32Array(N * N), from: new Int32Array(N * N), gen: 0,
    res: [], st: [], claims: [{ x: 0, z: 0, r: D.CAMP_R }], stock: { wood: level.stock.wood | 0, stone: level.stock.stone | 0 },
    up: { pack: level.upgrades?.pack | 0, tool: level.upgrades?.tool | 0 }, nextId: 1000,
    bot: { x: level.player.x, z: level.player.z, vx: 0, vz: 0, stack: [], task: null, swingT: 0, swingCd: 0, swingDur: 0.42, hit: false },
    credits: [], ci: 0, bad: new Map(), badSites: new Set(), siteWait: 0, depT: 0.15, haul: null, hauls: [], trail: [], deps: [], builds: [], buys: [],
    harvest: { wood: 0, stone: 0 }, regrow: { wood: 0, stone: 0 }, exposed: 0, idle: 0, night1: null, nightStart: null,
    days: [], acc: null,
  };
  for (let c = 0; c < N * N; c++) { const [x, z] = cXY(c); W.outside[c] = D.inIsland(x, z, 1) ? 0 : 1; }
  for (const c of CAMP_COLLIDERS) insert(W, { x: c.x, z: c.z, r: c.r, cov: 0 });
  for (const c of CAMP_COLLIDERS) setCover(W, W.idx.get(bkey(c.x, c.z)).find(o => o.x === c.x && o.z === c.z), c.r);
  for (const r of level.resources) {
    if (r.kind !== 'tree' && r.kind !== 'rock') continue;
    const s = r.s ?? 1, o = { x: r.x, z: r.z, cov: 0, res: null };
    const res = { i: W.res.length, id: r.id, kind: r.kind, v: r.v, x: r.x, z: r.z, s, r: r.kind === 'tree' ? 0.42 * s : 0.85 * s,
      hp: r.hp | 0, max: Math.max(1, r.max | 0), regrowAt: r.regrowAt || 0, removed: !!r.removed, o, reach: false };
    o.res = res; W.res.push(res); insert(W, o); setCover(W, o, resBlk(res));
  }
  for (const s of level.structures) addStruct(W, s.type, s.x, s.z, s.rot || 0, s.id);
  reachStatic(W);
  W.acc = dayAcc(W);
  W.nightStart = W.dayTime < NIGHT0 ? (NIGHT0 - W.dayTime) * DAY : null;
  return W;
}
function dayAcc(W) {
  return { day: W.day - W.day0 + 1, area: claimedArea(W), dep: { wood: 0, stone: 0 }, harvest: { wood: 0, stone: 0 }, regrow: { wood: 0, stone: 0 }, exposed: 0 };
}
// structure colliders exactly as rebuildColliders()
function addStruct(W, type, x, z, rot, id) {
  const def = D.STRUCT[type], s = { id: id ?? W.nextId++, type, x, z, rot, claim: def.claim, foot: def.foot };
  W.st.push(s); W.claims.push({ x, z, r: def.claim });
  const cols = type === 'campfire' ? [[0, 0.55]] : type === 'wall' ? [[-0.85, 0.36], [0, 0.36], [0.85, 0.36]] : [[-0.45, 0.55], [0.45, 0.55]];
  for (const [k, r] of cols) {
    const o = { x: x + Math.cos(rot) * k, z: z - Math.sin(rot) * k, r, cov: 0, res: null };
    insert(W, o); setCover(W, o, r);
  }
  return s;
}
// static reachability for the level as it stands at t=0: flood fill from the spawn, then per-resource reach
function reachStatic(W) {
  const sx = W.bot.x, sz = W.bot.z;
  let start = cellOf(sx) + cellOf(sz) * N, best = 1e9;
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
    const c = (cellOf(sz) + j) * N + cellOf(sx) + i;
    if (c < 0 || c >= N * N || blockedCell(W, c)) continue;
    const [x, z] = cXY(c), d = Math.hypot(x - sx, z - sz);
    if (d < best) { best = d; start = c; }
  }
  const q = new Int32Array(N * N); let h = 0, t = 0;
  q[t++] = start; W.root[start] = 1;
  while (h < t) {
    const c = q[h++];
    for (const [dx, dz] of DIRS) {
      const ni = (c % N) + dx, nj = ((c / N) | 0) + dz;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nc = nj * N + ni;
      if (W.root[nc] || blockedCell(W, nc)) continue;
      if (dx && dz && (blockedCell(W, c + dx) || blockedCell(W, c + dz * N))) continue;  // no corner cutting
      W.root[nc] = 1; q[t++] = nc;
    }
  }
  for (const r of W.res) {
    const rng = 1.25 + r.r - PAD; let ok = false;
    const i0 = Math.max(0, cellOf(r.x - rng)), i1 = Math.min(N - 1, cellOf(r.x + rng));
    const j0 = Math.max(0, cellOf(r.z - rng)), j1 = Math.min(N - 1, cellOf(r.z + rng));
    for (let j = j0; j <= j1 && !ok; j++) for (let i = i0; i <= i1 && !ok; i++) {
      const c = j * N + i, [x, z] = cXY(c);
      if (W.root[c] && Math.hypot(x - r.x, z - r.z) <= rng) ok = true;
    }
    r.reach = ok;
  }
}

// ---------------------------------------------------------------- A* on the planning grid (8-connected, no corner cutting)
const hpush = (h, k, v) => {
  let i = h.k.length; h.k.push(k); h.v.push(v);
  while (i > 0) { const p = (i - 1) >> 1; if (h.k[p] <= k) break; h.k[i] = h.k[p]; h.v[i] = h.v[p]; i = p; }
  h.k[i] = k; h.v[i] = v;
};
const hpop = h => {
  const top = h.v[0], k = h.k.pop(), v = h.v.pop(), n = h.k.length;
  if (n) {
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= n) break;
      if (c + 1 < n && h.k[c + 1] < h.k[c]) c++;
      if (h.k[c] >= k) break;
      h.k[i] = h.k[c]; h.v[i] = h.v[c]; i = c;
    }
    h.k[i] = k; h.v[i] = v;
  }
  return top;
};
// returns smoothed waypoints [[x,z],...] (excluding the start) or null when no route exists
export function astar(W, sx, sz, goal, h, maxNodes = 40000) {
  if (goal(sx, sz)) return [];
  const gen = ++W.gen, s = cellOf(sx) + cellOf(sz) * N;
  const open = { k: [], v: [] };
  W.gs[s] = gen; W.gv[s] = 0; W.from[s] = -1;
  hpush(open, h(sx, sz), s);
  let end = -1, n = 0;
  while (open.k.length && n++ < maxNodes) {
    const c = hpop(open);
    if (W.cl[c] === gen) continue;
    W.cl[c] = gen;
    const [x, z] = cXY(c);
    if (goal(x, z)) { end = c; break; }
    const ci = c % N, cj = (c / N) | 0;
    for (const [dx, dz] of DIRS) {
      const ni = ci + dx, nj = cj + dz;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nc = nj * N + ni;
      if (blockedCell(W, nc) || W.cl[nc] === gen) continue;
      if (dx && dz && (blockedCell(W, c + dx) || blockedCell(W, c + dz * N))) continue;
      const g = W.gv[c] + (dx && dz ? Math.SQRT2 : 1) * CELL;
      if (W.gs[nc] === gen && W.gv[nc] <= g) continue;
      W.gs[nc] = gen; W.gv[nc] = g; W.from[nc] = c;
      const [mx, mz] = cXY(nc);
      hpush(open, g + h(mx, mz), nc);
    }
  }
  if (end < 0) return null;
  const pts = []; for (let c = end; c >= 0; c = W.from[c]) pts.push(cXY(c));
  pts.reverse();                                  // pts[0] is the start cell
  const out = []; let a = 0;
  while (a < pts.length - 1) {                    // greedy line-of-sight smoothing
    let b = pts.length - 1;
    while (b > a + 1 && !los(W, pts[a], pts[b])) b--;
    out.push(pts[b]); a = b;
  }
  return out;
}
function los(W, a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 0.25);
  for (let k = 1; k <= n; k++) { const t = k / n; if (blockedAt(W, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; }
  return true;
}

// ---------------------------------------------------------------- tasks
// walk task: goal(x,z) predicate, h(x,z) heuristic, done(W) on arrival
function walkTask(W, kind, goal, h, extra = {}) { return { k: kind, goal, h, wp: null, i: 0, replans: 0, failed: false, lt: W.t, lx: W.bot.x, lz: W.bot.z, ...extra }; }
function plan(W, T) {
  const wp = astar(W, W.bot.x, W.bot.z, T.goal, T.h);
  T.wp = wp; T.i = 0; T.lt = W.t; T.lx = W.bot.x; T.lz = W.bot.z;
  if (!wp) T.failed = true;
  return !!wp;
}
// direction to the next waypoint, or null when the walk is finished (or failed)
function follow(W, T) {
  const b = W.bot;
  for (let guard = 0; guard < 3; guard++) {
    if (T.failed) return null;
    if (T.wp && T.i < T.wp.length) {
      const [x, z] = T.wp[T.i], dx = x - b.x, dz = z - b.z, l = Math.hypot(dx, dz);
      if (Math.hypot(b.x - T.lx, b.z - T.lz) > 0.05) { T.lx = b.x; T.lz = b.z; T.lt = W.t; }
      else if (W.t - T.lt > 1.5) { T.lt = W.t; T.replans++; if (T.replans > 6 || !plan(W, T)) T.failed = true; continue; }
      if (l >= 0.3) return [dx / l, dz / l];
      T.i++; continue;
    }
    if (T.goal(b.x, b.z)) return null;
    if (T.replans++ > 6 || !plan(W, T)) T.failed = true;
  }
  return null;
}
function endTask(W) { W.bot.task = null; }
function startGather(W, r) {
  const rng = 1.25 + r.r - PAD;
  return walkTask(W, 'gather', (x, z) => Math.hypot(x - r.x, z - r.z) <= rng, (x, z) => Math.max(0, Math.hypot(x - r.x, z - r.z) - rng), { r });
}

// ---------------------------------------------------------------- bot decisions (the player's loop in repo-app)
function nextItem(W) {
  while (W.pi < W.plan.length) {
    const it = W.plan[W.pi];
    if (UP_ITEMS.includes(it) && W.up[upKey(it)] >= upLvl(it)) { W.pi++; continue; }
    if (it === 'workbench' && benchOf(W)) { W.pi++; continue; }
    break;
  }
  const it = W.plan[W.pi];
  if (!it) return null;
  if (UP_ITEMS.includes(it) && !benchOf(W)) return 'workbench';   // upgrades are bought at a workbench
  return it;
}
const benchOf = W => W.st.find(s => s.type === 'workbench');
const affordable = (W, c) => W.stock.wood >= (c.wood || 0) && W.stock.stone >= (c.stone || 0);
function needType(W, item) {
  const c = item ? costOf(item) : { wood: 0, stone: 0 };
  const dw = Math.max(0, (c.wood || 0) - W.stock.wood), ds = Math.max(0, (c.stone || 0) - W.stock.stone);
  if (!dw && !ds) return W.stock.wood <= W.stock.stone ? 'wood' : 'stone';
  return ds / Math.max(1, c.stone || 1) > dw / Math.max(1, c.wood || 1) ? 'stone' : 'wood';
}
function pickTarget(W, type) {
  const home = W.strat.gather === 'camp';
  let best = null, bs = Infinity;
  for (const r of W.res) {
    if (r.kind !== (type === 'wood' ? 'tree' : 'rock') || !present(r) || !r.reach) continue;
    const bad = W.bad.get(r.i); if (bad !== undefined && bad > W.t) continue;
    if (W.night && !isSafe(W, r.x, r.z)) continue;                   // wolves are out: only work inside claimed ground
    const s = home ? Math.hypot(r.x, r.z) : Math.hypot(r.x - W.bot.x, r.z - W.bot.z);
    if (s < bs) { bs = s; best = r; }
  }
  return best;
}
// placementProblem() without the cost check; x,z on the 0.5 m lattice
function placementOK(W, type, x, z) {
  const def = D.STRUCT[type];
  if (!D.inIsland(x, z, 2)) return false;
  if (Math.hypot(x, z) < D.DEPOSIT_R + 1.0) return false;
  if (claimDepth(W, x, z) < -3.5) return false;
  let ok = true;
  eachRes(W, x, z, def.foot + 1.2, r => { if (ok && present(r) && Math.hypot(r.x - x, r.z - z) < def.foot + r.r + 0.1) ok = false; });
  if (!ok) return false;
  for (const s of W.st) {
    const min = (type === 'wall' && s.type === 'wall') ? 1.7 : def.foot + s.foot;
    if (Math.hypot(s.x - x, s.z - z) < min) return false;
  }
  for (const c of CAMP_COLLIDERS) if (Math.hypot(c.x - x, c.z - z) < def.foot + c.r) return false;
  return true;
}
// best site for a structure: campfires claim the most unclaimed resources, workbenches sit close to camp
function findSite(W, type) {
  const def = D.STRUCT[type], dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  let best = null, bs = -Infinity;
  for (let c = 0; c < N * N; c++) {
    const [x, z] = cXY(c), cd = claimDepth(W, x, z);
    if (cd < -3.5 || cd > 0.5 || W.outside[c]) continue;
    let s = -Math.hypot(x, z) * 0.05;
    if (type === 'campfire') {
      let gain = 0;
      eachRes(W, x, z, def.claim + 1, r => { if (present(r) && r.reach && claimDepth(W, r.x, r.z) <= 0 && Math.hypot(r.x - x, r.z - z) < def.claim) gain++; });
      s += gain * 10;
    } else s -= Math.hypot(x, z) * 0.5;
    if (s <= bs || W.badSites.has(x + ',' + z)) continue;
    if (!placementOK(W, type, x, z)) continue;
    const p = dirs.map(([fx, fz]) => [x - fx * 2.5, z - fz * 2.5]).find(([px, pz]) => {
      const pc = cellOf(px) + cellOf(pz) * N;
      return !blockedAt(W, px, pz) && W.root[pc];
    });
    if (p) { best = { type, x, z, px: p[0], pz: p[1] }; bs = s; }
  }
  return best;
}
function placeAt(W, type, x, z) {
  const def = D.STRUCT[type], b = W.bot;
  if (!affordable(W, def.cost) || !placementOK(W, type, x, z)) return false;
  W.stock.wood -= def.cost.wood || 0; W.stock.stone -= def.cost.stone || 0;
  addStruct(W, type, x, z, 0);
  for (const r of W.res) if (!r.removed && !present(r) && Math.hypot(r.x - x, r.z - z) < def.foot + 0.8) { r.removed = true; setCover(W, r.o, resBlk(r)); }
  W.builds.push({ t: W.t, type, x, z, day: W.day - W.day0 + 1 });
  if (W.plan[W.pi] === type) W.pi++;
  W.siteWait = 0;
  return b;
}
function buyUp(W, item) {
  const c = costOf(item), k = upKey(item);
  W.stock.wood -= c.wood; W.stock.stone -= c.stone; W.up[k]++;
  W.buys.push({ t: W.t, item, day: W.day - W.day0 + 1 });
}
function decide(W) {
  const b = W.bot, item = nextItem(W), wt = weight(W);
  if (item && affordable(W, costOf(item))) {
    const bench = benchOf(W);
    if (UP_ITEMS.includes(W.plan[W.pi]) && bench && W.plan[W.pi] === item) {
      return b.task = walkTask(W, 'buy', (x, z) => Math.hypot(x - bench.x, z - bench.z) < 2.0, (x, z) => Math.max(0, Math.hypot(x - bench.x, z - bench.z) - 2.0));
    }
    if (!UP_ITEMS.includes(item) && W.t >= W.siteWait) {
      const site = findSite(W, item);       // scans the whole grid, so a miss backs off for 10 game s
      if (site) return b.task = walkTask(W, 'build', (x, z) => Math.hypot(x - site.px, z - site.pz) < 0.1, (x, z) => Math.hypot(x - site.px, z - site.pz), { site });
      W.siteWait = W.t + 10;
    }
  }
  const type = needType(W, item), other = type === 'wood' ? 'stone' : 'wood';
  for (const ty of [type, other]) {
    if (!canCarry(W, ty)) continue;
    const r = pickTarget(W, ty);
    if (r) return b.task = startGather(W, r);
  }
  if (b.stack.length) return b.task = walkTask(W, 'dep', (x, z) => Math.hypot(x, z) < DEP, (x, z) => Math.max(0, Math.hypot(x, z) - DEP));
  if (W.night && !isSafe(W, b.x, b.z)) return b.task = walkTask(W, 'home', (x, z) => Math.hypot(x, z) < DEP, (x, z) => Math.max(0, Math.hypot(x, z) - DEP));
  b.task = { k: 'wait', until: W.t + 3 };
}

// ---------------------------------------------------------------- per-step systems
function harvest(W, r) {               // harvest() + addToStack()
  const b = W.bot, type = typeOf(r), it = D.ITEM[type];
  r.hp--; W.harvest[type]++; W.acc.harvest[type]++;
  const y = stackTop(W), dur = 0.42 + Math.min(0.25, y * 0.04);
  if (!b.stack.length) W.haul = { t0: W.t, t1: W.t, dist: 0, wood: 0, stone: 0 };
  b.stack.push({ type, h: it.h, w: it.w, landAt: W.t + dur });
  if (r.hp <= 0) { r.regrowAt = W.clock + (r.kind === 'tree' ? 220 : 280) + W.rng() * 80; setCover(W, r.o, resBlk(r)); }  // deplete()
}
function regrowCheck(W) {              // regrowCheck()
  const b = W.bot;
  for (const r of W.res) {
    if (r.removed || present(r) || !r.regrowAt || W.clock < r.regrowAt) continue;
    if (Math.hypot(r.x - b.x, r.z - b.z) < 4) continue;
    if (W.st.some(s => Math.hypot(s.x - r.x, s.z - r.z) < s.foot + r.r + 0.3)) { r.removed = true; setCover(W, r.o, resBlk(r)); continue; }
    r.hp = r.max; r.regrowAt = 0; W.regrow[typeOf(r)]++; W.acc.regrow[typeOf(r)]++; setCover(W, r.o, resBlk(r));
  }
}
function depositStep(W) {              // updateDeposit(): standing in the ring pops the top landed item
  const b = W.bot, inZone = Math.hypot(b.x, b.z) < D.DEPOSIT_R;
  if (inZone && b.stack.length) {
    W.depT -= DT;
    if (W.depT <= 0) {
      const top = b.stack[b.stack.length - 1];
      if (top && top.landAt <= W.t) {
        b.stack.pop(); W.credits.push({ at: W.t + 0.5, type: top.type });   // flight to the pile
        if (W.haul) { W.haul[top.type]++; W.haul.t1 = W.t; if (!b.stack.length) { W.hauls.push(W.haul); W.haul = null; } }
        W.depT = 0.11;
      }
    }
  } else W.depT = 0.15;
}
function creditStep(W) {
  while (W.ci < W.credits.length && W.credits[W.ci].at <= W.t) {
    const c = W.credits[W.ci++]; W.stock[c.type]++; W.acc.dep[c.type]++;
    W.deps.push({ t: W.t, type: c.type });
  }
}
function newDay(W) {
  W.days.push(W.acc);
  W.acc = dayAcc(W);
}

// one fixed step of the simulation
function stepOnce(W) {
  const b = W.bot, px = b.x, pz = b.z;
  W.t += DT; W.clock += DT; W.dayTime += DT / DAY;
  if (W.dayTime >= 1) { W.dayTime -= 1; W.day++; newDay(W); }
  W.night = isNight(W.dayTime);
  if (W.night && !W.nightSeen) {
    W.nightSeen = true;
    W.night1 = { t: W.t, safeRes: W.res.filter(r => present(r) && r.reach && isSafe(W, r.x, r.z)).length, area: claimedArea(W), campfires: W.st.filter(s => s.type === 'campfire').length };
  }
  if (W.clock >= W.nextRegrow) { W.nextRegrow += 1; regrowCheck(W); }
  creditStep(W);
  depositStep(W);
  if (W.night && !isSafe(W, b.x, b.z)) { W.exposed += DT; W.acc.exposed += DT; }
  if (W.t >= W.nextTrail) { W.nextTrail += 0.5; W.trail.push(b.x, b.z, b.stack.length ? (b.stack[b.stack.length - 1].type === 'wood' ? 1 : 2) : 0); }

  if (!b.task) decide(W);
  const T = b.task;
  let dir = null;
  if (!T) { /* decide always sets a task */ }
  else if (T.k === 'wait') { if (W.t >= T.until) endTask(W); }
  else if (T.k === 'gather') {
    const r = T.r;
    if (!present(r)) { endTask(W); }
    else if (b.swingT > 0) {           // swing(): the hit lands at 55% of the swing
      b.swingT += DT;
      const p = b.swingT / b.swingDur;
      if (!b.hit && p >= 0.55) {
        b.hit = true;
        if (present(r) && Math.hypot(r.x - b.x, r.z - b.z) < 1.8 + r.r && canCarry(W, typeOf(r))) harvest(W, r);
      }
      if (p >= 1) { b.swingT = 0; b.swingCd = 0.07; }
    } else {
      b.swingCd = Math.max(0, b.swingCd - DT);
      const rng = 1.25 + r.r;
      if (Math.hypot(r.x - b.x, r.z - b.z) <= rng) {
        if (!canCarry(W, typeOf(r))) endTask(W);
        else if (b.swingCd <= 0) { b.swingT = 0.0001; b.swingDur = swingDurOf(W.up.tool); b.hit = false; }
      } else {
        dir = follow(W, T);
        if (!dir && T.failed) { W.bad.set(r.i, W.t + 60); endTask(W); }
        else if (!dir) { W.bad.set(r.i, W.t + 60); endTask(W); }
      }
    }
  } else if (T.k === 'dep' && !b.stack.length) endTask(W);
  else if (T.k === 'dep' || T.k === 'home' || T.k === 'build' || T.k === 'buy') {
    dir = follow(W, T);
    if (!dir) {
      if (T.failed) { if (T.site) W.badSites.add(T.site.x + ',' + T.site.z); endTask(W); }
      else if (T.k === 'build') { placeAt(W, T.site.type, T.site.x, T.site.z); endTask(W); }
      else if (T.k === 'buy') {
        for (let g = 0; g < 8; g++) { const it = nextItem(W); if (!it || !UP_ITEMS.includes(it) || !affordable(W, costOf(it))) break; buyUp(W, it); }
        endTask(W);
      }
      else if (T.k === 'home') endTask(W);
      // 'dep' stays until the stack is empty (checked at the top of this branch)
    }
  }
  if (dir) moveBot(W, dir[0], dir[1], 1); else moveBot(W, 0, 0, 0);
  if (!dir && (!T || T.k === 'wait')) W.idle += DT;
  if (W.haul) W.haul.dist += Math.hypot(b.x - px, b.z - pz);
  if (W.bot.task && W.bot.task.k === 'build' && W.bot.task.failed) endTask(W);
}

// ---------------------------------------------------------------- runner
// Generator: yields a progress fraction every CHUNK steps so the Worker can stay responsive and cancel stale runs.
export function* simRun(level, opts = {}) {
  const H = opts.days ?? 6, W = buildWorld(level, opts), end = H * DAY;
  let n = 0;
  while (W.t < end) {
    stepOnce(W);
    if (++n % CHUNK === 0) yield W.t / end;
  }
  W.days.push(W.acc);
  return summarize(W, H, opts);
}
export function runSim(level, opts) { const g = simRun(level, opts); let r; while (!(r = g.next()).done); return r.value; }

function summarize(W, H, opts) {
  // absolute game clock for a run time t: level start day and dayTime offset included
  const at = t => t == null ? null : { t, day: W.day0 + Math.floor((W.dayTime0 * DAY + t) / DAY), sec: Math.round((W.dayTime0 * DAY + t) % DAY) };
  const firstBuy = type => at(W.builds.find(b => b.type === type)?.t ?? null);
  const upDone = UP_ITEMS.every(it => W.up[upKey(it)] >= upLvl(it));
  // already maxed at the start: nothing was bought, so the milestone is the start itself (day 1 of the sim)
  const lastUp = upDone ? (W.buys.length ? W.buys[W.buys.length - 1].t : 0) : null;
  const lastDay = upDone ? (W.buys.length ? W.buys[W.buys.length - 1].day : 1) : null;
  return {
    strategy: opts.strategy ?? 'claims', seed: opts.seed ?? 1, days: H, steps: Math.round(H * DAY / DT),
    dayTime0: W.dayTime0, day0: W.day0, nightStart: W.nightStart, night1: W.night1,
    dayStats: W.days.map(d => ({ ...d })),
    deps: W.deps, hauls: W.hauls, builds: W.builds, buys: W.buys, harvest: W.harvest, regrow: W.regrow,
    exposed: W.exposed, idle: W.idle, trail: Float32Array.from(W.trail), up: { ...W.up }, stock: { ...W.stock },
    milestones: { campfire: firstBuy('campfire'), workbench: firstBuy('workbench'), allUpgrades: at(lastUp), allUpgradesDay: lastDay },
    reserve: W.res.filter(r => present(r)).reduce((a, r) => (a[typeOf(r)] += r.hp, a), { wood: 0, stone: 0 }),
  };
}
