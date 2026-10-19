import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/core/heft-data.js';
import { ProjectDB, QuotaError, LIMITS, keepSet } from '../src/db/store.js';
import { memoryAdapter } from '../src/db/adapters.js';
import { diff, apply, summarize } from '../src/db/diff.js';
import { bigLevel } from './db-fixtures.mjs';

const clone = p => structuredClone(p);
// Autosave one edit per call: move a resource and advance the clock by 2 s.
// Copy-on-write like immer: untouched objects keep their references.
function editor(p, rng) {
  const L = { ...p.level, resources: p.level.resources.slice() }, i = Math.floor(rng() * L.resources.length);
  L.resources[i] = { ...L.resources[i], x: Math.round((L.resources[i].x + rng() - 0.5) * 100) / 100 };
  if (rng() < 0.05) L.resources.splice(0, 1);
  if (rng() < 0.05) L.resources.push({ id: 90000 + Math.floor(rng() * 1e6), kind: 'rock', v: 0, x: 1, z: 2, rot: 0, s: 1, hp: 5, max: 5, regrowAt: 0 });
  return { ...p, level: L };
}

test('diff then apply reproduces the target and leaves the input untouched', () => {
  const rng = D.mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const a = bigLevel(30, i + 1), b = clone(a);
    for (let k = 0; k < 4; k++) {
      const r = Math.floor(rng() * 3), L = b.level;
      if (r === 0) L.resources[Math.floor(rng() * L.resources.length)].hp = Math.floor(rng() * 9);
      else if (r === 1) L.resources.splice(Math.floor(rng() * L.resources.length), Math.floor(rng() * 3), ...(rng() < 0.5 ? [{ id: 1e6 + k, kind: 'tree', v: 1 }] : []));
      else { delete L.player.hp; L.player.name = 'p' + k; }
    }
    const before = clone(a), ops = diff(a, b);
    assert.deepStrictEqual(apply(a, ops), b, `case ${i}`);
    assert.deepStrictEqual(a, before, 'input mutated');
  }
});

test('diff keeps unchanged subtrees by reference, so only the edited path is new', () => {
  const a = bigLevel(50), b = clone(a);
  b.level.resources[10].x += 1;
  const out = apply(a, diff(a, b));
  assert.equal(out.level.resources[11], a.level.resources[11]);
  assert.notEqual(out.level.resources[10], a.level.resources[10]);
  assert.equal(out.models, a.models);
});

test('summary names the changed area', () => {
  const a = bigLevel(10), b = { ...a, level: { ...a.level, resources: [...a.level.resources] } };
  b.level.resources.push({ id: 99, kind: 'rock', v: 0, x: 0, z: 0, rot: 0, s: 1 });
  assert.match(summarize(diff(a, b)), /level\.resources: 1 change \(\+1 -0\)/);
  assert.equal(summarize([]), 'no changes');
});

test('1000 autosaves: retention bounds the revisions, every kept delta replays to its snapshot', async () => {
  let t = Date.parse('2026-10-19T09:00:00Z');
  const db = new ProjectDB(memoryAdapter(), { now: () => t });
  const rng = D.mulberry32(11), snap = new Map();
  let p = bigLevel(205, 1), kinds = { base: 0, delta: 0 };
  for (let i = 0; i < 1000; i++) {
    p = editor(p, rng); t += 2000;
    const r = await db.save(p, { label: 'autosave' });
    snap.set(r.seq, p); kinds[r.kind]++;
  }
  const list = await db.list();
  assert.ok(list.length <= LIMITS.keepLast + 24 + 7 + 1, `kept ${list.length}`);
  assert.ok(kinds.delta > 900, `deltas ${kinds.delta}`);
  assert.deepStrictEqual(await db.latest(), p);
  for (const r of list) assert.deepStrictEqual(await db.restore(r.seq), snap.get(r.seq), `seq ${r.seq}`);
  const { bytes } = await db.stats();
  assert.ok(bytes < 64 << 10, `DB ${bytes} bytes after 1000 autosaves`);
});

test('pinned revisions survive retention, and removing a revision keeps the rest replayable', async () => {
  let t = Date.parse('2026-10-19T09:00:00Z');
  const db = new ProjectDB(memoryAdapter(), { now: () => t });
  const rng = D.mulberry32(5), snap = new Map();
  let p = bigLevel(60, 2);
  const first = await db.save(p, { label: 'first', auto: false, pin: true }); snap.set(first.seq, p);
  for (let i = 0; i < 200; i++) { p = editor(p, rng); t += 2000; snap.set((await db.save(p)).seq, p); }
  const kept = (await db.list()).map(r => r.seq);
  assert.ok(kept.includes(first.seq), 'pinned revision dropped');
  assert.deepStrictEqual(await db.restore(first.seq), snap.get(first.seq));
  const victim = kept[Math.floor(kept.length / 2)];
  await db.remove(victim);
  assert.equal((await db.list()).some(r => r.seq === victim), false);
  for (const s of kept.filter(s => s !== victim)) assert.deepStrictEqual(await db.restore(s), snap.get(s), `seq ${s} after remove`);
});

test('a failed write leaves the previous state intact and reports a clear error', async () => {
  const probe = new ProjectDB(memoryAdapter());
  const p1 = bigLevel(60, 3), p2 = editor(p1, D.mulberry32(1));
  const { bytes } = await probe.save(p1);
  const db = new ProjectDB(memoryAdapter({ quota: bytes + 150 }), { lim: { ...LIMITS, margin: 100 } });   // room for the base, not for a delta plus margin
  await db.save(p1);
  const before = await db.list();
  await assert.rejects(db.save(p2), e => e instanceof QuotaError && /Not enough browser storage/.test(e.message));
  assert.deepStrictEqual(await db.latest(), p1);
  assert.deepStrictEqual(await db.list(), before);
});

test('quota guard warns before writes fail', async () => {
  const warns = [];
  const db = new ProjectDB(memoryAdapter({ quota: 1 << 20 }), { onWarn: m => warns.push(m) });
  await db.save(bigLevel(60, 4));
  const q = await db.quota();
  assert.equal(q.warn, true);             // free space is below the warning threshold on a 1 MB quota
  assert.match(warns.join(), /% full/);
});

test('retention rules: last N, hourly for a day, daily for a week, autosave ring by bytes', () => {
  const H = 3600e3, now = 100 * 24 * H, mk = (seq, age, extra = {}) => ({ seq, at: now - age, auto: true, pinned: false, bytes: 10, ...extra });
  const revs = []; for (let i = 0; i < 300; i++) revs.push(mk(i + 1, (299 - i) * 60e3));   // one per minute, 5 hours
  const keep = keepSet(revs, 300, now);
  assert.ok(keep.has(300) && keep.has(281), 'last N kept');
  assert.ok(keep.size <= 20 + 5 + 1, `kept ${keep.size}`);
  // day buckets: 5 and 6 share a day (newest per day wins), 1 and 2 are on different days, 3 is past a week
  const week = [mk(1, 4 * 24 * H + 60e3), mk(2, 4 * 24 * H), mk(3, 8 * 24 * H), mk(4, 0, { pinned: true, bytes: 1 }), mk(5, 2 * 24 * H + 2 * H), mk(6, 2 * 24 * H + H)];
  const k2 = keepSet(week, 4, now, { ...LIMITS, keepLast: 0 });
  assert.ok(k2.has(1) && k2.has(2) && k2.has(6) && !k2.has(5) && !k2.has(3) && k2.has(4));
  const big = Array.from({ length: 10 }, (_, i) => mk(i + 1, i * 1e3, { bytes: 100 }));
  const k3 = keepSet(big, 10, now, { ...LIMITS, keepLast: 50, ringBytes: 350 });
  assert.equal(k3.has(10), true);
  assert.equal([...k3].filter(s => s !== 10).length, 3);   // oldest autosaves dropped until the ring fits
});

test('compact reports before and after bytes, and a summary names the change', async () => {
  let t = Date.parse('2026-10-19T09:00:00Z');
  const db = new ProjectDB(memoryAdapter(), { now: () => t });
  const rng = D.mulberry32(8);
  let p = bigLevel(120, 6);
  for (let i = 0; i < 80; i++) { p = editor(p, rng); t += 60e3; await db.save(p); }
  const r = await db.compact();
  assert.ok(r.after <= r.before, `${r.before} -> ${r.after}`);
  const list = await db.list();
  assert.match(await db.summary(list[0].seq), /level\.resources/);
  assert.deepStrictEqual(await db.latest(), p);
});

test('saving an unchanged project writes nothing', async () => {
  const db = new ProjectDB(memoryAdapter());
  const p = bigLevel(20, 9);
  await db.save(p);
  const again = await db.save(p);
  assert.equal(again.skipped, true);
  assert.equal((await db.list()).length, 1);
});
