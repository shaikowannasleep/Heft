// Recipe service (ctx.bag.models). Geometry is cached per recipe object, so rev(key) changes exactly when the recipe
// changes (edit, undo, redo, replace or reset).
import { DEFAULTS } from './defaults.js';
import { KEYS, NAMES, validParts, bakeModel } from './recipe.js';

export function createModels(store) {
  const seen = new Map();
  const recipe = key => { const r = store.project.models?.[key]; return validParts(r) ? r : DEFAULTS[key]; };
  const track = key => {
    const rec = recipe(key), s = seen.get(key);
    if (s && s.rec === rec) return s;
    const n = { rec, rev: (s?.rev ?? 0) + 1, geo: null };
    seen.set(key, n);
    return n;
  };
  return {
    keys: () => KEYS.slice(),
    recipe,
    edited: key => validParts(store.project.models?.[key]),
    rev: key => track(key).rev,
    geometry: key => { const s = track(key); return s.geo ??= bakeModel(s.rec); },
    // One undo step. The first edit copies the game default into the project; a result that fails validation throws
    // and nothing is stored.
    edit(label, key, fn, merge) {
      store.update(label, d => {
        d.models ??= {};
        if (!validParts(d.models[key])) d.models[key] = structuredClone(DEFAULTS[key]);
        fn(d.models[key]);
        if (!validParts(d.models[key])) throw new Error('value out of range');
      }, merge);
    },
    reset(key) { store.update(`Reset ${NAMES[key]}`, d => { if (d.models) delete d.models[key]; }); },
  };
}
