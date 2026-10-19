import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/viewport/geom.js';
import { fallbackGeometry } from '../src/viewport/fallback.js';
import { WOOD_PILE, STONE_PILE } from '../src/core/heft-data.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('view2 round trip and zoomAt keeps the cursor point fixed', () => {
  const v = G.view2(3, -2, 10, 400, 300);
  const [x, z] = v.toWorld(120, 40), [sx, sy] = v.toScreen(x, z);
  near(sx, 120); near(sy, 40);
  const z2 = G.zoomAt(v, 120, 40, 2), v2 = G.view2(z2.cx, z2.cz, z2.scale, 400, 300);
  const [sx2, sy2] = v2.toScreen(x, z);
  near(sx2, 120); near(sy2, 40); near(z2.scale, 20);
});

test('pickAt uses footprint plus pad', () => {
  const items = [{ id: 'a', x: 0, z: 0, r: 1 }, { id: 'b', x: 3, z: 0, r: 1 }];
  assert.equal(G.pickAt(items, 0.5, 0), 'a');
  assert.equal(G.pickAt(items, -1.3, 0), null);
  assert.equal(G.pickAt(items, -1.3, 0, 0.5), 'a');
});

test('rayCylinder hits the side, misses above the top, and pickRay takes the nearest', () => {
  near(G.rayCylinder([-5, 1, 0], [1, 0, 0], 0, 0, 1, 2), 4);
  assert.equal(G.rayCylinder([-5, 3, 0], [1, 0, 0], 0, 0, 1, 2), Infinity);
  assert.equal(G.rayCylinder([0, 5, 0], [0, -1, 0], 0, 0, 1, 2), Infinity);
  const items = [{ id: 'far', x: 4, z: 0, r: 1, h: 2 }, { id: 'near', x: 0, z: 0, r: 1, h: 2 }];
  assert.equal(G.pickRay(items, [-5, 1, 0], [1, 0, 0]), 'near');
});

test('idsInRect and rectOf normalise corners', () => {
  const rc = G.rectOf(50, 40, 10, 5);
  assert.deepEqual(rc, { x: 10, y: 5, w: 40, h: 35 });
  const items = [{ id: 'in', x: 1, z: 1 }, { id: 'out', x: 9, z: 9 }];
  assert.deepEqual(G.idsInRect(items, (x, z) => [x * 10, z * 10], G.rectOf(0, 0, 20, 20)), ['in']);
});

test('applySelection set, add and toggle', () => {
  assert.deepEqual(G.applySelection(['a'], ['b', 'b'], 'set'), ['b']);
  assert.deepEqual(G.applySelection(['a'], ['b'], 'add'), ['a', 'b']);
  assert.deepEqual(G.applySelection(['a', 'b'], ['b', 'c'], 'toggle'), ['a', 'c']);
  assert.equal(G.modeOf({ ctrlKey: true }), 'toggle');
  assert.equal(G.modeOf({ shiftKey: true }), 'add');
});

test('snapping keeps the group anchor on the grid', () => {
  assert.equal(G.snapTo(1.26, 0.5), 1.5);
  assert.equal(G.snapTo(1.26, 0), 1.26);
  const anchor = { x: 1.2, z: 0 };
  const d = G.moveDelta(anchor, { dx: 0.1, dz: 0.3 }, true, 0.5);
  near(anchor.x + d.dx, 1.5); near(anchor.z + d.dz, 0.5);
  assert.deepEqual(G.moveDelta(anchor, { dx: 0.1, dz: 0.3 }, false, 0.5), { dx: 0.1, dz: 0.3 });
});

test('rotY matches three.js rotation.y and sweepRot makes the point follow the cursor', () => {
  const [x, z] = G.rotY(1, 0, Math.PI / 2);
  near(x, 0); near(z, -1);
  const a0 = 0.3, a1 = 0.7, t = G.sweepRot(a0, a1);
  const [rx, rz] = G.rotY(Math.cos(a0), Math.sin(a0), t);
  near(G.wrapAngle(Math.atan2(rz, rx) - a1), 0);
});

test('scaleFactor takes the axis that changed most', () => {
  near(G.scaleFactor([2, 2, 2], [1, 1, 1]), 2);
  near(G.scaleFactor([1, 2, 1], [1, 1, 1]), 2);
  near(G.scaleFactor([0.5, 1, 1], [1, 1, 1]), 0.5);
});

test('xformed applies move, rotate about a pivot and clamped scale', () => {
  assert.deepEqual(G.xformed({ x: 1, z: 2 }, { kind: 'move', dx: 0.5, dz: -1 }), { x: 1.5, z: 1 });
  const r = G.xformed({ x: 2, z: 0, rot: 0 }, { kind: 'rotate', px: 0, pz: 0, t: Math.PI / 2 });
  near(r.x, 0, 1e-2); near(r.z, -2, 1e-2); near(r.rot, Math.PI / 2, 1e-2);
  near(G.xformed({ x: 0, z: 0, s: 1 }, { kind: 'scale', f: 1.2, snap: true }).s, 1.2);
  assert.equal(G.xformed({ x: 0, z: 0, s: 1 }, { kind: 'scale', f: 3, snap: false }).s, 2);
  assert.deepEqual(G.xformed({ x: 0, z: 0 }, { kind: 'scale', f: 2, snap: false }), {});
});

test('orbitPos: iso is symmetric in x and z, top is straight up', () => {
  const [x, y, z] = G.orbitPos([0, 0, 0], Math.PI / 4, 0.64, 10);
  near(x, z); assert.ok(x > 0 && y > 0);
  near(y, Math.sin(0.64) * 10);
  const [tx, ty, tz] = G.orbitPos([0, 0, 0], 0, Math.PI / 2, 10);
  near(tx, 0); near(ty, 10); near(tz, 0, 1e-9);
});

test('territoryField: centre inside the claim, far cells zero', () => {
  const f = G.territoryField([{ x: 0, z: 0, r: 8 }], 64, 100);
  assert.ok(f[32 * 64 + 32] > 200);
  assert.equal(f[0], 0);
  assert.equal(f.length, 64 * 64);
});

test('pileSlot: stacks layers upward and keeps slots apart', () => {
  const wood = Array.from({ length: 12 }, (_, i) => G.pileSlot('wood', i));
  assert.equal(G.pileSlot('wood', 0).y, 0.18);
  near(G.pileSlot('wood', 6).y, 0.42);
  assert.equal(new Set(wood.slice(0, 6).map(p => p.x.toFixed(3) + ',' + p.z.toFixed(3))).size, 6);
  for (const p of wood) assert.ok(Math.hypot(p.x - WOOD_PILE.x, p.z - WOOD_PILE.z) < 1.5);
  const stone = Array.from({ length: 24 }, (_, i) => G.pileSlot('stone', i));
  near(G.pileSlot('stone', 12).y, 0.5);
  for (const p of stone) assert.ok(Math.hypot(p.x - STONE_PILE.x, p.z - STONE_PILE.z) < 1.5);
});

test('fallback geometry exists for every key the scene asks for', () => {
  for (const k of ['tree.0', 'tree.1', 'tree.2', 'rock.0', 'rock.1', 'stump', 'rubble', 'campfire', 'wall', 'workbench', 'player']) {
    const g = fallbackGeometry(k);
    assert.ok(g.attributes.position.count > 0, k);
    assert.ok(g.attributes.normal, k);
  }
});
