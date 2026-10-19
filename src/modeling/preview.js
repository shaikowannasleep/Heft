// Export: models.json (recipes plus baked meshes) and a standalone preview.html that embeds the same JSON.
import { NAMES } from './recipe.js';

const arr = a => Array.from(a, v => +v.toFixed(5));

export function modelsEnvelope(models) {
  return {
    format: 'heft-models', version: 1,
    models: models.keys().map(key => {
      const g = models.geometry(key);
      return { key, name: NAMES[key], edited: models.edited(key), parts: models.recipe(key),
        mesh: { position: arr(g.attributes.position.array), normal: arr(g.attributes.normal.array), color: arr(g.attributes.color.array) } };
    }),
  };
}

const esc = json => json.replace(/</g, '\\u003c');   // keeps </script> out of the embedded data

export function previewHtml(json) {
  return PREVIEW_HEAD + esc(json) + PREVIEW_TAIL;
}

export function exportModels(models) {
  const json = JSON.stringify(modelsEnvelope(models));
  download(json, 'models.json', 'application/json');
  setTimeout(() => download(previewHtml(json), 'preview.html', 'text/html'), 300);
}

function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// The viewer. Keep it free of backticks and of the dollar-brace sequence: it sits inside a JS template literal.
const PREVIEW_HEAD = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Heft models preview</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"}}</script>
<style>
html,body{margin:0;height:100%;background:#202020;color:#d2d2d2;font:12px/1.4 system-ui,-apple-system,sans-serif;overflow:hidden}
body{display:flex;flex-direction:column}
#bar,#anim{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;background:#282828;border-bottom:1px solid #121212}
#anim{border-top:1px solid #121212;border-bottom:0}
button,select,input{font:inherit;color:inherit;background:#323232;border:1px solid #3a3a3a;border-radius:3px;padding:3px 7px}
button:hover:not(:disabled){background:#3c3c3c}
button.on{background:#2c5d9e}
button:disabled,select:disabled,input:disabled{opacity:.4}
#stats{margin-left:auto;color:#9a9a9a;font:11px ui-monospace,Menlo,monospace}
#view{flex:1;min-height:0;position:relative;overflow:hidden}
#view canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#view.drop{outline:2px dashed #3d8bfd;outline-offset:-8px}
#hint{position:absolute;left:10px;bottom:8px;color:#6c6c6c;pointer-events:none}
#scrub{width:220px}
</style></head>
<body>
<div id="bar">
  <select id="model" title="Model"></select>
  <button data-view="front">Front</button><button data-view="side">Side</button><button data-view="top">Top</button><button data-view="persp">Reset</button>
  <button id="wire" title="Wireframe">Wireframe</button>
  <button id="grid" class="on" title="Floor grid">Floor grid</button>
  <button id="skel" disabled title="Procedural models have no bones">Skeleton helper</button>
  <input type="file" id="file" accept=".json,application/json" title="Open a models.json">
  <span id="stats"></span>
</div>
<div id="view"><div id="hint">Drop a models.json here. Left drag orbits, right drag pans, wheel zooms.</div></div>
<div id="anim">
  <select id="clip" disabled title="Animation clip"><option>No clips</option></select>
  <button id="play" disabled>Play</button>
  <input id="scrub" type="range" min="0" max="1" step="0.001" value="0" disabled title="Timeline">
  <select id="speed" disabled title="Playback speed">
    <option>0.25x</option><option>0.5x</option><option selected>1.0x</option><option>1.5x</option><option>2.0x</option>
  </select>
  <span style="color:#6c6c6c">These are static props: no animation clips in this export.</span>
</div>
<script id="data" type="application/json">`;

const PREVIEW_TAIL = `</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let models = JSON.parse(document.getElementById('data').textContent).models;
const $ = id => document.getElementById(id);
const view = $('view'), sel = $('model'), wire = $('wire'), grid = $('grid');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a2a);
const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
const orbit = new OrbitControls(cam, renderer.domElement);
orbit.enableDamping = true;
orbit.screenSpacePanning = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 6, 4);
scene.add(sun);
const floor = new THREE.GridHelper(12, 24, 0x5a5a5a, 0x3a3a3a);
scene.add(floor);
const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
let mesh = null, dist = 6;

const VIEWS = { front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0.0001], persp: [1, 0.6, 1] };
function setView(name) {
  cam.position.copy(orbit.target).addScaledVector(new THREE.Vector3(...VIEWS[name]).normalize(), dist);
  orbit.update();
}
const finite9 = a => Array.isArray(a) && a.length > 0 && a.length % 9 === 0 && a.every(v => typeof v === 'number' && Number.isFinite(v));
function valid(m) { return m && m.mesh && finite9(m.mesh.position) && finite9(m.mesh.normal) && finite9(m.mesh.color) && m.mesh.normal.length === m.mesh.position.length && m.mesh.color.length === m.mesh.position.length; }

function load(i) {
  const m = models[i];
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.mesh.position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.mesh.normal, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.mesh.color, 3));
  g.computeBoundingBox();
  mesh = new THREE.Mesh(g, mat);
  scene.add(mesh);
  const b = g.boundingBox, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  orbit.target.copy(c);
  dist = Math.max(s.x, s.y, s.z) * 2 + 1.5;
  setView('persp');
  const verts = g.attributes.position.count;
  $('stats').textContent = 'polys ' + (verts / 3) + ' · verts ' + verts + ' · bones 0';
}
function useModels(list) {
  if (!Array.isArray(list) || !list.length || !list.every(valid)) throw new Error('not a heft-models file');
  models = list;
  sel.replaceChildren(...models.map((m, i) => new Option(m.name || m.key || 'model ' + i, i)));
  sel.disabled = false;
  $('hint').style.display = 'none';
  load(0);
}
function readFile(f) {
  f.text().then(t => {
    const j = JSON.parse(t);
    useModels(j.format === 'heft-models' ? j.models : [j]);
  }).catch(e => alert('Could not open ' + f.name + ': ' + e.message));
}

sel.onchange = () => load(+sel.value);
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
wire.onclick = () => { mat.wireframe = !mat.wireframe; wire.classList.toggle('on', mat.wireframe); };
grid.onclick = () => { floor.visible = !floor.visible; grid.classList.toggle('on', floor.visible); };
$('file').onchange = e => e.target.files[0] && readFile(e.target.files[0]);
view.ondragover = e => { e.preventDefault(); view.classList.add('drop'); };
view.ondragleave = () => view.classList.remove('drop');
view.ondrop = e => { e.preventDefault(); view.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f) readFile(f); };

const size = () => {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
};
addEventListener('resize', size);
size();
sel.replaceChildren(...models.map((m, i) => new Option(m.name || m.key || 'model ' + i, i)));
load(0);
renderer.setAnimationLoop(() => { orbit.update(); renderer.render(scene, cam); });
</script>
</body></html>
`;
