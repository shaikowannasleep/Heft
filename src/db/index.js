// Pillar module: db. Replaces ctx.persist with the revision store, adds autosave, the Data panel and .heftb import/export.
// Contract in docs/ARCHITECTURE.md.
import { fmtBytes } from '../shell/app.js';
import { h, toast } from '../core/dom.js';
import { encodeHeftb, decodeHeftb } from './codec.js';
import { ProjectDB } from './store.js';
import { idbAdapter, memoryAdapter } from './adapters.js';
import { dataPanel } from './panel.js';
import './db.css';

const AUTOSAVE_MS = 1500;
const when = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function install(ctx) {
  const ready = (async () => {
    let adapter;
    try { adapter = idbAdapter(); await adapter.all('revs'); }
    catch (e) { console.warn('IndexedDB unavailable, revisions kept in memory', e); adapter = memoryAdapter(); ctx.setStatus('db', 'memory only'); }
    const db = new ProjectDB(adapter, { onWarn: m => ctx.setStatus('db', `⚠ ${m}`) });
    await db.open();
    navigator.storage?.persist?.().catch(() => { });   // ask the browser not to evict the database
    return db;
  })();
  const status = text => ctx.setStatus('db', text);
  const saved = (r, verb) => { status(`${fmtBytes(r.bytes)} ${verb} ${when()}`); ctx.store.emit('db'); };

  // ctx.persist: Mod+S saves a manual revision; load returns the newest one.
  ctx.persist = {
    async save(project) {
      const r = await (await ready).save(project, { label: 'save', auto: false });
      saved(r, 'saved'); return { bytes: r.bytes };
    },
    async load() {
      const db = await ready, p = await db.latest();
      if (p) return p;
      await db.save(ctx.store.project, { label: 'initial' });
      return null;
    },
  };

  // Debounced autosave: a project edit schedules a revision; the flag clears only if nothing changed meanwhile.
  let timer = 0;
  async function autosave() {
    clearTimeout(timer); timer = 0;
    const project = ctx.store.project;
    if (!ctx.store.dirty) return;
    try {
      const r = await (await ready).save(project, { label: 'autosave' });
      if (ctx.store.project === project) ctx.store.dirty = false;
      saved(r, 'autosaved');
    } catch (e) { status(`⚠ not saved: ${e.message}`); toast(e.message, 'err', 6000); }
  }
  ctx.store.on(why => { if (why === 'project') { clearTimeout(timer); timer = setTimeout(autosave, AUTOSAVE_MS); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) autosave(); });

  const download = (bytes, name) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const pickFile = () => new Promise(res => {
    const inp = h('input', { type: 'file', accept: '.heftb' });
    inp.onchange = async () => res(inp.files[0] ? new Uint8Array(await inp.files[0].arrayBuffer()) : null);
    inp.click();
  });

  async function saveHeftb() {
    const project = ctx.store.project, bytes = encodeHeftb(project), name = `${project.name || 'level'}.heftb`;
    try {
      if (window.heftDesktop) await window.heftDesktop.saveAs(name, bytes); else download(bytes, name);
      toast(`Exported ${name} · ${fmtBytes(bytes.length)}`, 'ok', 1800);
    } catch (e) { toast(`Export failed: ${e.message}`, 'err', 6000); }
  }
  async function openHeftb() {
    try {
      let bytes;
      if (window.heftDesktop) { const r = await window.heftDesktop.open([{ name: 'Heft save', extensions: ['heftb'] }]); bytes = r?.bytes ? new Uint8Array(r.bytes) : null; }
      else bytes = await pickFile();
      if (!bytes) return;
      const { project } = decodeHeftb(bytes);   // strict: a bad file throws here and nothing is loaded
      if (project.format !== 'heft-studio') throw new Error('not a Heft Studio project');
      if (ctx.store.dirty && !confirm('Discard unsaved changes?')) return;
      ctx.store.replace(project);
      saved(await (await ready).save(project, { label: 'opened file', auto: false }), 'saved');
      toast(`Opened ${project.name}`, 'ok', 1800);
    } catch (e) { toast(`Could not open: ${e.message}`, 'err', 6000); }
  }

  ctx.registerCommand({ id: 'file.saveHeftb', label: 'Save as .heftb…', keys: 'Mod+Shift+S', menu: 'File', run: saveHeftb });
  ctx.registerCommand({ id: 'file.openHeftb', label: 'Open .heftb…', menu: 'File', run: openHeftb });
  ctx.registerPanel(dataPanel({ ctx, ready, io: { saveHeftb, openHeftb } }));
  ready.then(db => db.stats()).then(s => status(`${s.count} revisions · ${fmtBytes(s.bytes)}`), e => status(`⚠ ${e.message}`));
}
