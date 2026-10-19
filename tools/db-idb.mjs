// Browser check of the db pillar against real IndexedDB: autosave, Mod+S, reload, export and import of .heftb.
// usage: node tools/db-idb.mjs [url]   (start `npm run dev` first)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5190/';
// Edits use values unique to this run: an earlier run's data is still in IndexedDB, and a no-op edit writes nothing.
const T = 1000 + (Date.now() % 900000);
fs.mkdirSync('scratch', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctxBrowser = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
const page = await ctxBrowser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const revCount = () => ev(() => new Promise((res, rej) => {
  const r = indexedDB.open('heft-studio');
  r.onsuccess = () => { const q = r.result.transaction('revs').objectStore('revs').count(); q.onsuccess = () => { res(q.result); r.result.close(); }; q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}));
const boot = async () => { await page.goto(url); await page.waitForFunction(() => window.studio, null, { timeout: 15000 }); await page.waitForTimeout(800); };
// Vite HMR can reload the page while other code is being edited: wait for the studio and retry once.
const ev = async (fn, arg) => {
  for (let k = 0; ; k++) {
    try { await page.waitForFunction(() => window.studio, null, { timeout: 15000 }); return await page.evaluate(fn, arg); }
    catch (e) { if (k >= 2 || !/context was destroyed|Target closed/.test(e.message)) throw e; await page.waitForTimeout(1000); }
  }
};

await boot();
const before = await revCount();
console.log('revisions after first load:', before);
assert.ok(before >= 1, 'the initial revision is written on first load');

// Autosave: an edit becomes a revision after the debounce, without Mod+S.
await ev(t => window.studio.store.update('test edit', d => { d.level.resources[0].hp = t; }), T);
await page.waitForTimeout(2600);
const afterAuto = await revCount();
assert.equal(afterAuto, before + 1, 'autosave wrote one revision');
assert.equal(await ev(() => window.studio.store.dirty), false);

// Mod+S: manual save of an unchanged project writes nothing new.
await ev(t => window.studio.store.update('test edit 2', d => { d.level.resources[1].hp = t; }), T + 1);
await ev(() => 0); await page.keyboard.press('Control+s');
await page.waitForTimeout(600);
assert.equal(await revCount(), afterAuto + 1, 'Mod+S saved the edit');

// Reload: the latest revision comes back.
await boot();
const hp = await ev(() => [window.studio.store.project.level.resources[0].hp, window.studio.store.project.level.resources[1].hp]);
assert.deepEqual(hp, [T, T + 1], 'reload restores the edits');
console.log('reload restored edits:', hp);

// Export through the browser download path, then import the same file through the file chooser.
const dl = page.waitForEvent('download');
await ev(() => { window.studio.run('file.saveHeftb'); });
const file = await dl;
const out = 'scratch/db-export.heftb';
await file.saveAs(out);
const size = fs.statSync(out).size;
console.log('exported', out, size, 'bytes');
await ev(() => window.studio.store.update('before import', d => { d.level.resources[0].hp = 9; }));
await page.waitForTimeout(2600);
const chooser = page.waitForEvent('filechooser');
await ev(() => { window.studio.run('file.openHeftb'); });
(await chooser).setFiles(out);
await page.waitForTimeout(1200);
assert.equal(await ev(() => window.studio.store.project.level.resources[0].hp), T, 'import restores the exported project');
// A corrupt file is refused and the project is left alone.
const bad = 'scratch/db-bad.heftb';
const raw = fs.readFileSync(out); raw[raw.length >> 1] ^= 0xff; fs.writeFileSync(bad, raw);
await ev(() => window.studio.store.update('before bad import', d => { d.level.resources[0].hp = 3; }));
await page.waitForTimeout(2600);
const chooser2 = page.waitForEvent('filechooser');
await ev(() => { window.studio.run('file.openHeftb'); });
(await chooser2).setFiles(bad);
await page.waitForTimeout(800);
assert.equal(await ev(() => window.studio.store.project.level.resources[0].hp), 3, 'corrupt file did not change the project');
console.log('corrupt import refused; project unchanged');

console.log('IndexedDB checks passed. revisions:', await revCount());
await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
