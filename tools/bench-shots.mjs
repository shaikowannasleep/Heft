// Screenshots of the Capacity Bench and Solvability panels: default level, then a breaking edit (player walled in).
// Both panels share one dock tab group, so each capture activates its tab first. Writes scratch/bench-*.png.
// Usage: node tools/bench-shots.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = '/Users/macbook/Heft/repo-editor/scratch';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.studio?.bag?.dock, null, { timeout: 30000 });

const show = async id => {
  await page.evaluate(id => window.studio.bag.dock.getPanel(id)?.api.setActive(), id);
  await page.waitForFunction(id => id === 'bench' ? /runs, \d+ ms/.test(document.querySelector('.bn-status')?.textContent ?? '')
    : !!document.querySelector('.sv-badge') && document.querySelector('.sv-badge').textContent !== 'checking...', id, { timeout: 60000 });
};
const badge = () => page.evaluate(() => document.querySelector('.sv-badge')?.textContent);

await show('bench');
console.log('default bench:', await page.evaluate(() => document.querySelector('.bn-status').textContent));
await page.screenshot({ path: `${out}/bench-default.png` });
await page.locator('.bn').first().screenshot({ path: `${out}/bench-panel-default.png` });
await show('solvability');
const before = await badge();
console.log('default verdict:', before, await page.evaluate(() => [...document.querySelectorAll('.sv-issues li')].map(li => li.textContent)));
await page.locator('.sv').first().screenshot({ path: `${out}/bench-solv-default.png` });

// breaking edit: a ring of palisades 2.6 m around the spawn walls the player in
const t0 = Date.now();
await page.evaluate(() => window.studio.store.update('break-ring', p => {
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6;
    p.level.structures.push({ id: 9000 + k, type: 'wall', x: 1.4 + 2.6 * Math.cos(a), z: 4.2 + 2.6 * Math.sin(a), rot: a + Math.PI / 2 });
  }
}));
await page.waitForFunction(b => document.querySelector('.sv-badge')?.textContent !== b && document.querySelector('.sv-badge')?.textContent !== 'checking...', before, { timeout: 60000 });
console.log('breaking verdict:', await badge(), 'after', Date.now() - t0, 'ms wall time');
console.log(await page.evaluate(() => [...document.querySelectorAll('.sv-issues li')].slice(0, 5).map(li => li.textContent)));
await page.screenshot({ path: `${out}/bench-breaking.png` });
await page.locator('.sv').first().screenshot({ path: `${out}/bench-solv-breaking.png` });
await show('bench');
await page.locator('.bn').first().screenshot({ path: `${out}/bench-panel-breaking.png` });
console.log('bench status after break:', await page.evaluate(() => document.querySelector('.bn-status').textContent));
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
