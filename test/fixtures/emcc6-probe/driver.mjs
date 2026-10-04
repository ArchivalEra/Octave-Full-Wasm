// emcc6 探针 driver：同进程装载两变体，交错 3 轮 × 5 样本取中位（±30% 方差对策）。
// 用法：node driver.mjs <base.js> <cand.js> <reps>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const norm = (p) => (p.includes('/') ? p : `./${p}`);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
const [, baseJs, candJs, repsArg] = process.argv.slice(1);
const REPS = parseInt(repsArg || '1', 10);
const base = await require(norm(baseJs))();
const cand = await require(norm(candJs))();
const FN = ['dgemm', 'sortit', 'memcpyb', 'bytesum'];
const res = { base: {}, cand: {} };
for (const v of ['base', 'cand']) for (const f of FN) res[v][f] = [];
for (let r = 0; r < 3; r++)
  for (const v of ['base', 'cand']) {
    const m = v === 'base' ? base : cand;
    for (const f of FN) {
      m[`_${f}`](1);
      const ts = [];
      for (let i = 0; i < 5; i++) { const t0 = performance.now(); m[`_${f}`](REPS); ts.push(performance.now() - t0); }
      res[v][f].push(median(ts));
    }
  }
const geo = (a) => Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length);
const ratios = [];
console.log('func       base(ms)   cand6(ms)  cand/base');
for (const f of FN) {
  const b = median(res.base[f]), c = median(res.cand[f]);
  ratios.push(c / b);
  console.log(`${f.padEnd(10)} ${b.toFixed(0).padStart(8)}   ${c.toFixed(0).padStart(8)}   ${(c / b).toFixed(3)}`);
}
console.log(`geomean(cand6/base) = ${geo(ratios).toFixed(3)}  （<1 = 新工具链更快；REPORT 线，判决在用户）`);
