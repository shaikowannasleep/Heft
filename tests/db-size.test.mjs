// Size budgets, set from measured numbers (node tools/db-bench.mjs). Measured in brackets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/core/heft-data.js';
import { encodeHeftb, decodeHeftb } from '../src/db/codec.js';
import { ProjectDB } from '../src/db/store.js';
import { memoryAdapter } from '../src/db/adapters.js';
import { bigLevel } from './db-fixtures.mjs';

const BUDGET = {
  default205: 2560,          // 2.5 KB for the 205-resource default level [2217 B]
  synthetic10k: 80 * 1024,   // 10k resources at 0.01 m / 0.001 rad precision [76513 B; per-field entropy floor ~59.5 KB]
  growth1000: 8 * 1024,      // DB size after 1000 autosaves on the default level [3.65 KB]
};

test('default 205-object level fits its budget and round trips', () => {
  const p = D.newProject(1), bytes = encodeHeftb(p);
  assert.ok(bytes.length <= BUDGET.default205, `${bytes.length} B > ${BUDGET.default205} B`);
  assert.deepStrictEqual(decodeHeftb(bytes).project, p);
});

test('10k-resource level fits its budget and round trips', () => {
  const p = bigLevel(10000), bytes = encodeHeftb(p);
  assert.ok(bytes.length <= BUDGET.synthetic10k, `${bytes.length} B > ${BUDGET.synthetic10k} B`);
  assert.deepStrictEqual(decodeHeftb(bytes).project, p);
});

test('1000 autosaves keep the DB under a fixed cap, and each autosave stores a small delta', async () => {
  let t = Date.parse('2026-10-19T09:00:00Z');
  const db = new ProjectDB(memoryAdapter(), { now: () => t });
  const rng = D.mulberry32(21);
  let p = D.newProject(1), deltaBytes = [];
  for (let i = 0; i < 1000; i++) {
    const L = { ...p.level, resources: p.level.resources.slice() }, k = Math.floor(rng() * L.resources.length);
    L.resources[k] = { ...L.resources[k], x: Math.round((L.resources[k].x + rng() - 0.5) * 100) / 100 };
    p = { ...p, level: L }; t += 2000;
    const r = await db.save(p);
    if (r.kind === 'delta') deltaBytes.push(r.bytes);
  }
  const { bytes, count } = await db.stats();
  assert.ok(bytes <= BUDGET.growth1000, `DB ${bytes} B after 1000 autosaves > ${BUDGET.growth1000} B`);
  assert.ok(count <= 45, `${count} revisions kept`);
  deltaBytes.sort((a, b) => a - b);
  assert.ok(deltaBytes[deltaBytes.length >> 1] < 200, `median delta ${deltaBytes[deltaBytes.length >> 1]} B`);
});
