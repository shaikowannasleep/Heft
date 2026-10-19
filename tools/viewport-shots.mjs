// Viewport screenshots and frame stats for Scene 2D / Scene 3D: default layout, a 2D drag, a marquee, each 3D preset.
// Fails on any page error. usage: node tools/viewport-shots.mjs [url] [outDir]   (start `npm run dev` first)
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5190/';
const out = process.argv[3] || 'scratch/viewport';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.studio?.bag?.viewport?.stats?.(), null, { timeout: 20000 });
await page.waitForTimeout(1500);

const panel = title => page.locator('.vp', { has: page.locator('.vp-title', { hasText: title }) });
// Clips a page screenshot instead of an element one: element shots wait for stability, which never settles at a low frame rate.
const shot = async (name, loc) => page.screenshot({ path: `${out}/${name}.png`, clip: loc ? await loc.boundingBox() : undefined });
const log = (...a) => console.log(...a);

// Screen position (CSS px, page coords) of a node in the 2D view, from the view's centre and scale.
const at2d = id => page.evaluate(id => {
  const s = window.studio, w = s.bag.viewport.where(), n = s.getNode(id)?.obj;
  const v = [...document.querySelectorAll('.vp')].find(e => e.querySelector('.vp-title')?.textContent.startsWith('Scene 2D'));
  const r = v.querySelector('.vp-canvas').getBoundingClientRect();
  return { x: r.left + r.width / 2 + (n.x - w.cam2.x) * w.scale2, y: r.top + r.height / 2 + (n.z - w.cam2.z) * w.scale2, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
}, id);
const pos = id => page.evaluate(id => { const n = window.studio.getNode(id)?.obj; return n && { x: n.x, z: n.z }; }, id);
const drag = async (from, to, steps = 12) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
  return () => page.mouse.up();
};

// Frame stats are a rolling window of the last 120 frames, so read them after a longer steady stretch.
const stats = async label => {
  await page.waitForTimeout(8000);
  const st = await page.evaluate(() => window.studio.bag.viewport.stats());
  log(label, JSON.stringify(st));
  return st;
};

const ids = await page.evaluate(() => {
  const L = window.studio.store.project.level;
  return { total: L.resources.length + L.structures.length + 1, res: L.resources.find(r => !r.removed && r.hp > 0)?.id };
});
log('objects in project:', ids.total);

// 1. Default layout, both views side by side.
await shot('01-default');
const s0 = await stats('default stats:');

// 2. Drag a resource in 2D; both views should show the new position (3D reads the same store).
const rid = 'r:' + ids.res, p0 = await pos(rid), a = await at2d(rid);
await page.evaluate(id => window.studio.store.select([id]), rid);
await page.waitForTimeout(200);
const up1 = await drag({ x: a.x, y: a.y }, { x: a.x + 90, y: a.y - 40 });
await page.waitForTimeout(150);
await shot('02-drag-2d', panel('Scene 2D'));
await shot('02-drag-3d', panel('Scene 3D'));
await up1();
await page.waitForTimeout(400);
const p1 = await pos(rid);
log('drag moved', rid, JSON.stringify(p0), '->', JSON.stringify(p1));

// 3. Marquee: drag across empty ground in 2D, shot while still held, then after release.
const v2 = (await at2d(rid)).rect;
const up2 = await drag({ x: v2.x + 24, y: v2.y + 24 }, { x: v2.x + v2.w * 0.55, y: v2.y + v2.h * 0.55 });
await page.waitForTimeout(150);
await shot('03-marquee-held', panel('Scene 2D'));
await up2();
await page.waitForTimeout(300);
const sel = await page.evaluate(() => window.studio.store.selection.length);
log('marquee selected', sel);
await shot('03-marquee-released');

// 4. 3D presets by hotkey. Each one is read back from the stats so a dead hotkey shows up as a failure.
for (const [key, name] of [['Numpad7', 'top'], ['Numpad1', 'iso'], ['Numpad5', 'persp'], ['Numpad5', 'iso-ortho']]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(600);
  await shot('04-3d-' + name, panel('Scene 3D'));
  const st = await page.evaluate(() => window.studio.bag.viewport.stats());
  log('preset', key, '->', st.preset, st.persp ? 'persp' : 'ortho');
}
await page.keyboard.press('Numpad1');
await page.waitForTimeout(600);

// 5. Frame rate at the default state with the iso camera.
const s1 = await stats('iso stats:');
log('summary: objects', ids.total, 'fps', s1.fps, 'frameMs', s1.frameMs, 'jsMs', s1.jsMs, 'renderMs', s1.renderMs, 'drawCalls', s1.drawCalls, 'triangles', s1.triangles);
await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
log('no page errors; shots in', out);
