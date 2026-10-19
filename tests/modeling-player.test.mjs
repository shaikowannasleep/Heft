// The player recipe, the game's rig and the offline preview bundle. The game side is read from repo-app/index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gameModels, gameBuilderParts } from '../tools/modeling-gamesrc.mjs';
import { DEFAULTS } from '../src/modeling/defaults.js';
import { mergeGeo, validParts } from '../src/modeling/recipe.js';
import { LIB } from '../src/modeling/viewer.generated.js';
import { previewHtml } from '../src/modeling/preview.js';

const G = gameModels(fs.readFileSync(new URL('../../repo-app/index.html', import.meta.url), 'utf8'));
const world = b => mergeGeo(gameBuilderParts(Object.assign({}, G, { buildBuilder: () => b })));

test('default player recipe reproduces the game rig exactly', () => {
  assert.equal(validParts(DEFAULTS.player), true);
  const base = world(G.buildBuilder());
  const b = G.buildBuilder(); G.applyModels({ player: DEFAULTS.player }, b);
  const same = world(b);
  assert.equal(same.attributes.position.count, base.attributes.position.count);
  const pa = base.attributes.position.array, pb = same.attributes.position.array;
  for (let i = 0; i < pa.length; i++) assert.ok(Math.abs(pa[i] - pb[i]) < 1e-6, `vertex ${i}`);
});

test('moving the torso in the recipe moves only the torso, and removing the recipe restores the game rig', () => {
  const base = world(G.buildBuilder()).attributes.position.array;
  const edited = DEFAULTS.player.map(p => p.g === 'torso' ? { ...p, pos: [p.pos[0] + 0.5, p.pos[1], p.pos[2]] } : p);
  const b = G.buildBuilder(); G.applyModels({ player: edited }, b);
  const pos = world(b).attributes.position.array;
  assert.equal(pos.length, base.length);
  let moved = 0, maxDev = 0;
  for (let i = 0; i < base.length; i += 3) {
    const dx = pos[i] - base[i], dy = pos[i + 1] - base[i + 1], dz = pos[i + 2] - base[i + 2];
    if (Math.hypot(dx, dy, dz) < 1e-6) continue;
    moved++; maxDev = Math.max(maxDev, Math.abs(dx - 0.5), Math.abs(dy), Math.abs(dz));
  }
  assert.ok(moved > 0 && moved < base.length / 3, 'some vertices move, not all');
  assert.ok(maxDev < 1e-4, 'every moved vertex moved by 0.5 on x only (deviation ' + maxDev + ')');
  const r = G.buildBuilder(); G.applyModels({ player: edited }, r); G.applyModels(undefined, r);
  assert.equal(world(r).attributes.position.count, base.length / 3);
});

test('the offline preview embeds three.js inline: no CDN import, and the bundle round-trips', () => {
  const html = previewHtml('{"format":"heft-models","models":[]}', LIB);
  assert.equal(html.includes('jsdelivr'), false);
  assert.equal(html.includes('importmap'), false);
  const m = /<script id="lib" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'lib block present');
  assert.equal(JSON.parse(m[1]), LIB);
  const lib = new Function(LIB + '\nreturn HeftLib;')();
  assert.equal(typeof lib.THREE.WebGLRenderer, 'function');
  assert.equal(typeof lib.OrbitControls, 'function');
});
