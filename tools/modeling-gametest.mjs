// Edits made with the Model Editor's own controls, then Play (the shell's ▶ Play button), then a check inside the game iframe:
// the game's geometry for each edited model must match bakeModel() of the recipe, vertex by vertex, colours included.
// The game keeps its geometry in module scope, so the page serves a copy of public/game/index.html with one probe line
// appended (test instrumentation only; repo-app is not touched). Needs the dev server (npm run dev). Exits 1 on any FAIL.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bakeModel } from '../src/modeling/recipe.js';
import { DEFAULTS } from '../src/modeling/defaults.js';

const BASE = process.env.HEFT_URL ?? 'http://localhost:5190';
const OUT = process.env.SHOT_DIR ?? '/tmp/modeling-shots';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (item, ok, detail = '') => {
  results.push({ item, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${item}${detail ? '  (' + detail + ')' : ''}`);
};
const pause = ms => new Promise(r => setTimeout(r, ms));
const maxDelta = (a, b) => {
  if (!a || !b || a.length !== b.length) return Infinity;
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// The game page with a probe line before its module script ends: exposes the geometry holders and PIVOT.
const PROBE = ';window.__heft = { TREE_GEOS, ROCK_GEOS, STRUCT_GEO, player, PIVOT, scene };';
await page.route('**/game/index.html*', async route => {
  const res = await route.fetch();
  const html = await res.text();
  const i = html.lastIndexOf('</script>');
  await route.fulfill({ response: res, body: html.slice(0, i) + PROBE + html.slice(i), headers: { ...res.headers(), 'content-type': 'text/html' } });
});

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.studio, null, { timeout: 60000 });
await page.evaluate(() => window.studio.bag.dock.getPanel('modeling')?.api.setActive());
await page.waitForSelector('.mdl-vp canvas', { timeout: 30000 });
await pause(800);
const recipe = key => page.evaluate(k => window.studio.bag.models.recipe(k), key);
const pickModel = key => page.selectOption('.mdl-picker', key).then(() => pause(300));
const pickPart = i => page.locator('.mdl-row').nth(i).click().then(() => pause(200));
const field = (vecLabel, axis) => page.locator('.mdl-part .vec', { has: page.locator('.vl', { hasText: new RegExp('^' + vecLabel + '$') }) }).locator('input.' + axis);
const typeIn = async (loc, value) => { await loc.fill(String(value)); await loc.press('Enter'); await pause(300); };

// ---------------------------------------------------------------- edits, made in the editor
const pine0 = await recipe('tree.0');
const topCone = pine0.map((p, i) => ({ p, i })).filter(o => o.p.prim === 'cone').sort((a, b) => b.p.pos[1] - a.p.pos[1])[0].i;
await pickModel('tree.0');
await pickPart(topCone);
await typeIn(field('scale', 'x'), 0.6);
await typeIn(field('scale', 'y'), 1.4);
const pineAfter = await recipe('tree.0');
check('pine top cone scale edited in the inspector', pineAfter[topCone].scale[0] === 0.6 && pineAfter[topCone].scale[1] === 1.4,
  `part ${topCone} scale ${JSON.stringify(pineAfter[topCone].scale)}`);

await pickModel('campfire');
const logs = (await recipe('campfire')).map((p, i) => ({ p, i })).filter(o => o.p.prim === 'cyl' && o.p.rot[2] !== 0)[0].i;
await pickPart(logs);
await page.locator('.mdl-part input[type=color]').fill('#c03a10');
await pause(300);
const fireAfter = await recipe('campfire');
check('campfire log recoloured in the inspector', fireAfter[logs].color === 0xc03a10, `part ${logs} colour ${fireAfter[logs].color.toString(16)}`);

await pickModel('player');
const torsoIdx = (await recipe('player')).findIndex(p => p.g === 'torso' && p.prim === 'box' && p.args[0] === 0.6 && p.args[1] === 0.52);
await pickPart(torsoIdx);
await typeIn(field('position', 'x'), 0.12);
const playerAfter = await recipe('player');
check('player torso part moved in the inspector', Math.abs(playerAfter[torsoIdx].pos[0] - 0.12) < 1e-9, `part ${torsoIdx} pos ${JSON.stringify(playerAfter[torsoIdx].pos)}`);
await page.screenshot({ path: `${OUT}/game-r3-editor-edits.png` });

// ---------------------------------------------------------------- Play, then the game iframe
const frameEl = page.locator('iframe[title="Heft playtest"]');
await page.locator('button', { hasText: '▶ Play' }).first().click();
await page.waitForFunction(() => /Running/.test(document.querySelector('.playtest .bar span')?.textContent ?? ''), null, { timeout: 90000 })
  .then(() => check('Play runs the level in the game (heft:ready)', true), () => check('Play runs the level in the game (heft:ready)', false, 'timed out'));
const frame = await (await frameEl.elementHandle()).contentFrame();
const hasProbe = await frame.waitForFunction(() => !!window.__heft, null, { timeout: 30000 }).then(() => true, () => false);
check('game iframe exposes its geometry (same-origin probe)', hasProbe);
await pause(1500);

const game = await frame.evaluate(() => {
  const H = window.__heft, pack = g => ({ pos: Array.from(g.attributes.position.array), col: Array.from(g.attributes.color?.array ?? []) });
  const rig = Object.fromEntries(Object.entries(H.player.parts).filter(([k]) => k !== 'axe' && k !== 'pickaxe').map(([k, m]) => [k, pack(m.geometry)]));
  const count = geo => { let n = 0; H.scene.traverse(o => { if (o.isMesh && o.geometry === geo) n++; }); return n; };
  return { tree0: pack(H.TREE_GEOS[0]), campfire: pack(H.STRUCT_GEO.campfire), rig, PIVOT: H.PIVOT,
    treeMeshes: count(H.TREE_GEOS[0]), campfireMeshes: count(H.STRUCT_GEO.campfire) };
});
await page.screenshot({ path: `${OUT}/game-r3-after-play.png` });
await frameEl.screenshot({ path: `${OUT}/game-r3-game-view.png` });

// ---------------------------------------------------------------- expected: the same recipes baked in node
const cmp = (label, gotPos, gotCol, geo) => {
  const dp = maxDelta(gotPos, geo.attributes.position.array), dc = maxDelta(gotCol, geo.attributes.color.array);
  check(`${label}: game vertices match the recipe`, dp < 1e-4 && gotPos.length === geo.attributes.position.count * 3, `${gotPos.length / 3} verts, max position delta ${dp.toExponential(1)}`);
  check(`${label}: game colours match the recipe`, dc < 1e-4, `max colour delta ${dc.toExponential(1)}`);
};
cmp('pine (tree.0)', game.tree0.pos, game.tree0.col, bakeModel(pineAfter));
const pineDefault = bakeModel(DEFAULTS['tree.0']).attributes.position.array;
check('pine in the game differs from the built-in pine (the edit is visible)', maxDelta(game.tree0.pos, pineDefault) > 0.05,
  `max position delta vs built-in ${maxDelta(game.tree0.pos, pineDefault).toFixed(3)}`);
check('pine mesh instances in the game use the edited geometry', game.treeMeshes > 0, `${game.treeMeshes} tree meshes`);
cmp('campfire (structure)', game.campfire.pos, game.campfire.col, bakeModel(fireAfter));
check('campfire mesh instances in the game use the edited geometry', game.campfireMeshes > 0, `${game.campfireMeshes} campfire meshes`);

const playerNow = await recipe('player');
for (const name of ['legL', 'legR', 'torso', 'head', 'armL', 'armR']) {
  const sub = playerNow.filter(p => (p.g ?? 'root') === name);
  const exp = bakeModel(sub), off = game.PIVOT[name];
  const expPos = Float32Array.from(exp.attributes.position.array, (v, i) => v - off[i % 3]);
  const got = game.rig[name];
  if (!got) { check(`player ${name}: game rig mesh present`, false); continue; }
  cmp(`player ${name}`, got.pos, got.col, { attributes: { position: { array: expPos, count: exp.attributes.position.count }, color: { array: exp.attributes.color.array } } });
}

fs.writeFileSync(path.join(OUT, 'gametest.json'), JSON.stringify({ results, game: { treeMeshes: game.treeMeshes, campfireMeshes: game.campfireMeshes } }, null, 2));
await browser.close();
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed} of ${results.length} passed; shots in ${OUT}`);
process.exitCode = failed ? 1 : 0;
