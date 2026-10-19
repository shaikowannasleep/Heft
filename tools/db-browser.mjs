// Browser pass for the Data panel and .heftb: reload restore, restore an older revision, pin, delete (non-head and head),
// Compact now, export and import .heftb, a corrupt .heftb with a clear error and the project intact, and a model edit
// that survives a .heftb round trip. Screenshots and files go to scratch/db/. Fails on any page error.
// usage: node tools/db-browser.mjs [url]   (start `npm run dev` first)
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5190/', OUT = 'scratch/db';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const check = (ok, what) => { log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
let failed = 0;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 960 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => d.accept());   // confirm() prompts: restore, delete, discard
const boot = async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.studio, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.studio.bag.dock.getPanel('data')?.api.setActive());
  await page.waitForSelector('.db-panel', { timeout: 10000 });
};
const hp = () => page.evaluate(() => window.studio.store.project.level.resources[0].hp);
const edit = (v) => page.evaluate(v => window.studio.store.update('browser edit ' + v, d => { d.level.resources[0].hp = v; }), v);
const scale = () => page.evaluate(() => window.studio.store.project.models?.['tree.0']?.[0]?.scale?.[0] ?? null);
const rows = () => page.locator('.db-table tbody tr');
const rowFor = i => rows().nth(i);
const settle = () => page.waitForTimeout(2600);   // autosave debounce is 1500 ms
const note = () => page.locator('.db-note').textContent().catch(() => '');
const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));

await boot();
// 1. Edit, edit, model edit: three revisions, then reload.
await edit(111); await settle();
await edit(222); await settle();
await page.evaluate(() => window.studio.bag.models.edit('Edit tree', 'tree.0', d => { d[0].scale[0] = 1.25; }));
await settle();
const hpBefore = await hp(), scaleBefore = await scale();
check(hpBefore === 222 && scaleBefore === 1.25, `edits in place (hp ${hpBefore}, tree scale ${scaleBefore})`);

// 2. Reload restores the newest revision.
await page.reload(); await page.waitForFunction(() => window.studio, null, { timeout: 15000 });
await page.waitForTimeout(1200);
check(await hp() === 222 && await scale() === 1.25, `reload restores the project (hp ${await hp()}, tree scale ${await scale()})`);
await page.evaluate(() => window.studio.bag.dock.getPanel('data')?.api.setActive());
await page.waitForSelector('.db-panel');
await page.locator('.db-table').first().screenshot({ path: `${OUT}/revisions-table.png` });
await page.locator('.db-panel').screenshot({ path: `${OUT}/panel-full.png` });

// 3. Restore an older revision (row 2: the state before the last two edits).
await rowFor(2).getByRole('button', { name: 'Restore' }).click();
await page.waitForTimeout(1200);
const hpOld = await hp();
check(hpOld !== 222, `restore older revision changes the project (hp now ${hpOld})`);

// 4. Pin and unpin the newest row.
await rowFor(0).getByRole('button', { name: /^(Pin|Unpin)$/ }).click();
await page.waitForTimeout(600);
check(await rowFor(0).getByRole('button', { name: 'Unpin' }).count() === 1, 'pin sets the Unpin label on the row');
await rowFor(0).getByRole('button', { name: 'Unpin' }).click(); await page.waitForTimeout(400);

// 5. Delete a non-head revision: the count drops by one and the project is untouched.
const before = await rows().count(), hpBeforeDel = await hp();
await rowFor(3).getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(1000);
const afterDel = await rows().count();
check(afterDel === before - 1 && await hp() === hpBeforeDel, `delete non-head: ${before} -> ${afterDel} rows, project unchanged`);

// 6. Delete the head: the open project is saved as a new revision first, so nothing is lost.
const headRow = rows().filter({ has: page.locator('.db-head, [data-head], :text("head")') }).first();
const headIdx = await page.evaluate(() => { const rs = [...document.querySelectorAll('.db-table tbody tr')]; return rs.findIndex(r => /head/i.test(r.textContent)); });
const hpHead = await hp();
if (headIdx >= 0) {
  await rowFor(headIdx).getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(1200);
  await page.waitForTimeout(400);
  check(await hp() === hpHead && await rows().count() === afterDel, `delete head keeps the open project (hp ${await hp()}), rows ${afterDel} -> ${await rows().count()}`);
} else check(false, 'found the head row');

// 7. Compact now.
await page.getByRole('button', { name: 'Compact now' }).click();
await page.waitForTimeout(900);
const compactNote = await note();
check(/Compacted/.test(compactNote) || /Compacted/.test(await toastText()), `Compact now reports sizes: ${compactNote.trim() || (await toastText())}`);
await page.locator('.db-panel').screenshot({ path: `${OUT}/panel-compact.png` });

// 8. Export .heftb (download), then a fresh edit so the import has something to change.
await edit(333); await page.evaluate(() => window.studio.bag.models.edit('Edit tree', 'tree.0', d => { d[0].scale[0] = 1.25; })); await settle();
const hpExported = await hp(), scaleExported = await scale();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as .heftb' }).click()]);
const good = `${OUT}/exported.heftb`;
await dl.saveAs(good);
check(fs.statSync(good).size > 0, `exported ${dl.suggestedFilename()} (${fs.statSync(good).size} bytes)`);
await edit(444); await page.evaluate(() => window.studio.bag.models.edit('Edit tree', 'tree.0', d => { d[0].scale[0] = 0.5; })); await settle();

// 9. Import: open the good file, the edited hp and the model edit come back.
const [fc1] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open .heftb' }).click()]);
await fc1.setFiles(good);
await page.waitForTimeout(1200);
check(scaleExported === 1.25 && await hp() === hpExported && await scale() === scaleExported, `import restores hp ${hpExported} and tree scale ${scaleExported} (was 0.5 before import)`);

// 10. Corrupt file: one flipped byte inside the body. Expect a clear error and the project intact.
const bytes = fs.readFileSync(good), bad = Buffer.from(bytes);
bad[bad.length >> 1] ^= 0x5a;
const badPath = `${OUT}/corrupt.heftb`;
fs.writeFileSync(badPath, bad);
const hpPre = await hp();
const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open .heftb' }).click()]);
await fc2.setFiles(badPath);
await page.waitForTimeout(1000);
const msg = await toastText();
check(/Could not open: file is corrupt/.test(msg), `corrupt file gives a clear error: ${msg.slice(0, 120)}`);
check(await hp() === hpPre, 'corrupt file leaves the current project intact');
await page.locator('.toasts').screenshot({ path: `${OUT}/corrupt-error.png` }).catch(() => {});

// 11. Growth chart screenshot.
const chart = page.locator('.db-panel svg').first();
if (await chart.count()) await chart.screenshot({ path: `${OUT}/growth-chart.png` });
check(await chart.count() > 0, 'growth chart is drawn');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' / ').slice(0, 300) : ''}`);
log(`screenshots and files in ${OUT}/`);
await page.close(); await browser.close();
if (failed) process.exit(1);
