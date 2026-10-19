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

test('marquee counts a tall item whose body crosses the box, not only its base', () => {
  // screen: x = 10 x, y = 10 z - 10 y (height rises up the screen)
  const pr = (x, z, y = 0) => [x * 10, z * 10 - y * 10];
  const tree = { id: 'tree', x: 1, z: 5, h: 2 };       // base (10, 50), top (10, 30)
  assert.deepEqual(G.idsInRect([tree], pr, G.rectOf(0, 25, 20, 35)), ['tree']);   // box holds only the top part
  assert.deepEqual(G.idsInRect([tree], pr, G.rectOf(0, 55, 20, 65)), []);         // box is below the base
  assert.deepEqual(G.idsInRect([tree], pr, G.rectOf(30, 0, 50, 60)), []);         // box is to the right
});

test('segHitsRect: endpoints inside, crossings and misses', () => {
  const rc = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(G.segHitsRect([5, 5], [50, 50], rc), true);     // start inside
  assert.equal(G.segHitsRect([-5, 5], [15, 5], rc), true);     // crosses through
  assert.equal(G.segHitsRect([-5, -5], [-1, 20], rc), false);  // passes left of the box
  assert.equal(G.segHitsRect([12, 12], [12, 12], rc), false);  // point outside
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

// Camera model matching scene3d: orbit position, look-at basis, ortho half-height dist * 0.36, persp half-fov tan 17.5 deg.
const TANH = Math.tan(17.5 * Math.PI / 180), ORTHO_H = 0.36;
function screenOf(P, cam, persp, W, H) {
  const C = G.orbitPos(cam.t, cam.yaw, cam.el, cam.dist), sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = sub(cam.t, C), fl = Math.hypot(...f), fn = f.map(v => v / fl);
  const up = [0, 1, 0], rr = [fn[1] * up[2] - fn[2] * up[1], fn[2] * up[0] - fn[0] * up[2], fn[0] * up[1] - fn[1] * up[0]], rl = Math.hypot(...rr), r = rr.map(v => v / rl);
  const u = [r[1] * fn[2] - r[2] * fn[1], r[2] * fn[0] - r[0] * fn[2], r[0] * fn[1] - r[1] * fn[0]];
  const d = sub(P, C), x = dot(d, r), y = dot(d, u), z = dot(d, fn);
  if (!persp) return [W / 2 + x / (cam.dist * ORTHO_H) * H / 2, H / 2 - y / (cam.dist * ORTHO_H) * H / 2];
  return [W / 2 + x / (z * TANH) * H / 2, H / 2 - y / (z * TANH) * H / 2];
}

test('zoom toward the cursor keeps the ground point under it within 2 px (ortho and persp)', () => {
  const W = 1200, H = 800;
  for (const persp of [false, true]) {
    for (const k of [0.5, 0.8, 1.6, 2.5]) {
      const cam = { t: [4, 0.5, -3], yaw: Math.PI / 4, el: 0.64, dist: 150 };
      const P = [10, 0, 7];                                  // ground point under the cursor
      const before = screenOf(P, cam, persp, W, H);
      const t2 = G.dollyTarget(cam.t, P, k), after = screenOf(P, { t: t2, yaw: cam.yaw, el: cam.el, dist: cam.dist * k }, persp, W, H);
      assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 2, `persp=${persp} k=${k} ${before} -> ${after}`);
      // without the target shift the point must move, otherwise the check above proves nothing
      const drift = screenOf(P, { t: cam.t, yaw: cam.yaw, el: cam.el, dist: cam.dist * k }, persp, W, H);
      assert.ok(Math.hypot(drift[0] - before[0], drift[1] - before[1]) > 10, `persp=${persp} k=${k} unshifted drift too small`);
    }
  }
});

test('groundHit intersects y = 0 and dollyTarget scales the target about P', () => {
  const p = G.groundHit([0, 10, 0], [0, -1, 0]);
  near(p[0], 0); near(p[1], 0); near(p[2], 0);
  const q = G.groundHit([-4, 5, 2], [1, -0.5, 0]);
  near(q[0], 6); near(q[2], 2);
  const t = G.dollyTarget([2, 0.5, 2], [0, 0, 0], 2);
  near(t[0], 4); near(t[1], 1); near(t[2], 4);
});

test('gizmoHit: move arrows constrain, centre square is free, scale has axis and uniform handles', () => {
  const pv = { x: 10, z: 5, R: 3 }, m = 0.1;   // 10 px per metre-tenth: 1 px = 0.1 m
  assert.equal(G.gizmoHit('move', pv, 10, 5, m), 'xz');
  assert.equal(G.gizmoHit('move', pv, 10 + 3, 5 + 0.2, m), 'x');     // along +X, 0.2 m off the axis (2 px) is inside the tolerance
  assert.equal(G.gizmoHit('move', pv, 10 + 2, 5 + 4, m), null);       // nowhere near an arm
  assert.equal(G.gizmoHit('move', pv, 10 + 0.3, 5 + 4, m), 'z');
  assert.equal(G.gizmoHit('move', pv, 10 - 3, 5, m), null);           // arms only point positive
  assert.equal(G.gizmoHit('scale', pv, 10 + 3, 5, m), 'sx');
  assert.equal(G.gizmoHit('scale', pv, 10, 5 + 3, m), 'sz');
  assert.equal(G.gizmoHit('scale', pv, 10 + 3 * 0.7071, 5 + 3 * 0.7071, m), 'u');
  assert.equal(G.gizmoHit('scale', pv, 10, 5, m), null);
  assert.equal(G.gizmoHit('rotate', pv, 10 + 3, 5, m), 'rot');
  assert.equal(G.gizmoHit('translate', pv, 10 + 3, 5, m), null);
});

test('xformed spread scales positions about the pivot per axis, leaving sizes alone', () => {
  const st = { x: 12, z: 3, rot: 0, s: 1.25 };
  const out = G.xformed(st, { kind: 'spread', px: 10, pz: 5, fx: 2, fz: 1 });
  assert.equal(out.x, 14); assert.equal(out.z, 3);
  assert.equal(out.s, undefined);
});

test('gridAlphas: each floor grid fades in at 6 px cells and out at 48 px, and stays within 0..1', () => {
  for (let ppm = 0.05; ppm <= 400; ppm *= 1.07) {
    const a = G.gridAlphas(ppm);
    for (const v of [a.a1, a.a5, a.a25]) assert.ok(v >= 0 && v <= 1, `ppm=${ppm} ${JSON.stringify(a)}`);
  }
  const far = G.gridAlphas(1), mid = G.gridAlphas(3), close = G.gridAlphas(12), very = G.gridAlphas(60);
  near(far.a1, 0); near(far.a5, 0); near(far.a25, 1);   // zoomed out: only the 25 m grid
  near(mid.a1, 0); near(mid.a5, 1);                       // 5 m cells are 15 px
  assert.ok(close.a1 > 0.5 && close.a1 < 1);              // 1 m cells at 12 px: partly faded in
  near(very.a25, 0); near(very.a5, 0); near(very.a1, 1); // close up: only 1 m grid
});
