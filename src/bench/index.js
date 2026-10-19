// Pillar module: bench. Live Capacity Bench + Solvability panels, fed by a Worker that re-runs on every project edit.
import * as D from '../core/heft-data.js';
import { GRID } from './sim.js';
import { GOAL_DAY } from './solve.js';
import './bench.css';

const { N, CELL, HALF } = GRID;
const LIVE = ['claims', 'upgrades'].map(strategy => ({ strategy, seed: 1, days: 4 }));       // 4 game days so the day-4 goal is judged; nearest-first is in the deep run
const DEEP = ['claims', 'upgrades', 'roam'].flatMap(strategy => [1, 2].map(seed => ({ strategy, seed, days: 6 })));
const DEBOUNCE = 250;

export function install(ctx) {
  const { store, h } = ctx;
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const listeners = new Set();
  let seq = 0, timer = 0, result = null, level = null, progress = null;
  const emit = () => listeners.forEach(f => f());

  // overlays: draw2d reads the latest result; rev bumps tell the viewport to redraw
  const heat = document.createElement('canvas'); heat.width = heat.height = N;
  const overlays = {
    reach: { id: 'bench.reach', label: 'Reachability (green reachable, amber walled-in, red blocked)', enabled: false, rev: 0, draw2d: (g, view) => drawHeat(g, view) },
    walled: { id: 'bench.walled', label: 'Walled-in resources and cut suggestions', enabled: true, rev: 0, draw2d: (g, view) => drawWalled(g, view) },
    claims: { id: 'bench.claims', label: 'Claim radii', enabled: false, rev: 0, draw2d: (g, view) => drawClaims(g, view) },
    trail: { id: 'bench.trail', label: 'Best run bot trail', enabled: false, rev: 0, draw2d: (g, view) => drawTrail(g, view) },
  };
  ctx.bag.overlays.push(...Object.values(overlays));
  const touch = (...keys) => keys.forEach(k => overlays[k].rev++);

  function bakeHeat() {
    const { root, blocked } = result.stat.grid, img = heat.getContext('2d').createImageData(N, N), d = img.data;
    for (let c = 0; c < N * N; c++) {
      const [r, g, b, a] = root[c] ? [60, 200, 90, 110] : blocked[c] ? [200, 60, 60, 90] : [230, 180, 60, 110];
      d.set([r, g, b, a], c * 4);
    }
    heat.getContext('2d').putImageData(img, 0, 0);
  }
  // grid pixel (i,j) covers world x in [i*CELL-HALF-CELL/2, +CELL/2]; map it through the view's world-to-screen affine
  function gridMatrix(view) {
    const o = view.toScreen(-HALF - CELL / 2, -HALF - CELL / 2), ei = view.toScreen(-HALF + CELL / 2, -HALF - CELL / 2), ej = view.toScreen(-HALF - CELL / 2, -HALF + CELL / 2);
    return [ei[0] - o[0], ei[1] - o[1], ej[0] - o[0], ej[1] - o[1], o[0], o[1]];
  }
  function drawHeat(g, view) {
    if (!result) return;
    g.save(); g.setTransform(...gridMatrix(view)); g.imageSmoothingEnabled = false; g.drawImage(heat, 0, 0); g.restore();
  }
  function drawWalled(g, view) {
    if (!result) return;
    const s = view.scale;
    g.font = '11px ' + (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace');
    for (const r of result.stat.walled) {
      const [x, y] = view.toScreen(r.x, r.z);
      g.strokeStyle = '#ff5b5b'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke();
    }
    for (const c of result.stat.cuts) {
      const [x, y] = view.toScreen(c.x, c.z);
      g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, Math.max(8, (c.kind === 'structure' ? 1.2 : 0.8) * s), 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffd166'; g.fillText(`${c.node} +${c.frees.length}`, x + 10, y - 8);
    }
  }
  function drawClaims(g, view) {
    if (!level) return;
    const s = view.scale, circles = [[0, 0, D.CAMP_R], ...level.structures.map(o => [o.x, o.z, D.STRUCT[o.type].claim])];
    g.strokeStyle = 'rgba(120,190,255,0.7)'; g.setLineDash([6, 4]); g.lineWidth = 1.5;
    for (const [x, z, r] of circles) { const [sx, sy] = view.toScreen(x, z); g.beginPath(); g.arc(sx, sy, r * s, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
  }
  function drawTrail(g, view) {
    const t = result?.runs[0]?.trail;
    if (!t) return;
    g.lineWidth = 2;
    for (let i = 0; i + 5 < t.length; i += 3) {
      const [ax, ay] = view.toScreen(t[i], t[i + 1]), [bx, by] = view.toScreen(t[i + 3], t[i + 4]);
      g.strokeStyle = ['rgba(255,255,255,0.35)', '#5bd17a', '#9aa6b8'][t[i + 2]];
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
  }

  // runs: worker round trip, debounced; a newer request cancels the older one inside the worker
  function run(cfgs = LIVE) {
    const id = ++seq;
    level = store.project.level; progress = 0;
    worker.postMessage({ id, level, runs: cfgs });
    emit(); ctx.setStatus('bench', 'bench: running');
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => run(), DEBOUNCE); }
  worker.onmessage = ({ data: m }) => {
    if (m.id !== seq) return;
    if (m.type === 'progress') { progress = m.frac; return emit(); }
    result = { stat: m.stat, runs: m.runs, ms: m.ms, verdict: m.verdict };
    progress = null;
    bakeHeat();
    touch('reach', 'walled', 'claims', 'trail');
    ctx.setStatus('bench', `bench: ${m.verdict.verdict} · ${m.runs.length} runs · ${m.ms} ms`);
    emit();
  };
  store.on(why => { if (why === 'project') schedule(); });
  schedule();

  // ---------------------------------------------------------- panels
  function benchPanel() {
    const status = h('span', { class: 'bn-status' }), bar = h('i'), tab = h('tbody');
    const deepBtn = h('button', { class: 'bn-btn', onclick: () => run(DEEP) }, 'Deep run (6 runs, 6 days)');
    const foot = h('div', { class: 'bn-foot' });
    const ov = Object.entries({ trail: 'Best run trail', claims: 'Claim radii' }).map(([k, label]) => {
      const cb = h('input', { type: 'checkbox', onchange: e => { overlays[k].enabled = e.target.checked; touch(k); } });
      cb.checked = overlays[k].enabled;
      return h('label', {}, cb, ' ' + label);
    });
    const el = h('div', { class: 'bn' },
      h('div', { class: 'bn-top' }, status, deepBtn),
      h('div', { class: 'bn-bar' }, bar),
      h('table', { class: 'bn-tab' },
        h('thead', {}, h('tr', {}, ...['Plan', 'Camp', 'Bench', 'Upgrades', 'Wood/min', 'Stone/min', 'Idle', 'Exposed'].map(t => h('th', {}, t)))),
        tab),
      h('div', { class: 'bn-ov' }, ...ov), foot);
    const draw = () => {
      status.textContent = progress != null ? `running ${Math.round(progress * 100)}%` : result ? `${result.runs.length} runs, ${result.ms} ms` : 'idle';
      bar.style.width = (progress ?? 1) * 100 + '%'; bar.className = progress != null ? 'on' : '';
      tab.replaceChildren(...(result?.runs ?? []).map(r => {
        const days = r.days, mins = days * D.DAY_LEN / 60, cnt = t => r.deps.filter(d => d.type === t).length;
        const idle = r.idle / (days * D.DAY_LEN), exp = r.exposed;
        const cell = (t, ok = true) => h('td', { class: ok ? '' : 'bad' }, t);
        const fmt = t => t == null ? '-' : 'd' + (Math.floor(t / D.DAY_LEN) + 1) + ' ' + Math.round(t % D.DAY_LEN) + 's';
        return h('tr', {}, cell(`${r.strategy} #${r.seed}`), cell(fmt(r.milestones.campfire)), cell(fmt(r.milestones.workbench)),
          cell(r.milestones.allUpgradesDay == null ? 'not done' : 'day ' + r.milestones.allUpgradesDay, r.milestones.allUpgradesDay != null && r.milestones.allUpgradesDay <= GOAL_DAY),
          cell((cnt('wood') / mins).toFixed(1)), cell((cnt('stone') / mins).toFixed(1)), cell((idle * 100).toFixed(0) + '%'), cell(exp.toFixed(0) + 's', exp < 5));
      }));
      foot.textContent = result ? `Horizon ${result.runs[0]?.days ?? 0} game days at dt 1/30 s, wolves not simulated. Rates per game minute.` : '';
    };
    const sub = () => draw(); listeners.add(sub); draw();
    return { element: el, update: draw, dispose: () => listeners.delete(sub) };
  }

  function solvPanel() {
    const badge = h('div', { class: 'sv-badge' }), checks = h('tbody'), budget = h('div', { class: 'sv-budget' }), issues = h('ul', { class: 'sv-issues' });
    const ov = Object.entries({ reach: 'Reachability', walled: 'Walled-in and cuts' }).map(([k, label]) => {
      const cb = h('input', { type: 'checkbox', onchange: e => { overlays[k].enabled = e.target.checked; touch(k); } });
      cb.checked = overlays[k].enabled;
      return h('label', {}, cb, ' ' + label);
    });
    const el = h('div', { class: 'sv' }, h('div', { class: 'sv-top' }, badge),
      issues, budget, h('table', { class: 'sv-tab' }, checks), h('div', { class: 'bn-ov' }, ...ov));
    const draw = () => {
      const v = result?.verdict;
      badge.textContent = v ? v.verdict : progress != null ? 'checking...' : '-';
      badge.className = 'sv-badge ' + (v ? v.verdict.replace(/\s/g, '-').toLowerCase() : '');
      checks.replaceChildren(...(v?.checks ?? []).map(c => h('tr', {}, h('td', { class: 'sv-ok ' + (c.ok === false ? 'bad' : c.ok ? 'good' : '') }, c.ok === false ? 'x' : c.ok ? 'ok' : '-'), h('td', {}, c.label), h('td', { class: 'mono' }, c.value))));
      budget.replaceChildren(...(v ? ['wood', 'stone'].map(k => {
        const need = v.budget.need[k], have = v.budget.have[k], pct = need ? Math.min(100, have / need * 100) : 100;
        return h('div', { class: 'sv-meter' }, h('span', {}, `${k} ${have}/${need}`), h('div', { class: 'sv-bar' }, h('i', { style: { width: pct + '%' }, class: have >= need ? 'good' : 'bad' })));
      }) : []));
      issues.replaceChildren(...(v?.issues ?? []).map(i => h('li', { class: 'sv-' + i.sev, onclick: () => i.node && focus(i.node) },
        h('b', {}, i.sev), ' ' + i.text)));
    };
    const sub = () => draw(); listeners.add(sub); draw();
    return { element: el, update: draw, dispose: () => listeners.delete(sub) };
  }
  const focus = id => { store.select([id]); ctx.bag.frame?.([id]); };

  ctx.registerPanel({ id: 'bench', title: 'Capacity Bench', area: 'bottom', create: benchPanel });
  ctx.registerPanel({ id: 'solvability', title: 'Solvability', area: 'bottom', create: solvPanel });
}
