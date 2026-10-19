// Structural diff between two project states. Unchanged subtrees keep their references (immer), so the walk only
// visits what changed. Ops transform a into b: {p, k, s} set key, {p, k, d:1} delete key, {p, i, n, v} splice array.
// Object.is, not ===: NaN equals NaN (re-saving NaN is "unchanged") and -0 differs from 0.
import { HeftbError } from './codec.js';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const containers = (a, b) => (Array.isArray(a) && Array.isArray(b)) || (isObj(a) && isObj(b));
// defineProperty, not assignment: a "__proto__" key must stay an own property, not replace the prototype.
const setKey = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

export function diff(a, b) {
  if (!containers(a, b)) throw new HeftbError('diff needs two objects or two arrays');
  return walk(a, b, [], []);
}
function walk(a, b, p, out) {
  if (Object.is(a, b)) return out;
  if (Array.isArray(a)) {
    if (a.length === b.length) {
      for (let i = 0; i < a.length; i++) child(a[i], b[i], p, i, out);
      return out;
    }
    let i = 0; while (i < a.length && i < b.length && Object.is(a[i], b[i])) i++;
    let ea = a.length, eb = b.length; while (ea > i && eb > i && Object.is(a[ea - 1], b[eb - 1])) { ea--; eb--; }
    out.push({ p, i, n: ea - i, v: b.slice(i, eb) });
    return out;
  }
  for (const k of Object.keys(a)) if (!Object.hasOwn(b, k)) out.push({ p, k, d: 1 });
  for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) out.push({ p, k, s: b[k] }); else child(a[k], b[k], p, k, out);
  return out;
}
function child(x, y, p, k, out) {
  if (Object.is(x, y)) return;
  if (containers(x, y)) walk(x, y, [...p, k], out); else out.push({ p, k, s: y });
}

// Copy-on-write: each container on a path is copied once per call, the input is never mutated.
export function apply(root, ops) {
  const owned = new WeakSet();
  const mine = n => {
    if (owned.has(n)) return n;
    if (n === null || typeof n !== 'object') throw new HeftbError('delta does not match its base revision');
    const c = Array.isArray(n) ? n.slice() : { ...n }; owned.add(c); return c;
  };
  const out = mine(root);
  for (const op of ops) {
    let parent = null, pk = null, node = out;
    for (const k of op.p) { const c = mine(node[k]); setKey(node, k, c); parent = node; pk = k; node = c; }
    if (op.i !== undefined) {
      if (!Array.isArray(node)) throw new HeftbError('delta does not match its base revision');
      const c = node.slice(0, op.i).concat(op.v, node.slice(op.i + op.n)); owned.add(c);
      if (!parent) throw new HeftbError('delta splices the project root');
      setKey(parent, pk, c);
    } else if (op.d) delete node[op.k];
    else setKey(node, op.k, op.s);
  }
  return out;
}

// One line per top-level area ("level.resources: 3 changes"), for the revision list.
export function summarize(ops) {
  const g = new Map();
  for (const op of ops) {
    const key = op.p.slice(0, 2).join('.') || 'project';
    const c = g.get(key) ?? { n: 0, add: 0, del: 0 };
    c.n++; if (op.i !== undefined) { c.add += op.v.length; c.del += op.n; }
    g.set(key, c);
  }
  if (!g.size) return 'no changes';
  return [...g].map(([k, c]) => `${k}: ${c.n} change${c.n === 1 ? '' : 's'}${c.add || c.del ? ` (+${c.add} -${c.del})` : ''}`).join(', ');
}
