// Bench Worker: static analysis, then each sim run in chunks. A newer request id cancels the running one between chunks.
import { simRun } from './sim.js';
import { staticAnalysis, verdict } from './solve.js';

let latest = 0;
const tick = () => new Promise(r => setTimeout(r, 0));

self.onmessage = async ({ data: { id, level, runs, cut = true } }) => {
  latest = id;
  const t0 = performance.now(), stat = staticAnalysis(level, { cut }), out = [];
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
  const ms = Math.round(performance.now() - t0);
  self.postMessage({ type: 'done', id, stat, runs: out, ms, verdict: verdict(level, stat, out) }, [stat.grid.root.buffer, stat.grid.blocked.buffer]);
};
