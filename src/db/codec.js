// Heft binary project format (.heftb) and revision deltas. Pure JS: runs in Node and the browser.
// Container: "HEFB" | u8 version | u8 reserved | u16 sections | u32 crc32(table) | table | section bodies.
//   table entry: u8 nameLen | name | u8 method (0 stored, 1 deflate) | u32 stored | u32 raw | u32 crc32(raw) | u32 crc32(stored)
// Section raw bytes: varint nStrings | strings (varint len, utf8) | value stream.
// Level tables (RES, STRUCT) are columnar. Each integer column has its own offset and bit width, and a value that is
// not on the column's grid is an exception: a sparse list of decimal-or-float64 values, marked by the column's escape code.
// Anything that cannot be stored exactly is rejected or takes the generic encoding, so nothing is clipped or rounded.
// Unknown section names are CRC-checked and skipped, so newer builds can add sections.
import { deflateSync, Inflate } from 'fflate';

export class HeftbError extends Error { constructor(msg) { super(msg); this.name = 'HeftbError'; } }
const SIG = 'HEFB', DELTA_SIG = 'HEFD', VERSION = 1;
const MAX_RAW = 64 << 20;      // decoded bytes per file
const MAX_ROWS = 1 << 18;      // shortcut: 262k rows per level table, raise it if levels grow past this
const MAX_NODES = 1 << 23;     // decoded containers and table rows per file (bounds JS allocations)
const MAX_RATIO = 1032;        // deflate cannot expand more than this
const MAX_SECTIONS = 32;
// Schema: 'delta' (ids, zigzag deltas), 'dict' (string), 'flag' (true or absent), 'q<scale>' (number on a 1/scale grid).
const RES = { id: 'delta', kind: 'dict', v: 'q1', x: 'q100', z: 'q100', rot: 'q1000', s: 'q1000', hp: 'q1', max: 'q1', regrowAt: 'q100', removed: 'flag' };
const STRUCT = { id: 'delta', type: 'dict', x: 'q100', z: 'q100', rot: 'q1000' };
const TAG = { NULL: 0, FALSE: 1, TRUE: 2, UNDEF: 3, UINT: 4, NINT: 5, F64: 6, STR: 7, ARR: 8, OBJ: 9 };
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const corrupt = (why = 'corrupt') => new HeftbError(`file is ${why}`);
const LONE = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;   // unpaired UTF-16 surrogate
const P2 = Array.from({ length: 54 }, (_, k) => 2 ** k);

const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

class Out {
  buf = new Uint8Array(1024); n = 0; dv = new DataView(this.buf.buffer); strs = new Map(); list = [];
  room(k) { if (this.n + k > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k)); b.set(this.buf.subarray(0, this.n)); this.buf = b; this.dv = new DataView(b.buffer); } }
  u8(v) { this.room(1); this.buf[this.n++] = v; }
  u16(v) { this.room(2); this.dv.setUint16(this.n, v, true); this.n += 2; }
  u32(v) { this.room(4); this.dv.setUint32(this.n, v, true); this.n += 4; }
  f64(v) { this.room(8); this.dv.setFloat64(this.n, v, true); this.n += 8; }
  uint(v) { this.room(8); while (v >= 128) { this.buf[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); } this.buf[this.n++] = v; }
  bytes(a) { this.room(a.length); this.buf.set(a, this.n); this.n += a.length; }
  str(s) { let i = this.strs.get(s); if (i === undefined) { i = this.list.length; this.strs.set(s, i); this.list.push(s); } return i; }
  done() { return this.buf.slice(0, this.n); }
}

class In {
  constructor(b, budget) { this.b = b; this.budget = budget; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.p = 0; }
  need(k) { if (k > this.b.length - this.p) throw corrupt('truncated (unexpected end of data)'); }
  take(k) { if ((this.budget.n -= k) < 0) throw corrupt(`corrupt (more than ${MAX_NODES} values)`); }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  uint() { let v = 0, m = 1; for (let k = 0; k < 8; k++) { const b = this.u8(); v += (b & 127) * m; if (b < 128) { if (v > Number.MAX_SAFE_INTEGER) break; return v; } m *= 128; } throw corrupt('corrupt (bad integer)'); }
  bytes(k) { this.need(k); const v = this.b.subarray(this.p, this.p + k); this.p += k; return v; }
  count() { const n = this.uint(); if (n > this.b.length - this.p) throw corrupt('corrupt (length exceeds data)'); return n; }
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
  else if (Array.isArray(v)) {
    if (Object.keys(v).length !== v.length) throw new HeftbError('cannot store a sparse array (holes or extra properties); fill it with null first');
    o.u8(TAG.ARR); o.uint(v.length); for (const x of v) putValue(o, x, d + 1);
  }
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
    case TAG.ARR: { const n = i.count(); i.take(n); const a = new Array(n); for (let k = 0; k < n; k++) a[k] = getValue(i, S, d + 1); return a; }
    case TAG.OBJ: { const n = i.count(); i.take(n); const o = {}; for (let k = 0; k < n; k++) { const key = str(S, i.uint()); put(o, key, getValue(i, S, d + 1)); } return o; }
    default: throw corrupt('corrupt (unknown value tag)');
  }
}

// ---- numbers that are off the column grid: decimal (m / 10^k reproduces v exactly) or raw float64
function putNum(o, v) {
  for (let k = 0; k < 16; k++) {
    const m = Math.round(v * 10 ** k);
    if (Math.abs(m) < 2 ** 50 && !Object.is(m, -0) && Object.is(m / 10 ** k, v)) { o.uint(k + 1); o.uint(zig(m)); return; }
  }
  o.uint(0); o.f64(v);
}
function getNum(i) {
  const k = i.uint();
  if (k === 0) return i.f64();
  if (k > 16) throw corrupt('corrupt (bad decimal exponent)');
  return unzig(i.uint()) / 10 ** (k - 1);
}

// ---- columnar tables
const bitsFor = n => { let b = 0; while (2 ** b < n) b++; return b; };
const zig = d => d >= 0 ? 2 * d : -2 * d - 1;
const unzig = z => z % 2 ? -(z + 1) / 2 : z / 2;
const pushBits = (b, p, v, w) => { for (let k = w - 1; k >= 0; k--, p++) if (Math.floor(v / P2[k]) % 2) b[p >> 3] |= 0x80 >> (p & 7); return p; };
const bitAt = (b, p) => (b[p >> 3] >> (7 - (p & 7))) & 1;
const bitsOf = (b, p, w) => { let v = 0; for (let k = 0; k < w; k++) v = v * 2 + bitAt(b, p + k); return v; };
const scaleOf = s => s.startsWith('q') ? +s.slice(1) : 1;

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
  }
  return true;
}
// Integer code for v on the scale grid, or null when v does not come back bit-identical (then it is an exception).
function quant(v, scale) {
  const q = Math.round(v * scale) + 0;
  return Math.abs(q) < 2 ** 50 && Object.is(q / scale, v) ? q : null;
}
// One integer column. vals[n]: an integer, null (an exception: its value is next in exc), or undefined (row not here).
// Stores offset lo and width w, so a column costs about its range in bits, not 16 per row. minW forces at least 1 bit.
function putCol(o, vals, exc, minW = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (typeof v === 'number') { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo > hi) lo = hi = 0;
  const esc = exc.length > 0, w = Math.max(minW, bitsFor(hi - lo + (esc ? 2 : 1)));
  o.u8(w); o.uint(zig(lo));
  o.uint(exc.length); for (const v of exc) putNum(o, v);
  const bits = new Uint8Array(Math.ceil(vals.length * w / 8));
  let p = 0;
  for (const v of vals) p = pushBits(bits, p, typeof v === 'number' ? v - lo : v === null ? 2 ** w - 1 : 0, w);
  o.bytes(bits);
}
function getCol(i, N, scale) {
  const w = i.u8(), lo = unzig(i.uint());
  if (w > 52) throw corrupt('corrupt (column width)');
  const E = i.count();
  if (E > N) throw corrupt('corrupt (too many exceptions)');
  const exc = Array.from({ length: E }, () => getNum(i));
  const bits = i.bytes(Math.ceil(N * w / 8)), esc = E ? 2 ** w - 1 : -1;
  const out = new Array(N);
  let p = 0, e = 0;
  for (let n = 0; n < N; n++, p += w) {
    const c = bitsOf(bits, p, w);
    if (c === esc) { if (e >= E) throw corrupt('corrupt (exception list)'); out[n] = exc[e++]; }
    else out[n] = (c + lo) / scale;
  }
  if (e !== E) throw corrupt('corrupt (exception list)');
  return out;
}
function putTable(o, rows, schema) {
  const keys = Object.keys(schema), N = rows.length, ok = rows.map(r => fits(r, schema)), dict = {};
  o.uint(N);
  for (const k of keys) {
    if (schema[k] !== 'dict') continue;
    const m = new Map(); rows.forEach((r, n) => { if (ok[n] && !m.has(r[k])) m.set(r[k], m.size); });
    dict[k] = m; o.uint(m.size); for (const s of m.keys()) o.uint(o.str(s));
  }
  const odd = ok.map(v => !v), anyOdd = odd.includes(true);
  o.u8(+anyOdd);
  if (anyOdd) { const bm = new Uint8Array((N + 7) >> 3); odd.forEach((v, n) => { if (v) bm[n >> 3] |= 1 << (n & 7); }); o.bytes(bm); }
  for (const k of keys) {
    const s = schema[k], exc = [];
    let prev = 0;
    const vals = rows.map((r, n) => {
      if (!ok[n]) return undefined;
      if (s === 'delta') { const z = zig(r.id - prev); prev = r.id; return z; }
      if (s === 'dict') return dict[k].get(r[k]);
      if (s === 'flag') return r[k] === true ? 1 : 0;
      const q = quant(r[k], scaleOf(s));
      if (q === null) exc.push(r[k]);
      return q;
    });
    putCol(o, vals, exc, s === 'delta' ? 1 : 0);
  }
  rows.forEach((r, n) => { if (!ok[n]) putValue(o, r); });
}
function getTable(i, S, schema) {
  const keys = Object.keys(schema), N = i.uint();
  if (N > MAX_ROWS) throw corrupt(`corrupt (${N} rows, the limit is ${MAX_ROWS})`);
  i.take(N * keys.length);
  const dicts = {};
  for (const k of keys) if (schema[k] === 'dict') dicts[k] = Array.from({ length: i.count() }, () => str(S, i.uint()));
  const hasOdd = i.u8();
  if (hasOdd > 1) throw corrupt('corrupt (row flags)');
  const oddBits = hasOdd ? i.bytes((N + 7) >> 3) : null;
  const isOdd = n => oddBits !== null && ((oddBits[n >> 3] >> (n & 7)) & 1) === 1;
  const cols = {};
  for (const k of keys) cols[k] = getCol(i, N, scaleOf(schema[k]));
  const idKey = keys.find(k => schema[k] === 'delta');
  const rows = new Array(N);
  let prev = 0;
  for (let n = 0; n < N; n++) {
    if (isOdd(n)) continue;
    prev += unzig(cols[idKey][n]);
    if (!Number.isSafeInteger(prev)) throw corrupt('corrupt (id out of range)');
    const o = {};
    for (const k of keys) {
      const s = schema[k];
      if (s === 'delta') o[k] = prev;
      else if (s === 'flag') { if (cols[k][n]) o[k] = true; }
      else if (s === 'dict') { const c = cols[k][n], d = dicts[k]; if (!(c >= 0 && c < d.length)) throw corrupt('corrupt (dictionary index)'); o[k] = d[c]; }
      else o[k] = cols[k][n];
    }
    rows[n] = o;
  }
  for (let n = 0; n < N; n++) if (isOdd(n)) rows[n] = getValue(i, S);
  return rows;
}

// ---- containers
function payload(fn) {
  const o = new Out(); fn(o);
  const head = new Out(); head.uint(o.list.length);
  for (const s of o.list) {
    if (LONE.test(s)) throw new HeftbError(`cannot store text with an unpaired surrogate (${JSON.stringify(s.slice(0, 40))}); fix it before saving`);
    const b = enc.encode(s); head.uint(b.length); head.bytes(b);
  }
  head.bytes(o.done());
  return head.done();
}
function unpayload(raw, fn, budget) {
  const i = new In(raw, budget), S = Array.from({ length: i.count() }, () => dec.decode(i.bytes(i.uint())));
  const v = fn(i, S);
  if (i.p !== raw.length) throw corrupt('corrupt (section has trailing data)');
  return v;
}
function pack(sig, entries) {
  const secs = entries.map(([name, fn]) => {
    const raw = payload(fn), z = deflateSync(raw, { level: 9 }), useZ = z.length < raw.length, body = useZ ? z : raw;
    return { name: enc.encode(name), method: +useZ, body, rawLen: raw.length, crc: crc32(raw), bcrc: crc32(body) };
  });
  const t = new Out();
  for (const s of secs) { t.u8(s.name.length); t.bytes(s.name); t.u8(s.method); t.u32(s.body.length); t.u32(s.rawLen); t.u32(s.crc); t.u32(s.bcrc); }
  const table = t.done(), h = new Out();
  h.bytes(enc.encode(sig)); h.u8(VERSION); h.u8(0); h.u16(secs.length); h.u32(crc32(table)); h.bytes(table);
  for (const s of secs) h.bytes(s.body);
  return h.done();
}
// Inflates with a hard output cap: fflate emits at most ~264 KB per 256-byte input slice, so the cap aborts early.
function inflateCapped(body, rawLen, name) {
  const out = new Uint8Array(rawLen), bad = () => corrupt(`corrupt (section '${name}' does not decompress to its declared size)`);
  let n = 0;
  const inf = new Inflate(chunk => { if (n + chunk.length > rawLen) throw bad(); out.set(chunk, n); n += chunk.length; });
  try {
    let end = 0;
    do { end += 256; inf.push(body.subarray(end - 256, end), end >= body.length); } while (end < body.length);
  } catch { throw bad(); }
  if (n !== rawLen) throw bad();
  return out;
}
function unpack(bytes, sig) {
  if (bytes.length < 4) throw corrupt('truncated (shorter than the signature)');
  if (enc.encode(sig).some((c, k) => bytes[k] !== c)) throw new HeftbError(`not a ${sig} file (bad signature)`);
  const i = new In(bytes, { n: 0 });
  i.p = 4;
  const ver = i.u8(); if (ver !== VERSION) throw new HeftbError(`${sig} format version ${ver} is not supported (this build reads ${VERSION})`);
  if (i.u8()) throw corrupt('corrupt (reserved header byte set)');
  const count = i.u16(), tcrc = i.u32();
  if (count > MAX_SECTIONS) throw corrupt('corrupt (too many sections)');
  const t0 = i.p, table = [];
  for (let k = 0; k < count; k++) {
    const nl = i.u8(); if (!nl) throw corrupt('corrupt (empty section name)');
    const name = dec.decode(i.bytes(nl)), method = i.u8(), stored = i.u32(), rawLen = i.u32(), crc = i.u32(), bcrc = i.u32();
    table.push({ name, method, stored, rawLen, crc, bcrc });
  }
  if (crc32(bytes.subarray(t0, i.p)) !== tcrc) throw corrupt('corrupt (header checksum mismatch)');
  const total = table.reduce((n, e) => n + e.stored, 0), left = bytes.length - i.p;
  if (left < total) throw corrupt(`truncated (${left} of ${total} section bytes present)`);
  if (left > total) throw corrupt('corrupt (trailing data after the last section)');
  const out = new Map(); let off = i.p, decoded = 0;
  for (const e of table) {
    if (e.method > 1) throw corrupt('corrupt (bad section header)');
    if (e.method === 0 ? e.rawLen !== e.stored : e.rawLen > e.stored * MAX_RATIO + 1024) throw corrupt(`corrupt (section '${e.name}' declares an impossible size)`);
    if ((decoded += e.rawLen) > MAX_RAW) throw corrupt(`corrupt (decoded size exceeds ${MAX_RAW >> 20} MiB)`);
    const body = bytes.subarray(off, off + e.stored); off += e.stored;
    if (crc32(body) !== e.bcrc) throw corrupt(`corrupt (section '${e.name}' failed its checksum)`);
    const raw = e.method ? inflateCapped(body, e.rawLen, e.name) : body;
    if (crc32(raw) !== e.crc) throw corrupt(`corrupt (section '${e.name}' failed its checksum)`);
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
    const secs = unpack(asBytes(bytes), SIG), budget = { n: MAX_NODES };
    const sec = (name, fn) => unpayload(secs.get(name).raw, fn, budget), val = name => sec(name, (i, S) => getValue(i, S));
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
    const ops = unpayload(unpack(asBytes(bytes), DELTA_SIG).get('ops').raw, (i, S) => getValue(i, S), { n: MAX_NODES });
    if (!Array.isArray(ops)) throw corrupt("malformed (delta is not a list of ops)");
    return ops;
  });
}
// Section sizes of a .heftb without decoding its contents (for the Data panel).
export function sectionSizes(bytes) {
  return guard(() => [...unpack(asBytes(bytes), SIG)].map(([name, s]) => ({ name, raw: s.raw.length, stored: s.stored })));
}
