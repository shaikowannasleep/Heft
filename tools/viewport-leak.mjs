// WebGL context leak check for the viewport: closes and reopens Scene 3D through the Window menu N times and counts live contexts.
// Live = a WebGL context created on any canvas that has not been lost. Fails on any page error or console error, or if a view
// ever holds more than one live context, or if the count after the loop is not back to the starting value.
// usage: node tools/viewport-leak.mjs [url] [outDir] [cycles]   (start `npm run dev` first); exit code 0 = pass
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5190/';
const out = process.argv[3] || 'scratch/viewport';
const cycles = +(process.argv[4] || 10);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Recorded before any page script runs: every WebGL context handed out, so live ones can be counted without DevTools.
await page.addInitScript(() => {
  const made = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = orig.call(this, type, ...rest);
    if (gl && /webgl/.test(type) && !made.includes(gl)) made.push(gl);
    return gl;
  };
  // Only canvases of the viewport (class vp-canvas); other WebGL users on the page are counted separately.
  window.__glLive = () => made.filter(gl => !gl.isContextLost() && gl.canvas.classList.contains("vp-canvas")).length;
  window.__glAll = () => made.filter(gl => !gl.isContextLost()).length;
});

await page.goto(url);
await page.waitForFunction(() => window.studio?.bag?.viewport?.stats?.(), null, { timeout: 20000 });
await page.waitForTimeout(1500);

const live = () => page.evaluate(() => window.__glLive());
const all = () => page.evaluate(() => window.__glAll());
const toggle3d = async () => {
  await page.locator('button.mb', { hasText: 'Window' }).click();
  await page.locator('.menu .mi', { hasText: 'Scene 3D' }).click();
};
const open3d = () => page.locator('.vp', { has: page.locator('.vp-title', { hasText: 'Scene 3D' }) }).count();

const rows = [];
// Drives the Window-menu toggle until the 3D panel is in the wanted state, so a missed click is retried, not counted as a pass.
const setOpen = async want => {
  for (let t = 0; t < 5 && (await open3d()) !== want; t++) { await toggle3d(); await page.waitForTimeout(700); }
  return open3d();
};
const start = await live();
rows.push({ step: 'start', live: start, all: await all(), views3d: await open3d() });
for (let i = 1; i <= cycles; i++) {
  const v0 = await setOpen(0);
  await page.waitForTimeout(400);
  const closed = { live: await live(), views3d: v0 };
  const v1 = await setOpen(1);
  await page.waitForTimeout(900);
  const reopened = { live: await live(), views3d: v1 };
  rows.push({ step: i, closed, reopened });
  console.log(`cycle ${i}: closed live=${closed.live} views=${closed.views3d} | reopened live=${reopened.live} views=${reopened.views3d}`);
}
const st = await page.evaluate(() => window.studio.bag.viewport.stats());
const end = await live();
rows.push({ step: 'end', live: end, all: await all(), fps: st.fps, frameMs: st.frameMs });
fs.writeFileSync(`${out}/leak-loop.json`, JSON.stringify({ start, end, cycles, rows, errors }, null, 2));

const maxLive = Math.max(...rows.filter(r => r.reopened).map(r => r.reopened.live));
const pass = errors.length === 0 && maxLive <= 1 && end === start && st.fps > 0 && rows.every(r => !r.reopened || (r.closed.views3d === 0 && r.reopened.views3d === 1));
console.log(`start live=${start} end live=${end} max live with a view open=${maxLive} fps=${st.fps} errors=${errors.length}`);
for (const e of errors) console.log('  ' + e);
console.log(pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
