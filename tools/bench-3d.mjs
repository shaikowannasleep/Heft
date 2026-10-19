// Scene 3D check: the bench overlays (claims, walled-in, trail) show up in the 3D viewport after toggling.
// Writes scratch/bench-scene3d.png. Usage: node tools/bench-3d.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = '/Users/macbook/Heft/repo-editor/scratch';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.studio?.bag?.dock, null, { timeout: 30000 });
await page.waitForFunction(() => /runs, \d+ ms|\(fast\)/.test(document.querySelector('.bn-status')?.textContent ?? ''), null, { timeout: 60000 });
// walled-in state so the walled markers and cut circles are there too
await page.evaluate(() => window.studio.store.update('break-ring', p => {
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; p.level.structures.push({ id: 9000 + k, type: 'wall', x: 1.4 + 2.6 * Math.cos(a), z: 4.2 + 2.6 * Math.sin(a), rot: a + Math.PI / 2 }); }
}));
await page.waitForFunction(() => /runs, \d+ ms/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 60000, polling: 10 }).catch(() => {});
await page.waitForTimeout(1500);
await page.evaluate(() => window.studio.bag.dock.getPanel('scene3d')?.api.setActive());
await page.waitForTimeout(800);
// turn on the 3D-capable overlays through the bench panel checkboxes
await page.evaluate(() => window.studio.bag.dock.getPanel('bench')?.api.setActive());
await page.waitForTimeout(300);
for (const label of ['Claim radii', 'Best run trail']) {
  await page.locator('.bn-ov label', { hasText: label }).locator('input').check();
}
await page.evaluate(() => window.studio.bag.dock.getPanel('scene3d')?.api.setActive());
await page.waitForTimeout(1200);
await page.locator('.dv-content-container, .dockview-theme-abyss, body').first().screenshot({ path: `${out}/bench-scene3d-check.png` }).catch(() => {});
await page.screenshot({ path: `${out}/bench-scene3d.png` });
console.log('overlays enabled:', await page.evaluate(() => window.studio.bag.overlays.filter(o => o.id.startsWith('bench.')).map(o => `${o.id}=${o.enabled}/rev${o.rev}`).join(' ')));
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
