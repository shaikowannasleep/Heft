// Project store with immer patches for undo/redo (distilled from Sand Bus Forge's ForgeStore).
import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze } from 'immer';
enablePatches();
setAutoFreeze(false);

// A long drag merges hundreds of "replace" patches on the same path: keep the latest forward and earliest inverse per path.
function compactReplaces(e) {
  if (e.patches.length < 16) return;
  if (!e.patches.every(p => p.op === 'replace') || !e.inverse.every(p => p.op === 'replace')) return;
  const key = p => p.path.join('\0');
  const fwd = new Map(); e.patches.forEach((p, i) => fwd.set(key(p), i));
  e.patches = e.patches.filter((p, i) => fwd.get(key(p)) === i);
  const first = new Map(); e.inverse.forEach((p, i) => { if (!first.has(key(p))) first.set(key(p), i); });
  e.inverse = e.inverse.filter((p, i) => first.get(key(p)) === i);
}

export class Store {
  selection = [];
  ui = { tool: 'move', snap: false, snapMove: 0.5, snapRotate: 15, cam3d: 'iso' };
  past = []; future = [];
  dirty = false; rev = 0; replaceRev = 0;
  listeners = new Set();
  constructor(project) { this.project = project; }
  on(l) { this.listeners.add(l); return () => this.listeners.delete(l); }
  emit(why) {
    if (this._batch) { (this._queued ??= new Set()).add(why); return; }
    for (const l of [...this.listeners]) l(why);
  }
  batch(fn) {
    this._batch = (this._batch ?? 0) + 1;
    try { fn(); } finally {
      if (--this._batch === 0) { const q = this._queued; this._queued = null; if (q) for (const w of q) this.emit(w); }
    }
  }
  // merge: edits with the same merge key within 1.5 s collapse into one undo step (drags, scrubs).
  update(label, recipe, merge) {
    const [next, patches, inverse] = produceWithPatches(this.project, recipe);
    if (!patches.length) return;
    this.project = next;
    const last = this.past[this.past.length - 1];
    if (merge && last && last.merge === merge && Date.now() - last.at < 1500) {
      last.patches.push(...patches); last.inverse.unshift(...inverse); last.at = Date.now(); compactReplaces(last);
    } else {
      this.past.push({ label, patches, inverse, merge, at: Date.now() });
      if (this.past.length > 300) this.past.shift();
    }
    this.future = []; this.dirty = true; this.rev++;
    this.emit('project');
  }
  undo() { const e = this.past.pop(); if (!e) return; this.project = applyPatches(this.project, e.inverse); this.future.push(e); this.rev++; this.dirty = true; this.pruneSelection(); this.emit('project'); }
  redo() { const e = this.future.pop(); if (!e) return; this.project = applyPatches(this.project, e.patches); this.past.push(e); this.rev++; this.dirty = true; this.pruneSelection(); this.emit('project'); }
  replace(p) {
    this.project = p; this.past = []; this.future = []; this.selection = [];
    this.rev++; this.replaceRev++; this.dirty = false;
    this.emit('project'); this.emit('selection');
  }
  select(ids) { this.selection = [...new Set(ids)]; this.pruneSelection(true); this.emit('selection'); }
  setUi(patch) { this.ui = { ...this.ui, ...patch }; this.emit('ui'); }
  pruneSelection(silent) {
    const live = new Set(nodeIds(this.project));
    const sel = this.selection.filter(i => live.has(i));
    if (sel.length !== this.selection.length) { this.selection = sel; if (!silent) this.emit('selection'); }
  }
}

// ---- scene nodes: one id space over the level so every panel addresses objects the same way
// 'player' | 'r:<resource id>' | 's:<structure id>'
export function nodeIds(p) {
  return ['player', ...p.level.structures.map(s => 's:' + s.id), ...p.level.resources.map(r => 'r:' + r.id)];
}
export function getNode(p, id) {
  if (id === 'player') return { id, kind: 'player', obj: p.level.player };
  const [t, n] = id.split(':'); const k = +n;
  if (t === 'r') { const obj = p.level.resources.find(r => r.id === k); return obj && { id, kind: obj.kind, obj }; }
  if (t === 's') { const obj = p.level.structures.find(s => s.id === k); return obj && { id, kind: obj.type, obj }; }
  return null;
}
// Mutable draft lookup for use inside store.update recipes.
export function draftNode(d, id) { return getNode(d, id)?.obj; }
