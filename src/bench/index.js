// Pillar module: bench. Live Capacity Bench + Solvability panels, fed by a Worker that re-runs on every project edit.
// Edit -> pending at once -> static verdict -> fast pass (one strategy, 4 days) -> full pass refines the numbers.
import * as D from '../core/heft-data.js';
import { GRID } from './sim.js';
import { GOAL_DAY, verdict } from './solve.js';
import './bench.css';

const { N, CELL, HALF } = GRID;
const FAST = [{ strategy: 'claims', seed: 1, days: 1 }];   // shortcut: 1 game day covers night 1 and the budget; the day-4 goal waits for the full pass
const FULL_DAYS = GOAL_DAY;
const FULL = ['claims', 'upgrades', 'roam'].map(strategy => ({ strategy, seed: 1, days: FULL_DAYS }));
const DEBOUNCE = 80;
const TRAIL = [{ rgb: 'rgba(255,255,255,0.35)', hex: '#e8e8e8', name: 'on foot' }, { rgb: '#5bd17a', hex: '#5bd17a', name: 'carrying wood' }, { rgb: '#9aa6b8', hex: '#9aa6b8', name: 'carrying stone' }];
const LIST_MAX = 10;

export function install(ctx) {
  const { store, h } = ctx;
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const listeners = new Set();
  // result: last static + run data (kept while a newer one is pending, shown dimmed); pending: edit waiting for numbers
  let seq = 0, timer = 0, result = null, pending = false, refining = false, failure = null, progress = null;
  const emit = () => listeners.forEach(f => f());

  // overlays: draw2d reads the latest result, object3d (Scene 3D) is rebuilt by the viewport when rev changes
  const heat = document.createElement('canvas'); heat.width = heat.height = N;
  const overlays = {
    reach: { id: 'bench.reach', label: 'Reachability (green reachable, amber walled-in, red blocked)', enabled: false, rev: 0, draw2d: (g, view) => drawHeat(g, view) },
    walled: { id: 'bench.walled', label: 'Walled-in resources and cut suggestions', enabled: true, rev: 0, draw2d: (g, view) => drawWalled(g, view), object3d: THREE => objWalled(THREE) },
    claims: { id: 'bench.claims', label: 'Claim radii', enabled: false, rev: 0, draw2d: (g, view) => drawClaims(g, view), object3d: THREE => objClaims(THREE) },
    trail: { id: 'bench.trail', label: 'Best run bot trail', enabled: false, rev: 0, draw2d: (g, view) => drawTrail(g, view), object3d: THREE => objTrail(THREE) },
  };
  ctx.bag.overlays.push(...Object.values(overlays));
  // every data change or toggle bumps the rev (viewport rebuilds Scene 3D objects on it) and asks for a 2D repaint
  const touch = (...keys) => { keys.forEach(k => overlays[k].rev++); ctx.bag.redraw?.(); };

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
  const bestRun = () => (result?.runs ?? []).reduce((b, r) => (!b || r.deps.length > b.deps.length ? r : b), null);
  const claimCircles = () => result?.level ? [[0, 0, D.CAMP_R], ...result.level.structures.map(o => [o.x, o.z, D.STRUCT[o.type].claim])] : [];
  function drawHeat(g, view) {
    if (!result?.stat) return;
    g.save(); g.setTransform(...gridMatrix(view)); g.imageSmoothingEnabled = false; g.drawImage(heat, 0, 0); g.restore();
  }
  function drawWalled(g, view) {
    const stat = result?.stat;
    if (!stat) return;
    const s = view.scale;
    g.font = '11px ' + (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace');
    for (const r of stat.walled) {
      const [x, y] = view.toScreen(r.x, r.z);
      g.strokeStyle = '#ff5b5b'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke();
      if (stat.walled.length <= 12) { g.fillStyle = '#ff9b9b'; g.fillText(r.name, x + 8, y + 14); }
    }
    for (const c of stat.cuts) {
      for (const it of c.items) {
        const [x, y] = view.toScreen(it.x, it.z);
        g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, Math.max(8, (it.kind === 'structure' ? 1.2 : 0.8) * s), 0, Math.PI * 2); g.stroke();
      }
      const [x, y] = view.toScreen(c.items[0].x, c.items[0].z);
      g.fillStyle = '#ffd166'; g.fillText(`${c.items.map(i => i.name).join(' + ')} frees ${c.frees.length}`, x + 10, y - 8);
    }
  }
  function drawClaims(g, view) {
    const s = view.scale;
    g.strokeStyle = 'rgba(120,190,255,0.7)'; g.setLineDash([6, 4]); g.lineWidth = 1.5;
    for (const [x, z, r] of claimCircles()) { const [sx, sy] = view.toScreen(x, z); g.beginPath(); g.arc(sx, sy, r * s, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
  }
  function drawTrail(g, view) {
    const t = bestRun()?.trail;
    if (!t) return;
    g.lineWidth = 2;
    for (let i = 0; i + 5 < t.length; i += 3) {
      const [ax, ay] = view.toScreen(t[i], t[i + 1]), [bx, by] = view.toScreen(t[i + 3], t[i + 4]);
      g.strokeStyle = TRAIL[t[i + 2]].rgb;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
  }
  // Scene 3D: flat line segments on the ground (y up, world x/z as in the 2D view)
  const geo = (THREE, pos, col) => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  };
  function objClaims(THREE) {
    const pos = [], SEG = 48;
    for (const [x, z, r] of claimCircles()) for (let i = 0; i < SEG; i++) {
      const a = i / SEG * Math.PI * 2, b = (i + 1) / SEG * Math.PI * 2;
      pos.push(x + r * Math.cos(a), 0.06, z + r * Math.sin(a), x + r * Math.cos(b), 0.06, z + r * Math.sin(b));
    }
    return new THREE.LineSegments(geo(THREE, pos), new THREE.LineBasicMaterial({ color: 0x78beff }));
  }
  function objWalled(THREE) {
    const grp = new THREE.Group(), pos = [], cpos = [], SEG = 16;
    for (const r of result?.stat?.walled ?? []) {
      const x = r.x, z = r.z, d = 0.45;
      pos.push(x - d, 0.3, z - d, x + d, 0.3, z + d, x + d, 0.3, z - d, x - d, 0.3, z + d);
    }
    for (const c of result?.stat?.cuts ?? []) for (const it of c.items) for (let i = 0; i < SEG; i++) {
      const a = i / SEG * Math.PI * 2, b = (i + 1) / SEG * Math.PI * 2, R = it.kind === 'structure' ? 1.2 : 0.8;
      cpos.push(it.x + R * Math.cos(a), 0.3, it.z + R * Math.sin(a), it.x + R * Math.cos(b), 0.3, it.z + R * Math.sin(b));
    }
    grp.add(new THREE.LineSegments(geo(THREE, pos), new THREE.LineBasicMaterial({ color: 0xff5b5b })));
    grp.add(new THREE.LineSegments(geo(THREE, cpos), new THREE.LineBasicMaterial({ color: 0xffd166 })));
    return grp;
  }
  function objTrail(THREE) {
    const t = bestRun()?.trail, pos = [], col = [];
    if (t) for (let i = 0; i + 5 < t.length; i += 3) {
      const c = new THREE.Color(TRAIL[t[i + 2]].hex);
      pos.push(t[i], 0.1, t[i + 1], t[i + 3], 0.1, t[i + 4]);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    return new THREE.LineSegments(geo(THREE, pos, col), new THREE.LineBasicMaterial({ vertexColors: true }));
  }

  // one worker request; a newer one cancels this one inside the worker
  function run(cfgs) {
    worker.postMessage({ id: ++seq, level: store.project.level, runs: cfgs });
    progress = 0;
    emit();
  }
  // an edit: pending at once, then the fast pass after the debounce; the full pass follows the fast one
  function schedule() {
    pending = true; failure = null; refining = false; stage = 'fast';
    ctx.setStatus('bench', 'bench: running');
    clearTimeout(timer); timer = setTimeout(() => run(FAST), DEBOUNCE);
    emit();
  }
  const status = () => {
    if (failure) return `bench: result unavailable: ${failure}`;
    if (pending || progress != null) return 'bench: running';
    if (refining) return `bench: ${result.verdict.verdict} (fast) · refining`;
    return `bench: ${result.verdict.verdict} · ${result.runs.length} runs · ${result.ms} ms`;
  };
  // stage messages arrive in order: static -> progress* -> done (fast: queue the full pass) -> cuts
  let stage = 'fast';
  worker.onmessage = ({ data: m }) => {
    if (m.id !== seq) return;
    if (m.type === 'progress') { progress = m.frac; return emit(); }
    if (m.type === 'error') { failure = m.reason; pending = refining = false; progress = null; ctx.setStatus('bench', status()); return emit(); }
    if (m.type === 'static') {
      // cut suggestions stay while the walled-in set is unchanged; the cuts message replaces them
      const same = result && result.stat.walled.map(w => w.id).join() === m.stat.walled.map(w => w.id).join();
      result = { level: store.project.level, stat: { ...m.stat, cuts: same ? result.stat.cuts : [] }, runs: result?.runs ?? [], ms: result?.ms ?? 0, verdict: m.verdict };
      bakeHeat();
      touch('reach', 'walled', 'claims');
      return emit();
    }
    if (m.type === 'done') {
      result = { ...result, runs: m.runs, ms: m.ms, verdict: m.verdict };
      progress = null; failure = null;
      touch('trail');
      if (stage === 'fast') { stage = 'full'; pending = false; refining = true; ctx.setStatus('bench', status()); emit(); return run(FULL); }
      pending = refining = false;
      ctx.setStatus('bench', status());
      return emit();
    }
    if (m.type === 'cuts') {
      result.stat.cuts = m.cuts;
      result.verdict = verdict(result.level, result.stat, result.runs);
      touch('walled');
      return emit();
    }
  };
  store.on(why => { if (why === 'project') schedule(); });
  schedule();
  // Full run button: skips the fast pass, marks the numbers pending until the full pass lands
  const deepRun = () => { stage = 'full'; pending = true; failure = null; refining = false; ctx.setStatus('bench', 'bench: running'); run(FULL); emit(); };

  // ---------------------------------------------------------- panels
  const fmtAt = m => m ? `d${m.day} ${m.sec}s` : '-';
  function benchPanel() {
    const statusEl = h('span', { class: 'bn-status' }), bar = h('i'), tab = h('tbody');
    const deepBtn = h('button', { class: 'bn-btn', onclick: deepRun }, `Full run (${FULL.length} runs, ${FULL_DAYS} days)`);
    const foot = h('div', { class: 'bn-foot' });
    const body = h('div', { class: 'bn-body' });
    const ov = Object.entries({ trail: 'Best run trail', claims: 'Claim radii' }).map(([k, label]) => {
      const cb = h('input', { type: 'checkbox', onchange: e => { overlays[k].enabled = e.target.checked; touch(k); } });
      cb.checked = overlays[k].enabled;
      return h('label', {}, cb, ' ' + label);
    });
    const legend = h('div', { class: 'bn-legend' }, h('span', {}, 'Trail:'), ...TRAIL.map(t => h('span', {}, h('i', { style: { background: t.hex } }), t.name)));
    const el = h('div', { class: 'bn' },
      h('div', { class: 'bn-top' }, statusEl, deepBtn),
      h('div', { class: 'bn-bar' }, bar),
      body);
    body.replaceChildren(
      h('table', { class: 'bn-tab' },
        h('thead', {}, h('tr', {}, ...['Plan', 'Camp', 'Bench', 'Upgrades', 'Wood/min', 'Stone/min', 'Idle', 'Exposed'].map(t => h('th', {}, t)))),
        tab),
      h('div', { class: 'bn-ov' }, ...ov), legend, foot);
    const draw = () => {
      const runs = result?.runs ?? [], stale = pending || failure != null;
      statusEl.textContent = progress != null ? `running ${Math.round(progress * 100)}%` : refining ? 'fast result, refining' : stale ? 'pending' : result ? `${runs.length} runs, ${result.ms} ms` : 'idle';
      el.classList.toggle('stale', stale);
      bar.style.width = (progress ?? 1) * 100 + '%'; bar.className = progress != null ? 'on' : '';
      tab.replaceChildren(...runs.map(r => {
        const days = r.days, mins = days * D.DAY_LEN / 60, cnt = t => r.deps.filter(d => d.type === t).length;
        const idle = r.idle / (days * D.DAY_LEN), exp = r.exposed;
        const cell = (t, ok = true) => h('td', { class: ok ? '' : 'bad' }, t);
        return h('tr', {}, cell(`${r.strategy} #${r.seed}`), cell(fmtAt(r.milestones.campfire)), cell(fmtAt(r.milestones.workbench)),
          cell(r.milestones.allUpgradesDay == null ? `not in ${days} days` : 'sim day ' + r.milestones.allUpgradesDay, r.milestones.allUpgradesDay != null && r.milestones.allUpgradesDay <= GOAL_DAY),
          cell((cnt('wood') / mins).toFixed(1)), cell((cnt('stone') / mins).toFixed(1)), cell((idle * 100).toFixed(0) + '%'), cell(exp.toFixed(0) + 's', exp < 5));
      }));
      foot.textContent = runs.length ? `Horizon ${runs[0].days} game days from day ${store.project.level.day} at dayTime ${(store.project.level.dayTime ?? 0).toFixed(2)}. Fixed step 1/30 s. Wolves not simulated. Rates per game minute.` : '';
    };
    const sub = () => draw(); listeners.add(sub); draw();
    return { element: el, update: draw, dispose: () => listeners.delete(sub) };
  }

  function solvPanel() {
    const badge = h('div', { class: 'sv-badge' }), checks = h('tbody'), budget = h('div', { class: 'sv-budget' }), issues = h('ul', { class: 'sv-issues' }), fail = h('div', { class: 'sv-fail' });
    const ov = Object.entries({ reach: 'Reachability', walled: 'Walled-in and cuts' }).map(([k, label]) => {
      const cb = h('input', { type: 'checkbox', onchange: e => { overlays[k].enabled = e.target.checked; touch(k); } });
      cb.checked = overlays[k].enabled;
      return h('label', {}, cb, ' ' + label);
    });
    const body = h('div', { class: 'sv-body' }, budget, issues, h('table', { class: 'sv-tab' }, checks), h('div', { class: 'bn-ov' }, ...ov));
    const count = h('span', { class: 'sv-count' }), el = h('div', { class: 'sv' }, h('div', { class: 'sv-top' }, badge, count), fail, body);
    const draw = () => {
      const v = result?.verdict, stale = pending || failure != null;
      el.classList.toggle('stale', stale);
      badge.textContent = !v ? (pending ? 'checking...' : '-') : stale ? `${v.verdict} (stale)` : v.verdict;
      badge.className = 'sv-badge ' + (v ? v.verdict.replace(/\s/g, '-').toLowerCase() : '') + (stale ? ' stale' : '');
      fail.textContent = failure ? `result unavailable: ${failure}` : '';
      checks.replaceChildren(...(v?.checks ?? []).map(c => h('tr', {}, h('td', { class: 'sv-ok ' + (c.ok === false ? 'bad' : c.ok ? 'good' : '') }, c.ok === false ? 'x' : c.ok ? 'ok' : '-'), h('td', {}, c.label), h('td', { class: 'mono' }, c.value))));
      budget.replaceChildren(...(v ? ['wood', 'stone'].map(k => {
        const need = v.budget.need[k], have = v.budget.have[k], pct = need ? Math.min(100, have / need * 100) : 100;
        const reg = v.budget.regrow[k] ? ` (regrowth +${v.budget.regrow[k]})` : '';
        return h('div', { class: 'sv-meter' }, h('span', {}, `${k} ${have}/${need}${reg}`), h('div', { class: 'sv-bar' }, h('i', { style: { width: pct + '%' }, class: have >= need ? 'good' : 'bad' })));
      }) : []));
      const list = v?.issues ?? [], shown = list.slice(0, LIST_MAX), nb = list.filter(i => i.sev === 'block').length, nw = list.filter(i => i.sev === 'warn').length;
      count.textContent = v ? `${nb} block · ${nw} warn · ${list.filter(i => i.sev === 'hint').length} cut hints` : '';
      issues.replaceChildren(...shown.map(i => h('li', { class: 'sv-' + i.sev, onclick: () => i.node && focus(i.node) },
        h('b', {}, i.sev), ' ' + i.text)), ...(list.length > LIST_MAX ? [h('li', { class: 'sv-more' }, `+${list.length - LIST_MAX} more`)] : []));
    };
    const sub = () => draw(); listeners.add(sub); draw();
    return { element: el, update: draw, dispose: () => listeners.delete(sub) };
  }
  const focus = id => { store.select([id]); ctx.bag.frame?.([id]); };

  ctx.registerPanel({ id: 'bench', title: 'Capacity Bench', area: 'bottom', create: benchPanel });
  ctx.registerPanel({ id: 'solvability', title: 'Solvability', area: 'bottom', create: solvPanel });
}
