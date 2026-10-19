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
// edit-to-result: the fast verdict (status 'refining') and the full pass (final status with runs and ms) as seen on the statusbar
const statusText = () => page.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '');
const FINAL = /bench: (SOLVABLE|AT RISK|UNSOLVABLE|STATIC OK) · \d+ runs · \d+ ms/;
const timeEdit = async (label, code) => {
  const before = await statusText(), t0 = Date.now();
  await page.evaluate(code);
  const fast = await page.waitForFunction(() => /\(fast\) · refining/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 60000, polling: 10 }).then(() => Date.now() - t0).catch(() => null);
  await page.waitForFunction(b => { const t = document.querySelector('.statusbar')?.textContent ?? ''; return t !== b && /bench: (SOLVABLE|AT RISK|UNSOLVABLE|STATIC OK) · \d+ runs · \d+ ms/.test(t); }, before, { timeout: 60000, polling: 10 });
  const full = Date.now() - t0;
  console.log(`edit ${label}: fast verdict ${fast ?? 'n/a'} ms, full result ${full} ms`, (await statusText()).match(/bench:.*?ms/)?.[0]);
};

await show('bench');
console.log('default bench:', await page.evaluate(() => document.querySelector('.bn-status').textContent));
await page.screenshot({ path: `${out}/bench-default.png` });
await page.locator('.bn').first().screenshot({ path: `${out}/bench-panel-default.png` });
await show('solvability');

console.log('default verdict:', await badge(), await page.evaluate(() => [...document.querySelectorAll('.sv-issues li')].map(li => li.textContent)));
await page.locator('.sv').first().screenshot({ path: `${out}/bench-solv-default.png` });

// breaking edit: a ring of palisades 2.6 m around the spawn walls the player in
await timeEdit('break-ring', () => window.studio.store.update('break-ring', p => {
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6;
    p.level.structures.push({ id: 9000 + k, type: 'wall', x: 1.4 + 2.6 * Math.cos(a), z: 4.2 + 2.6 * Math.sin(a), rot: a + Math.PI / 2 });
  }
}));
console.log('breaking verdict:', await badge());
console.log(await page.evaluate(() => [...document.querySelectorAll('.sv-issues li')].slice(0, 5).map(li => li.textContent)));
await page.screenshot({ path: `${out}/bench-breaking.png` });
await page.locator('.sv').first().screenshot({ path: `${out}/bench-solv-breaking.png` });
await show('bench');
await page.locator('.bn').first().screenshot({ path: `${out}/bench-panel-breaking.png` });
console.log('bench status after break:', await page.evaluate(() => document.querySelector('.bn-status').textContent));
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
