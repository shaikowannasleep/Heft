// Hierarchy: Player spawn, Structures, Trees, Rocks. Click / Ctrl-click / Shift-range select, double-click frames.
const ICON = { player: '🧍', campfire: '🔥', wall: '🪵', workbench: '🛠', tree: '🌲', rock: '🪨' };

export function hierarchyPanel(ctx) {
  const { h, store, data } = ctx;
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search  (name, type, id)' });
  const tree = h('div', { class: 'tree', tabindex: 0 });
  const el = h('div', { class: 'hier' }, search, tree);
  const closed = new Set();
  let anchor = null, flat = [];

  function rows() {
    const L = store.project.level, q = search.value.trim().toLowerCase();
    const match = (label, id) => !q || label.toLowerCase().includes(q) || id.includes(q);
    const groups = [
      ['Player', [{ id: 'player', label: 'Player Spawn', icon: ICON.player }]],
      ['Structures', L.structures.map(s => ({ id: 's:' + s.id, label: `${data.STRUCT[s.type]?.name ?? s.type} #${s.id}`, icon: ICON[s.type] }))],
      ['Trees', L.resources.filter(r => r.kind === 'tree').map(r => ({ id: 'r:' + r.id, label: `${data.RES_V.tree[r.v]} Tree #${r.id}`, icon: ICON.tree, dim: r.removed }))],
      ['Rocks', L.resources.filter(r => r.kind === 'rock').map(r => ({ id: 'r:' + r.id, label: `${data.RES_V.rock[r.v]} #${r.id}`, icon: ICON.rock, dim: r.removed }))],
    ];
    return groups.map(([g, items]) => [g, items.filter(i => match(i.label, i.id))]);
  }

  function render() {
    const selSet = new Set(store.selection), out = [];
    flat = [];
    for (const [g, items] of rows()) {
      const open = !closed.has(g) || search.value;
      out.push(h('div', { class: 'row grp', onclick: () => { closed.has(g) ? closed.delete(g) : closed.add(g); render(); } },
        h('span', { class: 'tw' }, open ? '▾' : '▸'), g, h('span', { class: 'cnt' }, items.length)));
      if (!open) continue;
      for (const it of items) {
        flat.push(it.id);
        out.push(h('div', { class: 'row' + (selSet.has(it.id) ? ' sel' : '') + (it.dim ? ' dim' : ''), 'data-id': it.id, style: { paddingLeft: '18px' } },
          h('span', { class: 'ic' }, it.icon), it.label));
      }
    }
    tree.replaceChildren(...out);
    tree.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
  }

  tree.addEventListener('mousedown', e => {
    const id = e.target.closest('.row[data-id]')?.dataset.id; if (!id) return;
    if (e.shiftKey && anchor) {
      const a = flat.indexOf(anchor), b = flat.indexOf(id);
      if (a >= 0 && b >= 0) return store.select(flat.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
    anchor = id;
    if (e.metaKey || e.ctrlKey) store.select(store.selection.includes(id) ? store.selection.filter(x => x !== id) : [...store.selection, id]);
    else store.select([id]);
  });
  tree.addEventListener('dblclick', e => { const id = e.target.closest('.row[data-id]')?.dataset.id; if (id) ctx.bag.frame?.([id]); });
  tree.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = flat.indexOf(store.selection[store.selection.length - 1]);
    const n = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) { anchor = n; store.select([n]); }
  });
  search.addEventListener('input', render);
  render();
  return { element: el, update: why => { if (why === 'project' || why === 'selection') render(); } };
}
