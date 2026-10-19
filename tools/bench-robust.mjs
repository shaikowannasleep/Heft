// Robustness in the real UI: a maxed start (P0-1), a level the worker cannot run (error path), and recovery.
// Checks the statusbar and the Solvability panel, and times edit-to-result. Usage: node tools/bench-robust.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5190/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.studio?.bag?.dock, null, { timeout: 30000 });
await page.evaluate(() => window.studio.bag.dock.getPanel('solvability')?.api.setActive());
const FINAL = /bench: (SOLVABLE|AT RISK|UNSOLVABLE|STATIC OK) · \d+ runs · \d+ ms/;
const statusText = () => page.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '');
const panel = () => page.evaluate(() => ({ badge: document.querySelector('.sv-badge')?.textContent, fail: document.querySelector('.sv-fail')?.textContent ?? '', stale: !!document.querySelector('.sv.stale') }));
const waitFinal = (after = '') => page.waitForFunction(([re, a]) => { const t = document.querySelector('.statusbar')?.textContent ?? ''; return t !== a && new RegExp(re).test(t); }, [FINAL.source, after], { timeout: 90000, polling: 10 });
const timed = async (label, code) => {
  const before = await statusText(), t0 = Date.now();
  await page.evaluate(code);
  await waitFinal(before);
  const ms = Date.now() - t0;
  console.log(`${label}: ${ms} ms to final result | ${(await statusText()).match(/bench:.*?ms/)?.[0] ?? (await statusText()).match(/bench:.*/)?.[0]}`);
  return ms;
};

await waitFinal('');
console.log('start:', await statusText().then(t => t.match(/bench:.*/)?.[0]), JSON.stringify(await panel()));

// P0-1a: level starts with every upgrade owned. Old code threw on W.buys[-1].day and stuck at 'bench: running'.
await timed('maxed upgrades', () => window.studio.store.update('maxed', p => { p.level.upgrades = { pack: 3, tool: 3 }; }));
console.log('  panel:', JSON.stringify(await panel()));

// P0-1b: a level the worker cannot build (unknown structure type) must post an error, not hang or show a stale verdict as current
await page.evaluate(() => window.studio.store.update('bad-structure', p => { p.level.structures.push({ id: 9999, type: 'no-such-type', x: 0, z: 30, rot: 0 }); }));
await page.waitForFunction(() => /result unavailable/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000, polling: 10 }).catch(() => {});
const failed = await statusText();
const pf = await panel();
console.log('error path status:', failed.match(/bench:.*/)?.[0] ?? '(no unavailable message)', '| panel:', JSON.stringify(pf));
console.log('  stale shown while failed:', pf.stale ? 'yes' : 'NO');

// recovery: removing the bad structure must produce a fresh verdict and clear the failure
await timed('recover', () => window.studio.store.update('fix', p => { p.level.structures = p.level.structures.filter(s => s.id !== 9999); }));
console.log('  panel after recovery:', JSON.stringify(await panel()));

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
