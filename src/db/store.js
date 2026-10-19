// Project database: revisions in a key-value adapter (IndexedDB or memory). A revision is a base snapshot (.heftb)
// or a delta (HEFD ops) against the previous revision. Retention keeps the last N, hourly for a day, daily for a
// week, and the newest autosaves under a byte ring. GC writes rebuilt revisions before it deletes old ones.
import { encodeHeftb, decodeHeftb, encodeDelta, decodeDelta, HeftbError } from './codec.js';
import { diff, apply, summarize } from './diff.js';

export const LIMITS = {
  keepLast: 20, hourMs: 3600e3, dayMs: 86400e3, weekMs: 7 * 86400e3,
  ringBytes: 512 << 10,   // autosave bytes kept (oldest autosaves go first)
  chain: 32,              // deltas in a row before a base snapshot
  warnFree: 16 << 20, margin: 256 << 10,   // warn below warnFree; refuse writes that would leave less than margin
  chunk: 64,              // revisions per GC transaction
};

export class QuotaError extends Error {
  constructor(need, free) { super(`Not enough browser storage: ${free} bytes free, ${need} needed. Export a .heftb, then compact or delete old revisions.`); this.name = 'QuotaError'; }
}

// Seqs to keep. Pure: depends only on revision metadata and the clock.
export function keepSet(revs, head, now, lim = LIMITS) {
  const desc = [...revs].sort((a, b) => b.seq - a.seq), keep = new Set(head == null ? [] : [head]);
  desc.forEach((r, i) => { if (r.pinned || i < lim.keepLast) keep.add(r.seq); });
  const hours = new Set(), days = new Set();
  for (const r of desc) {
    const age = now - r.at, hour = Math.floor(r.at / lim.hourMs), day = Math.floor(r.at / lim.dayMs);
    if (age < lim.dayMs && !hours.has(hour)) { hours.add(hour); keep.add(r.seq); }
    if (age < lim.weekMs && !days.has(day)) { days.add(day); keep.add(r.seq); }
  }
  const ring = desc.filter(r => keep.has(r.seq) && r.auto && !r.pinned && r.seq !== head).reverse();   // oldest first
  let total = ring.reduce((n, r) => n + r.bytes, 0);
  for (const r of ring) { if (total <= lim.ringBytes) break; keep.delete(r.seq); total -= r.bytes; }
  return keep;
}

export class ProjectDB {
  revs = new Map(); headSeq = null; next = 1; cur = null; q = Promise.resolve();
  constructor(adapter, { now = () => Date.now(), onWarn = () => {}, lim = LIMITS } = {}) { Object.assign(this, { a: adapter, now, onWarn, lim }); }

  // Every public op runs through this queue, so commits, GC and reads never interleave.
  run(fn) { const r = this.q.then(fn); this.q = r.catch(() => { }); return r; }
  open() { return this.run(() => this.#reload()); }
  async #reload() {
    this.revs = new Map((await this.a.all('revs')).map(r => [r.seq, r]));
    this.headSeq = this.revs.size ? Math.max(...this.revs.keys()) : null;
    this.next = this.headSeq == null ? 1 : this.headSeq + 1; this.cur = null;
  }
  save(project, opts) { return this.run(() => this.#commit(project, opts)); }
  latest() { return this.run(() => this.headSeq == null ? null : this.#head()); }
  restore(seq) { return this.run(() => this.#state(seq, new Map())); }
  list() {
    return this.run(() => [...this.revs.values()].sort((a, b) => b.seq - a.seq)
      .map(({ seq, at, label, kind, auto, pinned, bytes, prev }) => ({ seq, at, label, kind, auto, pinned, bytes, prev, head: seq === this.headSeq })));
  }
  // What changed in revision seq relative to its predecessor.
  summary(seq) {
    return this.run(() => {
      const r = this.revs.get(seq); if (!r) return null;
      if (r.prev == null) return r.kind === 'base' ? 'base snapshot' : 'orphan delta';
      const memo = new Map();
      return summarize(diff(this.#state(r.prev, memo), this.#state(seq, memo)));
    });
  }
  pin(seq, on) { return this.run(() => { const r = this.revs.get(seq); if (r) return this.#setPinned(r, on); }); }
  async #setPinned(r, on) {
    const v = { ...r, pinned: on };
    await this.#write([{ store: 'revs', value: v }], 0);
    this.revs.set(r.seq, v);
  }
  remove(seq) {
    return this.run(() => this.#gc(keepSet([...this.revs.values()], this.headSeq, this.now(), this.lim), seq));
  }
  // Retention + GC. Returns the stored bytes before and after.
  compact() {
    return this.run(async () => {
      const before = this.#bytes();
      await this.#gc(keepSet([...this.revs.values()], this.headSeq, this.now(), this.lim));
      return { before, after: this.#bytes() };
    });
  }
  stats() { return this.run(() => ({ count: this.revs.size, bytes: this.#bytes(), head: this.headSeq })); }
  quota() {
    return this.run(async () => {
      const e = await this.a.estimate?.(); if (!e) return null;
      const free = e.quota - e.usage, warn = free < this.lim.warnFree || e.usage / e.quota > 0.8;
      if (warn) this.onWarn(`browser storage ${Math.round(100 * e.usage / e.quota)}% full`);
      return { usage: e.usage, quota: e.quota, free, warn };
    });
  }

  #bytes() { let n = 0; for (const r of this.revs.values()) n += r.bytes; return n; }
  #head() { return this.#state(this.headSeq, new Map()); }
  #state(seq, memo) {
    if (memo.has(seq)) return memo.get(seq);
    const r = this.revs.get(seq);
    if (!r) throw new HeftbError(`revision ${seq} is missing`);
    let out;
    if (r.kind === 'base') out = decodeHeftb(r.data).project;
    else {
      if (r.prev == null || !this.revs.has(r.prev)) throw new HeftbError(`revision ${seq} has no base`);
      out = apply(this.#state(r.prev, memo), decodeDelta(r.data));
    }
    memo.set(seq, out); return out;
  }
  // Number of deltas back to the nearest base snapshot.
  #depth(seq) { let n = 0, r = this.revs.get(seq); while (r.kind === 'delta') { if (++n > 100000) throw new HeftbError('revision chain loops'); r = this.revs.get(r.prev); } return n; }

  async #commit(project, { label = 'autosave', auto = true, pin = false } = {}) {
    if (this.headSeq != null && this.cur?.seq !== this.headSeq) this.cur = { seq: this.headSeq, project: this.#head() };
    const head = this.cur && this.revs.get(this.headSeq);
    let kind = 'base', prev = null, data, ops = null;
    if (head) {
      ops = diff(this.cur.project, project);
      if (!ops.length) { if (pin && !head.pinned) await this.#setPinned(head, true); return { seq: head.seq, kind: head.kind, bytes: head.bytes, skipped: true }; }
      data = encodeDelta(ops);
      const base = this.#baseBytes(head.seq);
      if (this.#depth(head.seq) + 1 < this.lim.chain && data.length < base) { kind = 'delta'; prev = head.seq; }
    }
    if (kind === 'base') data = encodeHeftb(project);
    const rec = { seq: this.next, kind, prev, at: this.now(), label, auto, pinned: pin, bytes: data.length, data };
    await this.#write([{ store: 'revs', value: rec }, { store: 'projects', value: { id: 'main', name: project.name, at: rec.at } }], data.length);
    this.next++; this.revs.set(rec.seq, rec); this.headSeq = rec.seq; this.cur = { seq: rec.seq, project };
    try { await this.#gc(keepSet([...this.revs.values()], this.headSeq, this.now(), this.lim)); }
    catch (e) { this.onWarn(`cleanup failed: ${e.message}`); }
    return { seq: rec.seq, kind, bytes: rec.bytes, changes: ops?.length ?? 0 };
  }
  #baseBytes(seq) { let r = this.revs.get(seq); while (r.kind === 'delta') r = this.revs.get(r.prev); return r.bytes; }

  // Quota guard: refuse a write that would leave less than the margin, and warn before that point.
  async #write(ops, need) {
    const e = await this.a.estimate?.();
    if (e && e.quota - e.usage < need + this.lim.margin) throw new QuotaError(need, Math.max(0, e.quota - e.usage));
    try { await this.a.write(ops); }
    catch (err) { if (/quota/i.test(err.name)) throw new QuotaError(need, 0); throw err; }
  }

  // Retained revisions are kept. A kept delta whose predecessor is dropped is rebuilt against the nearest kept
  // predecessor (or as a base when that is not smaller). New records are written before the dropped ones are deleted.
  async #gc(keep, removing = null) {
    const all = [...this.revs.values()].sort((a, b) => a.seq - b.seq);
    const drop = all.filter(r => !keep.has(r.seq) || r.seq === removing).map(r => r.seq);
    if (!drop.length) return 0;
    const memo = new Map(), depth = new Map(), puts = [];
    let prevKept = null;
    for (const r of all) {
      if (!keep.has(r.seq) || r.seq === removing) continue;
      let rec = r;
      if (r.kind === 'delta' && (r.prev == null || !keep.has(r.prev) || r.prev === removing)) {
        const project = this.#state(r.seq, memo), full = encodeHeftb(project);
        const d = prevKept && depth.get(prevKept.seq) + 1 < this.lim.chain ? encodeDelta(diff(this.#state(prevKept.seq, memo), project)) : null;
        rec = d && d.length < full.length ? { ...r, prev: prevKept.seq, data: d, bytes: d.length } : { ...r, kind: 'base', prev: null, data: full, bytes: full.length };
        puts.push(rec);
      }
      depth.set(rec.seq, rec.kind === 'base' ? 0 : depth.get(rec.prev) + 1);
      prevKept = rec;
    }
    try {
      for (const chunk of chunks(puts, this.lim.chunk)) await this.#write(chunk.map(value => ({ store: 'revs', value })), chunk.reduce((n, r) => n + r.bytes, 0));
      for (const chunk of chunks(drop, this.lim.chunk)) await this.#write(chunk.map(del => ({ store: 'revs', del })), 0);
    } catch (e) {
      await this.#reload();   // memory may be ahead of the store after a partial GC: re-read it
      throw e;
    }
    for (const r of puts) this.revs.set(r.seq, r);
    for (const s of drop) this.revs.delete(s);
    if (!this.revs.has(this.headSeq)) { this.headSeq = this.revs.size ? Math.max(...this.revs.keys()) : null; this.cur = null; }
    return drop.length;
  }
}

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
