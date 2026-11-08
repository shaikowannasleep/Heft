// Model Editor panel: part and vertex modes over the recipe in project.models. Gizmo drags and inspector edits are
// store.update steps (undo/redo); the viewport shows bakePart() of the same recipe the game gets. The panel owns its
// keys (ownsKeys): a capture-phase window listener takes Delete, Ctrl+D, Ctrl+Z and friends while it is the active panel.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { part } from './defaults.js';
import { NAMES, PRIMS, ARG_NAMES, NEW_ARGS, bakePart, weldsOf } from './recipe.js';
import { visibleFrom, transformPoint } from './pick.js';

const hex = c => '#' + c.toString(16).padStart(6, '0');
const fmt = v => +(+v).toFixed(4);
const DEG = Math.PI / 180;
const VIEWS = { front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0], persp: [1, 0.6, 1] };
const ICON = {
  select: '<path d="M4 2.5l8 5-3.6.9 1.9 3.9-1.5.7-1.9-3.9L4 11z"/>',
  move: '<path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2"/>',
  rotate: '<path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8M13.4 2.2v3.1h-3.1"/>',
  scale: '<path d="M2.5 13.5l11-11M9.5 2.5h4v4M2.5 9.5v4h4"/>',
  xray: '<rect x="2" y="2" width="12" height="12" stroke-dasharray="2 2"/><circle cx="8" cy="8" r="3"/>',
  wire: '<path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12"/>',
  normals: '<path d="M3 13l8-8M7 4.5h4.5V9"/>',
  grid: '<path d="M2 3.5h12M2 8h12M2 12.5h12"/>',
  frame: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
  panel: '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M10 2v12"/>',
  reset: '<path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v3h3"/>',
  export: '<path d="M8 2v8M5 7l3 3 3-3M3 13.5h10"/>',
  part: '<path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM2.5 4.5L8 7.5l5.5-3M8 7.5v7"/>',
  vertex: '<circle cx="3.5" cy="3.5" r="1.6" fill="currentColor"/><circle cx="12.5" cy="4.5" r="1.6" fill="currentColor"/><circle cx="8" cy="8.5" r="1.6" fill="currentColor"/><circle cx="3.5" cy="12.5" r="1.6" fill="currentColor"/><circle cx="12.5" cy="12.5" r="1.6" fill="currentColor"/>',
};
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const icon = name => { const s = svg('svg', { viewBox: '0 0 16 16', class: 'ico', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); s.innerHTML = ICON[name]; return s; };

export function modelingPanel(ctx, models, exportAll) {
  const { h, toast, store } = ctx;
  const live = new Set();                       // GPU objects this panel made; dispose() frees exactly these
  const own = o => (live.add(o), o);
  const free = o => { if (live.delete(o)) o.dispose(); };
  const ac = new AbortController();
  let listeners = 0;   // live listeners this panel added; abort() gives each one back
  const on = (t, type, fn, opt = {}) => { listeners++; ac.signal.addEventListener('abort', () => listeners--, { once: true }); t.addEventListener(type, fn, { ...opt, signal: ac.signal }); };
  const text = (node, s) => { if (node.textContent !== s) node.textContent = s; };   // same text is not re-set: no DOM churn per event
  const S = { key: 'tree.0', part: 0, mode: 'part', sel: new Set(), welds: [], radius: 0.3, wire: false, normals: false,
    grid: true, xray: false, side: true, proj: 'persp', drag: null, dragId: 0, dist: 6 };
  const parts = () => models.recipe(S.key);
  // Apply one edit to the selected model. An out-of-range value is refused with a toast and nothing is stored.
  function run(label, fn, merge) {
    try { models.edit(label, S.key, fn, merge); return true; }
    catch (e) { toast(`Not applied: ${e.message}`, 'err', 3000); return false; }
  }

  // Fixed controls are built once; paint() re-runs their small update functions (class, disabled, value).
  const bound = [];
  const bind = (node, f) => (bound.push([node, f]), node);
  const paint = () => { for (const [node, f] of bound) f(node); };
  const onOff = test => node => node.classList.toggle('on', !!test());
  const tx = (label, title, fn, f = () => {}) => bind(h('button', { class: 'tb', title, onclick: fn }, label), f);
  const tbtn = (name, title, fn, f = () => {}) => bind(h('button', { class: 'tb ic', title, onclick: fn }, icon(name)), f);

  // ---------------------------------------------------------------- DOM
  const bar = h('div', { class: 'mdl-bar' });
  const picker = h('select', { class: 'mdl-picker', title: 'Model', onchange: e => { S.key = e.target.value; S.part = 0; S.sel.clear(); refreshAll(); frameAll(); } });
  const list = h('div', { class: 'mdl-list' });
  const rowBox = h('div', { class: 'mdl-rows' });
  const partBox = h('div', { class: 'mdl-part' });
  const vertBox = h('div', { class: 'mdl-vert' });
  const insp = h('div', { class: 'mdl-insp' }, partBox, vertBox);
  const foot = h('div', { class: 'mdl-foot' });
  const vp = h('div', { class: 'mdl-vp' });
  const box = h('div', { class: 'mdl-box' });
  const side = h('aside', { class: 'mdl-side' }, picker, list, insp);
  const el = h('div', { class: 'mdl', tabindex: '-1' }, bar, h('div', { class: 'mdl-body' }, side, vp), foot);
  vp.append(box);

  // ---------------------------------------------------------------- three.js view
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  vp.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2a2a);
  const persp = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500);
  let cam = persp;
  const orbit = new OrbitControls(cam, renderer.domElement);
  orbit.enableDamping = true; orbit.screenSpacePanning = true; orbit.minDistance = 0.2; orbit.maxDistance = 80;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 6, 4); scene.add(sun);
  const grid = new THREE.GridHelper(12, 24, 0x5a5a5a, 0x3a3a3a); own(grid.geometry); own(grid.material); scene.add(grid);
  const root = new THREE.Group(); scene.add(root);
  const proxy = new THREE.Object3D(); scene.add(proxy);
  const gizmo = new TransformControls(cam, renderer.domElement);
  scene.add(gizmo.getHelper());
  const polyOff = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };   // keeps dots and edges above their faces
  const matBody = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...polyOff }));
  const matSel = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x2a3d55, ...polyOff }));
  const matDots = own(new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true }));
  const matEdge = own(new THREE.LineBasicMaterial({ color: 0xff8a1f }));
  const matNorm = own(new THREE.LineBasicMaterial({ color: 0x7fd1ff }));
  const dots = new THREE.Points(); dots.renderOrder = 2; scene.add(dots);
  const meshes = [];
  let outline = null, normals = null;

  // Navigation gizmo: the axes in view space, drawn in a corner SVG. Click a tip to look down that axis.
  const navSvg = svg('svg', { class: 'mdl-nav', viewBox: '0 0 72 72' });
  vp.append(navSvg);
  const NAV = [['X', [1, 0, 0], '#e5534b'], ['Y', [0, 1, 0], '#57c25a'], ['Z', [0, 0, 1], '#4a8fe7']].flatMap(([name, v, col]) => [1, -1].map(sg => {
    const g = svg('g', { class: 'nv' }), c = svg('circle', { r: sg > 0 ? 8 : 5.5, fill: sg > 0 ? col : '#2b2b2b', stroke: col, 'stroke-width': 1.5 });
    const t = svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 10, 'font-weight': 700, fill: '#111' });
    t.textContent = sg > 0 ? name : '';
    g.append(c, t); navSvg.append(g);
    return { dir: new THREE.Vector3(...v).multiplyScalar(sg), g, px: 36, py: 36, vz: 0 };
  }));
  function drawNav() {
    const R = 26;
    for (const n of NAV) { const v = n.dir.clone().transformDirection(cam.matrixWorldInverse); n.px = 36 + v.x * R; n.py = 36 - v.y * R; n.vz = v.z; }
    for (const n of [...NAV].sort((a, b) => a.vz - b.vz)) {   // back to front
      n.g.setAttribute('transform', `translate(${n.px.toFixed(1)} ${n.py.toFixed(1)})`);
      n.g.setAttribute('opacity', n.vz > 0 ? 1 : 0.45);
      navSvg.append(n.g);
    }
  }
  on(navSvg, 'pointerdown', e => {
    const r = navSvg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 72, y = (e.clientY - r.top) / r.height * 72;
    const hit = NAV.map(n => ({ n, d: Math.hypot(n.px - x, n.py - y) })).filter(o => o.d < 9).sort((a, b) => a.d - b.d)[0];
    if (hit) alignTo(hit.n.dir);
  });

  // Vertex mode works on welds: vertices of one part that share a base position. Offsets are stored per vertex index.
  function welds(p) {
    const cur = bakePart(p).attributes.position;
    return weldsOf(bakePart(p, false)).map(w => ({ m: w.m, p: new THREE.Vector3(cur.getX(w.m[0]), cur.getY(w.m[0]), cur.getZ(w.m[0])) }));
  }
  const selWelds = () => [...S.sel].map(j => S.welds[j]).filter(Boolean);
  // A vertex is pickable when it is visible, or when X-ray is on.
  const seen = v => S.xray || visibleFrom(cam, meshes, v);

  on(gizmo, 'dragging-changed', e => {
    orbit.enabled = !e.value;
    if (e.value) { S.dragId++; S.drag = S.mode === 'vertex' ? startVertexDrag() : {}; S.drag.press = { c: toScreen(proxy.position), at: pd?.a }; }
    else { S.drag = null; refreshAll(); }   // re-anchor the gizmo on the result
  });
  on(gizmo, 'objectChange', () => {
    if (!S.drag) return;
    if (gizmo.axis === 'XYZ' && gizmo.getMode() === 'scale') uniformScale();
    S.mode === 'vertex' ? moveVertices() : movePart();
  });
  // The centre handle's own factor is |pointer| / |press| from the gizmo centre, so a press near the centre jumps. Here the
  // factor is the pointer's screen distance from the centre over the press distance (at least 40 px).
  function uniformScale() {
    const { c, at } = S.drag.press, press = at ? Math.hypot(at[0] - c[0], at[1] - c[1]) : 0;
    proxy.scale.setScalar(Math.max(Math.hypot(ptr[0] - c[0], ptr[1] - c[1]) / Math.max(press, 40), 0.01));
  }

  function startVertexDrag() {
    const c0 = proxy.position.clone(), mode = gizmo.getMode();
    const wts = S.welds.map((w, j) => {
      if (S.sel.has(j)) return 1;
      const d = w.p.distanceTo(c0);
      return S.radius > 0 && d < S.radius ? (1 - d / S.radius) ** 2 : 0;   // soft falloff
    });
    return { c0, mode, wts, welds: S.welds, vx0: { ...(parts()[S.part].vx ?? {}) } };
  }
  // The gizmo starts each drag at identity, so the proxy's rotation and scale are the change so far.
  function moveVertices() {
    const d = S.drag, gz = { t: proxy.position.clone().sub(d.c0), q: proxy.quaternion.clone(), s: proxy.scale.clone() };
    run({ translate: 'Move vertices', rotate: 'Rotate vertices', scale: 'Scale vertices' }[d.mode], rec => {
      const p = rec[S.part]; p.vx ??= {};
      d.welds.forEach((w, j) => {
        const k = d.wts[j]; if (!k) return;
        const dv = transformPoint(d.mode, w.p, d.c0, gz).sub(w.p).multiplyScalar(k);
        for (const m of w.m) {
          const b = d.vx0[m] ?? [0, 0, 0], o = [b[0] + dv.x, b[1] + dv.y, b[2] + dv.z];
          if (o.every(v => Math.abs(v) < 1e-6)) delete p.vx[m]; else p.vx[m] = o;
        }
      });
      if (!Object.keys(p.vx).length) delete p.vx;
    }, 'vx' + S.dragId);
  }
  function movePart() {
    const m = gizmo.getMode(), i = S.part;
    run(m === 'rotate' ? 'Rotate part' : m === 'scale' ? 'Scale part' : 'Move part', rec => {
      const q = rec[i];
      if (m === 'translate') q.pos = proxy.position.toArray();
      else if (m === 'rotate') q.rot = [proxy.rotation.x, proxy.rotation.y, proxy.rotation.z];
      else q.scale = proxy.scale.toArray();
    }, 'part' + S.dragId);
  }

  // Scene sync works per part: a mesh is rebuilt only when its recipe object changed, so drags do not rebuild the scene.
  function syncScene() {
    const ps = parts();
    S.part = Math.min(S.part, ps.length - 1);
    while (meshes.length > ps.length) { const m = meshes.pop(); root.remove(m); free(m.geometry); }
    ps.forEach((p, i) => {
      let m = meshes[i];
      if (!m) { m = new THREE.Mesh(undefined, matBody); meshes[i] = m; root.add(m); }
      m.userData.i = i;
      if (m.userData.p !== p) { free(m.geometry); m.geometry = own(bakePart(p)); m.userData.p = p; }
      m.material = i === S.part ? matSel : matBody;
    });
    matBody.wireframe = matSel.wireframe = S.wire;
    if (matBody.transparent !== S.xray) matBody.needsUpdate = matSel.needsUpdate = true;   // three.js re-reads the material state only on needsUpdate
    matBody.transparent = matSel.transparent = S.xray;
    matBody.opacity = matSel.opacity = S.xray ? 0.3 : 1;
    matBody.depthWrite = matSel.depthWrite = !S.xray;
    const sm = meshes[S.part];
    if (outline && outline.userData.g !== sm?.geometry) { scene.remove(outline); free(outline.geometry); outline = null; }
    if (!outline && sm) { outline = new THREE.LineSegments(own(new THREE.EdgesGeometry(sm.geometry, 20)), matEdge); outline.userData.g = sm.geometry; scene.add(outline); }
    if (normals) { scene.remove(normals); free(normals.geometry); normals = null; }
    if (S.normals) {
      const pts = [];
      for (const m of meshes) {
        const P = m.geometry.attributes.position, N = m.geometry.attributes.normal;
        for (let i = 0; i < P.count; i++) pts.push(P.getX(i), P.getY(i), P.getZ(i), P.getX(i) + N.getX(i) * 0.08, P.getY(i) + N.getY(i) * 0.08, P.getZ(i) + N.getZ(i) * 0.08);
      }
      const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      normals = new THREE.LineSegments(g, matNorm); scene.add(normals);
    }
  }
  function syncVerts() {
    dots.visible = S.mode === 'vertex';
    matDots.depthTest = !S.xray;   // occluded dots are hidden by the depth test unless X-ray is on
    if (!dots.visible) return;
    S.welds = welds(parts()[S.part]);
    const n = S.welds.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    S.welds.forEach((w, j) => { pos.set([w.p.x, w.p.y, w.p.z], j * 3); col.set(S.sel.has(j) ? DOT : DOT_IDLE, j * 3); });
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    free(dots.geometry); dots.geometry = g;
  }
  const DOT = [1, 0.85, 0.2], DOT_IDLE = [0.85, 0.92, 1];
  function syncGizmo() {
    if (S.drag) return;   // never re-anchor the gizmo under the pointer
    const tool = store.ui.tool, snap = store.ui.snap;
    gizmo.setTranslationSnap(snap ? store.ui.snapMove : null);
    gizmo.setRotationSnap(snap ? store.ui.snapRotate * DEG : null);
    gizmo.setScaleSnap(snap ? 0.1 : null);
    if (tool === 'select') return gizmo.detach();   // Q: select only
    const mode = { move: 'translate', rotate: 'rotate', scale: 'scale' }[tool] ?? 'translate';
    if (S.mode === 'vertex') {
      const ws = selWelds();
      if (!ws.length) return gizmo.detach();
      proxy.position.copy(ws.reduce((a, w) => a.add(w.p), new THREE.Vector3()).divideScalar(ws.length));   // selection centre
      proxy.quaternion.identity(); proxy.scale.set(1, 1, 1);
    } else {
      const p = parts()[S.part];
      proxy.position.set(...p.pos); proxy.rotation.set(...p.rot); proxy.scale.set(...p.scale);
    }
    gizmo.setMode(mode); gizmo.attach(proxy);
  }

  // ---------------------------------------------------------------- camera: one perspective and one orthographic camera
  const toScreen = v => { const q = v.clone().project(cam); return [(q.x + 1) / 2 * vp.clientWidth, (1 - q.y) / 2 * vp.clientHeight]; };
  function fitCam() {
    const w = vp.clientWidth, hh = vp.clientHeight; if (!w || !hh) return;
    renderer.setSize(w, hh, false);
    persp.aspect = w / hh; persp.updateProjectionMatrix();
    const half = S.dist * Math.tan(persp.fov * DEG / 2), ax = half * w / hh;   // ortho frustum matches the perspective size at the target
    Object.assign(ortho, { left: -ax, right: ax, top: half, bottom: -half }); ortho.updateProjectionMatrix();
  }
  function useProj(kind) {
    const next = kind === 'ortho' ? ortho : persp;
    if (next !== cam) { next.position.copy(cam.position); next.quaternion.copy(cam.quaternion); cam = next; orbit.object = cam; gizmo.camera = cam; }
    S.proj = kind;
  }
  function place(dir) {   // camera on dir from the orbit target, S.dist away
    cam.position.copy(orbit.target).addScaledVector(dir.setZ(dir.z + 1e-4).normalize(), S.dist);
    cam.zoom = 1; orbit.update(); fitCam();
  }
  function view(name) { useProj(name === 'persp' ? 'persp' : 'ortho'); place(new THREE.Vector3(...VIEWS[name])); paint(); }
  function alignTo(dir) { useProj('ortho'); place(dir.clone()); paint(); }
  function toggleProj() { useProj(S.proj === 'persp' ? 'ortho' : 'persp'); orbit.update(); fitCam(); paint(); }
  function frame(b) {
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const d = cam.position.clone().sub(orbit.target);
    d.lengthSq() ? d.normalize() : d.set(...VIEWS.persp).normalize();
    orbit.target.copy(c); S.dist = Math.max(s.x, s.y, s.z) * 2 + 1.5;
    cam.position.copy(c).addScaledVector(d, S.dist); cam.zoom = 1; orbit.update(); fitCam();
  }
  function frameAll() { const b = new THREE.Box3().setFromObject(root); if (!b.isEmpty()) frame(b); }
  function frameSel() {
    if (S.mode === 'part' && meshes[S.part]) return frame(new THREE.Box3().setFromObject(meshes[S.part]));
    if (S.mode === 'vertex' && S.sel.size) { const b = new THREE.Box3(); for (const w of selWelds()) b.expandByPoint(w.p); return frame(b); }
    frameAll();
  }

  const ro = new ResizeObserver(fitCam); ro.observe(vp);
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop); if (!vp.clientWidth) return;
    orbit.update(); renderer.render(scene, cam); drawNav();
    if (gizmo.object) { const [x, y] = toScreen(proxy.position); vp.dataset.anchor = Math.round(x) + ',' + Math.round(y); }   // gizmo anchor, for tools/modeling-shots.mjs
  };

  // ---------------------------------------------------------------- picking: click, Shift+click, Shift+drag box
  let pd = null, ptr = [0, 0];
  const rel = e => { const r = renderer.domElement.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  on(vp, 'pointerdown', e => {
    if (e.button !== 0 || e.target.closest?.('.mdl-nav')) return;
    el.focus({ preventScroll: true });
    const boxing = S.mode === 'vertex' && e.shiftKey;
    orbit.enabled = !boxing;
    pd = { x: e.clientX, y: e.clientY, id: S.dragId, boxing, a: rel(e) };
  }, { capture: true });
  on(vp, 'pointermove', e => {
    ptr = rel(e);
    if (!pd?.boxing) return;
    const [x0, y0] = pd.a, [x1, y1] = rel(e);
    Object.assign(box.style, { display: 'block', left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' });
  });
  on(vp, 'pointerup', e => {
    const p = pd; pd = null; box.style.display = 'none'; orbit.enabled = true;
    if (!p || p.id !== S.dragId) return;   // the gizmo was dragged or grabbed, not a pick
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4;
    if (moved && !p.boxing) return;
    const [mx, my] = rel(e);
    if (S.mode === 'vertex') {
      if (moved) {
        const lo = [Math.min(p.a[0], mx), Math.min(p.a[1], my)], hi = [Math.max(p.a[0], mx), Math.max(p.a[1], my)];
        const ids = S.welds.flatMap((w, j) => { const [sx, sy] = toScreen(w.p); return sx >= lo[0] && sx <= hi[0] && sy >= lo[1] && sy <= hi[1] && seen(w.p) ? [j] : []; });
        S.sel = new Set([...S.sel, ...ids]);
      } else {
        const best = S.welds.map((w, j) => { const [sx, sy] = toScreen(w.p); return { j, d: Math.hypot(sx - mx, sy - my) }; })
          .filter(o => o.d < 14).sort((a, b) => a.d - b.d).find(o => seen(S.welds[o.j].p))?.j ?? -1;
        if (best < 0) { if (!e.shiftKey) S.sel.clear(); }
        else if (e.shiftKey) { if (S.sel.has(best)) S.sel.delete(best); else S.sel.add(best); }
        else S.sel = new Set([best]);
      }
      return refreshAll();
    }
    const r = new THREE.Raycaster(), w = vp.clientWidth, hh = vp.clientHeight;
    r.setFromCamera(new THREE.Vector2(mx / w * 2 - 1, -(my / hh) * 2 + 1), cam);
    const hit = r.intersectObjects(meshes, false)[0];
    if (hit) selPart(hit.object.userData.i);
  }, { capture: false });

  // ---------------------------------------------------------------- actions
  function setMode(m) { S.mode = m; S.sel.clear(); refreshAll(); }
  function selPart(i) { S.part = i; S.sel.clear(); refreshAll(); }
  function addPart() { if (run('Add part', rec => { rec.push(part('box', NEW_ARGS.box, 0x9a9a9a, { y: 0.5 })); })) selPart(parts().length - 1); }
  function dupPart() {
    if (S.mode !== 'part') return;
    const i = S.part;
    if (run('Duplicate part', rec => { const c = JSON.parse(JSON.stringify(rec[i])); c.pos[0] += 0.2; rec.splice(i + 1, 0, c); })) selPart(i + 1);
  }
  function delPart() {
    if (S.mode !== 'part') return;
    if (parts().length <= 1) return toast('A model needs at least one part', 'warn');
    const i = S.part;
    if (run('Delete part', rec => { rec.splice(i, 1); })) selPart(Math.max(0, i - 1));
  }
  function moveBy(dir) {
    const i = S.part, j = i + dir;
    if (S.mode !== 'part' || j < 0 || j >= parts().length) return;
    if (run('Reorder part', rec => { rec.splice(j, 0, rec.splice(i, 1)[0]); })) selPart(j);
  }
  function resetVerts() {
    const ws = selWelds();
    run('Reset vertices', rec => {
      const p = rec[S.part]; if (!p.vx) return;
      for (const w of ws) for (const m of w.m) delete p.vx[m];
      if (!Object.keys(p.vx).length) delete p.vx;
    });
  }
  function selectAll() { if (S.mode === 'vertex') { S.sel = new Set(S.welds.keys()); refreshAll(); } }
  function toggleXray() { S.xray = !S.xray; refreshAll(); }
  function toggleSide() { S.side = !S.side; refreshAll(); }

  // Keys: capture on window, so the shell's bubble-phase commands (F, Ctrl+Z, Delete) never see them while this panel is
  // the active one. Typing in a field is left alone.
  on(window, 'keydown', e => {
    if (ctx.bag.dock?.activePanel?.id !== 'modeling' || e.target.closest?.('input,select,textarea,[contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey, c = e.code;
    let done = true;
    if (mod && c === 'KeyZ') e.shiftKey ? store.redo() : store.undo();
    else if (mod && c === 'KeyY') store.redo();
    else if (mod && c === 'KeyD') dupPart();
    else if (mod && c === 'KeyA' && S.mode === 'vertex') selectAll();
    else if (!mod && (c === 'Delete' || c === 'Backspace')) delPart();
    else if (c === 'Escape' && S.mode === 'vertex') { S.sel.clear(); refreshAll(); }
    else if (c === 'Tab') setMode(S.mode === 'part' ? 'vertex' : 'part');
    else if (!mod && c === 'KeyF') frameSel();
    else if (!mod && c === 'KeyN') toggleSide();
    else if (e.altKey && c === 'KeyZ') toggleXray();
    else if (c === 'Numpad1') view('front');
    else if (c === 'Numpad3') view('side');
    else if (c === 'Numpad7') view('top');
    else if (c === 'Numpad5') toggleProj();
    else done = false;
    if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, { capture: true });

  // ---------------------------------------------------------------- toolbar: one line, icons with tooltips and hotkeys
  bar.append(
    h('div', { class: 'grp' },
      tbtn('select', 'Select (Q): picks only, no gizmo', () => store.setUi({ tool: 'select' }), onOff(() => store.ui.tool === 'select')),
      tbtn('move', 'Move (W)', () => store.setUi({ tool: 'move' }), onOff(() => store.ui.tool === 'move')),
      tbtn('rotate', 'Rotate (E)', () => store.setUi({ tool: 'rotate' }), onOff(() => store.ui.tool === 'rotate')),
      tbtn('scale', 'Scale (R)', () => store.setUi({ tool: 'scale' }), onOff(() => store.ui.tool === 'scale'))),
    h('div', { class: 'grp' },
      tbtn('part', 'Part mode (Tab)', () => setMode('part'), onOff(() => S.mode === 'part')),
      tbtn('vertex', 'Vertex mode (Tab)', () => setMode('vertex'), onOff(() => S.mode === 'vertex'))),
    h('div', { class: 'grp' },
      tbtn('xray', 'X-ray: show and pick hidden vertices (Alt+Z)', toggleXray, onOff(() => S.xray)),
      tbtn('wire', 'Wireframe', () => { S.wire = !S.wire; refreshAll(); }, onOff(() => S.wire)),
      tbtn('normals', 'Vertex normals', () => { S.normals = !S.normals; refreshAll(); }, onOff(() => S.normals)),
      tbtn('grid', 'Floor grid', () => { S.grid = !S.grid; grid.visible = S.grid; paint(); }, onOff(() => S.grid))),
    h('div', { class: 'grp' },
      tx('Front', 'Front, orthographic (Numpad 1)', () => view('front')),
      tx('Side', 'Side, orthographic (Numpad 3)', () => view('side')),
      tx('Top', 'Top, orthographic (Numpad 7)', () => view('top')),
      tx('Persp', 'Perspective (Numpad 5 toggles ortho)', () => view('persp'), onOff(() => S.proj === 'persp'))),
    tbtn('frame', 'Frame selection (F)', () => frameSel()),
    tbtn('panel', 'Inspector (N)', toggleSide, onOff(() => S.side)),
    h('span', { class: 'sp' }),
    tbtn('reset', 'Restore the game default for this model', () => { models.reset(S.key); S.part = 0; S.sel.clear(); refreshAll(); }),
    tbtn('export', 'Export models.json and preview.html', exportAll));

  // ---------------------------------------------------------------- side panel: model picker, part list, inspector
  let pickSig = '';
  function syncPicker() {
    const keys = models.keys(), sig = keys.map(k => k + (models.edited(k) ? '*' : '')).join() + '|' + S.key;
    if (sig === pickSig) return;
    pickSig = sig;
    picker.replaceChildren(...keys.map(k => h('option', { value: k }, NAMES[k] + (models.edited(k) ? ' (edited)' : ''))));
    picker.value = S.key;
  }
  const inPart = () => S.mode === 'part';
  list.append(
    h('div', { class: 'mdl-btns' },
      tx('Add', 'Add a box part', addPart, el => { el.disabled = !inPart(); }),
      tx('Dup', 'Duplicate (Ctrl+D)', dupPart, el => { el.disabled = !inPart(); }),
      tx('Del', 'Delete (Del)', delPart, el => { el.disabled = !inPart(); }),
      tx('Up', 'Move up in draw order', () => moveBy(-1), el => { el.disabled = !inPart() || S.part === 0; }),
      tx('Down', 'Move down in draw order', () => moveBy(1), el => { el.disabled = !inPart() || S.part >= parts().length - 1; })),
    rowBox);
  const rows = [];
  function syncRows() {
    const ps = parts();
    while (rows.length > ps.length) rows.pop().r.remove();
    while (rows.length < ps.length) {
      const sw = h('i', { class: 'sw' }), pr = h('span'), dim = h('span', { class: 'dim' });
      const r = h('div', { class: 'mdl-row', onclick: () => selPart(+r.dataset.i) }, sw, pr, dim);
      rowBox.append(r); rows.push({ r, sw, pr, dim });
    }
    ps.forEach((p, i) => {
      const q = rows[i];
      q.r.dataset.i = i; q.r.classList.toggle('on', i === S.part);
      q.sw.style.background = hex(p.color); q.pr.textContent = p.prim; q.dim.textContent = '#' + i;
    });
  }
  // The part inspector is rebuilt only when the part or its primitive changes; otherwise its fields take new values in place.
  let partSig = '', fields = [];
  function syncPartBox() {
    const p = parts()[S.part], sig = [S.key, S.part, p.prim].join('|');
    if (sig !== partSig) {
      partSig = sig; fields = [];
      const upd = (label, fn) => run(label, rec => fn(rec[S.part]));
      const field = (input, get) => { fields.push({ el: input, get }); return input; };
      const num = (label, get, step, fn) => h('label', { class: 'f' }, h('span', {}, label),
        field(h('input', { type: 'number', step, onchange: e => { const x = parseFloat(e.target.value); if (Number.isFinite(x)) fn(x); } }), get));
      const vec = (label, key, unit, step, fn) => h('div', { class: 'vec' }, h('span', { class: 'vl' }, label), ...[0, 1, 2].map(i =>
        field(h('input', { type: 'number', step, class: 'xyz'[i], onchange: e => { const x = parseFloat(e.target.value); if (Number.isFinite(x)) fn(i, x * unit); } }), rec => fmt(rec[key][i] / unit))));
      const count = ARG_NAMES[p.prim], intArg = n => n === 'seg' || n === 'detail';
      partBox.replaceChildren(
        h('h4', {}, `Part #${S.part}`),
        h('label', { class: 'f' }, h('span', {}, 'primitive'),
          h('select', { onchange: e => upd('Change primitive', q => { q.prim = e.target.value; q.args = [...NEW_ARGS[e.target.value]]; delete q.vx; }) },
            Object.keys(PRIMS).map(k => h('option', { value: k, selected: k === p.prim }, k)))),
        ...count.map((n, i) => num(n, rec => fmt(rec.args[i]), intArg(n) ? 1 : 0.01, x => upd(`Edit ${n}`, q => { q.args[i] = intArg(n) ? Math.round(x) : x; }))),
        vec('position', 'pos', 1, 0.01, (i, x) => upd('Move part', q => { q.pos[i] = x; })),
        vec('rotation°', 'rot', DEG, 1, (i, x) => upd('Rotate part', q => { q.rot[i] = x; })),
        vec('scale', 'scale', 1, 0.01, (i, x) => upd('Scale part', q => { q.scale[i] = x; })),
        h('label', { class: 'f' }, h('span', {}, 'colour'),
          field(h('input', { type: 'color', onchange: e => upd('Recolour part', q => { q.color = parseInt(e.target.value.slice(1), 16); }) }), rec => hex(rec.color))),
        num('jitter', rec => fmt(rec.jit ?? 0.07), 0.01, x => upd('Edit jitter', q => { q.jit = x; })),
        num('gradient', rec => fmt(rec.grad ?? 0.22), 0.01, x => upd('Edit gradient', q => { q.grad = x; })),
        num('warp', rec => fmt(rec.warp ?? 0), 0.01, x => upd('Edit warp', q => { q.warp = x; })),
        num('seed', rec => rec.seed ?? 7, 1, x => upd('Edit seed', q => { q.seed = Math.round(x); })));
    }
    for (const f of fields) if (f.el !== document.activeElement) f.el.value = f.get(p);
  }
  const vertHead = h('h4'), vertInfo = h('p', { class: 'dim' });
  const radius = bind(h('input', { type: 'number', step: 0.05, min: 0, onchange: e => { const x = parseFloat(e.target.value); if (Number.isFinite(x) && x >= 0) S.radius = Math.min(x, 10); } }),
    el => { if (el !== document.activeElement) el.value = S.radius; });
  vertBox.append(vertHead, vertInfo,
    h('label', { class: 'f' }, h('span', {}, 'falloff radius'), radius),
    h('div', { class: 'mdl-btns' },
      tx('All', 'Select all vertices (Ctrl+A)', selectAll),
      tx('Reset selected', 'Remove the offsets of the selected vertices', resetVerts, el => { el.disabled = !S.sel.size; })),
    h('p', { class: 'dim' }, 'Drag the gizmo (W move, E rotate, R scale) about the selection centre. Welds move together; the falloff radius feathers the unselected neighbours.'));
  function syncInsp() {
    const vert = S.mode === 'vertex';
    partBox.hidden = vert; vertBox.hidden = !vert;
    if (!vert) return syncPartBox();
    const n = S.sel.size;
    vertHead.textContent = `Vertices · ${S.welds.length} welds`;
    vertInfo.textContent = n ? `${n} selected` : 'Click a vertex. Shift+click adds, Shift+drag box-selects.';
  }
  function syncFoot() {
    let tris = 0, verts = 0;
    for (const m of meshes) { const n = m.geometry.attributes.position.count; verts += n; tris += n / 3; }
    foot.textContent = `${parts().length} parts · ${verts} verts · ${tris} tris · ${models.edited(S.key) ? 'edited' : 'game default'} · LMB orbit · RMB pan · wheel zoom · Alt+Z x-ray · N inspector`;
  }
  function refreshAll() {
    syncPicker(); syncScene(); syncVerts(); syncGizmo(); syncRows(); syncInsp(); paint(); syncFoot();
    side.classList.toggle('closed', !S.side);
  }

  view('persp');
  refreshAll(); frameAll(); loop();
  return {
    element: el,
    update: refreshAll,   // every store event (project, ui, selection, saved) lands here
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); ac.abort(); listeners = 0;
      gizmo.dispose(); orbit.dispose();
      for (const o of live) o.dispose(); live.clear();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
    // What this panel still holds: all zero after dispose().
    liveCount: () => ({ objects: live.size, listeners, contextLost: renderer.getContext().isContextLost() }),
    // Read-only state for tools/modeling-clicktest.mjs: vertex screen positions (viewport px) and visibility flags.
    probe: () => ({ mode: S.mode, part: S.part, sel: [...S.sel], xray: S.xray, side: S.side, proj: S.proj, dist: S.dist,
      gizmo: !!gizmo.object, tool: gizmo.getMode(), axis: gizmo.axis, ps: proxy.scale.toArray().map(v => +v.toFixed(3)), drag: !!S.drag, dir: cam.getWorldDirection(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)), welds: S.welds.map(w => { const [x, y] = toScreen(w.p); return [Math.round(x), Math.round(y), seen(w.p) ? 1 : 0]; }) }),
  };
}
