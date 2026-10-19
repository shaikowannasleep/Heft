import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/core/heft-data.js';
import { encodeHeftb, decodeHeftb, encodeDelta, decodeDelta, sectionSizes, HeftbError } from '../src/db/codec.js';
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
  for (let n = 0; n < bytes.length; n += 3) {
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
