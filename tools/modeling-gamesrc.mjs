// Evaluates the game's model code (repo-app/index.html, the copy under public/game/) without its renderer, so the
// tests and the compare page can use the game's own builders. Works in node and in the browser.
import * as THREE from 'three';

export function gameModels(html) {
  const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error(`game source moved: ${a}`); return html.slice(i, j); };
  const mat = /const MAT = \{[\s\S]*?\n\};/.exec(html);
  if (!mat) throw new Error('game source moved: const MAT');
  const body = [
    cut('const V3 = THREE.Vector3;', '// ---------------------------------------------------------------- renderer / scene'),
    mat[0],
    cut('// ---------------------------------------------------------------- geometry kit', '// ---------------------------------------------------------------- audio'),
    'return { TREE_GEOS, ROCK_GEOS, STRUCT_GEO, buildBuilder };',
  ].join('\n');
  return new Function('THREE', body)(THREE);
}

// The game's builder as a list of { name, geometry } in the root frame (axe and pickaxe excluded, like the recipe).
export function gameBuilderParts(G) {
  const { root, axe, pickaxe } = G.buildBuilder();
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse(o => { if (o.isMesh && o !== axe && o !== pickaxe) out.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); });
  return out;
}
