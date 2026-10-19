// Vertex tools, pure and DOM-free: whether a vertex is visible from the camera (picking, box select) and where a gizmo
// move sends a weld (translate, rotate or scale about the selection centre).
import * as THREE from 'three';

// A vertex is visible when the first mesh hit on the ray from the camera reaches it. Orthographic rays come from far
// behind the vertex along the view direction.
export function visibleFrom(cam, meshes, v) {
  const ortho = cam.isOrthographicCamera;
  const dir = ortho ? cam.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3().subVectors(v, cam.position);
  const dv = ortho ? 1e3 : dir.length();
  const origin = ortho ? v.clone().addScaledVector(dir, -dv) : cam.position.clone();
  const hit = new THREE.Raycaster(origin, dir.normalize(), 0, dv + 1).intersectObjects(meshes, false)[0];
  return !hit || hit.distance > dv - 1e-4 * dv;
}

// rel: the gizmo's change since the drag started. t: translation, q: rotation, s: scale factors.
export function transformPoint(mode, p, c0, rel) {
  if (mode === 'rotate') return p.clone().sub(c0).applyQuaternion(rel.q).add(c0);
  if (mode === 'scale') return p.clone().sub(c0).multiply(rel.s).add(c0);
  return p.clone().add(rel.t);
}
