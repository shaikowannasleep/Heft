import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/core/heft-data.js';
import { encodeHeftb, decodeHeftb, encodeDelta, decodeDelta, sectionSizes, crc32, HeftbError } from '../src/db/codec.js';
import zlib from 'node:zlib';
import { bigLevel, rnd, fuzzLevel } from './db-fixtures.mjs';

const roundTrip = p => decodeHeftb(encodeHeftb(p)).project;

test('default level round trips exactly', () => {
  const p = D.newProject(1);
  assert.deepStrictEqual(roundTrip(p), p);
});

test('fuzz: random levels, including rows that take the generic path, round trip exactly', () => {
  const rng = D.mulberry32(12345);
  for (let i = 0; i < 300; i++) {
    const p = fuzzLevel(rng);
    assert.deepStrictEqual(roundTrip(p), p, `fuzz case ${i}`);
  }
});

test('edge values survive: -0, NaN, infinities, huge ints, subnormals, unicode and __proto__ keys', () => {
  const rng = D.mulberry32(9);
  for (let i = 0; i < 200; i++) {
    const v = rnd(rng);
    const p = { format: 'heft-studio', version: 1, name: 'é ✓', level: { player: { x: -0, z: NaN, hp: 2 ** 53 }, weird: v }, models: { m: v } };
    const back = roundTrip(p);
    assert.deepStrictEqual(back, p, `case ${i}`);
    assert.equal(Object.is(back.level.player.x, -0), true);
  }
  const q = D.newProject(3);
  q.level.resources[0].x = 0.123456789;           // not on the 0.01 grid: exception list
  q.level.resources[1].s = -0;                    // stored as a float64 exception, keeps the sign
  q.level.resources[2].regrowAt = 2 ** 40;        // beyond the fixed-width column
  assert.deepStrictEqual(roundTrip(q), q);
});

test('models section round trips and is optional', () => {
  const p = D.newProject(4);
  p.models = { 'tree.0': { positions: [0, 1, 2, -3.5], uvs: [0.25] }, 'rock.0': {} };
  assert.deepStrictEqual(roundTrip(p), p);
  const { models, ...noModels } = p;
  assert.equal('models' in decodeHeftb(encodeHeftb(noModels)).project, false);
});

test('big synthetic level round trips', () => {
  const p = bigLevel(2000);
  assert.deepStrictEqual(roundTrip(p), p);
});

test('truncated files are rejected with HeftbError, never a partial load', () => {
  const bytes = encodeHeftb(D.newProject(1));
  for (let n = 0; n < bytes.length; n += 1) {
    assert.throws(() => decodeHeftb(bytes.subarray(0, n)), e => e instanceof HeftbError && /file is/.test(e.message), `prefix ${n}`);
  }
});

test('every single-byte corruption is rejected', () => {
  const bytes = encodeHeftb(D.newProject(1));
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes.slice(); b[i] ^= 0x5a;
    assert.throws(() => decodeHeftb(b), HeftbError, `flip at ${i}`);
  }
});

test('trailing garbage and bad signatures are rejected', () => {
  const bytes = encodeHeftb(D.newProject(1));
  assert.throws(() => decodeHeftb(new Uint8Array([...bytes, 0])), HeftbError);
  const bad = bytes.slice(); bad[0] = 0x58;
  assert.throws(() => decodeHeftb(bad), /bad signature/);
  assert.throws(() => decodeHeftb(new Uint8Array(0)), HeftbError);
});

test('unknown sections are checked and skipped', () => {
  const p = D.newProject(5);
  const bytes = encodeHeftb(p, { extra: { future: { hello: [1, 2, 3] } } });
  assert.deepStrictEqual(decodeHeftb(bytes).project, p);
  assert.ok(sectionSizes(bytes).some(s => s.name === 'future'));
});

test('a delta file is not a project file, and the reverse', () => {
  assert.throws(() => decodeDelta(encodeHeftb(D.newProject(1))), /bad signature/);
  assert.throws(() => decodeHeftb(encodeDelta([])), /bad signature/);
  assert.deepStrictEqual(decodeDelta(encodeDelta([{ p: ['level'], k: 'x', s: 1 }])), [{ p: ['level'], k: 'x', s: 1 }]);
});

// Hand-built container: lets tests declare sizes and bodies that encodeHeftb would never write.
const le32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
function container(secs) {
  const enc = new TextEncoder(), table = [];
  for (const s of secs) {
    const name = enc.encode(s.name);
    table.push(name.length, ...name, s.method, ...le32(s.body.length), ...le32(s.rawLen), ...le32(crc32(s.raw)), ...le32(crc32(s.body)));
  }
  const t = new Uint8Array(table);
  const head = [...enc.encode('HEFB'), 1, 0, secs.length & 255, secs.length >> 8, ...le32(crc32(t))];
  const parts = [new Uint8Array(head), t, ...secs.map(s => s.body)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const raw = (bytes, name = 'meta') => { const s = { name, method: 0, raw: bytes, body: bytes, rawLen: bytes.length }; return s; };
const EMPTY_OBJ = [0, 9, 0];   // nStrings 0, OBJ with 0 keys

test('decompression bomb: a body that inflates past its declared size is rejected before the output grows', () => {
  const zeros = new Uint8Array(64 << 20), bomb = new Uint8Array(zlib.deflateRawSync(zeros, { level: 9 }));
  const bytes = container([{ name: 'meta', method: 1, body: bomb, rawLen: 100, raw: new Uint8Array(100) }]);
  const t = Date.now();
  assert.throws(() => decodeHeftb(bytes), e => e instanceof HeftbError);
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
});

test('declared sizes are bounded: 32 sections each claiming 256 MiB are rejected without allocating', () => {
  const body = new Uint8Array(zlib.deflateRawSync(new Uint8Array(10)));
  const secs = Array.from({ length: 32 }, (_, i) => ({ name: 's' + i, method: 1, body, rawLen: 1 << 28, raw: new Uint8Array(10) }));
  assert.throws(() => decodeHeftb(container(secs)), e => e instanceof HeftbError && /impossible size|exceeds/.test(e.message));
});

test('row-count amplification: a table declaring more rows than the limit is rejected at once', () => {
  const rows = [0, ...[0x80, 0x80, 0x80, 0x08]];   // nStrings 0, then a varint of 2^24 rows
  const level = [0, 9, 0];
  const bytes = container([raw(new Uint8Array(EMPTY_OBJ)), raw(new Uint8Array(level), 'level'), raw(new Uint8Array(rows), 'resources'), raw(new Uint8Array([0, 0]), 'structures')]);
  const t = Date.now();
  assert.throws(() => decodeHeftb(bytes), e => e instanceof HeftbError && /rows/.test(e.message));
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
});

test('a section that inflates to fewer bytes than declared is rejected', () => {
  const body = new Uint8Array(zlib.deflateRawSync(new Uint8Array(40)));
  assert.throws(() => decodeHeftb(container([{ name: 'meta', method: 1, body, rawLen: 41, raw: new Uint8Array(40) }])), HeftbError);
});

test('lone surrogates are rejected, paired ones round trip', () => {
  assert.throws(() => encodeHeftb({ name: 'bad \uD800 name' }), e => e instanceof HeftbError && /unpaired surrogate/.test(e.message));
  assert.throws(() => encodeHeftb({ level: { note: '\uDC00' } }), /unpaired surrogate/);
  const ok = { name: '😀 ok' };
  assert.deepStrictEqual(roundTrip(ok), ok);
});

test('sparse arrays (holes) are rejected, not turned into undefined', () => {
  const a = [1]; a[3] = 2;
  assert.throws(() => encodeHeftb({ level: { list: a } }), /sparse array/);
});

test('__proto__ keys and off-grid numbers come back exactly', () => {
  const p = D.newProject(6);
  Object.defineProperty(p.meta ?? (p.meta = {}), '__proto__', { value: { x: 1 }, enumerable: true, writable: true, configurable: true });
  p.level.resources[0].x = 1 / 3;
  const back = roundTrip(p);
  assert.deepStrictEqual(back, p);
  assert.equal(Object.getPrototypeOf(back.meta), Object.prototype);
});
