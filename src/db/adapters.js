// Storage adapters for ProjectDB. write(ops) is one atomic transaction; ops are {store, value} or {store, del: key}.
const KEYS = { revs: 'seq', projects: 'id' };

export function idbAdapter(name = 'heft-studio') {
  let db;
  const open = () => db ??= new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { for (const [s, key] of Object.entries(KEYS)) r.result.createObjectStore(s, { keyPath: key }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return {
    async all(s) {
      const d = await open();
      return new Promise((res, rej) => { const q = d.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    },
    async write(ops) {
      const d = await open();
      await new Promise((res, rej) => {
        const tx = d.transaction(Object.keys(KEYS), 'readwrite');
        for (const o of ops) 'del' in o ? tx.objectStore(o.store).delete(o.del) : tx.objectStore(o.store).put(o.value);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('transaction aborted'));
      });
    },
    async estimate() { const e = await navigator.storage?.estimate?.(); return e?.quota ? { usage: e.usage ?? 0, quota: e.quota } : null; },
  };
}

// In-memory stand-in with the same contract. quota caps the stored bytes so tests can hit the guard.
export function memoryAdapter({ quota = 1 << 30 } = {}) {
  let revs = new Map(), projects = new Map();
  const bytes = m => { let n = 0; for (const v of m.values()) n += v.data?.length ?? 0; return n; };
  const pick = s => s === 'revs' ? revs : projects;
  return {
    async all(s) { return [...pick(s).values()]; },
    async write(ops) {
      const next = { revs: new Map(revs), projects: new Map(projects) };
      for (const o of ops) 'del' in o ? next[o.store].delete(o.del) : next[o.store].set(o.value[KEYS[o.store]], o.value);
      if (bytes(next.revs) + bytes(next.projects) > quota) { const e = new Error('storage quota exceeded'); e.name = 'QuotaExceededError'; throw e; }
      revs = next.revs; projects = next.projects;
    },
    async estimate() { return { usage: bytes(revs) + bytes(projects), quota }; },
  };
}
