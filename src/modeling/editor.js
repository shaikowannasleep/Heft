// Model Editor panel: part and vertex modes over the recipe in project.models. Gizmo drags and inspector edits are
// store.update steps (undo/redo); the viewport shows bakePart() of the same recipe the game gets.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { part } from './defaults.js';
import { NAMES, PRIMS, ARG_NAMES, NEW_ARGS, bakePart, weldsOf } from './recipe.js';

const hex = c => '#' + c.toString(16).padStart(6, '0');
const fmt = v => +(+v).toFixed(4);
const DEG = Math.PI / 180;
const VIEWS = { front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 1e-4], persp: [1, 0.6, 1] };

export function modelingPanel(ctx, models, exportAll) {
  const { h, toast, store } = ctx;
  const S = { key: 'tree.0', part: 0, mode: 'part', sel: new Set(), welds: [], radius: 0.3, wire: false, normals: false,
    grid: true, drag: null, dragId: 0, dist: 6 };
  const parts = () => models.recipe(S.key);
  // Apply one edit to the selected model. An out-of-range value is refused with a toast and nothing is stored.
  function run(label, fn, merge) {
    try { models.edit(label, S.key, fn, merge); return true; }
    catch (e) { toast(`Not applied: ${e.message}`, 'err', 3000); return false; }
  }

  // ---------------------------------------------------------------- DOM
  const bar = h('div', { class: 'mdl-bar' });
  const list = h('div', { class: 'mdl-list' });
  const insp = h('div', { class: 'mdl-insp' });
  const foot = h('div', { class: 'mdl-foot' });
  const picker = h('select', { title: 'Model', onchange: e => { S.key = e.target.value; S.part = 0; S.sel.clear(); refreshAll(); frameAll(); } });
  const vp = h('div', { class: 'mdl-vp' });
  const box = h('div', { class: 'mdl-box' });
  vp.append(box);
  const el = h('div', { class: 'mdl', tabindex: '-1' }, bar,
    h('div', { class: 'mdl-body' }, h('aside', { class: 'mdl-side' }, picker, list, insp), vp), foot);

  // ---------------------------------------------------------------- three.js view
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  vp.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2a2a);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
  const orbit = new OrbitControls(cam, renderer.domElement);
  orbit.enableDamping = true; orbit.screenSpacePanning = true; orbit.minDistance = 0.2; orbit.maxDistance = 80;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 6, 4); scene.add(sun);
  const grid = new THREE.GridHelper(12, 24, 0x5a5a5a, 0x3a3a3a); scene.add(grid);
  const root = new THREE.Group(); scene.add(root);
  const proxy = new THREE.Object3D(); scene.add(proxy);
  const gizmo = new TransformControls(cam, renderer.domElement);
  scene.add(gizmo.getHelper());
  const matBody = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const matSel = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x2a3d55 });
  const vpts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  vpts.renderOrder = 2; scene.add(vpts);
  let meshes = [], normals = null;

  // Vertex mode works on welds: vertices of one part that share a base position. Offsets are stored per vertex index.
  function welds(p) {
    const cur = bakePart(p).attributes.position;
    return weldsOf(bakePart(p, false)).map(w => ({ m: w.m, p: new THREE.Vector3(cur.getX(w.m[0]), cur.getY(w.m[0]), cur.getZ(w.m[0])) }));
  }
  const selWelds = () => [...S.sel].map(j => S.welds[j]).filter(Boolean);

  gizmo.addEventListener('dragging-changed', e => {
    orbit.enabled = !e.value;
    if (e.value) { S.dragId++; S.drag = S.mode === 'vertex' ? startVertexDrag() : {}; }
    else S.drag = null;
  });
  gizmo.addEventListener('objectChange', () => { if (S.drag) (S.mode === 'vertex' ? moveVertices() : movePart()); });

  function startVertexDrag() {
    const p = parts()[S.part], c0 = proxy.position.clone();
    const wts = S.welds.map((w, j) => {
      if (S.sel.has(j)) return 1;
      const d = w.p.distanceTo(c0);
      return S.radius > 0 && d < S.radius ? (1 - d / S.radius) ** 2 : 0;   // soft falloff
    });
    return { c0, wts, welds: S.welds, vx0: { ...(p.vx ?? {}) } };
  }
  function moveVertices() {
    const d = S.drag, delta = proxy.position.clone().sub(d.c0);
    run('Move vertices', rec => {
      const p = rec[S.part]; p.vx ??= {};
      d.welds.forEach((w, j) => {
        const k = d.wts[j]; if (!k) return;
        for (const m of w.m) {
          const b = d.vx0[m] ?? [0, 0, 0], o = [b[0] + delta.x * k, b[1] + delta.y * k, b[2] + delta.z * k];
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

  function syncScene() {
    const ps = parts();
    S.part = Math.min(S.part, ps.length - 1);
    for (const m of meshes) { root.remove(m); m.geometry.dispose(); }
    meshes = ps.map((p, i) => { const m = new THREE.Mesh(bakePart(p), i === S.part ? matSel : matBody); m.userData.i = i; root.add(m); return m; });
    matBody.wireframe = matSel.wireframe = S.wire;
    if (normals) { scene.remove(normals); normals.geometry.dispose(); normals = null; }
    if (S.normals) {
      const pts = [];
      for (const m of meshes) {
        const P = m.geometry.attributes.position, N = m.geometry.attributes.normal;
        for (let i = 0; i < P.count; i++) pts.push(P.getX(i), P.getY(i), P.getZ(i), P.getX(i) + N.getX(i) * 0.08, P.getY(i) + N.getY(i) * 0.08, P.getZ(i) + N.getZ(i) * 0.08);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      normals = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x7fd1ff })); scene.add(normals);
    }
  }
  function syncVerts() {
    vpts.visible = S.mode === 'vertex';
    if (!vpts.visible) return;
    S.welds = welds(parts()[S.part]);
    const pos = new Float32Array(S.welds.length * 3), col = new Float32Array(S.welds.length * 3);
    S.welds.forEach((w, j) => { pos.set([w.p.x, w.p.y, w.p.z], j * 3); col.set(S.sel.has(j) ? [1, 0.85, 0.2] : [0.85, 0.92, 1], j * 3); });
    vpts.geometry.dispose();
    vpts.geometry = new THREE.BufferGeometry();
    vpts.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    vpts.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  function syncGizmo() {
    if (S.drag) return;   // never re-anchor the gizmo under the pointer
    const tool = store.ui.tool, snap = store.ui.snap;
    gizmo.setTranslationSnap(snap ? store.ui.snapMove : null);
    gizmo.setRotationSnap(snap ? store.ui.snapRotate * DEG : null);
    gizmo.setScaleSnap(snap ? 0.1 : null);
    if (S.mode === 'vertex') {
      const ws = selWelds();
      if (!ws.length) return gizmo.detach();
      proxy.position.set(0, 0, 0).add(ws.reduce((a, w) => a.add(w.p), new THREE.Vector3()).divideScalar(ws.length));
      proxy.rotation.set(0, 0, 0); proxy.scale.set(1, 1, 1);
      gizmo.setMode('translate'); gizmo.attach(proxy);
      return;
    }
    if (tool === 'select') return gizmo.detach();
    const p = parts()[S.part];
    proxy.position.set(...p.pos); proxy.rotation.set(...p.rot); proxy.scale.set(...p.scale);
    gizmo.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[tool] ?? 'translate');
    gizmo.attach(proxy);
  }

  // Camera
  const toScreen = v => { const q = v.clone().project(cam); return [(q.x + 1) / 2 * vp.clientWidth, (1 - q.y) / 2 * vp.clientHeight]; };
  function view(name) { cam.position.copy(orbit.target).addScaledVector(new THREE.Vector3(...VIEWS[name]).normalize(), S.dist); orbit.update(); }
  function frame(b) {
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    orbit.target.copy(c); S.dist = Math.max(s.x, s.y, s.z) * 2 + 1.5; view('persp');
  }
  function frameAll() { const b = new THREE.Box3().setFromObject(root); if (!b.isEmpty()) frame(b); }
  function frameSel() {
    if (S.mode === 'part' && meshes[S.part]) return frame(new THREE.Box3().setFromObject(meshes[S.part]));
    if (S.mode === 'vertex' && S.sel.size) { const b = new THREE.Box3(); for (const w of selWelds()) b.expandByPoint(w.p); return frame(b); }
    frameAll();
  }

  const size = () => {
    const w = vp.clientWidth, hh = vp.clientHeight; if (!w || !hh) return;
    renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(size); ro.observe(vp);
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop); if (!vp.clientWidth) return;
    orbit.update(); renderer.render(scene, cam);
    if (gizmo.object) { const [x, y] = toScreen(proxy.position); vp.dataset.anchor = Math.round(x) + ',' + Math.round(y); }   // gizmo anchor, for tools/modeling-shots.mjs
  };

  // ---------------------------------------------------------------- picking: click, Shift+click, Shift+drag box
  let pd = null;
  const rel = e => { const r = renderer.domElement.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  vp.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    el.focus({ preventScroll: true });
    const boxing = S.mode === 'vertex' && e.shiftKey;
    orbit.enabled = !boxing;
    pd = { x: e.clientX, y: e.clientY, id: S.dragId, boxing, a: rel(e), b: null };
  }, true);
  vp.addEventListener('pointermove', e => {
    if (!pd?.boxing) return;
    pd.b = rel(e);
    const [x0, y0] = pd.a, [x1, y1] = pd.b;
    Object.assign(box.style, { display: 'block', left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' });
  });
  vp.addEventListener('pointerup', e => {
    const p = pd; pd = null; box.style.display = 'none'; orbit.enabled = true;
    if (!p || p.id !== S.dragId) return;   // the gizmo was dragged or grabbed, not a pick
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4;
    if (moved && !p.boxing) return;
    const [mx, my] = rel(e);
    if (S.mode === 'vertex') {
      if (moved) {
        const lo = [Math.min(p.a[0], mx), Math.min(p.a[1], my)], hi = [Math.max(p.a[0], mx), Math.max(p.a[1], my)];
        const ids = S.welds.flatMap((w, j) => { const [sx, sy] = toScreen(w.p); return sx >= lo[0] && sx <= hi[0] && sy >= lo[1] && sy <= hi[1] ? [j] : []; });
        S.sel = new Set([...S.sel, ...ids]);
      } else {
        let best = -1, bd = 14;
        S.welds.forEach((w, j) => { const [sx, sy] = toScreen(w.p), d = Math.hypot(sx - mx, sy - my); if (d < bd) { bd = d; best = j; } });
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
  });

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

  el.addEventListener('keydown', e => {   // capture: these keys belong to the model editor while it has focus
    if (e.target.closest('input,select,textarea')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    let done = true;
    if (e.key === 'Tab') setMode(S.mode === 'part' ? 'vertex' : 'part');
    else if (mod && k === 'd') dupPart();
    else if (e.key === 'Delete' || e.key === 'Backspace') delPart();
    else if (mod && k === 'a' && S.mode === 'vertex') { S.sel = new Set(S.welds.keys()); refreshAll(); }
    else if (e.key === 'Escape' && S.mode === 'vertex') { S.sel.clear(); refreshAll(); }
    else if (k === 'f' && !mod) frameSel();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------------------------------------------------------------- render the side panels
  function renderBar() {
    const tb = (label, on, title, fn) => h('button', { class: 'tb' + (on ? ' on' : ''), title, onclick: fn }, label);
    bar.replaceChildren(
      h('div', { class: 'grp' }, tb('Part', S.mode === 'part', 'Part mode (Tab)', () => setMode('part')), tb('Vertex', S.mode === 'vertex', 'Vertex mode (Tab)', () => setMode('vertex'))),
      h('div', { class: 'grp' },
        tb('Wireframe', S.wire, 'Wireframe', () => { S.wire = !S.wire; refreshAll(); }),
        tb('Normals', S.normals, 'Vertex normals', () => { S.normals = !S.normals; refreshAll(); }),
        tb('Grid', S.grid, 'Floor grid', () => { S.grid = !S.grid; grid.visible = S.grid; renderBar(); })),
      h('div', { class: 'grp' }, ...['Front', 'Side', 'Top', 'Persp'].map(n => tb(n, false, `Camera: ${n}`, () => view(n.toLowerCase())))),
      tb('Frame', false, 'Frame selection (F)', frameSel),
      h('span', { class: 'sp' }),
      tb('Reset model', false, `Restore the game's ${NAMES[S.key]}`, () => { models.reset(S.key); S.part = 0; S.sel.clear(); refreshAll(); }),
      tb('Export', false, 'Export models.json and preview.html', exportAll));
  }
  function renderList() {
    const ps = parts(), inPart = S.mode === 'part';
    const b = (label, title, fn, dis) => h('button', { class: 'tb', title, disabled: dis, onclick: fn }, label);
    list.replaceChildren(
      h('div', { class: 'mdl-btns' },
        b('Add', 'Add a box part', addPart, !inPart), b('Dup', 'Duplicate (Ctrl+D)', dupPart, !inPart), b('Del', 'Delete (Del)', delPart, !inPart),
        b('Up', 'Move up in draw order', () => moveBy(-1), !inPart), b('Down', 'Move down in draw order', () => moveBy(1), !inPart)),
      ...ps.map((p, i) => h('div', { class: 'mdl-row' + (i === S.part ? ' on' : ''), onclick: () => selPart(i) },
        h('i', { class: 'sw', style: { background: hex(p.color) } }), h('span', {}, p.prim), h('span', { class: 'dim' }, `#${i}`))));
  }
  function renderInsp() {
    if (S.mode === 'vertex') return renderVertexInsp();
    const p = parts()[S.part];
    const upd = (label, fn) => run(label, rec => fn(rec[S.part]));
    const num = (label, v, step, fn) => h('label', { class: 'f' }, h('span', {}, label),
      h('input', { type: 'number', step, value: fmt(v), onchange: e => { const x = parseFloat(e.target.value); if (Number.isFinite(x)) fn(x); } }));
    const vec = (label, arr, unit, step, fn) => h('div', { class: 'vec' }, h('span', { class: 'vl' }, label),
      ['x', 'y', 'z'].map((c, i) => h('input', { type: 'number', step, value: fmt(arr[i] / unit), class: c,
        onchange: e => { const x = parseFloat(e.target.value); if (Number.isFinite(x)) fn(i, x * unit); } })));
    const count = ARG_NAMES[p.prim], intArg = n => n === 'seg' || n === 'detail';
    insp.replaceChildren(
      h('h4', {}, `Part #${S.part}`),
      h('label', { class: 'f' }, h('span', {}, 'primitive'),
        h('select', { onchange: e => upd('Change primitive', q => { q.prim = e.target.value; q.args = [...NEW_ARGS[e.target.value]]; delete q.vx; }) },
          Object.keys(PRIMS).map(k => h('option', { value: k, selected: k === p.prim }, k)))),
      ...count.map((n, i) => num(n, p.args[i], intArg(n) ? 1 : 0.01, x => upd(`Edit ${n}`, q => { q.args[i] = intArg(n) ? Math.round(x) : x; }))),
      vec('position', p.pos, 1, 0.01, (i, x) => upd('Move part', q => { q.pos[i] = x; })),
      vec('rotation°', p.rot, DEG, 1, (i, x) => upd('Rotate part', q => { q.rot[i] = x; })),
      vec('scale', p.scale, 1, 0.01, (i, x) => upd('Scale part', q => { q.scale[i] = x; })),
      h('label', { class: 'f' }, h('span', {}, 'colour'),
        h('input', { type: 'color', value: hex(p.color), onchange: e => upd('Recolour part', q => { q.color = parseInt(e.target.value.slice(1), 16); }) })),
      num('jitter', p.jit ?? 0.07, 0.01, x => upd('Edit jitter', q => { q.jit = x; })),
      num('gradient', p.grad ?? 0.22, 0.01, x => upd('Edit gradient', q => { q.grad = x; })),
      num('warp', p.warp ?? 0, 0.01, x => upd('Edit warp', q => { q.warp = x; })),
      num('seed', p.seed ?? 7, 1, x => upd('Edit seed', q => { q.seed = Math.round(x); })));
  }
  function renderVertexInsp() {
    const n = S.sel.size;
    insp.replaceChildren(
      h('h4', {}, `Vertices · ${S.welds.length} welds`),
      h('p', { class: 'dim' }, n ? `${n} selected` : 'Click a vertex. Shift+click adds, Shift+drag box-selects.'),
      h('label', { class: 'f' }, h('span', {}, 'falloff radius'),
        h('input', { type: 'number', step: 0.05, min: 0, value: S.radius, onchange: e => { const x = parseFloat(e.target.value); if (Number.isFinite(x) && x >= 0) S.radius = Math.min(x, 10); } })),
      h('div', { class: 'mdl-btns' },
        h('button', { class: 'tb', onclick: () => { S.sel = new Set(S.welds.keys()); refreshAll(); } }, 'All'),
        h('button', { class: 'tb', disabled: !n, onclick: resetVerts }, 'Reset selected')),
      h('p', { class: 'dim' }, 'Drag the gizmo (W) to move. Welds move together; the falloff radius feathers the unselected neighbours.'));
  }
  function renderFoot() {
    let tris = 0, verts = 0;
    for (const m of meshes) { verts += m.geometry.attributes.position.count; tris += m.geometry.attributes.position.count / 3; }
    foot.textContent = `${parts().length} parts · ${verts} verts · ${tris} tris · ${models.edited(S.key) ? 'edited' : 'game default'} · LMB orbit · RMB pan · wheel zoom`;
  }
  function refreshAll() {
    picker.replaceChildren(...models.keys().map(k => h('option', { value: k, selected: k === S.key }, NAMES[k] + (models.edited(k) ? ' (edited)' : ''))));
    syncScene(); syncVerts(); syncGizmo(); renderBar(); renderList(); renderInsp(); renderFoot();
  }

  refreshAll(); frameAll(); loop();
  return {
    element: el,
    update: refreshAll,   // every store event (project, ui, selection, saved) lands here
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); gizmo.dispose(); orbit.dispose(); renderer.dispose(); },
  };
}
