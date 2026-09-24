// S3 引导验收：Octave 11.3.0 的 wasm 在浏览器里能起、能 eval
//
// S3 闸门（HISTORY §9.3 的 P1 闸门：解释器与 eval 两条能跑）。
// 与 accept-requirements.mjs 的区别：那套是 7.2 基线的需求级验收（依赖全部资产），
// 这套只验**最底层可用性**——11.3.0 刚接上站点时资产还没有，断言必须窄。
//
// ⚠️ 关键实现细节（第一版踩过）：Octave 的 stdout 是**延时**到浏览器的 console 的，
//    固定 sleep 之后取日志会把上一次的输出混进这一次，造成假失败
//    （第一版里 det/svd 显示空、值却出现在下一条里）。
//    所以每次 eval 都在末尾 `disp('<哨兵>')`，**轮询等到哨兵出现**才判定这一段结束。
//
// 用法：  harness/run.sh test/browser/accept-113-boot.mjs [URL]
// 默认 URL 是 8762（11.3 staging），不是 8761（7.2 基线）。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8762/';
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

// 跑一段 Octave 代码，等哨兵出现，返回该段的输出。
// useSentinel=false 用于**故意报错**的代码：`error` 会中止执行，尾部的 disp 根本
// 不会跑到，哨兵永远不出现（第一版就是这么卡住的）→ 那种情况改为等固定时间，
// 靠 rc 与 last_error_message() 判定。
async function run (code, timeoutMs = 20000, useSentinel = true) {
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
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(26)} :: ${(r.out || r.err || '(空)').slice(0, 88)}`);
}


console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });

// ⚠️ 顺序更正（2026-09-24）：这段**必须在 `page.goto` 之后**。
//    原来它写在 goto 前面 ⇒ 页面还是 about:blank，`window.__octaveReady` 永远不是 true，
//    于是每个套件白等满 180 s（6 个 accept-113-* 套件 × 3 分钟/次 sweep，实测）。
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
// 就绪探测：用 eval + 哨兵，不用 feval
// （11.3.0 上 Module.eval_string 确定可用；第一版用 feval 探测一直没就绪，
//   但 eval 明明能用——探测方式本身不可靠，换掉）
const t0 = Date.now();
let ready = false;
while (Date.now() - t0 < 300000) {
  try {
    const r = await run('1+1', 4000);
    if (r.seen && r.rc === 0) { ready = true; break; }
  } catch { /* 页面还没起来 */ }
  await sleep(700);
}
console.log(`interpreter ready=${((Date.now() - t0) / 1000).toFixed(1)}s  ready=${ready}`);
ready ? pass++ : fail++;

// 闸门：解释器 + eval
await ev('eval_string 基本', "disp(2+2)", '4');
await ev('矩阵左除 A\\b',   "A=[2,3;1,4]; b=[7,6]'; x=A\\b; printf('%.10g %.10g', x(1), x(2))", '2 1');
await ev('det',             "printf('%.10g', det([2,3;1,4]))", '5');
await ev('svd',             "printf('%.10g', svd([2,3;1,4])(1))", '5.398345638');
await ev('feval 往来',      "disp(feval('strcat','x','y'))", 'xy');
// 故意报错：这一条**期望**看到 error（验证错误路径确实会把消息交回来）。
// 不能用通用的 ev()——它的判定是"不能有 error"，对这条恰好相反。
{
  const r = await run("error('boom')", 20000, false);
  const ok = /error:\s*boom/i.test(r.out) || /boom/.test(r.err || '');
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${'错误路径有报错'.padEnd(26)} :: ${(r.out || '(空)').slice(0, 88)}`);
}

// 11.x 新增目录解析（+matlab / +containers / @ftp）
console.log('--- 11.x 新增目录 ---');
await ev('containers.Map',  "m=containers.Map({'a'},{1}); disp(m('a'))", '1');
await ev('matlab 命名空间',  "disp(exist('matlab.lang.makeValidName'))");
await ev('which containers.Map', "w=which('containers.Map'); disp(!isempty(w))", '1');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
