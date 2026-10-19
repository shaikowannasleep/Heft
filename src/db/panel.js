// Data panel: size comparison, per-section bytes, revision growth, revision list, compaction, import/export.
import { deflateSync } from 'fflate';
import { h, toast } from '../core/dom.js';
import { fmtBytes } from '../shell/app.js';
import { encodeHeftb, sectionSizes } from './codec.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids); return e;
};
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const share = (n, of) => (of > 0 ? Math.min(100, (100 * n) / of) : 0).toFixed(2) + '%';

// ready resolves to the ProjectDB. io = { saveHeftb, openHeftb }.
export function dataPanel({ ctx, ready, io }) {
  return {
    id: 'data', title: 'Data', area: 'bottom',
    create() {
      const root = h('div', { class: 'db-panel' });
      let compactNote = '';
      const btn = (text, fn, cls = '') => h('button', { class: 'db-btn ' + cls, onclick: () => act(fn) }, text);
      async function act(fn) {
        try { await fn(); } catch (e) { toast(e.message, 'err', 6000); }
        refresh();
      }
      const refresh = async () => {
        const db = await ready, project = ctx.store.project;
        const json = new TextEncoder().encode(JSON.stringify(project));
        const gz = deflateSync(json, { level: 9 }).length, hb = encodeHeftb(project), sections = sectionSizes(hb);
        const [st, q, list] = await Promise.all([db.stats(), db.quota(), db.list()]);
        const sums = await Promise.all(list.slice(0, 40).map(r => db.summary(r.seq)));
        const asc = [...list].reverse(), totals = []; let run = 0;
        for (const r of asc) totals.push(run += r.bytes);
        const rows = asc.map((r, i) => ({ ...r, total: totals[i] }));

        const restore = async r => {
          if (ctx.store.dirty && !confirm('Discard unsaved changes?')) return;
          const p = await db.restore(r.seq);
          ctx.store.replace(p);
          await db.save(p, { label: `restored #${r.seq}`, auto: false });
          toast(`Restored #${r.seq}`, 'ok', 1800); ctx.store.emit('db');
        };
        const pin = r => db.pin(r.seq, !r.pinned);
        const del = r => { if (confirm(`Delete revision #${r.seq}?`)) return db.remove(r.seq); };
        const compact = async () => {
          const c = await db.compact();
          compactNote = `Compacted: ${fmtBytes(c.before)} -> ${fmtBytes(c.after)}`;
          toast(compactNote, 'ok', 3000);
        };

        const meter = q && h('div', { class: 'db-quota' },
          h('div', { class: 'db-row' }, h('span', { class: 'db-lbl' }, 'Browser storage'),
            h('span', { class: 'db-track' }, h('span', { class: 'db-fill' + (q.warn ? ' warn' : ''), style: { width: share(q.usage, q.quota) } })),
            h('span', { class: 'db-val' }, `${fmtBytes(q.usage)} of ${fmtBytes(q.quota)}`)),
          q.warn && h('div', { class: 'db-warn' }, `⚠ Storage is low (${fmtBytes(q.free)} free). Export a .heftb, then Compact now or delete old revisions.`));

        root.replaceChildren(
          h('div', { class: 'db-bar' },
            btn('Save as .heftb', io.saveHeftb), btn('Open .heftb', io.openHeftb), btn('Compact now', compact, 'primary'),
            h('span', { class: 'db-note' }, compactNote)),
          h('div', { class: 'db-sum' }, `${st.count} revisions kept · ${fmtBytes(st.bytes)} stored · head #${st.head ?? '-'}`),
          meter,
          h('section', {},
            h('h4', {}, 'Size of this project'),
            ...[['JSON', json.length], ['JSON + gzip', gz], ['.heftb', hb.length]].map(([name, n]) =>
              bar(name, n, json.length, `${fmtBytes(n)} · ${share(n, json.length)} of JSON`))),
          h('section', {},
            h('h4', {}, '.heftb sections'),
            ...sections.map(s => bar(s.name, s.stored, hb.length, `${fmtBytes(s.stored)} stored · ${fmtBytes(s.raw)} raw`))),
          h('section', {},
            h('h4', {}, 'Growth over revisions'),
            growth(rows),
            h('div', { class: 'db-legend' }, h('span', { class: 'sw bar' }, 'revision size'), h('span', { class: 'sw line' }, 'running total'))),
          h('section', {},
            h('h4', {}, 'Revisions'),
            h('table', { class: 'db-table' },
              h('thead', {}, h('tr', {}, ...['#', 'When', 'Label', 'Kind', 'Size', 'Change', ''].map(t => h('th', {}, t)))),
              h('tbody', {}, ...list.map((r, i) => h('tr', { class: r.head ? 'head' : '' },
                h('td', { class: 'num' }, '#' + r.seq + (r.head ? ' head' : '')),
                h('td', {}, when(r.at)),
                h('td', {}, r.label + (r.pinned ? ' \u{1F4CC}' : '')),
                h('td', {}, r.kind),
                h('td', { class: 'num' }, fmtBytes(r.bytes)),
                h('td', { class: 'chg' }, sums[i] ?? ''),
                h('td', { class: 'acts' },
                  btn('Restore', () => restore(r)), btn(r.pinned ? 'Unpin' : 'Pin', () => pin(r)), btn('Delete', () => del(r), 'danger'))))))),
        );
      };
      return { element: root, update: why => { if (why === 'db') refresh(); }, onShow: () => refresh() };
    },
  };
}

// One labelled bar row: the fill is one hue, the value sits in text tokens after it.
function bar(label, n, of, text) {
  return h('div', { class: 'db-row' },
    h('span', { class: 'db-lbl' }, label),
    h('span', { class: 'db-track' }, h('span', { class: 'db-fill', style: { width: share(n, of) } })),
    h('span', { class: 'db-val' }, text));
}

// One axis in bytes: a bar per kept revision, and the running total as a line over the same scale.
function growth(rows) {
  if (!rows.length) return h('div', { class: 'db-empty' }, 'No revisions yet.');
  const W = 640, H = 150, L = 56, R = 12, T = 12, B = 20, max = Math.max(1, rows[rows.length - 1].total);
  const band = (W - L - R) / rows.length, bw = Math.min(24, band * 0.7);
  const xc = i => L + band * (i + 0.5), y = v => H - B - (v / max) * (H - T - B);
  const wrap = h('div', { class: 'db-chart' });
  const tip = h('div', { class: 'db-tip' });
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'db-svg', role: 'img', 'aria-label': 'Revision sizes and running total' });
  for (const v of [0, max / 2, max]) {
    s.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'db-grid' }),
      svg('text', { x: L - 6, y: y(v) + 3, class: 'db-tick', 'text-anchor': 'end' }, fmtBytes(Math.round(v))));
  }
  rows.forEach((r, i) => {
    const x = xc(i) - bw / 2, top = y(r.bytes), hh = y(0) - top, rad = Math.min(4, bw / 2, hh);
    if (hh > 0) s.append(svg('path', { class: 'db-bar' + (r.kind === 'base' ? ' base' : ''), d: `M${x},${y(0)} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + bw - rad} Q${x + bw},${top} ${x + bw},${top + rad} V${y(0)} Z` }));
    const hit = svg('rect', { x: xc(i) - band / 2, y: T, width: band, height: H - T - B, class: 'db-hit' });
    hit.addEventListener('mouseenter', () => { tip.textContent = `#${r.seq} · ${r.kind} · ${fmtBytes(r.bytes)} · total ${fmtBytes(r.total)}`; tip.style.left = `${(xc(i) / W) * 100}%`; tip.classList.add('on'); });
    hit.addEventListener('mouseleave', () => tip.classList.remove('on'));
    s.append(hit);
  });
  const pts = rows.map((r, i) => `${xc(i)},${y(r.total)}`).join(' ');
  s.append(svg('polyline', { points: pts, class: 'db-line', fill: 'none' }));
  const last = rows[rows.length - 1];
  s.append(svg('circle', { cx: xc(rows.length - 1), cy: y(last.total), r: 4, class: 'db-dot' }),
    svg('text', { x: xc(rows.length - 1) - 8, y: y(last.total) - 8, class: 'db-end', 'text-anchor': 'end' }, fmtBytes(last.total)));
  wrap.append(s, tip);
  return wrap;
}
