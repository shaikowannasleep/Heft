// Heft Studio shell: Dockview workspace, menubar, command + hotkey registry, status bar.
// Modules plug in through ctx.registerPanel / ctx.registerCommand / ctx.setStatus (see src/main.js).
import './dockview.css';
import './style.css';
import { createDockview, themeDark } from 'dockview-core';
import { h, toast } from '../core/dom.js';
import { Store, getNode, draftNode, nodeIds } from '../core/store.js';
import * as data from '../core/heft-data.js';

const LAYOUT_KEY = 'heft-studio.layout.v2';

export function createStudio(root) {
  const store = new Store(data.newProject(1));
  const panels = [], commands = [], statusSlots = new Map(), mounted = new Map();
  let dock;

  const ctx = {
    store, data, h, toast, getNode: id => getNode(store.project, id), draftNode, nodeIds: () => nodeIds(store.project),
    // Cross-module services. Contract in docs/ARCHITECTURE.md.
    bag: { overlays: [], inspectorExtras: [] },
    registerPanel: def => panels.push(def),
    registerCommand: cmd => { commands.push(cmd); return cmd; },
    run: id => commands.find(c => c.id === id)?.run(ctx),
    setStatus: (key, text) => { statusSlots.set(key, text); renderStatus(); },
    // Persistence seam: the db module replaces this with the binary store. Default = JSON in localStorage.
    persist: {
      async save(project) { localStorage.setItem('heft-studio.project', JSON.stringify(project)); return { bytes: JSON.stringify(project).length }; },
      async load() { const t = localStorage.getItem('heft-studio.project'); return t ? JSON.parse(t) : null; },
    },
    async save() {
      const r = await ctx.persist.save(store.project);
      store.dirty = false; store.emit('saved'); toast(`Saved${r?.bytes ? ` · ${fmtBytes(r.bytes)}` : ''}`, 'ok', 1400);
    },
  };

  // ---------------------------------------------------------------- built-in commands
  const sel = () => store.selection;
  const addAt = (kind) => {
    const c = ctx.bag.viewCenter?.() ?? { x: 0, z: 8 };
    const x = data.r2(c.x), z = data.r2(c.z);
    let id;
    store.update(`Add ${kind}`, d => {
      const L = d.level;
      if (data.STRUCT[kind]) { const n = data.nextId(L.structures); L.structures.push({ id: n, type: kind, x, z, rot: 0 }); id = 's:' + n; }
      else {
        const n = data.nextId(L.resources), v = kind === 'tree' ? 1 : 0, hp = kind === 'tree' ? data.TREE_HP[v] : data.ROCK_HP[v];
        L.resources.push({ id: n, kind, v, x, z, rot: 0, s: 1, hp, max: hp, regrowAt: 0 }); id = 'r:' + n;
      }
    });
    store.select([id]);
  };
  const del = () => {
    const ids = sel().filter(i => i !== 'player'); if (!ids.length) return;
    store.update(`Delete ${ids.length}`, d => {
      const set = new Set(ids);
      d.level.resources = d.level.resources.filter(r => !set.has('r:' + r.id));
      d.level.structures = d.level.structures.filter(s => !set.has('s:' + s.id));
    });
  };
  const dup = () => {
    const ids = sel().filter(i => i !== 'player'); if (!ids.length) return;
    const out = [];
    store.update(`Duplicate ${ids.length}`, d => {
      for (const id of ids) {
        const o = draftNode(d, id); if (!o) continue;
        const list = id[0] === 'r' ? d.level.resources : d.level.structures, n = data.nextId(list);
        list.push({ ...JSON.parse(JSON.stringify(o)), id: n, x: data.r2(o.x + 1), z: data.r2(o.z + 1) });
        out.push(id[0] + ':' + n);
      }
    });
    store.select(out);
  };
  [
    { id: 'edit.undo', label: 'Undo', keys: 'Mod+Z', menu: 'Edit', run: () => store.undo() },
    { id: 'edit.redo', label: 'Redo', keys: 'Mod+Shift+Z', alt: 'Mod+Y', menu: 'Edit', run: () => store.redo() },
    { id: 'edit.duplicate', label: 'Duplicate', keys: 'Mod+D', menu: 'Edit', run: dup },
    { id: 'edit.delete', label: 'Delete', keys: 'Delete', alt: 'Backspace', menu: 'Edit', run: del },
    { id: 'edit.selectAll', label: 'Select all', keys: 'Mod+A', menu: 'Edit', run: () => store.select(nodeIds(store.project)) },
    { id: 'edit.deselect', label: 'Deselect', keys: 'Escape', menu: 'Edit', run: () => store.select([]) },
    { id: 'tool.select', label: 'Select tool', keys: 'Q', menu: 'Tools', run: () => store.setUi({ tool: 'select' }) },
    { id: 'tool.move', label: 'Move tool', keys: 'W', menu: 'Tools', run: () => store.setUi({ tool: 'move' }) },
    { id: 'tool.rotate', label: 'Rotate tool', keys: 'E', menu: 'Tools', run: () => store.setUi({ tool: 'rotate' }) },
    { id: 'tool.scale', label: 'Scale tool', keys: 'R', menu: 'Tools', run: () => store.setUi({ tool: 'scale' }) },
    { id: 'tool.snap', label: 'Toggle snapping', keys: 'Shift+S', menu: 'Tools', run: () => store.setUi({ snap: !store.ui.snap }) },
    { id: 'view.frame', label: 'Frame selection', keys: 'F', menu: 'View', run: () => ctx.bag.frame?.(sel().length ? sel() : nodeIds(store.project)) },
    { id: 'file.new', label: 'New island (random seed)', keys: 'Mod+N', menu: 'File', run: () => { if (!store.dirty || confirm('Discard unsaved changes?')) store.replace(data.newProject((Math.random() * 1e9) | 0)); } },
    { id: 'file.save', label: 'Save', keys: 'Mod+S', menu: 'File', run: () => ctx.save() },
    { id: 'file.open', label: 'Open level / save (.json)…', keys: 'Mod+O', menu: 'File', run: () => openJson() },
    { id: 'file.export', label: 'Export level for game (world_save.json)', keys: 'Mod+E', menu: 'File', run: () => download(JSON.stringify(data.toGameState(store.project), null, 1), 'world_save.json') },
    { id: 'file.layout', label: 'Reset layout', menu: 'Window', run: () => defaultLayout() },
    ...['tree', 'rock', 'campfire', 'wall', 'workbench'].map(k => ({ id: 'add.' + k, label: data.STRUCT[k]?.name ?? k[0].toUpperCase() + k.slice(1), menu: 'GameObject', run: () => addAt(k) })),
  ].forEach(c => commands.push(c));

  function openJson() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        store.replace(j.format === 'heft-studio' ? j : data.fromGameState(j, f.name.replace(/\.json$/, '')));
        toast(`Opened ${f.name}`, 'ok');
      } catch (e) { toast('Not a Heft level: ' + e.message, 'err', 4000); }
    };
    inp.click();
  }
  function download(text, name) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------------------------------------------------------- hotkeys (Unity defaults; Mod = Ctrl or Cmd)
  const comboOf = e => [(e.ctrlKey || e.metaKey) && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift',
    e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+');
  addEventListener('keydown', e => {
    const t = e.target, typing = t.closest?.('input,textarea,select,[contenteditable]');
    const combo = comboOf(e);
    if (typing && !combo.startsWith('Mod+') && combo !== 'Escape') return;
    if (typing && ['Mod+Z', 'Mod+Y', 'Mod+Shift+Z', 'Mod+A'].includes(combo)) return;  // native text undo/select inside fields
    const c = commands.find(c => c.keys === combo || c.alt === combo);
    if (!c) return;
    if (c.when && !c.when(ctx)) return;
    // A panel with ownsKeys handles edit keys itself while it is the active panel (e.g. Delete removes a model part, not a tree).
    if (c.id.startsWith('edit.') && panels.find(p => p.id === dock.activePanel?.id)?.ownsKeys) return;
    e.preventDefault(); c.run(ctx);
  });

  // ---------------------------------------------------------------- layout
  const menubar = h('header', { class: 'menubar' });
  const toolbar = h('div', { class: 'toolbar' });
  const dvEl = h('div', { class: 'dv dockview-theme-dark' });
  const status = h('footer', { class: 'statusbar' });
  root.classList.add('studio');
  root.replaceChildren(menubar, toolbar, h('div', { class: 'dock-host' }, dvEl), status);

  function renderStatus() {
    const L = store.project.level;
    const left = [`${store.project.name}${store.dirty ? ' •' : ''}`, `${L.resources.length} res · ${L.structures.length} structures`,
      sel().length ? `${sel().length} selected` : null, store.past.length ? `↶ ${store.past[store.past.length - 1].label}` : null];
    status.replaceChildren(...left.filter(Boolean).map(t => h('span', {}, t)), h('span', { class: 'sp' }),
      ...[...statusSlots.values()].filter(Boolean).map(t => h('span', { class: 'slot' }, t)));
  }

  function renderToolbar() {
    const tb = (tool, label, key) => h('button', { class: 'tb' + (store.ui.tool === tool ? ' on' : ''), title: `${label} (${key})`, onclick: () => store.setUi({ tool }) }, label);
    toolbar.replaceChildren(
      h('div', { class: 'grp' }, tb('select', '⬚ Select', 'Q'), tb('move', '✥ Move', 'W'), tb('rotate', '⟳ Rotate', 'E'), tb('scale', '⤢ Scale', 'R')),
      h('div', { class: 'grp' }, h('button', { class: 'tb' + (store.ui.snap ? ' on' : ''), title: 'Snap (Shift+S)', onclick: () => store.setUi({ snap: !store.ui.snap }) }, '🧲 Snap')),
      h('span', { class: 'sp' }),
      ...commands.filter(c => c.toolbar).map(c => h('button', { class: 'tb' + (c.primary ? ' primary' : ''), title: `${c.label}${c.keys ? ` (${c.keys})` : ''}`, onclick: () => c.run(ctx) }, c.toolbar)),
    );
  }

  function renderMenus() {
    const groups = ['File', 'Edit', 'GameObject', 'Tools', 'View', 'Window', ...new Set(commands.map(c => c.menu).filter(Boolean))];
    const uniq = [...new Set(groups)].filter(g => commands.some(c => c.menu === g) || g === 'Window');
    let open = null;
    const close = () => { open?.remove(); open = null; };
    menubar.replaceChildren(h('div', { class: 'brand' }, h('b', {}, 'HEFT'), ' Studio'), ...uniq.map(g => {
      const b = h('button', { class: 'mb' }, g);
      b.onclick = ev => {
        ev.stopPropagation(); const was = open?.dataset.g === g; close(); if (was) return;
        const items = g === 'Window'
          ? [...panels.map(p => ({ label: (dock.getPanel(p.id) ? '✓ ' : '   ') + p.title, run: () => togglePanel(p.id) })), ...commands.filter(c => c.menu === 'Window')]
          : commands.filter(c => c.menu === g);
        open = h('div', { class: 'menu', 'data-g': g }, ...items.map(c => h('div', { class: 'mi', onclick: () => { close(); c.run(ctx); } },
          h('span', {}, c.label), h('kbd', {}, (c.keys || '').replace('Mod', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')))));
        const r = b.getBoundingClientRect(); Object.assign(open.style, { left: r.left + 'px', top: r.bottom + 'px' });
        document.body.append(open);
      };
      return b;
    }));
    addEventListener('click', close);
  }

  dock = createDockview(dvEl, {
    theme: themeDark,
    createComponent: opts => {
      const def = panels.find(p => p.id === opts.name);
      const host = h('div', { class: 'pcontent' + (def?.noScroll ? ' noscroll' : '') });
      let inst = null;
      return {
        element: host,
        init: params => {
          if (!def) { host.append(h('div', { class: 'empty' }, `Missing panel ${opts.name}`)); return; }
          inst = def.create(ctx); host.append(inst.element); mounted.set(def.id, inst);
          params.api?.onDidVisibilityChange?.(e => { if (e.isVisible) inst?.onShow?.(); });
          params.api?.onDidDimensionsChange?.(() => inst?.onResize?.());
        },
        dispose: () => { inst?.dispose?.(); mounted.delete(def?.id); },
      };
    },
  });
  ctx.bag.dock = dock;
  dock.onDidLayoutChange(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(dock.toJSON())); } catch { } });

  const has = id => panels.some(p => p.id === id);
  function add(id, position, extra) { if (has(id) && !dock.getPanel(id)) dock.addPanel({ id, component: id, title: panels.find(p => p.id === id).title, position, ...extra }); }
  function togglePanel(id) { const p = dock.getPanel(id); if (p) p.api.close(); else add(id); }
  // Unity-ish: Hierarchy and Inspector full height, Scene 2D | Scene 3D on top, bench/data tabs spanning both scenes below.
  function defaultLayout() {
    dock.clear();
    const center = ['scene2d', 'scene3d', 'modeling', 'playtest'].filter(has);
    const main = center.includes('scene3d') ? 'scene3d' : center[0];
    const bottom = panels.filter(p => p.area === 'bottom').map(p => p.id);
    add(center[0]);
    bottom.forEach((id, i) => add(id, i ? { referencePanel: bottom[0], direction: 'within' } : { referencePanel: center[0], direction: 'below' }, i ? { inactive: true } : undefined));
    if (main !== center[0]) add(main, { referencePanel: center[0], direction: 'right' });
    for (const id of center) if (id !== center[0] && id !== main) add(id, { referencePanel: main, direction: 'within' }, { inactive: true });
    add('hierarchy', { direction: 'left' });
    add('inspector', { direction: 'right' });
    for (const p of panels) if (!dock.getPanel(p.id) && p.area !== 'hidden') add(p.id, { referencePanel: 'inspector', direction: 'within' }, { inactive: true });
    try {
      const L = dock.getPanel('hierarchy')?.group; L?.api.setSize({ width: 250 });
      dock.getPanel('inspector')?.group?.api.setSize({ width: 320 });
      if (bottom.length) dock.getPanel(bottom[0])?.group?.api.setSize({ height: 250 });
    } catch { }
    dock.getPanel(center[0])?.api.setActive();
  }

  store.on(why => {
    for (const inst of mounted.values()) inst.update?.(why);
    if (why === 'ui') renderToolbar();
    renderStatus();
  });

  return {
    ctx,
    async start() {
      try { const saved = await ctx.persist.load(); if (saved?.format === 'heft-studio') store.replace(saved); } catch (e) { console.warn('load failed', e); }
      renderMenus(); renderToolbar(); renderStatus();
      let restored = false;
      try {
        const j = JSON.parse(localStorage.getItem(LAYOUT_KEY));
        const want = j && Object.keys(j.panels || {});
        if (want && want.length && want.every(has)) { dock.fromJSON(j); restored = true; }
      } catch { }
      if (!restored) defaultLayout();
      addEventListener('beforeunload', e => { if (store.dirty) { e.preventDefault(); e.returnValue = ''; } });
      window.studio = ctx;   // console + test hook
    },
  };
}

export const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
