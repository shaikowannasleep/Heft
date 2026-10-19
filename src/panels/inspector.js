// Inspector: Unity-style components with drag-to-scrub labels. Edits apply to every selected node of a compatible kind.
// With nothing selected it shows the Level (seed, time of day, starting stock, upgrades).
const DEG = 180 / Math.PI;

export function inspectorPanel(ctx) {
  const { h, store, data } = ctx;
  const el = h('div', { class: 'insp' });
  const closed = new Set();
  let focusKey = null;

  // number field: label drag scrubs (Shift = x10, Alt = x0.1), wheel nudges, Enter commits.
  function num(label, get, set, { step = 0.1, min = -Infinity, max = Infinity, fmt = v => +v.toFixed(3), key } = {}) {
    const inp = h('input', { type: 'number', step, value: fmt(get()) });
    const commit = (v, merge) => { if (isFinite(v)) set(Math.min(max, Math.max(min, v)), merge); };
    inp.onchange = () => commit(+inp.value);
    inp.onfocus = () => { focusKey = key || label; };
    inp.onblur = () => { focusKey = null; };
    const lab = h('span', { class: 'lbl' }, label);
    lab.onpointerdown = e => {
      e.preventDefault(); lab.setPointerCapture(e.pointerId);
      const start = get(), x0 = e.clientX, mk = 'scrub:' + label + ':' + Date.now();
      const move = ev => { const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1; commit(start + (ev.clientX - x0) * step * k, mk); };
      lab.onpointermove = move;
      lab.onpointerup = () => { lab.onpointermove = null; lab.onpointerup = null; };
    };
    return [lab, inp];
  }
  function vec(label, axes) {
    return [h('span', { class: 'lbl nodrag' }, label), h('div', { class: 'vec' }, ...axes.map(([ax, get, set, o]) => {
      const [lab, inp] = num(ax, get, set, o);
      return h('label', {}, h('b', { class: 'ax-' + ax.toLowerCase(), onpointerdown: e => lab.onpointerdown(e) }, ax), inp);
    }))];
  }
  function select(label, opts, get, set) {
    const s = h('select', {}, ...opts.map(([v, t]) => h('option', { value: v, selected: String(get()) === String(v) }, t)));
    s.onchange = () => set(s.value);
    return [h('span', { class: 'lbl nodrag' }, label), s];
  }
  function check(label, get, set) {
    const c = h('input', { type: 'checkbox', checked: !!get() }); c.onchange = () => set(c.checked);
    return [h('span', { class: 'lbl nodrag' }, label), h('div', {}, c)];
  }
  function comp(title, icon, ...body) {
    const c = h('div', { class: 'comp' + (closed.has(title) ? ' closed' : '') },
      h('div', { class: 'ch', onclick: () => { closed.has(title) ? closed.delete(title) : closed.add(title); c.classList.toggle('closed'); } }, h('span', {}, closed.has(title) ? '▸' : '▾'), icon, title),
      h('div', { class: 'cb' }, ...body.flat()));
    return c;
  }

  // set a field on every selected node (single undo step; drags merge)
  const setAll = (ids, field, conv = v => v) => (v, merge) => store.update(`Set ${field}`, d => {
    for (const id of ids) { const o = ctx.draftNode(d, id); if (o && field in o) o[field] = conv(v); }
  }, merge);
  const first = ids => ctx.getNode(ids[0])?.obj;

  function renderLevel() {
    const L = store.project.level;
    const setL = (path, label) => (v, merge) => store.update(label, d => { const p = path.split('.'); let o = d.level; while (p.length > 1) o = o[p.shift()]; o[p[0]] = v; }, merge);
    el.replaceChildren(
      h('div', { class: 'head' }, h('span', { class: 'ic' }, '🏝'), h('div', {}, h('div', { class: 'ttl' }, store.project.name), h('div', { class: 'sub' }, 'Level settings'))),
      comp('Island', '🌊 ',
        h('span', { class: 'lbl nodrag' }, 'Name'), (() => { const i = h('input', { type: 'text', value: store.project.name }); i.onchange = () => store.update('Rename', d => { d.name = i.value; }); return i; })(),
        h('span', { class: 'lbl nodrag' }, 'Seed'), h('div', { style: { display: 'flex', gap: '4px' } },
          (() => { const i = h('input', { type: 'number', value: L.seed, style: { flex: 1 } }); i.onchange = () => store.update('Seed', d => { d.level.seed = +i.value | 0; }); return i; })(),
          h('button', { class: 'btn', title: 'Regenerate trees and rocks from this seed (undoable)', onclick: () => store.update('Regenerate resources', d => { d.level.resources = data.generateResources(d.level.seed); }) }, '↻ Regenerate')),
        num('Day', () => L.day, setL('day', 'Day'), { step: 1, min: 1, fmt: v => v | 0 }),
        num('Time of day', () => L.dayTime, setL('dayTime', 'Time of day'), { step: 0.005, min: 0, max: 0.9999 }),
        h('div', { class: 'warnline' }, L.dayTime >= 0.70 && L.dayTime < 0.965 ? '🌙 Starts at night: wolves are active' : '')),
      comp('Starting stock', '📦 ',
        num('Wood', () => L.stock.wood, setL('stock.wood', 'Wood'), { step: 1, min: 0, fmt: v => v | 0 }),
        num('Stone', () => L.stock.stone, setL('stock.stone', 'Stone'), { step: 1, min: 0, fmt: v => v | 0 })),
      comp('Upgrades', '⬆ ', ...Object.entries(data.UPGRADES).map(([k, u]) =>
        num(u.name, () => L.upgrades[k], setL('upgrades.' + k, u.name), { step: 1, min: 0, max: u.max, fmt: v => v | 0 }))),
    );
  }

  function renderNodes(ids) {
    const nodes = ids.map(id => ctx.getNode(id)).filter(Boolean);
    const kinds = new Set(nodes.map(n => n.kind)), n0 = nodes[0], o = n0.obj;
    const multi = nodes.length > 1, single = kinds.size === 1;
    const isRes = nodes.every(n => n.kind === 'tree' || n.kind === 'rock'), isStruct = nodes.every(n => data.STRUCT[n.kind]);
    const title = multi ? `${nodes.length} objects` : n0.kind === 'player' ? 'Player Spawn' : data.STRUCT[n0.kind] ? `${data.STRUCT[n0.kind].name} #${o.id}` : `${data.RES_V[n0.kind][o.v]} ${n0.kind === 'tree' ? 'Tree' : ''} #${o.id}`;
    const icon = { player: '🧍', campfire: '🔥', wall: '🪵', workbench: '🛠', tree: '🌲', rock: '🪨' }[single ? n0.kind : ''] ?? '◫';
    const out = [h('div', { class: 'head' }, h('span', { class: 'ic' }, icon), h('div', {}, h('div', { class: 'ttl' }, title), h('div', { class: 'sub' }, single ? n0.kind : [...kinds].join(', '))))];
    const R = data.r2;
    const off = !inIsland(nodes) ? h('div', { class: 'warnline' }, '⚠ Outside the island shore: unreachable in game') : '';
    out.push(comp('Transform', '✥ ',
      vec('Position', [['X', () => o.x, setAll(ids, 'x', R), { key: 'x' }], ['Z', () => o.z, setAll(ids, 'z', R), { key: 'z' }]]),
      num('Rotation (°)', () => o.rot * DEG, setAll(ids, 'rot', v => data.r3(v / DEG)), { step: 1, fmt: v => +v.toFixed(1) }),
      ...(isRes ? [num('Scale', () => o.s, setAll(ids, 's', data.r3), { step: 0.01, min: 0.5, max: 2 })] : []),
      off));
    if (isRes && single) {
      const hpTable = n0.kind === 'tree' ? data.TREE_HP : data.ROCK_HP;
      out.push(comp(n0.kind === 'tree' ? 'Tree' : 'Rock', n0.kind === 'tree' ? '🌲 ' : '🪨 ',
        select('Variant', data.RES_V[n0.kind].map((t, i) => [i, t]), () => o.v, v => store.update('Variant', d => {
          for (const id of ids) { const r = ctx.draftNode(d, id); r.v = +v; r.max = hpTable[+v]; r.hp = Math.min(r.hp, r.max) || r.max; }
        })),
        num('HP', () => o.hp, setAll(ids, 'hp', v => v | 0), { step: 1, min: 0, max: 20, fmt: v => v | 0 }),
        num('Max HP', () => o.max, setAll(ids, 'max', v => v | 0), { step: 1, min: 1, max: 20, fmt: v => v | 0 }),
        check('Harvested', () => o.removed, v => store.update('Harvested', d => { for (const id of ids) { const r = ctx.draftNode(d, id); if (v) r.removed = true; else delete r.removed; } })),
        h('div', { class: 'warnline', style: { color: 'var(--fg3)' } }, `Yields ${n0.kind === 'tree' ? 'wood (weight 1)' : 'stone (weight 2)'} × HP`)));
    }
    if (isStruct) {
      const S = data.STRUCT[o.type];
      out.push(comp('Structure', '🏗 ',
        select('Type', Object.entries(data.STRUCT).map(([k, s]) => [k, s.name]), () => o.type, v => store.update('Structure type', d => { for (const id of ids) ctx.draftNode(d, id).type = v; })),
        h('span', { class: 'lbl nodrag' }, 'Cost'), h('span', {}, `${S.cost.wood} wood · ${S.cost.stone} stone`),
        h('span', { class: 'lbl nodrag' }, 'Claim radius'), h('span', {}, `${S.claim} m`)));
    }
    if (n0.kind === 'player' && !multi) out.push(comp('Player', '🧍 ', num('HP', () => o.hp, setAll(ids, 'hp', v => v | 0), { step: 1, min: 10, max: 100, fmt: v => v | 0 })));
    for (const ext of ctx.bag.inspectorExtras ?? []) { const c = ext(nodes, { comp, num, select, check }); if (c) out.push(c); }
    el.replaceChildren(...out);
  }
  const inIsland = nodes => nodes.every(n => data.inIsland(n.obj.x, n.obj.z, 0.5));

  function render() {
    const keep = focusKey && document.activeElement?.closest('.insp');
    if (keep) return;    // don't yank a field the user is typing in
    const ids = store.selection.filter(id => ctx.getNode(id));
    if (!ids.length) renderLevel(); else renderNodes(ids);
  }
  render();
  return { element: el, update: why => { if (why === 'project' || why === 'selection') render(); } };
}
