// Click-driven check of the Model Editor in headless Chromium: real mouse and keyboard events only. The panel's probe()
// supplies vertex screen positions and state; nothing is set through the page. Needs the dev server (npm run dev).
// Writes PNGs and export files to SHOT_DIR (default /tmp/modeling-shots), prints PASS/FAIL per item, exits 1 on any FAIL.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.HEFT_URL ?? 'http://localhost:5190';
const OUT = process.env.SHOT_DIR ?? '/tmp/modeling-shots';
fs.mkdirSync(path.join(OUT, 'export'), { recursive: true });
const results = [];
const check = (item, ok, detail = '') => {
  results.push({ item, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${item}${detail ? '  (' + detail + ')' : ''}`);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const pause = ms => page.waitForTimeout(ms);
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const vpShot = name => page.locator('.mdl-vp').screenshot({ path: `${OUT}/${name}.png` });
const canvasBox = () => page.locator('.mdl-vp canvas').first().boundingBox();
const toPage = async (x, y) => { const b = await canvasBox(); return [b.x + x, b.y + y]; };
const probe = () => page.evaluate(() => window.studio.bag.modelingView.probe());
// The gizmo anchor is written once per rendered frame; swiftshader frames are slow, so wait two before reading it.
const anchor = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(document.querySelector('.mdl-vp').dataset.anchor.split(',').map(Number)))))); 
const recipe = () => page.evaluate(() => JSON.stringify(window.studio.bag.models.recipe(document.querySelector('.mdl-picker').value)));
const partCount = () => page.evaluate(() => window.studio.bag.models.recipe(document.querySelector('.mdl-picker').value).length);
const lastLabel = () => page.evaluate(() => window.studio.store.past.at(-1)?.label ?? '');
const key = k => page.keyboard.press(k).then(() => pause(150));
const click = async (x, y) => { const [px, py] = await toPage(x, y); await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.up(); await pause(150); };
async function dragPx(x0, y0, x1, y1, steps = 10) {
  const [a, b] = await toPage(x0, y0), [c, d] = await toPage(x1, y1);
  await page.mouse.move(a, b); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(a + (c - a) * i / steps, b + (d - b) * i / steps); await pause(25); }
  await page.mouse.up(); await pause(250);
}
const xs = welds => welds.map(w => w[0]);
const spread = arr => Math.max(...arr) - Math.min(...arr);
const same = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

// ---------------------------------------------------------------- setup
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.studio, null, { timeout: 60000 });
await page.evaluate(() => window.studio.bag.dock.getPanel('modeling')?.api.setActive());
await page.waitForSelector('.mdl-vp canvas', { timeout: 30000 });
await pause(1000);
await shot('clk-01-part-mode');
check('nav gizmo is drawn in the viewport corner', await page.locator('.mdl-nav').isVisible());

// ---------------------------------------------------------------- part click (item 2, part picking)
// Part 0 (the trunk) sits inside part 1 (the cone), so its centre is occluded: a click there must pick the cone.
const A0 = await anchor();
await page.locator('.mdl-row').nth(1).click(); await pause(150);
check('row click selects part 1', (await probe()).part === 1);
await page.locator('.mdl-bar button[title^="Select (Q)"]').click(); await pause(150);
check('Select tool detaches the gizmo', (await probe()).gizmo === false);
await click(A0[0], A0[1]);
check('click on occluded part 0 centre picks the visible part 1', (await probe()).part === 1, `anchor ${A0}`);
await page.locator('.mdl-row').nth(0).click(); await pause(150);
await vpShot('clk-02-part-click');

// ---------------------------------------------------------------- vertex picking with occlusion (item 2)
await key('Tab');
let p = await probe();
check('Tab switches to vertex mode', p.mode === 'vertex');
const vb = await canvasBox();
const inView = w => w[0] >= 0 && w[1] >= 0 && w[0] <= vb.width && w[1] <= vb.height;
const hiddenIdx = p.welds.map((w, i) => i).filter(i => !p.welds[i][2] && inView(p.welds[i]));
const shownIdx = p.welds.map((w, i) => i).filter(i => p.welds[i][2] && inView(p.welds[i]));
check('view has occluded and visible vertices', hiddenIdx.length > 0 && shownIdx.length > 0,
  `${shownIdx.length} visible, ${hiddenIdx.length} occluded in view, ${p.welds.length} welds`);
// An occluded vertex with no visible vertex within 20 px, so a click there can only pick something else if the test is wrong.
const h = hiddenIdx.find(i => !shownIdx.some(j => Math.hypot(p.welds[j][0] - p.welds[i][0], p.welds[j][1] - p.welds[i][1]) < 20));
if (h === undefined) check('found an isolated occluded vertex to click', false);
else {
  await click(p.welds[h][0], p.welds[h][1]);
  p = await probe();
  check('click on an occluded vertex does not pick it', !p.sel.includes(h), `sel ${JSON.stringify(p.sel)}`);
}
const v = shownIdx[0];
await click(p.welds[v][0], p.welds[v][1]);
p = await probe();
check('click on a visible vertex picks it', p.sel.length === 1 && p.welds[p.sel[0]][2] === 1, `sel ${JSON.stringify(p.sel)}`);
await vpShot('clk-03-vertex-occluded');

// X-ray (Alt+Z): occluded vertices become pickable and their dots show.
await key('Alt+KeyZ');
p = await probe();
check('Alt+Z turns X-ray on', p.xray === true);
if (h !== undefined) {
  await click(p.welds[h][0], p.welds[h][1]);
  p = await probe();
  check('with X-ray, an occluded vertex is picked', p.sel.includes(h));
}
await vpShot('clk-04-xray-on');
await key('Alt+KeyZ');
check('Alt+Z again turns X-ray off', (await probe()).xray === false);

// Shift+drag box select only takes visible vertices.
await key('Escape');
check('Escape clears the vertex selection', (await probe()).sel.length === 0);
// The box covers every welded vertex in view, so occluded ones fall inside it and must be left out.
p = await probe();
const ws = p.welds.filter(inView);
// Clamped to the canvas: a drag that starts over the inspector never reaches the viewport.
const box = [Math.max(1, Math.min(...ws.map(w => w[0])) - 6), Math.max(1, Math.min(...ws.map(w => w[1])) - 6), Math.min(vb.width - 1, Math.max(...ws.map(w => w[0])) + 6), Math.min(vb.height - 1, Math.max(...ws.map(w => w[1])) + 6)];
const inBox = i => p.welds[i][0] >= box[0] && p.welds[i][0] <= box[2] && p.welds[i][1] >= box[1] && p.welds[i][1] <= box[3];
const expectBox = p.welds.map((w, i) => i).filter(i => inBox(i) && p.welds[i][2]);
const occludedInBox = p.welds.map((w, i) => i).filter(i => inBox(i) && !p.welds[i][2]).length;
check('the box also covers occluded vertices (so the test is meaningful)', occludedInBox > 0, `${occludedInBox} occluded inside`);
await page.keyboard.down('Shift');
await dragPx(box[0], box[1], box[2], box[3], 12);
await page.keyboard.up('Shift');
p = await probe();
check('Shift+drag box selects the visible vertices in the box', expectBox.length > 0 && same(p.sel, expectBox), `box took ${p.sel.length}, expected ${expectBox.length}`);
await vpShot('clk-05-box-select');

// ---------------------------------------------------------------- gizmo move, scale, rotate (item 3)
await key('Control+KeyA');
p = await probe();
check('Ctrl+A selects every vertex in vertex mode', p.sel.length === p.welds.length, `${p.sel.length} of ${p.welds.length}`);
const recipe0 = await recipe();
await key('KeyW');
let A = await anchor();
const before = await probe();
check('W gives the move gizmo at the selection centre', (await probe()).tool === 'translate' && (await probe()).gizmo === true);
await dragPx(A[0], A[1], A[0] + 60, A[1]);
const afterMove = await probe();
const dxMean = (xs(afterMove.welds).reduce((s, x) => s + x, 0) - xs(before.welds).reduce((s, x) => s + x, 0)) / before.welds.length;
check('W drag moves the selected vertices with the gizmo', Math.abs(dxMean - 60) < 12, `mean dx ${dxMean.toFixed(1)} px for a 60 px drag`);
check('move is one undo step labelled Move vertices', (await lastLabel()) === 'Move vertices', await lastLabel());
await key('Control+KeyZ');
check('Ctrl+Z undoes the vertex move', (await recipe()) === recipe0);

await key('KeyR');
A = await anchor();
const sBefore = await probe();
await dragPx(A[0], A[1], A[0] + 60, A[1]);
const sAfter = await probe();
const sRatio = spread(xs(sAfter.welds)) / spread(xs(sBefore.welds));
check('R drag scales the selection about its centre by a bounded factor (60 px drag)', sRatio > 1.2 && sRatio < 2.5,
  `x spread ${spread(xs(sBefore.welds))} -> ${spread(xs(sAfter.welds))} px, x${sRatio.toFixed(2)}`);
check('scale is one undo step labelled Scale vertices', (await lastLabel()) === 'Scale vertices', await lastLabel());
await vpShot('clk-06-gizmo-scale');
await key('Control+KeyZ');
check('Ctrl+Z undoes the vertex scale', (await recipe()) === recipe0);

await key('KeyE');
let hitR = 0;
for (const r of [30, 45, 60, 75, 90, 110, 130]) {
  A = await anchor();
  await dragPx(A[0] + r, A[1], A[0] + r, A[1] + 70);
  if ((await lastLabel()) === 'Rotate vertices') { hitR = r; break; }
}
const rotated = hitR > 0;
check('E drag on the rotate ring rotates the selection (scan of ring radii)', rotated, rotated ? 'ring hit at ' + hitR + ' px from the centre' : 'no hit');
if (rotated) {
  await vpShot('clk-07-gizmo-rotate');
  await key('Control+KeyZ');
  check('Ctrl+Z undoes the vertex rotate', (await recipe()) === recipe0);
}

await key('KeyQ');
check('Q keeps the selection but detaches the gizmo', (await probe()).gizmo === false);

// ---------------------------------------------------------------- inspector, views, frame (items 4, 6)
await key('Tab');   // back to part mode
await page.locator('.mdl-row').nth(0).click(); await pause(150);
await key('KeyN');
check('N collapses the inspector', (await probe()).side === false && await page.locator('.mdl-side').isHidden());
await shot('clk-08-inspector-collapsed');
await key('KeyN');
check('N opens the inspector again', (await probe()).side === true);

await key('Numpad1');
p = await probe();
check('Numpad 1 gives front orthographic', p.proj === 'ortho' && Math.abs(p.dir[2] + 1) < 0.05, `dir ${p.dir}`);
await vpShot('clk-09-ortho-front');
await key('Numpad3');
p = await probe();
check('Numpad 3 gives side orthographic', p.proj === 'ortho' && Math.abs(p.dir[0] + 1) < 0.05, `dir ${p.dir}`);
await vpShot('clk-10-ortho-side');
await key('Numpad7');
p = await probe();
check('Numpad 7 gives top orthographic', p.proj === 'ortho' && Math.abs(p.dir[1] + 1) < 0.05, `dir ${p.dir}`);
await vpShot('clk-11-ortho-top');
await key('Numpad5');
check('Numpad 5 toggles back to perspective', (await probe()).proj === 'persp');

// F frames the selected part: its anchor ends up near the viewport centre.
await await key('KeyW');   // gizmo attached again: the anchor readout only refreshes while it is
await pause(300);
await key('KeyF');
await pause(300);
A = await anchor();
check('F frames the selected part at the viewport centre', Math.hypot(A[0] - vb.width / 2, A[1] - vb.height / 2) < 40, `anchor ${A}, centre ${vb.width / 2},${vb.height / 2}`);

// Part duplicate, delete and undo run from the panel's own keys, not the shell's.
const n0 = await partCount();
await key('Control+KeyD');
check('Ctrl+D duplicates one part (panel key, not shell)', (await partCount()) === n0 + 1, `${n0} -> ${await partCount()}`);
await key('Delete');
check('Delete removes the selected part', (await partCount()) === n0, `${await partCount()}`);
await key('Control+KeyZ');
check('Ctrl+Z restores the deleted part', (await partCount()) === n0 + 1);
await key('Control+KeyZ');
check('Ctrl+Z undoes the duplicate', (await partCount()) === n0);
await shot('clk-12-after-keys');

// ---------------------------------------------------------------- export (item 7)
const got = [];
page.on('download', d => got.push(d));
await page.locator('.mdl-bar button[title^="Export"]').click();
await pause(3000);
for (const d of got) await d.saveAs(path.join(OUT, 'export', d.suggestedFilename()));
const names = got.map(d => d.suggestedFilename()).sort();
check('Export downloads models.json and preview.html', JSON.stringify(names) === JSON.stringify(['models.json', 'preview.html']), names.join(', '));

// preview.html from disk, no network, orbit and file drop work.
const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const pv = await ctx2.newPage();
const external = [], pvErr = [];
pv.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) external.push(r.url()); });
pv.on('pageerror', e => pvErr.push('pageerror: ' + e.message));
pv.on('console', m => { if (m.type() === 'error') pvErr.push(m.text()); });
await pv.goto('file://' + path.join(OUT, 'export', 'preview.html'));
await pv.waitForFunction(() => document.querySelector('#stats')?.textContent.includes('polys'), null, { timeout: 60000 });
await pause(600);
check('preview.html opens from file:// with no network requests', external.length === 0 && pvErr.length === 0, `external ${external.length}, errors ${pvErr.length}`);
await pv.screenshot({ path: `${OUT}/clk-13-preview-offline.png` });
const models = await pv.locator('#model option').count();
check('preview.html lists every exported model', models === JSON.parse(fs.readFileSync(path.join(OUT, 'export', 'models.json'), 'utf8')).models.length, `${models} options`);
const orbitBefore = await pv.screenshot();
const cvs = await pv.locator('#view canvas').boundingBox();
await pv.mouse.move(cvs.x + cvs.width / 2, cvs.y + cvs.height / 2); await pv.mouse.down();
for (let i = 1; i <= 10; i++) { await pv.mouse.move(cvs.x + cvs.width / 2 + i * 12, cvs.y + cvs.height / 2); await pause(20); }
await pv.mouse.up(); await pause(400);
check('preview orbit drag rotates the view', !orbitBefore.equals(await pv.screenshot()));
await pv.setInputFiles('#file', path.join(OUT, 'export', 'models.json'));
await pause(800);
check('preview.html reopens a models.json through the file input', (await pv.locator('#model option').count()) === models && pvErr.length === 0);
await ctx2.close();

// ---------------------------------------------------------------- dispose (item 9)
const live0 = await page.evaluate(() => { window.__mv = window.studio.bag.modelingView; return window.__mv.liveCount(); });
check('the panel holds GPU objects and listeners while open', live0.objects > 0 && live0.listeners > 0, JSON.stringify(live0));
await page.evaluate(() => window.studio.bag.dock.getPanel('modeling')?.api.close());
await pause(800);
const live1 = await page.evaluate(() => window.__mv.liveCount());
check('closing the panel disposes it (0 objects, context lost)', live1.objects === 0 && live1.contextLost === true && live1.listeners === 0, JSON.stringify(live1));

check('no page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter(r => !r.ok).length;
fs.writeFileSync(path.join(OUT, 'clicktest.json'), JSON.stringify(results, null, 2));
console.log(`${results.length - failed} of ${results.length} passed; shots in ${OUT}`);
process.exitCode = failed ? 1 : 0;
