// Boots the studio in headless Chromium, fails on any page error, writes a screenshot.
// usage: node tools/smoke.mjs [url] [out.png]   (start `npm run dev` first, or pass a URL)
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5190/';
const out = process.argv[3] || 'scratch/smoke.png';
fs.mkdirSync('scratch', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.studio, null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
const info = await page.evaluate(() => ({ panels: window.studio.bag.dock.panels.map(p => p.id), nodes: window.studio.nodeIds().length }));
console.log(JSON.stringify(info), 'screenshot:', out);
await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
