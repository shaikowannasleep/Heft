// Prints the db pillar's measured numbers: JSON vs gzip vs .heftb sizes, per-section bytes, and DB growth over autosaves.
// Usage: node tools/db-bench.mjs
import { gzipSync } from 'fflate';
import assert from 'node:assert/strict';
import * as D from '../src/core/heft-data.js';
import { encodeHeftb, decodeHeftb, sectionSizes } from '../src/db/codec.js';
import { ProjectDB } from '../src/db/store.js';
import { memoryAdapter } from '../src/db/adapters.js';
import { bigLevel } from '../tests/db-fixtures.mjs';

const kb = n => (n / 1024).toFixed(2).padStart(8) + ' KB';
function sizes(label, p) {
  const json = JSON.stringify(p), t0 = performance.now(), hb = encodeHeftb(p), t1 = performance.now();
  const back = decodeHeftb(hb).project, t2 = performance.now();
  assert.deepStrictEqual(back, p);   // values and types exact; key order of table rows is canonical (schema order)
  console.log(`${label}: json ${kb(json.length)}  gzip ${kb(gzipSync(json, { level: 9 }).length)}  heftb ${kb(hb.length)}  (encode ${(t1 - t0).toFixed(0)} ms, decode ${(t2 - t1).toFixed(0)} ms)`);
  for (const s of sectionSizes(hb)) console.log(`    ${s.name.padEnd(10)} raw ${String(s.raw).padStart(7)} B  stored ${String(s.stored).padStart(7)} B`);
  return hb.length;
}

const def = D.newProject(1);
console.log(`default level: ${def.level.resources.length} resources, ${def.level.structures.length} structures`);
const small = sizes('default 205-object level', def);
const big = sizes('synthetic 10k-resource level', bigLevel(10000));

// Growth: 1000 autosaves of one edit each, 2 s apart, on the default level.
let t = Date.parse('2026-10-19T09:00:00Z');
const db = new ProjectDB(memoryAdapter(), { now: () => t });
let p = def, rng = D.mulberry32(21), seen = [];
for (let i = 1; i <= 1000; i++) {
  const L = { ...p.level, resources: p.level.resources.slice() }, k = Math.floor(rng() * L.resources.length);
  L.resources[k] = { ...L.resources[k], x: Math.round((L.resources[k].x + rng() - 0.5) * 100) / 100 };
  p = { ...p, level: L }; t += 2000;
  await db.save(p);
  if ([1, 10, 100, 1000].includes(i)) seen.push([i, (await db.stats())]);
}
console.log('DB growth over 1000 autosaves (default level):');
for (const [i, s] of seen) console.log(`    after ${String(i).padStart(4)} autosaves: ${s.count} revisions kept, ${kb(s.bytes)}`);
const c = await db.compact();
console.log(`compact: ${kb(c.before)} -> ${kb(c.after)}`);
console.log(JSON.stringify({ smallBytes: small, bigBytes: big }));
