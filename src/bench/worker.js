// Bench Worker, one request = static analysis (posted at once), sim runs in chunks, then the cut search.
// A newer request id cancels the running one between chunks. Any failure is posted as an error, never swallowed.
import { simRun } from './sim.js';
import { staticAnalysis, verdict, cutSearchGen } from './solve.js';

let latest = 0;
const tick = () => new Promise(r => setTimeout(r, 0));

self.onmessage = async ({ data: { id, level, runs } }) => {
  latest = id;
  try {
    const t0 = performance.now(), stat = staticAnalysis(level, { cut: false }), out = [];
    self.postMessage({ type: 'static', id, stat, verdict: verdict(level, stat, []) });
    for (const cfg of runs) {
      const g = simRun(level, cfg);
      let s;
      while (!(s = g.next()).done) {
        await tick();
        if (latest !== id) return;
        self.postMessage({ type: 'progress', id, frac: (out.length + s.value) / runs.length });
      }
      out.push(s.value);
    }
    if (latest !== id) return;
    self.postMessage({ type: 'done', id, runs: out, ms: Math.round(performance.now() - t0), verdict: verdict(level, stat, out) });
    const cg = cutSearchGen(level, stat.walled);
    let c;
    while (!(c = cg.next()).done) { await tick(); if (latest !== id) return; }
    self.postMessage({ type: 'cuts', id, cuts: c.value });
  } catch (e) {
    if (latest === id) self.postMessage({ type: 'error', id, reason: String(e?.message ?? e) });
  }
};
