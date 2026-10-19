// Heft binary project format (.heftb) and revision deltas. Pure JS: runs in Node and the browser.
// Container: "HEFB" | u8 version | u8 reserved | u16 sections | u32 crc32(table) | table | section bodies.
//   table entry: u8 nameLen | name | u8 method (0 stored, 1 deflate) | u32 stored | u32 raw | u32 crc32(raw)
// Section raw bytes: varint nStrings | strings (varint len, utf8) | value stream.
// Resources and structures are columnar (RES, STRUCT): a bit-packed row header (odd, dictionary index, small
// ints, flags), zigzag-varint id deltas, and fixed-width quantized numbers with an exception list.
// A row or value that cannot be stored exactly falls back to the generic encoding, so nothing is clipped.
// Unknown section names are CRC-checked and skipped, so newer builds can add sections.
import { deflateSync, inflateSync } from 'fflate';

export class HeftbError extends Error { constructor(msg) { super(msg); this.name = 'HeftbError'; } }
const SIG = 'HEFB', DELTA_SIG = 'HEFD', VERSION = 1, MAX_RAW = 1 << 28, MAX_SECTIONS = 32;
const RES = { id: 'delta', kind: 'dict', v: 'b4', x: 'i16:100', z: 'i16:100', rot: 'u16:1000', s: 'u16:1000', hp: 'u8', max: 'u8', regrowAt: 'i32:100', removed: 'flag' };
const STRUCT = { id: 'delta', type: 'dict', x: 'i16:100', z: 'i16:100', rot: 'u16:1000' };
const FIXED = { u8: ['setUint8', 'getUint8', 1, 0, 255], i16: ['setInt16', 'getInt16', 2, -32768, 32767], u16: ['setUint16', 'getUint16', 2, 0, 65535], i32: ['setInt32', 'getInt32', 4, -2147483648, 2147483647], u32: ['setUint32', 'getUint32', 4, 0, 4294967295] };
const TAG = { NULL: 0, FALSE: 1, TRUE: 2, UNDEF: 3, UINT: 4, NINT: 5, F64: 6, STR: 7, ARR: 8, OBJ: 9 };
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const corrupt = (why = 'corrupt') => new HeftbError(`file is ${why}`);

const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

class Out {
  buf = new Uint8Array(1024); n = 0; dv = new DataView(this.buf.buffer); strs = new Map(); list = [];
  room(k) { if (this.n + k > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k)); b.set(this.buf.subarray(0, this.n)); this.buf = b; this.dv = new DataView(b.buffer); } }
  u8(v) { this.room(1); this.buf[this.n++] = v; }
  fixed(t, v) { const [set, , k] = FIXED[t]; this.room(k); this.dv[set](this.n, v, true); this.n += k; }
  f64(v) { this.room(8); this.dv.setFloat64(this.n, v, true); this.n += 8; }
  uint(v) { this.room(8); while (v >= 128) { this.buf[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); } this.buf[this.n++] = v; }
  bytes(a) { this.room(a.length); this.buf.set(a, this.n); this.n += a.length; }
  str(s) { let i = this.strs.get(s); if (i === undefined) { i = this.list.length; this.strs.set(s, i); this.list.push(s); } return i; }
  done() { return this.buf.slice(0, this.n); }
}

class In {
  constructor(b) { this.b = b; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.p = 0; }
  need(k) { if (k > this.b.length - this.p) throw corrupt('truncated (unexpected end of data)'); }
  u8() { this.need(1); return this.b[this.p++]; }
  fixed(t) { const [, get, k] = FIXED[t]; this.need(k); const v = this.dv[get](this.p, true); this.p += k; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  uint() { let v = 0, m = 1; for (let k = 0; k < 8; k++) { const b = this.u8(); v += (b & 127) * m; if (b < 128) { if (v > Number.MAX_SAFE_INTEGER) break; return v; } m *= 128; } throw corrupt('corrupt (bad integer)'); }
  bytes(k) { this.need(k); const v = this.b.subarray(this.p, this.p + k); this.p += k; return v; }
  count() { const n = this.uint(); if (n > this.b.length - this.p) throw corrupt('corrupt (length exceeds data)'); return n; }
  left() { return this.b.length - this.p; }
}

const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const str = (S, i) => { if (i >= S.length) throw corrupt('corrupt (string index out of range)'); return S[i]; };
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPlain = v => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// ---- generic values (any JSON-like value; numbers that are not safe integers are stored as float64)
function putValue(o, v, d = 0) {
  if (d > 256) throw new HeftbError('project nests too deeply or has a cycle');
  if (v === null) o.u8(TAG.NULL);
  else if (v === undefined) o.u8(TAG.UNDEF);
  else if (typeof v === 'boolean') o.u8(v ? TAG.TRUE : TAG.FALSE);
  else if (typeof v === 'number') {
    if (Number.isSafeInteger(v) && !Object.is(v, -0)) { o.u8(v < 0 ? TAG.NINT : TAG.UINT); o.uint(Math.abs(v)); }
    else { o.u8(TAG.F64); o.f64(v); }
  } else if (typeof v === 'string') { o.u8(TAG.STR); o.uint(o.str(v)); }
  else if (Array.isArray(v)) { o.u8(TAG.ARR); o.uint(v.length); for (const x of v) putValue(o, x, d + 1); }
  else if (isPlain(v)) { const keys = Object.keys(v); o.u8(TAG.OBJ); o.uint(keys.length); for (const k of keys) { o.uint(o.str(k)); putValue(o, v[k], d + 1); } }
  else throw new HeftbError(`cannot store a ${ArrayBuffer.isView(v) ? 'typed array' : typeof v} in a project`);
}
function getValue(i, S, d = 0) {
  if (d > 256) throw corrupt('corrupt (nesting too deep)');
  switch (i.u8()) {
    case TAG.NULL: return null;
    case TAG.FALSE: return false;
    case TAG.TRUE: return true;
    case TAG.UNDEF: return undefined;
    case TAG.UINT: return i.uint();
    case TAG.NINT: { const v = i.uint(); if (v === 0) throw corrupt('corrupt (negative zero)'); return -v; }
    case TAG.F64: return i.f64();
    case TAG.STR: return str(S, i.uint());
    case TAG.ARR: { const n = i.count(), a = new Array(n); for (let k = 0; k < n; k++) a[k] = getValue(i, S, d + 1); return a; }
    case TAG.OBJ: { const n = i.count(), o = {}; for (let k = 0; k < n; k++) { const key = str(S, i.uint()); put(o, key, getValue(i, S, d + 1)); } return o; }
    default: throw corrupt('corrupt (unknown value tag)');
  }
}

// ---- columnar tables
const bitsFor = n => { let b = 0; while ((1 << b) < n) b++; return b; };
const zig = d => d >= 0 ? 2 * d : -2 * d - 1;
const unzig = z => z % 2 ? -(z + 1) / 2 : z / 2;
const pushBits = (b, p, v, w) => { for (let k = w - 1; k >= 0; k--, p++) if ((v >> k) & 1) b[p >> 3] |= 0x80 >> (p & 7); return p; };
const bitAt = (b, p) => (b[p >> 3] >> (7 - (p & 7))) & 1;
const bitsOf = (b, p, w) => { let v = 0; for (let k = 0; k < w; k++) v = v * 2 + bitAt(b, p + k); return v; };

// A row fits the schema when every field is present with a storable value; otherwise it goes generic.
function fits(r, schema) {
  if (!isPlain(r)) return false;
  for (const k of Object.keys(r)) if (!Object.hasOwn(schema, k)) return false;
  for (const k of Object.keys(schema)) {
    const s = schema[k], has = Object.hasOwn(r, k), v = r[k];
    if (s === 'flag') { if (has && v !== true) return false; continue; }
    if (!has) return false;
    if (s === 'dict') { if (typeof v !== 'string') return false; continue; }
    if (typeof v !== 'number' || Object.is(v, -0)) return false;
    if (s === 'delta' && (!Number.isSafeInteger(v) || Math.abs(v) > 2 ** 40)) return false;
    if (s === 'b4' && (!Number.isInteger(v) || v < 0 || v > 15)) return false;
  }
  return true;
}
// Integer code for v at this scale, or null when v does not come back bit-identical (then it is an exception).
function quant(v, t, scale) {
  const q = Math.round(v * scale) + 0, [, , , lo, hi] = FIXED[t];
  return q >= lo && q <= hi && Object.is(q / scale, v) ? q : null;
}
function putTable(o, rows, schema) {
  const keys = Object.keys(schema), N = rows.length, dk = keys.filter(k => schema[k] === 'dict');
  const ok = rows.map(r => fits(r, schema)), dict = new Map(dk.map(k => [k, new Map()]));
  rows.forEach((r, n) => { if (ok[n]) for (const k of dk) { const m = dict.get(k); if (!m.has(r[k])) m.set(r[k], m.size); } });
  const width = Object.fromEntries(keys.map(k => [k, schema[k] === 'dict' ? bitsFor(dict.get(k)?.size ?? 0) : schema[k] === 'b4' ? 4 : schema[k] === 'flag' ? 1 : 0]));
  const rowBits = 1 + keys.reduce((s, k) => s + width[k], 0), bits = new Uint8Array(Math.ceil(N * rowBits / 8));
  o.uint(N);
  for (const k of dk) { o.uint(dict.get(k).size); for (const s of dict.get(k).keys()) o.uint(o.str(s)); }
  let p = 0;
  rows.forEach((r, n) => {
    p = pushBits(bits, p, ok[n] ? 0 : 1, 1);
    for (const k of keys) {
      const w = width[k]; if (!w) continue;
      const v = !ok[n] ? 0 : schema[k] === 'dict' ? dict.get(k).get(r[k]) : schema[k] === 'flag' ? (r[k] === true ? 1 : 0) : r[k];
      p = pushBits(bits, p, v, w);
    }
  });
  o.bytes(bits);
  let prev = 0;
  rows.forEach((r, n) => { if (ok[n]) { o.uint(zig(r.id - prev)); prev = r.id; } else o.uint(0); });
  for (const k of keys) {
    const [t, sc] = schema[k].split(':'); if (!FIXED[t]) continue;
    const scale = sc ? +sc : 1, q = new Array(N), exc = [], map = new Uint8Array((N + 7) >> 3);
    rows.forEach((r, n) => {
      q[n] = 0; if (!ok[n]) return;
      const c = quant(r[k], t, scale);
      if (c === null) { exc.push(r[k]); map[n >> 3] |= 1 << (n & 7); } else q[n] = c;
    });
    o.uint(exc.length); if (exc.length) { o.bytes(map); for (const v of exc) o.f64(v); }
    for (let n = 0; n < N; n++) o.fixed(t, q[n]);
  }
  rows.forEach((r, n) => { if (!ok[n]) putValue(o, r); });
}
function getTable(i, S, schema) {
  const keys = Object.keys(schema), N = i.count(), dk = keys.filter(k => schema[k] === 'dict'), dicts = {};
  for (const k of dk) { const n = i.count(); dicts[k] = Array.from({ length: n }, () => str(S, i.uint())); }
  const width = Object.fromEntries(keys.map(k => [k, schema[k] === 'dict' ? bitsFor(dicts[k]?.length ?? 0) : schema[k] === 'b4' ? 4 : schema[k] === 'flag' ? 1 : 0]));
  const rowBits = 1 + keys.reduce((s, k) => s + width[k], 0), bits = i.bytes(Math.ceil(N * rowBits / 8));
  const odd = new Uint8Array(N), raw = Object.fromEntries(keys.map(k => [k, new Array(N)]));
  let p = 0;
  for (let n = 0; n < N; n++) {
    odd[n] = bitAt(bits, p++);
    for (const k of keys) { const w = width[k]; raw[k][n] = w ? bitsOf(bits, p, w) : 0; p += w; }
  }
  const ids = new Array(N); let prev = 0;
  for (let n = 0; n < N; n++) {
    const d = unzig(i.uint());
    if (!odd[n]) { prev += d; if (!Number.isSafeInteger(prev)) throw corrupt('corrupt (id out of range)'); ids[n] = prev; }
  }
  const cols = {};
  for (const k of keys) {
    const [t, sc] = schema[k].split(':'); if (!FIXED[t]) continue;
    const scale = sc ? +sc : 1, E = i.uint();
    if (E > N) throw corrupt('corrupt (too many exceptions)');
    const map = E ? i.bytes((N + 7) >> 3) : null, exc = Array.from({ length: E }, () => i.f64());
    const col = new Array(N); let e = 0;
    for (let n = 0; n < N; n++) {
      const code = i.fixed(t);
      if (map && (map[n >> 3] >> (n & 7)) & 1) { if (e >= E) throw corrupt('corrupt (exception list)'); col[n] = exc[e++]; }
      else col[n] = code / scale;
    }
    if (e !== E) throw corrupt('corrupt (exception list)');
    cols[k] = col;
  }
  const rows = new Array(N);
  for (let n = 0; n < N; n++) {
    if (odd[n]) continue;
    const o = {};
    for (const k of keys) {
      const s = schema[k];
      if (s === 'delta') o[k] = ids[n];
      else if (s === 'flag') { if (raw[k][n]) o[k] = true; }
      else if (s === 'dict') { if (raw[k][n] >= dicts[k].length) throw corrupt('corrupt (dictionary index)'); o[k] = dicts[k][raw[k][n]]; }
      else if (s === 'b4') o[k] = raw[k][n];
      else o[k] = cols[k][n];
    }
    rows[n] = o;
  }
  for (let n = 0; n < N; n++) if (odd[n]) rows[n] = getValue(i, S);
  return rows;
}

// ---- containers
function payload(fn) {
  const o = new Out(); fn(o);
  const head = new Out(); head.uint(o.list.length);
  for (const s of o.list) { const b = enc.encode(s); head.uint(b.length); head.bytes(b); }
  head.bytes(o.done());
  return head.done();
}
function unpayload(raw, fn) {
  const i = new In(raw), S = Array.from({ length: i.count() }, () => dec.decode(i.bytes(i.uint())));
  const v = fn(i, S);
  if (i.left()) throw corrupt('corrupt (section has trailing data)');
  return v;
}
function pack(sig, entries) {
  const secs = entries.map(([name, fn]) => {
    const raw = payload(fn), z = deflateSync(raw, { level: 9 }), useZ = z.length < raw.length;
    return { name: enc.encode(name), method: +useZ, body: useZ ? z : raw, rawLen: raw.length, crc: crc32(raw) };
  });
  const t = new Out();
  for (const s of secs) { t.u8(s.name.length); t.bytes(s.name); t.u8(s.method); t.fixed('u32', s.body.length); t.fixed('u32', s.rawLen); t.fixed('u32', s.crc); }
  const table = t.done(), h = new Out();
  h.bytes(enc.encode(sig)); h.u8(VERSION); h.u8(0); h.fixed('u16', secs.length); h.fixed('u32', crc32(table)); h.bytes(table);
  for (const s of secs) h.bytes(s.body);
  return h.done();
}
function unpack(bytes, sig) {
  if (bytes.length < 4) throw corrupt('truncated (shorter than the signature)');
  if (enc.encode(sig).some((c, k) => bytes[k] !== c)) throw new HeftbError(`not a ${sig} file (bad signature)`);
  const i = new In(bytes);
  i.p = 4;
  const ver = i.u8(); if (ver !== VERSION) throw new HeftbError(`${sig} format version ${ver} is not supported (this build reads ${VERSION})`);
  if (i.u8()) throw corrupt('corrupt (reserved header byte set)');
  const count = i.fixed('u16'), tcrc = i.fixed('u32');
  if (count > MAX_SECTIONS) throw corrupt('corrupt (too many sections)');
  const t0 = i.p, table = [];
  for (let k = 0; k < count; k++) {
    const nl = i.u8(); if (!nl) throw corrupt('corrupt (empty section name)');
    const name = dec.decode(i.bytes(nl)), method = i.u8(), stored = i.fixed('u32'), rawLen = i.fixed('u32'), crc = i.fixed('u32');
    table.push({ name, method, stored, rawLen, crc });
  }
  if (crc32(bytes.subarray(t0, i.p)) !== tcrc) throw corrupt('corrupt (header checksum mismatch)');
  const total = table.reduce((n, e) => n + e.stored, 0), left = bytes.length - i.p;
  if (left < total) throw corrupt(`truncated (${left} of ${total} section bytes present)`);
  if (left > total) throw corrupt('corrupt (trailing data after the last section)');
  const out = new Map(); let off = i.p;
  for (const e of table) {
    if (e.rawLen > MAX_RAW || e.method > 1) throw corrupt('corrupt (bad section header)');
    const body = bytes.subarray(off, off + e.stored); off += e.stored;
    let raw = body;
    if (e.method) { try { raw = inflateSync(body, { size: e.rawLen }); } catch { throw corrupt(`corrupt (section '${e.name}' does not decompress)`); } }
    if (raw.length !== e.rawLen || crc32(raw) !== e.crc) throw corrupt(`corrupt (section '${e.name}' failed its checksum)`);
    if (out.has(e.name)) throw corrupt(`corrupt (duplicate section '${e.name}')`);
    out.set(e.name, { raw, stored: e.stored });
  }
  return out;
}
const guard = fn => { try { return fn(); } catch (e) { throw e instanceof HeftbError ? e : new HeftbError(`file is corrupt (${e.message})`); } };
const asBytes = b => b instanceof ArrayBuffer ? new Uint8Array(b) : b;

// ---- public API
// Project = { ...meta, level?, models? }. Level tables are split out when the level has the usual arrays.
export function encodeHeftb(project, { history, extra } = {}) {
  if (!isObj(project)) throw new HeftbError('project must be an object');
  const { level, models, ...meta } = project, entries = [['meta', o => putValue(o, meta)]];
  if (Object.hasOwn(project, 'level')) {
    if (isObj(level) && Array.isArray(level.resources) && Array.isArray(level.structures)) {
      const { resources, structures, ...rest } = level;
      entries.push(['level', o => putValue(o, rest)], ['resources', o => putTable(o, resources, RES)], ['structures', o => putTable(o, structures, STRUCT)]);
    } else entries.push(['level', o => putValue(o, level)]);
  }
  if (Object.hasOwn(project, 'models')) entries.push(['models', o => putValue(o, models)]);
  if (history !== undefined) entries.push(['history', o => putValue(o, history)]);
  for (const [name, v] of Object.entries(extra ?? {})) entries.push([name, o => putValue(o, v)]);   // future sections (tests)
  return pack(SIG, entries);
}
export function decodeHeftb(bytes) {
  return guard(() => {
    const secs = unpack(asBytes(bytes), SIG), sec = (name, fn) => unpayload(secs.get(name).raw, fn), val = name => sec(name, (i, S) => getValue(i, S));
    if (!secs.has('meta')) throw corrupt("missing its 'meta' section");
    const project = val('meta');
    if (!isObj(project)) throw corrupt("malformed (bad 'meta' section)");
    const tables = secs.has('resources') || secs.has('structures');
    if (tables && !(secs.has('level') && secs.has('resources') && secs.has('structures'))) throw corrupt('incomplete (level tables without their level section)');
    if (secs.has('level')) {
      const level = val('level');
      if (tables) { level.resources = sec('resources', (i, S) => getTable(i, S, RES)); level.structures = sec('structures', (i, S) => getTable(i, S, STRUCT)); }
      project.level = level;
    }
    if (secs.has('models')) project.models = val('models');
    return { project, history: secs.has('history') ? val('history') : undefined };
  });
}
// A revision delta: the diff ops from one project state to the next (see diff.js).
export function encodeDelta(ops) { return pack(DELTA_SIG, [['ops', o => putValue(o, ops)]]); }
export function decodeDelta(bytes) {
  return guard(() => {
    const ops = unpayload(unpack(asBytes(bytes), DELTA_SIG).get('ops').raw, (i, S) => getValue(i, S));
    if (!Array.isArray(ops)) throw corrupt("malformed (delta is not a list of ops)");
    return ops;
  });
}
// Section sizes of a .heftb without decoding its contents (for the Data panel).
export function sectionSizes(bytes) {
  return guard(() => [...unpack(asBytes(bytes), SIG)].map(([name, s]) => ({ name, raw: s.raw.length, stored: s.stored })));
}
