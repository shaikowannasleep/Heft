// Vertex visibility (picking, box select) and the gizmo's point transform, as pure maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { visibleFrom, transformPoint } from '../src/modeling/pick.js';

const block = (x, y, z, s) => { const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s)); m.position.set(x, y, z); m.updateMatrixWorld(); return m; };
const camera = (c) => { c.position.set(0, 0, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(); return c; };
const cams = () => [camera(new THREE.PerspectiveCamera(35, 1, 0.1, 100)), camera(new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100))];

test('visibleFrom: the front face is seen and the face behind it is hidden, for both projections', () => {
  for (const cam of cams()) {
    const cube = [block(0, 0, 0, 2)];
    assert.equal(visibleFrom(cam, cube, new THREE.Vector3(0.5, 0.5, 1)), true, cam.type);
    assert.equal(visibleFrom(cam, cube, new THREE.Vector3(0.5, 0.5, -1)), false, cam.type);
  }
});

test('visibleFrom: a closer mesh occludes a vertex behind it', () => {
  for (const cam of cams()) {
    const meshes = [block(0, 0, 0, 2), block(0, 0, 4, 0.5)];   // the small block sits between camera and front face
    assert.equal(visibleFrom(cam, meshes, new THREE.Vector3(0, 0, 1)), false, cam.type);
    assert.equal(visibleFrom(cam, meshes, new THREE.Vector3(0.9, 0.9, 1)), true, cam.type);
  }
});

test('transformPoint: translate, rotate about the pivot, scale about the pivot', () => {
  const c0 = new THREE.Vector3(1, 1, 0), p = new THREE.Vector3(2, 1, 0);
  assert.deepEqual(transformPoint('translate', p, c0, { t: new THREE.Vector3(0, 1, 0) }).toArray(), [2, 2, 0]);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const r = transformPoint('rotate', p, c0, { q });
  assert.ok(r.distanceTo(new THREE.Vector3(1, 2, 0)) < 1e-9, r.toArray().join());
  const s = transformPoint('scale', p, c0, { s: new THREE.Vector3(2, 3, 1) });
  assert.deepEqual(s.toArray(), [3, 1, 0]);
  assert.deepEqual(c0.toArray(), [1, 1, 0], 'pivot untouched');
});
