// Parity page: the game's own builders (public/game/index.html) against the editor recipes, per model.
// Positions are compared vertex by vertex (both sides build the same non-indexed order). Colours are not compared:
// the game's jitter is Math.random there.
import * as THREE from 'three';
import { gameModels, gameBuilderParts } from './modeling-gamesrc.mjs';
import { DEFAULTS } from '../src/modeling/defaults.js';
import { KEYS, NAMES, bakeModel, mergeGeo } from '../src/modeling/recipe.js';

const G = gameModels(await (await fetch('/game/index.html')).text());
function gameGeo(key) {
  if (key.startsWith('tree.')) return G.TREE_GEOS[+key[5]];
  if (key.startsWith('rock.')) return G.ROCK_GEOS[+key[5]];
  if (key === 'player') return mergeGeo(gameBuilderParts(G));
  return G.STRUCT_GEO[key];
}
const boxOf = g => { g.computeBoundingBox(); return g.boundingBox; };
const boundsDelta = (a, b) => Math.max(...['min', 'max'].flatMap(k => ['x', 'y', 'z'].map(c => Math.abs(a[k][c] - b[k][c]))));
function posDelta(a, b) {
  if (a.count !== b.count) return NaN;
  let m = 0;
  for (let i = 0; i < a.array.length; i++) m = Math.max(m, Math.abs(a.array[i] - b.array[i]));
  return m;
}

const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
R.setPixelRatio(1);
R.setSize(150, 150, false);
const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
function snap(geo, box) {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x2a2a2a);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x505050, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 6, 4); sc.add(sun);
  sc.add(new THREE.Mesh(geo, mat));
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length() || 1;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
  cam.position.copy(c).add(new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(s * 0.9));
  cam.lookAt(c);
  R.render(sc, cam);
  const out = document.createElement('canvas');
  out.width = out.height = 150;
  out.getContext('2d').drawImage(R.domElement, 0, 0);
  return out;
}

const table = document.getElementById('t');
table.append(Object.assign(document.createElement('tr'), {
  innerHTML: '<th>Model</th><th>Game verts</th><th>Editor verts</th><th>Max position delta</th><th>Max bounds delta</th><th>Result</th><th>Game</th><th>Editor</th>',
}));
const rows = [];
for (const key of KEYS) {
  const g = gameGeo(key), e = bakeModel(DEFAULTS[key]);
  const gb = boxOf(g), eb = boxOf(e);
  const pd = posDelta(g.attributes.position, e.attributes.position), bd = boundsDelta(gb, eb);
  const pass = Number.isFinite(pd) && pd < 0.01 && bd < 0.01;
  const r = { key, name: NAMES[key], gameVerts: g.attributes.position.count, editorVerts: e.attributes.position.count, posDelta: pd, boundsDelta: bd, pass };
  rows.push(r);
  const tr = document.createElement('tr');
  const cells = [NAMES[key], r.gameVerts, r.editorVerts, Number.isFinite(pd) ? pd.toExponential(2) : 'count differs', bd.toExponential(2)];
  for (const c of cells) tr.append(Object.assign(document.createElement('td'), { textContent: String(c) }));
  tr.append(Object.assign(document.createElement('td'), { className: pass ? 'ok' : 'bad', textContent: pass ? 'match' : 'DIFF' }));
  for (const geo of [g, e]) { const td = document.createElement('td'); td.append(snap(geo, gb)); tr.append(td); }
  table.append(tr);
}
document.body.dataset.parity = JSON.stringify(rows);
document.body.dataset.done = '1';
