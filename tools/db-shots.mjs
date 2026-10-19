// Screenshots of the Data panel after a run of edits and after Compact now. Fails on any page error.
// usage: node tools/db-shots.mjs [url]   (start `npm run dev` first)
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5190/';
fs.mkdirSync('scratch', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.studio, null, { timeout: 15000 });
await page.waitForTimeout(1000);
await page.evaluate(() => window.studio.bag.dock.getPanel('data')?.api.setActive());
// A run of edits, each one a separate autosave revision.
const T = 1000 + (Date.now() % 900000);
for (let i = 0; i < 14; i++) {
  await page.evaluate(([i, T]) => {
    const s = window.studio;
    if (i % 5 === 4) s.run('add.tree');
    else s.store.update('shot edit ' + i, d => { d.level.resources[i].hp = T + i; });
  }, [i, T]);
  await page.waitForTimeout(1700);
}
await page.waitForTimeout(600);
await page.screenshot({ path: 'scratch/db-shot-edits.png' });
const panel = page.locator('.db-panel');
await panel.screenshot({ path: 'scratch/db-panel-edits.png' });
await page.getByRole('button', { name: 'Compact now' }).click();
await page.waitForTimeout(900);
await panel.screenshot({ path: 'scratch/db-panel-compact.png' });
const note = await page.locator('.db-note').textContent();
console.log('compact note:', note);
const overflow = await page.evaluate(() => { const p = document.querySelector('.db-panel'); return p ? p.scrollWidth - p.clientWidth : -1; });
console.log('horizontal overflow px:', overflow);
console.log('screenshots: scratch/db-shot-edits.png scratch/db-panel-edits.png scratch/db-panel-compact.png');
await page.close(); await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
