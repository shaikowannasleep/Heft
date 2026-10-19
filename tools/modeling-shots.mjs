// Headless check for the Model Editor: part and vertex mode, a gizmo drag, the parity page, and the game with an edited tree.
// Needs the dev server (npm run dev). Writes PNGs to SHOT_DIR (default /tmp/modeling-shots) and prints a summary.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.HEFT_URL ?? 'http://localhost:5190';
const OUT = process.env.SHOT_DIR ?? '/tmp/modeling-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const result = {};

await page.goto(BASE + '/');
await page.waitForFunction(() => window.studio);
await page.evaluate(() => window.studio.bag.dock.getPanel('modeling')?.api.setActive());
await page.waitForSelector('.mdl', { timeout: 10000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/part-mode.png` });

// Vertex mode: focus the panel, select every weld, and drag the gizmo from the viewport centre.
await page.locator('.mdl-bar button[title^="Vertex mode"]').click();
const vp = await page.locator('.mdl-vp').boundingBox();
await page.locator('.mdl-vp').click({ position: { x: 20, y: 20 } });
await page.keyboard.press('Control+a');
await page.waitForTimeout(400);
const [ax, ay] = (await page.locator('.mdl-vp').getAttribute('data-anchor')).split(',').map(Number);
const cx = vp.x + ax, cy = vp.y + ay;
await page.screenshot({ path: `${OUT}/vertex-mode.png` });
const before = await page.evaluate(() => window.studio.store.past.length);
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 6, cy); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(300);
result.vertexDrag = await page.evaluate(b => ({ steps: window.studio.store.past.length - b, label: window.studio.store.past.at(-1)?.label, edited: window.studio.bag.models.edited('tree.0') }), before);
await page.keyboard.press('Control+z');
result.undoRestored = await page.evaluate(() => !window.studio.bag.models.edited('tree.0'));
await page.locator('.mdl-bar button[title^="Part mode"]').click();
await page.screenshot({ path: `${OUT}/part-mode-after.png` });

// Game: tint the oak through the models bag, then hand the level and models to the game with the same postMessage the playtest uses.
await page.evaluate(() => window.studio.bag.models.edit('Tint oak', 'tree.1', rec => { rec.forEach(p => { p.color = 0xff00ff; }); }));
result.gameTree = await page.evaluate(() => new Promise(res => {
  const frame = () => document.querySelector('iframe[title="Heft playtest"]');
  addEventListener('message', e => {
    if (e.data?.type !== 'heft:ready' || e.source !== frame()?.contentWindow) return;
    const s = window.studio;
    frame().contentWindow.postMessage({ type: 'heft:playtest', state: { ...s.data.toGameState(s.store.project), models: s.store.project.models } }, '*');
    res('sent models');
  });
  window.studio.bag.playtest();
}));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/game-edited-tree.png` });

// Standalone preview.html built from the live bag, opened from disk (three.js is inlined, so no network is needed).
const previewHtml = await page.evaluate(async () => { const m = await import('/src/modeling/preview.js'); const v = await import('/src/modeling/viewer.generated.js'); return m.previewHtml(JSON.stringify(m.modelsEnvelope(window.studio.bag.models)), v.LIB); });
fs.writeFileSync(`${OUT}/preview.html`, previewHtml);
const pv = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const previewErrors = [];
pv.on('pageerror', e => previewErrors.push('pageerror: ' + e.message));
pv.on('console', m => { if (m.type() === 'error') previewErrors.push('console: ' + m.text()); });
await pv.goto('file://' + `${OUT}/preview.html`);
await pv.waitForFunction(() => document.querySelector('#stats')?.textContent.includes('polys'), null, { timeout: 30000 });
await pv.waitForTimeout(800);
await pv.screenshot({ path: `${OUT}/preview.png` });
result.previewErrors = previewErrors;

// Parity page.
await page.goto(BASE + '/tools/modeling-compare.html');
await page.waitForFunction(() => document.body.dataset.done === '1', null, { timeout: 60000 });
result.parity = await page.evaluate(() => JSON.parse(document.body.dataset.parity).map(r => `${r.name}: ${r.gameVerts}/${r.editorVerts} verts, pos ${r.posDelta}, ${r.pass ? 'match' : 'DIFF'}`));
await page.screenshot({ path: `${OUT}/parity.png`, fullPage: true });

await browser.close();
console.log(JSON.stringify({ result, errors, shots: OUT }, null, 2));
process.exitCode = errors.length ? 1 : 0;
