// S5 · .oct 资产车道：7 个核心 dldfcn 在 11.3.0 上的装载与数值
//
// 依赖前提：真 .oct 闸门（accept-113-oct）已证明机制可用；这一套把真正的
// 7 个核心 dldfcn 装上并逐个验数值 —— 它们**不属于** accept-113-libs 的
// 树内套件（那些是 dldfcn，必须走 .oct 车道）。
//
// 关键机制（照抄资产加载器的做法）：
//   Octave 按**函数名.oct** 找模块。模块文件名与它导出的函数名不一致时，
//   必须建符号链接（桌面版的 bzip2.oct -> gzip.oct 就是这么做的）。
//   这里把 aliases 显式写出来，与 bridge/assets-loader.js 的 aliases 同语义。
//
// 用法：harness/run.sh test/browser/accept-113-assets.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8762/';

// 模块 → 它提供的函数名（文件名之外的都要建链接）
const MODULES = {
  'convhulln':    ['convhulln'],
  '__delaunayn__': ['__delaunayn__'],
  '__voronoi__':  ['__voronoi__'],
  '__glpk__':     ['__glpk__'],
  'fftw':         ['fftw'],
  'gzip':         ['gzip', 'gunzip', 'bzip2', 'bunzip2'],
  'audioread':    ['audioread', 'audiowrite', 'audioinfo', 'audioformats'],
};

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run (code, timeoutMs = 25000, useSentinel = true) {
  const s = '__SW' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  const rc = await page.evaluate(
    ([x, sentinel, want]) => window.Module.eval_string(want ? `${x}; disp('${sentinel}');` : x),
    [code, s, useSentinel]);
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    if (!useSentinel) { if (Date.now() - t > 1200) break; }
    else if (logs.some(l => l.includes(s))) break;
    await sleep(80);
  }
  const seen = useSentinel ? logs.some(l => l.includes(s)) : true;
  const out = logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim();
  return { rc, out, seen, err: await page.evaluate(() => window.Module.last_error_message()) };
}

// ★ 匹配规则（`.githooks/check-wants.py` 会查这一条）：**单个数字**的 want 按「数字边界」匹配，
//   不是裸子串 —— `want='0'` 绝不该被输出里的 `10`/`100`/`13` 满足（`accept-hdf5` 就这么
//   假过了几个月：它查的 `__have_hdf5__` 在 11.3.0 里根本不存在，靠加载器日志里的杂数字对上）。
//   **点也算边界字符**：捕获窗口里有 `11.3.0` 这类版本号，`want='0'` 不该被它最后那位满足
//   （探针 `test/browser/probe-want-matcher.mjs` 把这几条钉在真浏览器里）。
//   多字符 want 保持子串匹配（`'0.7071'`、`'100 100'` 已足够具体；而 Octave 打印 1.5 是
//   `1.5000`，对它用严格词边界反而会误红）。
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

async function ev (name, code, expect) {
  const r = await run(code);
  let ok = r.seen && r.rc === 0 && !/^error/i.test(r.out);
  if (ok && expect !== undefined) ok = wantHit(r.out, expect);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(28)} :: ${(r.out || r.err || '(空)').slice(0, 88)}`);
}

// ⚠️ **还要等启动资产装完**（`window.__octaveReady` 在 index.html 里是"整条启动链跑完"
//    —— 含 help 数据与 webgraphics —— 才置真的）。只等解释器可用就往下跑时，页面侧的
//    资产加载器会继续打 `[assets] …就绪` 日志，那些行落进前几次 eval 的捕获窗口，
//    把要匹配的文本挤出截断窗口 ⇒ **偶发假红**（2026-09-23 实测：accept-hdf5 与
//    accept-net 各中过一次；这两条的根因是同一个，不是两条独立的毛病）。
for (let _w = 0; _w < 600; _w++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
await new Promise(r => setTimeout(r, 400));
console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  try { const r = await run('1+1', 4000); if (r.seen && r.rc === 0) break; } catch {}
  await sleep(700);
}
console.log(`ready=${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// ---- 装载：下载 .oct → 写 FS → 建 aliases 符号链接 → addpath --------------
const names = Object.keys(MODULES);
const loadRes = await page.evaluate(async (mods) => {
  const FS = window.Module.FS;
  const dir = '/usr/src/octave/m/oct';
  try { FS.mkdir('/usr/src/octave/m'); } catch (e) {}
  try { FS.mkdir(dir); } catch (e) {}
  const out = [];
  for (const m of Object.keys(mods)) {
    try {
      const buf = await fetch('assets/oct/' + m + '.oct').then(r => r.arrayBuffer());
      const mount = dir + '/' + m + '.oct';
      FS.writeFile(mount, new Uint8Array(buf));
      for (const fn of mods[m]) {
        if (fn === m) continue;
        try { FS.symlink(mount, dir + '/' + fn + '.oct'); } catch (e) { /* 已存在 */ }
      }
      out.push(m + ':' + buf.byteLength);
    } catch (e) { out.push(m + ':ERR ' + e.message); }
  }
  return out.join(' ');
}, MODULES);
console.log('装载：' + loadRes);
if (names.every(n => loadRes.includes(n + ':'))) pass++; else fail++;
await run("addpath('/usr/src/octave/m/oct')");

console.log('--- exist()==3（桌面版语义：.oct 文件 → 3）---');
for (const m of names) {
  const fns = MODULES[m];
  await ev('exist ' + fns[0], `disp(exist('${fns[0]}'))`, '3');
}
await ev('exist gunzip(别名)',     "disp(exist('gunzip'))", '3');
await ev('exist bzip2(别名)',      "disp(exist('bzip2'))", '3');
await ev('exist audioformats(别名)', "disp(exist('audioformats'))", '3');

console.log('--- 数值（期望值取自本机 11.3.0）---');
await ev('convhulln',   "v=convhulln([0 0;1 0;0 1;0.2 0.2]); disp(rows(v))", '3');
await ev('delaunay',    "t=delaunayn([0 0;1 0;0 1]); disp(rows(t))", '1');
await ev('voronoi(两输出)', "s=sparse([1 0;0 1]); disp(exist('__voronoi__'))", '3');
// 注意 glpk 的位置参数：glpk(c,A,b,lb,ub,ctype,vartype)——
// ctype 是每行的约束类型、vartype 是每个变量一个字符（两个变量 → 'CC'）。
// 第一版我错把 lb 当 ctype、把 vartype 漏了，本机 11.3.0 报出一字不差的同样错误，
// 说明那是**测试的参数错误**而非产物缺陷。
await ev('glpk',        "c=[-1;-1]; A=[1 1]; b=1; lb=[0;0]; [x,f]=glpk(c,A,b,lb,[],'U','CC'); printf('%.10g %.10g %.10g', x(1), x(2), f)", '1 0 -1');
await ev('fftw 后端',    "disp(fftw('planner'))");

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
