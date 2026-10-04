// libm-spike driver（工单 60）：同一 node 进程装载 基线/覆盖 两个模块 —— 同窗配对。
// ① 探针断言：覆盖变体必须导出 octave_libm_override_version()==20261004（证明覆盖真的链进来了）；
// ② 精度对拍：eval_* 对照 host Math.*（~0.5–1 ULP 参考级），覆盖变体 maxrel 必须 <1e-12；
// ③ 交错 3 轮 × 每测量取 5 次中位（单轮方差 ±30% 的对策，HISTORY §5.79/§5.84）。
// 用法：node --experimental-wasm-memory64 driver.mjs <base.js> <cand.js> <reps>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };

const [baseJs, candJs, repsArg] = process.argv.slice(2);
const REPS = parseInt(repsArg || '8', 10);

const norm = (p) => (p.includes('/') ? p : `./${p}`);   // 裸名不是相对路径（ESM require 语义）
const base = await require(norm(baseJs))();
const cand = await require(norm(candJs))();

// ① 探针：覆盖变体独有符号
const v = cand._octave_libm_override_version ? cand._octave_libm_override_version() : 0;
if (v !== 20261004) {
  console.error(`PROBE_FAIL: 覆盖探针 octave_libm_override_version=${v}（期望 20261004）—— 覆盖没链进来`);
  process.exit(3);
}
console.log(`probe: octave_libm_override_version=20261004 ✓（覆盖在链）`);

// ② 精度对拍（对照 host Math.*；sin 含大参数归约路径）
const grids = {
  sin: (() => { const xs = []; for (let x = -40; x <= 40; x += 0.0137) xs.push(x);
                for (let k = 1; k <= 2000; k++) { xs.push(k * 237.29); xs.push(k * 12345.678); } return xs; })(),
  exp: (() => { const xs = []; for (let x = -700; x <= 700; x += 1.7) xs.push(x); return xs; })(),
  log: (() => { const xs = []; for (let e = -300; e <= 300; e += 1.0) xs.push(Math.pow(10, e) * 1.2345);
                for (let x = 0.01; x <= 100; x *= 1.05) xs.push(x); return xs; })(),
  pow: (() => { const xs = [], ys = []; for (let e = -3; e <= 3; e += 0.5) for (let y = -3.7; y <= 3.7; y += 0.37) { xs.push(Math.pow(10, e) * 1.234); ys.push(y); } return xs; })(),
};
const powYs = grids.pow;

function maxRel(mod, fn, xs, ys) {
  let m = 0;
  for (let i = 0; i < xs.length; i++) {
    const got = ys ? mod[`_eval_${fn}`](xs[i], ys[i]) : mod[`_eval_${fn}`](xs[i]);
    const ref = ys ? Math[fn](xs[i], ys[i]) : Math[fn](xs[i]);
    const rel = Math.abs(got - ref) / Math.abs(ref);
    if (isFinite(rel) && rel > m) m = rel;
  }
  return m;
}

let precOk = true;
for (const fn of ['sin', 'exp', 'log', 'pow']) {
  const b = maxRel(base, fn, grids[fn], fn === 'pow' ? powYs : undefined);
  const c = maxRel(cand, fn, grids[fn], fn === 'pow' ? powYs : undefined);
  const ok = c < 1e-12;
  if (!ok) precOk = false;
  console.log(`prec ${fn}: base(maxrel vs JS)=${b.toExponential(2)}  cand=${c.toExponential(2)}  ${ok ? '✓ <1e-12' : '✗ 超门槛'}`);
}
if (!precOk) { console.error('PRECISION_FAIL'); process.exit(4); }

// ③ 交错基准：3 轮，每轮 base→cand 逐函数配对；每测量 = 5 次调用取中位
const FN = ['sin', 'exp', 'log', 'pow'];
const res = { base: {}, cand: {} };
for (const v of ['base', 'cand']) for (const f of FN) res[v][f] = [];
for (let r = 0; r < 3; r++) {
  for (const v of ['base', 'cand']) {
    const m = v === 'base' ? base : cand;
    for (const f of FN) {
      m[`_bench_${f}`](1);                       // warmup
      const ts = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        m[`_bench_${f}`](REPS);
        ts.push(performance.now() - t0);
      }
      res[v][f].push(median(ts));
    }
  }
}
const geo = (a) => Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length);
const ratios = [];
console.log('func        base(ms)   cand(ms)   cand/base');
for (const f of FN) {
  const b = median(res.base[f]), c = median(res.cand[f]);
  const r = c / b; ratios.push(r);
  console.log(`${f.padEnd(11)} ${b.toFixed(1).padStart(8)}   ${c.toFixed(1).padStart(8)}   ${r.toFixed(3)}`);
}
const g = geo(ratios);
// 判据（工单 60）：热点压降 ≥1/3 ⇒ 每调用几何均值 ≥1.5（四函数全覆盖元素数学时 1−1/g ≥ 1/3）
const verdict = g >= 1.5 ? 'ADOPT_CANDIDATE' : 'REJECT';
console.log(`geomean(cand/base) = ${g.toFixed(3)} ⇒ SPIKE_VERDICT: ${verdict}`);
process.exit(g >= 1.5 ? 0 : 1);
