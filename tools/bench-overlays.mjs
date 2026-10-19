// Calls each bench overlay's draw2d on a plain canvas with a fake view, checks something was painted, and saves a PNG.
// Usage: node tools/bench-overlays.mjs [url]   (needs the dev server; the overlays come from the running app)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = '/Users/macbook/Heft/repo-editor/scratch';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.studio?.bag?.dock && document.querySelector('.bn-status'), null, { timeout: 30000 });
await page.waitForFunction(() => /runs, \d+ ms/.test(document.querySelector('.bn-status')?.textContent ?? ''), null, { timeout: 60000 });

// the walled-in state: a palisade ring around the spawn (same edit as bench-shots.mjs)
const before = await page.evaluate(() => document.querySelector('.bn-status').textContent);
await page.evaluate(() => window.studio.store.update('break-ring', p => {
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; p.level.structures.push({ id: 9000 + k, type: 'wall', x: 1.4 + 2.6 * Math.cos(a), z: 4.2 + 2.6 * Math.sin(a), rot: a + Math.PI / 2 }); }
}));
await page.waitForFunction(b => document.querySelector('.bn-status')?.textContent !== b && /runs, \d+ ms/.test(document.querySelector('.bn-status').textContent), before, { timeout: 60000 });

const result = await page.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 900;
  const g = canvas.getContext('2d');
  // fake view: 8 px per metre, world (0,0) at the canvas centre, z down
  const view = { scale: 8, toScreen: (x, z) => [450 + x * 8, 450 + z * 8] };
  const ids = window.studio.bag.overlays.filter(o => o.id.startsWith('bench.'));
  const painted = {};
  for (const o of ids) {
    g.clearRect(0, 0, 900, 900);
    o.draw2d(g, view);
    const d = g.getImageData(0, 0, 900, 900).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    painted[o.id] = n;
  }
  // composite with every bench overlay on, to check that they line up with each other
  g.clearRect(0, 0, 900, 900);
  window.studio.bag.overlays.filter(o => o.id.startsWith('bench.')).forEach(o => { o.enabled = true; o.draw2d(g, view); });
  return { painted, png: canvas.toDataURL('image/png'), enabled: ids.map(o => [o.id, o.enabled, o.rev]) };
});
console.log(JSON.stringify({ painted: result.painted, enabled: result.enabled }));
writeFileSync(`${out}/bench-overlays.png`, Buffer.from(result.png.split(',')[1], 'base64'));
const zero = Object.entries(result.painted).filter(([, n]) => n === 0).map(([k]) => k);  // a walled-in state must paint the walled overlay
console.log('overlays painting nothing:', zero.length ? zero : 'none');
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
