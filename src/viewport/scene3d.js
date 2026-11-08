// Scene 3D: WebGL view of the island with the game's lighting, instanced objects and a TransformControls gizmo.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { h } from '../core/dom.js';
import { SPAN, CAMP_R, DEPOSIT_R, PILE_MAX } from '../core/heft-data.js';
import { sceneItems, pickRay, idsInRect, rectOf, boundsOf, orbitPos, territoryField, pileSlot, scaleFactor, clamp, groundHit, dollyTarget, gridAlphas } from './geom.js';
import { fallbackGeometry, structureGroup, buildGround, MAT } from './fallback.js';
import { tbtn, popover, viewMenu, closePopover, moreButton } from './ui.js';

const RAD = Math.PI / 180, TANH = Math.tan(17.5 * RAD), ORTHO_H = 0.36;   // half-height per metre of distance (ortho) / half-fov tangent (persp)
const PRESET = {
  top: { yaw: 0, el: Math.PI / 2 - 0.0005, persp: false },
  iso: { yaw: Math.PI / 4, el: 0.64, persp: false },   // the game's camera
  persp: { yaw: Math.PI / 4, el: 0.64, persp: true },
};
const MODE = { move: 'translate', rotate: 'rotate', scale: 'scale' };
// Handles each tool shows: move = X, Z and the XZ plane (no Y); rotate = Y ring only; scale = XZ plane and uniform XYZ.
const KEEP = { translate: ['X', 'Z', 'XZ', 'START', 'END', 'DELTA'], rotate: ['Y'], scale: ['XZ', 'XYZ'] };
const AXIS_COL = ['#e2504c', '#7bd148', '#4b8cf5'];
const gone = o => o.removed || !(o.hp > 0);
const resKey = o => gone(o) ? (o.kind === 'tree' ? 'stump' : 'rubble') : o.kind + '.' + o.v;

export function scene3d(sh) {
  const { ctx } = sh, { store, data } = ctx;
  const ac = new AbortController(), L = { signal: ac.signal };   // every DOM listener of this view goes through this signal
  let disposed = false;
  const wrap = h('div', { class: 'vp-view' });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;   // redrawn only when the scene changes
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
  const cvs = renderer.domElement; cvs.className = 'vp-canvas';
  const axisCv = h('canvas', { class: 'vp-axis' });
  const marq = h('div', { class: 'vp-marq', hidden: true });
  const readout = h('div', { class: 'vp-read' });
  wrap.append(cvs, axisCv, marq, readout);
  const ax = axisCv.getContext('2d');

  // ---------------------------------------------------------------- scene, lights (game values at dayTime 0.08)
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xa9d3e6);
  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x6a5a3c, 1.0);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.castShadow = true; sun.position.set(22, 40, 14);   // fixed over the island, so shadows do not move with the camera
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 300 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);
  const fire = [0, 1].map(() => { const l = new THREE.PointLight(0xff8a3a, 0, 15, 1.4); scene.add(l); return l; });
  const fog = new THREE.Fog(0xc9dde0, 150, 390);

  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 900), persp = new THREE.PerspectiveCamera(35, 1, 0.5, 900);
  const cam = { tx: 0, ty: 0.5, tz: 0, yaw: PRESET.iso.yaw, el: PRESET.iso.el, dist: 150, persp: false };
  let cur = ortho, preset = 'iso', W = 0, H = 0, projDirty = true, selDirty = true, drag3 = null, gid = 0, wire = false;
  let needDraw = true, shadowDirty = true, lastDraw = 0, lastKey = '';
  const IDLE_MS = 250;   // with View > Animate water and fire on, redraw this often while nothing changes (off by default: idle costs no GPU frames)

  // ---------------------------------------------------------------- ground, water, territory (shared with the fallback module)
  const territory = new THREE.DataTexture(territoryField([], 256, SPAN), 256, 256, THREE.RedFormat, THREE.UnsignedByteType);
  territory.minFilter = territory.magFilter = THREE.LinearFilter; territory.needsUpdate = true;
  const ground = buildGround(territory); scene.add(ground.root);
  // 1, 5 and 25 m floor grids; gridAlphas() decides how much of each one shows at the current zoom.
  const floors = [[1, 0.1], [5, 0.16], [25, 0.22]].map(([step, op]) => {
    const g = new THREE.GridHelper(SPAN, SPAN / step, 0x000000, 0x000000);
    g.material.transparent = true; g.material.opacity = 0; g.material.depthWrite = false; g.position.y = 0.06; scene.add(g);
    return { g, op };
  });
  let territorySig = '';

  // ---------------------------------------------------------------- geometry lookup: bag.models wins, fallback otherwise
  const geoCache = new Map();
  function geomOf(key) {
    const M = ctx.bag.models, has = (M?.keys?.() ?? []).includes(key), rv = has ? M.rev?.(key) : 0, c = geoCache.get(key);
    if (c && c.rv === rv && c.has === has) return c.geo;
    const geo = (has && M.geometry(key)) || fallbackGeometry(key);
    geoCache.set(key, { rv, has, geo }); return geo;
  }

  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0), S107 = new THREE.Matrix4().makeScale(1.07, 1.07, 1.07);
  const xf = (x, y, z, rot, s) => _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, rot), _s.set(s, s, s));

  // ---------------------------------------------------------------- resources: one InstancedMesh per geometry key
  const resGroup = new THREE.Group(); scene.add(resGroup);
  const resMeshes = new Map();
  function syncRes(L) {
    const by = new Map();
    for (const o of L.resources) { const k = resKey(o); if (!by.has(k)) by.set(k, []); by.get(k).push(o); }
    for (const [k, im] of resMeshes) if (!by.has(k)) { resGroup.remove(im); im.dispose(); resMeshes.delete(k); }
    for (const [k, list] of by) {
      const geo = geomOf(k);
      let im = resMeshes.get(k);
      if (!im || im.geometry !== geo || im.instanceMatrix.count < list.length) {
        if (im) { resGroup.remove(im); im.dispose(); }
        im = new THREE.InstancedMesh(geo, MAT.vc, Math.max(16, list.length));
        im.castShadow = im.receiveShadow = true; im.frustumCulled = false; resGroup.add(im); resMeshes.set(k, im);
      }
      im.userData.ids = list.map(o => 'r:' + o.id);
      list.forEach((o, i) => im.setMatrixAt(i, xf(o.x, 0, o.z, o.rot ?? 0, o.s ?? 1)));
      im.count = list.length; im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- structures, player, claims, piles
  const structGroup = new THREE.Group(), claimGroup = new THREE.Group(), ovGroup = new THREE.Group();
  scene.add(structGroup, claimGroup, ovGroup);
  const structs = new Map();   // 's:<id>' -> Group
  const claims = new Map();    // 's:<id>' -> Mesh
  const ringGeo = new Map();
  const ring = r => { if (!ringGeo.has(r)) { const g = new THREE.RingGeometry(r - 0.07, r + 0.07, 96); g.rotateX(-Math.PI / 2); ringGeo.set(r, g); } return ringGeo.get(r); };
  const claimMat = new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.22, depthWrite: false });
  const campRing = new THREE.Mesh(ring(CAMP_R), MAT.claim), depositRing = new THREE.Mesh(ring(DEPOSIT_R), MAT.claim);
  campRing.position.y = depositRing.position.y = 0.05; claimGroup.add(campRing, depositRing);
  const playerMesh = new THREE.Mesh(geomOf('player'), MAT.vc); playerMesh.castShadow = true; scene.add(playerMesh);
  const pileMat = { wood: new THREE.MeshLambertMaterial({ color: 0x9a6a3c }), stone: new THREE.MeshLambertMaterial({ color: 0x8d877c, flatShading: true }) };
  const woodIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.86, 0.22, 0.24), pileMat.wood, PILE_MAX);
  const stoneIM = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.2, 0), pileMat.stone, PILE_MAX);
  for (const im of [woodIM, stoneIM]) { im.castShadow = im.receiveShadow = true; im.count = 0; scene.add(im); }

  function syncStructs(L) {
    const seen = new Set();
    for (const s of L.structures) {
      const id = 's:' + s.id; seen.add(id);
      let g = structs.get(id);
      if (!g || g.userData.type !== s.type) {
        if (g) structGroup.remove(g);
        g = structureGroup(s.type, geomOf(s.type)); g.userData = { type: s.type, id }; structGroup.add(g); structs.set(id, g);
      }
      const mesh = g.children[0], geo = geomOf(s.type);
      if (mesh.geometry !== geo) mesh.geometry = geo;
      g.position.set(s.x, 0, s.z); g.rotation.y = s.rot ?? 0;
      const cr = data.STRUCT[s.type]?.claim;
      let c = claims.get(id);
      if (cr && !c) { c = new THREE.Mesh(ring(cr), claimMat); c.position.y = 0.04; claimGroup.add(c); claims.set(id, c); }
      if (c) c.position.set(s.x, 0, s.z);
    }
    for (const [id, g] of structs) if (!seen.has(id)) { structGroup.remove(g); structs.delete(id); }
    for (const [id, c] of claims) if (!seen.has(id)) { claimGroup.remove(c); claims.delete(id); }
    const sig = L.structures.map(s => s.type + s.x + ',' + s.z).join('|');
    if (sig !== territorySig) {
      territorySig = sig;
      territory.image.data = territoryField([{ x: 0, z: 0, r: CAMP_R }, ...L.structures.map(s => ({ x: s.x, z: s.z, r: data.STRUCT[s.type]?.claim ?? 0 }))], 256, SPAN);
      territory.needsUpdate = true;
    }
    // fire lights follow the first two campfires
    const fires = L.structures.filter(s => s.type === 'campfire');
    fire.forEach((l, i) => { const f = fires[i]; l.position.set(f?.x ?? 0, 1.1, f?.z ?? 0); l.visible = !!f; });
  }

  function syncPiles(L) {
    const put = (im, type, n, mat) => {
      im.count = Math.min(n, PILE_MAX);
      for (let i = 0; i < im.count; i++) { const p = pileSlot(type, i); _q.setFromAxisAngle(UP, p.rot); im.setMatrixAt(i, _m.compose(_p.set(p.x, p.y, p.z), _q, _one)); }
      im.instanceMatrix.needsUpdate = true;
    };
    put(woodIM, 'wood', L.stock.wood); put(stoneIM, 'stone', L.stock.stone);
  }

  // ---------------------------------------------------------------- overlays (bag.overlays object3d, rebuilt when rev changes)
  const ovCache = new Map();
  function syncOverlays() {   // returns true when something visible changed, so the shadow map needs redrawing
    let changed = false;
    for (const o of ctx.bag.overlays) {
      if (!o.object3d) continue;
      let c = ovCache.get(o.id);
      if (!o.enabled) { if (c && c.obj.visible) { c.obj.visible = false; changed = true; } continue; }
      if (!c || c.rev !== o.rev) { if (c) ovGroup.remove(c.obj); c = { rev: o.rev, obj: o.object3d(THREE) }; ovGroup.add(c.obj); ovCache.set(o.id, c); changed = true; }
      if (!c.obj.visible) { c.obj.visible = true; changed = true; }
    }
    return changed;
  }

  // ---------------------------------------------------------------- selection and hover outlines (inverted hull, scaled 1.07)
  const outlineGroup = new THREE.Group(); scene.add(outlineGroup);
  const outl = new Map();
  let hulls = [];
  function hullInst(key, im, rows, mat) {
    let om = outl.get(key);
    if (!om || om.geometry !== im.geometry || om.instanceMatrix.count < rows.length) {
      if (om) { outlineGroup.remove(om); om.dispose(); }
      om = new THREE.InstancedMesh(im.geometry, mat, Math.max(8, rows.length)); om.frustumCulled = false; outlineGroup.add(om); outl.set(key, om);
    }
    rows.forEach((row, j) => { im.getMatrixAt(row, _m); om.setMatrixAt(j, _m2.copy(_m).multiply(S107)); });
    om.count = rows.length; om.instanceMatrix.needsUpdate = true;
  }
  function syncSel() {
    const sel = new Set(store.selection), hov = sh.hover;
    for (const m of outl.values()) m.count = 0;
    for (const [k, im] of resMeshes) {
      const rows = { sel: [], hov: [] };
      im.userData.ids.forEach((id, i) => { if (sel.has(id)) rows.sel.push(i); else if (id === hov) rows.hov.push(i); });
      if (rows.sel.length) hullInst(k + '|sel', im, rows.sel, MAT.hullSel);
      if (rows.hov.length) hullInst(k + '|hov', im, rows.hov, MAT.hullHover);
    }
    for (const m of hulls) outlineGroup.remove(m);
    hulls = [];
    const solo = [...structs, ['player', playerMesh]];
    for (const [id, o] of solo) {
      const kind = sel.has(id) ? MAT.hullSel : id === hov ? MAT.hullHover : null;
      if (!kind) continue;
      const src = o.isMesh ? o : o.children[0], m = new THREE.Mesh(src.geometry, kind);
      m.position.copy(o.position); m.rotation.copy(o.rotation); m.scale.setScalar(1.07);
      outlineGroup.add(m); hulls.push(m);
    }
  }

  // ---------------------------------------------------------------- gizmo: TransformControls on a pivot at the selection bounds
  const tc = new TransformControls(cur, cvs), pivot = new THREE.Object3D();
  scene.add(pivot, tc.getHelper());
  // Drop the handles the tools do not use, and the 1e6-long guide lines TransformControls draws across the island while dragging.
  // shortcut: three r186 keeps its handle sets only on the private tc._gizmo (no public list), so this is skipped if that moves;
  // upgrade when three exposes the handle sets publicly.
  for (const set of [tc._gizmo?.gizmo, tc._gizmo?.picker, tc._gizmo?.helper]) for (const mode in set ?? {}) {
    if (!KEEP[mode]) continue;
    for (const o of [...(set[mode]?.children ?? [])]) if (!KEEP[mode].includes(o.name) || (o.isLine && o.scale.x > 1e5)) o.removeFromParent();
  }
  function placePivot() {
    const b = boundsOf(sh.starts(store.selection).map(s => ({ x: s.x, z: s.z })));
    if (!b) return;
    pivot.position.set(b.cx, 0.6, b.cz); pivot.quaternion.identity(); pivot.scale.set(1, 1, 1);
  }
  function syncGizmo() {
    const tool = store.ui.tool, on = sh.gizmos && store.selection.length > 0 && tool !== 'select';
    if (!on) { tc.detach(); return; }
    if (!drag3) placePivot();
    tc.setMode(MODE[tool]);
    tc.setTranslationSnap(store.ui.snap ? store.ui.snapMove : null);
    tc.setRotationSnap(store.ui.snap ? store.ui.snapRotate * RAD : null);
    tc.setScaleSnap(store.ui.snap ? 0.05 : null);
    if (tc.object !== pivot) tc.attach(pivot);
  }
  tc.addEventListener('dragging-changed', e => {
    if (e.value) { drag3 = { p0: pivot.position.clone(), starts: sh.starts(store.selection), key: 'g' + ++gid, mode: store.ui.tool }; pivot.quaternion.identity(); pivot.scale.set(1, 1, 1); }
    else { drag3 = null; placePivot(); }
  });
  tc.addEventListener('objectChange', () => {
    const d = drag3; if (!d) return;
    if (d.mode === 'move') sh.commit('Move', d.starts, { kind: 'move', dx: pivot.position.x - d.p0.x, dz: pivot.position.z - d.p0.z }, d.key);
    else if (d.mode === 'rotate') sh.commit('Rotate', d.starts, { kind: 'rotate', px: d.p0.x, pz: d.p0.z, t: 2 * Math.atan2(pivot.quaternion.y, pivot.quaternion.w) }, d.key);
    else sh.commit('Scale', d.starts, { kind: 'scale', f: scaleFactor([pivot.scale.x, pivot.scale.y, pivot.scale.z], [1, 1, 1]), snap: store.ui.snap }, d.key);
  });

  // ---------------------------------------------------------------- picking
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const local = e => { const r = cvs.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // Ray (origin, unit direction) through a canvas pixel, from the camera as last drawn.
  function rayAt(sx, sy) {
    const nx = sx / W * 2 - 1, ny = -(sy / H) * 2 + 1;
    _v1.set(nx, ny, -1).unproject(cur); _v2.set(nx, ny, 1).unproject(cur);
    const d = _v2.sub(_v1).normalize();
    return [[_v1.x, _v1.y, _v1.z], [d.x, d.y, d.z]];
  }
  function pick(sx, sy) {
    const [o, d] = rayAt(sx, sy);
    return pickRay(sceneItems(store.project, data.STRUCT), o, d);
  }
  const toScreen = (x, z, y = 0.5) => { _v3.set(x, y, z).project(cur); return [(_v3.x + 1) / 2 * W, (1 - _v3.y) / 2 * H]; };

  cvs.addEventListener('contextmenu', e => e.preventDefault(), L);
  let pd = null;
  cvs.addEventListener('pointerdown', e => {
    if (tc.dragging || !W) return;
    const [sx, sy] = local(e);
    if (e.button === 2 || (e.button === 0 && e.altKey)) pd = { kind: 'orbit', sx, sy };
    else if (e.button === 1 || (e.button === 0 && sh.space)) pd = { kind: 'pan', sx, sy };
    else if (e.button === 0) pd = { kind: 'lmb', x0: sx, y0: sy, sx, sy, e, hit: pick(sx, sy), moved: false };
    else return;
    cvs.setPointerCapture(e.pointerId);
  }, L);
  cvs.addEventListener('pointermove', e => {
    if (!W) return;
    const [sx, sy] = local(e);
    if (!pd) { if (!tc.dragging) sh.setHover(pick(sx, sy)); return; }   // no hover churn while a gizmo drag runs
    const dx = sx - pd.sx, dy = sy - pd.sy; pd.sx = sx; pd.sy = sy;
    if (pd.kind === 'orbit') {
      cam.yaw -= dx * 0.008; cam.el = clamp(cam.el + dy * 0.006, 0.05, Math.PI / 2 - 0.0005); preset = 'custom';
    } else if (pd.kind === 'pan') {
      const e4 = cur.matrixWorld.elements, upp = (cam.persp ? 2 * cam.dist * TANH : 2 * cam.dist * ORTHO_H) / H;
      cam.tx += (-dx * e4[0] + dy * e4[4]) * upp; cam.tz += (-dx * e4[2] + dy * e4[6]) * upp;
      sh.linkFrom(self, cam.tx, cam.tz);
    } else if (pd.kind === 'lmb') {
      if (!pd.moved && Math.hypot(sx - pd.x0, sy - pd.y0) < 3) return;
      pd.moved = true;
      Object.assign(marq.style, { left: Math.min(pd.x0, sx) + 'px', top: Math.min(pd.y0, sy) + 'px', width: Math.abs(sx - pd.x0) + 'px', height: Math.abs(sy - pd.y0) + 'px' });
      marq.hidden = false;
    }
  }, L);
  const endPtr = e => {
    const p = pd; pd = null; if (!p) return;
    if (p.kind === 'lmb') {
      marq.hidden = true;
      const [sx, sy] = local(e);
      if (p.moved) sh.select(idsInRect(sceneItems(store.project, data.STRUCT), toScreen, rectOf(p.x0, p.y0, sx, sy)), p.e);
      else sh.select(p.hit ? [p.hit] : [], p.e);
    }
  };
  cvs.addEventListener('pointerup', endPtr, L);
  cvs.addEventListener('pointercancel', endPtr, L);
  // Zoom toward the cursor: the ground point under it keeps its screen position (see dollyTarget).
  cvs.addEventListener('wheel', e => {
    e.preventDefault();
    updateCamera();   // several wheel events can land before the next frame, so the ray must come from the current camera
    const [sx, sy] = local(e), [o, d] = rayAt(sx, sy), P = groundHit(o, d), d0 = cam.dist;
    cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 6, 500);
    [cam.tx, cam.ty, cam.tz] = dollyTarget([cam.tx, cam.ty, cam.tz], P, cam.dist / d0);
    sh.linkFrom(self, cam.tx, cam.tz);
  }, { passive: false, signal: ac.signal });

  // ---------------------------------------------------------------- camera
  function setPreset(p) {
    const q = PRESET[p]; if (!q) return;
    Object.assign(cam, { yaw: q.yaw, el: q.el, persp: q.persp }); preset = p;
    if (sh.link) sh.linkFrom(self, cam.tx, cam.tz);
  }
  function toggleProj() {
    cam.persp = !cam.persp;
    preset = cam.persp ? 'persp' : preset === 'persp' ? 'iso' : preset;
  }
  function updateCamera() {
    const aspect = W / H;
    cur = cam.persp ? persp : ortho;
    if (tc.camera !== cur) tc.camera = cur;
    const [x, y, z] = orbitPos([cam.tx, cam.ty, cam.tz], cam.yaw, cam.el, cam.dist);
    cur.position.set(x, y, z); cur.up.set(0, 1, 0); cur.lookAt(cam.tx, cam.ty, cam.tz); cur.updateMatrixWorld();
    if (cur === ortho) {
      const hh = cam.dist * ORTHO_H, hw = hh * aspect;
      Object.assign(ortho, { left: -hw, right: hw, top: hh, bottom: -hh }); ortho.updateProjectionMatrix();
      scene.fog = null;
    } else {
      persp.aspect = aspect; persp.updateProjectionMatrix();
      fog.near = cam.dist; fog.far = cam.dist * 2.6; scene.fog = fog;
    }
  }

  // ---------------------------------------------------------------- axis gizmo (click an end to look down that axis)
  let axisHits = [];
  function drawAxis() {
    const c = 46, r = 30, e = cur.matrixWorld.elements, R = [e[0], e[1], e[2]], U = [e[4], e[5], e[6]], dpr = devicePixelRatio || 1;
    ax.setTransform(dpr, 0, 0, dpr, 0, 0); ax.clearRect(0, 0, 92, 92);
    axisHits = [];
    const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].flatMap((d, i) => [{ d, col: AXIS_COL[i], pos: true }, { d: d.map(v => -v), col: AXIS_COL[i], pos: false }]);
    for (const a of dirs) {
      const sx = c + (a.d[0] * R[0] + a.d[1] * R[1] + a.d[2] * R[2]) * r, sy = c - (a.d[0] * U[0] + a.d[1] * U[1] + a.d[2] * U[2]) * r;
      axisHits.push({ sx, sy, d: a.d });
      ax.beginPath(); ax.moveTo(c, c); ax.lineTo(sx, sy); ax.strokeStyle = a.col; ax.globalAlpha = a.pos ? 1 : 0.45; ax.lineWidth = 2; ax.stroke();
      ax.beginPath(); ax.arc(sx, sy, a.pos ? 8 : 5, 0, Math.PI * 2); ax.fillStyle = a.col; ax.fill();
      if (a.pos) { ax.fillStyle = '#111'; ax.font = 'bold 10px sans-serif'; ax.textAlign = 'center'; ax.textBaseline = 'middle'; ax.fillText('XYZ'[dirs.indexOf(a) / 2 | 0], sx, sy + 0.5); }
    }
    ax.globalAlpha = 1;
  }
  axisCv.addEventListener('pointerdown', e => {
    const r = axisCv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 12;
    for (const a of axisHits) { const d = Math.hypot(a.sx - mx, a.sy - my); if (d < bd) { bd = d; best = a; } }
    if (!best) { if (Math.hypot(mx - 46, my - 46) < 14) toggleProj(); return; }   // the centre of the axis gizmo flips ortho / persp
    const [ax0, ay0, az0] = best.d;
    cam.yaw = Math.atan2(ax0, az0); cam.el = clamp(Math.asin(ay0), 0, Math.PI / 2 - 0.0005); preset = 'custom';
    e.stopPropagation();
  }, L);

  // ---------------------------------------------------------------- resize, stats
  function resize() {
    W = wrap.clientWidth; H = wrap.clientHeight;
    if (W < 2 || H < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
    axisCv.width = 92 * (devicePixelRatio || 1); axisCv.height = 92 * (devicePixelRatio || 1);
  }
  const hist = { dt: [], js: [], rd: [] };
  const push = (k, v) => { const a = hist[k]; a.push(v); if (a.length > 120) a.shift(); };
  const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  function stats() {
    const dt = avg(hist.dt), L = store.project.level, info = renderer.info.render;
    return {
      fps: dt ? +(1000 / dt).toFixed(1) : 0, frameMs: +dt.toFixed(2), jsMs: +avg(hist.js).toFixed(2), renderMs: +avg(hist.rd).toFixed(2),
      samples: hist.dt.length, objects: L.resources.length + L.structures.length + 1, drawCalls: info.calls, triangles: info.triangles,
      geometries: renderer.info.memory.geometries, preset, persp: cam.persp, pixelRatio: renderer.getPixelRatio(), canvas: [cvs.width, cvs.height],
    };
  }

  // ---------------------------------------------------------------- toolbar and readout
  const pb = {
    top: tbtn('Top', 'Top view (Numpad 7)', false, () => setPreset('top')),
    iso: tbtn('Iso', 'Iso view, the game camera (Numpad 1)', false, () => setPreset('iso')),
    persp: tbtn('Persp', 'Perspective (Numpad 5 toggles ortho / persp)', false, () => setPreset('persp')),
  };
  const btnWire = tbtn('Wire', 'Wireframe', false, () => {
    wire = !wire; MAT.vc.wireframe = wire; ground.root.children[0].material.wireframe = wire; btnWire.classList.toggle('on', wire);
  });
  const btnGrid = tbtn('Grid', 'Grid (G)', sh.grid, () => { sh.grid = !sh.grid; sh.redraw(); });
  const btnLink = tbtn('Link', 'Link cameras: 2D centre to 3D target', sh.link, () => {
    sh.link = !sh.link; if (sh.link) sh.linkFrom(self, cam.tx, cam.tz); sh.redraw();
  });
  const btnOv = tbtn('Overlays ▾', 'Overlays, gizmos and grid', false, () => popover(btnOv, viewMenu(sh)));
  const more = moreButton(() => [
    { label: 'Top', checked: preset === 'top', run: () => pb.top.click() },
    { label: 'Iso', checked: preset === 'iso', run: () => pb.iso.click() },
    { label: 'Persp', checked: preset === 'persp', run: () => pb.persp.click() },
    { label: 'Wireframe', checked: wire, run: () => btnWire.click() },
    { label: 'Link cameras', checked: sh.link, run: () => btnLink.click() },
    ...viewMenu(sh),
  ]);
  const bar = h('div', { class: 'vp-bar' }, h('span', { class: 'vp-title' }, 'Scene 3D'), h('span', { class: 'sp' }),
    h('div', { class: 'vp-grp vp-collapse' }, pb.top, pb.iso, pb.persp), h('div', { class: 'vp-grp vp-collapse' }, btnWire, btnGrid, btnLink, btnOv), more);
  const root = h('div', { class: 'vp' }, bar, wrap);
  const updateBar = () => {
    for (const k in pb) pb[k].classList.toggle('on', preset === k);
    btnGrid.classList.toggle('on', sh.grid); btnLink.classList.toggle('on', sh.link);
    readout.textContent = `${preset} · ${cam.persp ? 'persp' : 'ortho'} · ${cam.dist.toFixed(0)} m · ${store.selection.length} selected`;
  };

  // ---------------------------------------------------------------- frame
  function tick(now) {
    if (disposed || W < 2) return;
    const t0 = performance.now();
    const revSig = ['campfire', 'wall', 'workbench', 'player', 'tree.0', 'tree.1', 'tree.2', 'rock.0', 'rock.1'].map(k => ctx.bag.models?.rev?.(k) ?? '').join();
    if (revSig !== self.revSig) { self.revSig = revSig; projDirty = true; }
    if (projDirty) {
      const L = store.project.level;
      syncRes(L); syncStructs(L); syncPiles(L);
      playerMesh.geometry = geomOf('player'); playerMesh.position.set(L.player.x, 0, L.player.z); playerMesh.rotation.y = L.player.rot ?? 0;
      projDirty = false; selDirty = true; shadowDirty = true;
    }
    if (selDirty) { syncSel(); syncGizmo(); selDirty = false; }
    if (syncOverlays()) shadowDirty = true;
    updateCamera();
    const key = [cam.tx, cam.ty, cam.tz, cam.yaw, cam.el, cam.dist, cam.persp, W, H, sh.grid, wire].join();
    if (key !== lastKey) { lastKey = key; needDraw = true; }
    const A = gridAlphas(H / (2 * cam.dist * (cam.persp ? TANH : ORTHO_H)));   // pixels per metre at the target
    floors.forEach((f, i) => { const a = [A.a1, A.a5, A.a25][i]; f.g.visible = sh.grid && a > 0.01; f.g.material.opacity = f.op * a; });
    updateBar();
    // Draw only when something changed, or on the idle refresh.
    if (!needDraw && !(sh.animate && now - lastDraw >= IDLE_MS)) return;
    needDraw = false;
    ground.uniforms.uTime.value = now / 1000;
    const t = now / 1000;
    for (const [id, g] of structs) if (g.userData.type === 'campfire') { const f = g.getObjectByName('flame'); if (f) f.scale.set(1, 0.9 + 0.2 * Math.sin(t * 9 + g.position.x), 1); }
    fire.forEach((l, i) => { if (l.visible) l.intensity = 2.2 + 0.6 * Math.sin(t * 11 + i * 2); });
    const t1 = performance.now();
    renderer.shadowMap.needsUpdate = shadowDirty; shadowDirty = false;
    renderer.render(scene, cur);
    const t2 = performance.now();
    drawAxis();
    if (lastDraw) push('dt', now - lastDraw);
    lastDraw = now;
    push('js', t1 - t0); push('rd', t2 - t1);
  }

  // ---------------------------------------------------------------- panel
  const ro = new ResizeObserver(() => !disposed && resize()); ro.observe(wrap);
  const self = {
    element: root,
    revSig: '',
    update(why) { if (why === 'project') projDirty = true; if (why !== 'saved') selDirty = true; needDraw = true; },
    dirty() { selDirty = true; needDraw = true; },
    tick,
    onResize: resize,
    onShow: resize,
    preset: p => setPreset(p),
    toggleProj,
    stats,
    project: (x, z, y) => toScreen(x, z, y),
    centre: () => ({ x: cam.tx, z: cam.tz }),
    where: () => ({ preset, persp: cam.persp, yaw: cam.yaw, el: cam.el, dist: cam.dist, target: [cam.tx, cam.ty, cam.tz], hover: sh.hover, axis: tc.axis, dragging: tc.dragging }),
    setCentre(x, z) { cam.tx = x; cam.tz = z; },
    frame(b) {
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6) * 1.3 + 2;
      cam.tx = b.cx; cam.tz = b.cz; cam.dist = cam.persp ? span / 2 / TANH : span / 2 / ORTHO_H;
      sh.linkFrom(self, cam.tx, cam.tz);
    },
    dispose() {
      if (disposed) return; disposed = true;
      ac.abort(); ro.disconnect(); closePopover();
      sh.views.delete(self); if (sh.v3 === self) sh.v3 = null;
      pd = null; marq.hidden = true;
      tc.detach(); tc.dispose();
      // Free what this view owns. Shared module caches (MAT, bag model geometry, fallback geometry) stay alive for other views.
      const shared = new Set(Object.values(MAT));
      for (const c of geoCache.values()) shared.add(c.geo);
      scene.traverse(o => {
        if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
        for (const m of [].concat(o.material ?? [])) if (m && !shared.has(m)) m.dispose();
      });
      territory.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    },
  };
  sh.views.add(self); sh.v3 = self;
  setPreset('iso');
  resize();
  return self;
}
