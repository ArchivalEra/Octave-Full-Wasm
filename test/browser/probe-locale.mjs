// probe-locale.mjs — **跨车道 locale 确定性探针**（issue #4 方案 A 的可测契约）。
// 为什么是"所有分支/车道"的事：报错文本与数字格式的确定性由**核心解释器**决定
// （interpreter.cc: setlocale(LC_ALL,"") + LC_NUMERIC/LC_TIME 强制 "C"；且无 NLS
// 消息目录 ⇒ gettext 回退英文 msgid）。任何一条车道若漂移（宿主 locale 泄漏 /
// 未来误编入某个非英文 .mo），都会让「同一段 Octave 代码在四档吐不同文本/不同
// 小数点」——前端正则、jsonencode/CSV/dlmread 全跟着坏。所以这条要**每档都过**。
//
// 断言（全部实测产物，不信文档承诺）：
//   L1 语法错文本是英文（含 `syntax error`，无 CJK/非 ASCII 污染）
//   L2 运行时错文本是英文（`'x' undefined` 形态）
//   L3 数字格式是 C locale（小数点是 `.` 不是 `,`；`sprintf('%.3f',3.14159)=='3.142'`）
//   L4 科学计数法格式确定（`sprintf('%e',1234.5)` == `1.234500e+03`）
//   L5 反证：非 ASCII 判据有分辨力（中文⇒true / abc⇒false），防匹配器失明
//
// ⚠️ 两个实测踩点（探针自身）：① 报错走 emscripten printErr → 经 **console** 通道，
//   钩 `Module.printErr` 在 evaluate 里不可靠 ⇒ 用 page.on('console')；
//   ② `Module.eval_string` 返回的是 **rc（0=成功）不是值** ⇒ 取值必须走 FS 写读。
//
// 用法：node probe-locale.mjs <URL>（默认 8761）；URL 加 `?lane=w64` 指定档。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await (await browser.newContext()).newPage();
const consoleBuf = [];
page.on('console', (m) => { try { consoleBuf.push(m.text()); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

let ready = false;
for (let i = 0; i < 300 && !ready; i++) {
  ready = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) { console.log('=== 0 PASS / 1 FAIL ==='); console.log('  (30s 内未就绪)'); process.exit(1); }

const lane = await page.evaluate(() => (window.__octaveCaps?.lane || {}).chosen || null);
console.log(`URL=${URL} lane=${lane}`);

// eval 一段代码，返回 { rc, errText } —— errText 取自这段期间的 console 新行
async function run(code) {
  consoleBuf.length = 0;
  const rc = await page.evaluate((c) => {
    try { return window.Module.eval_string(c); } catch (e) { return 'THROW:' + e; }
  }, code).catch((e) => 'EVAL_ERR:' + e);
  await new Promise((r) => setTimeout(r, 150));
  return { rc, errText: consoleBuf.join('\n') };
}

// 取一个**值**：写虚拟 FS 再读回（eval_string 只回 rc）
async function evalVal(expr) {
  const fn = `/tmp/_loc_${Math.random().toString(36).slice(2)}.txt`;
  await page.evaluate(({ e, f }) => {
    window.Module.eval_string(`_lf=fopen('${f}','w'); fprintf(_lf,'%s', ${e}); fclose(_lf);`);
  }, { e: expr, f: fn });
  return page.evaluate((f) => {
    try {
      const b = window.Module.FS.readFile(f);
      window.Module.FS.unlink(f);
      return new TextDecoder().decode(b);
    } catch (e) { return 'READERR:' + e; }
  }, fn);
}

const hasNonAscii = (s) => /[^\x00-\x7F]/.test(s);

// ── L1 语法错：英文 ──
{
  const r = await run('x = (1 + ;');
  check(r.rc === 2, 'L1a 语法错 rc==2', `rc=${r.rc}`);
  check(/syntax error/i.test(r.errText), 'L1b 语法错文本是英文（含 "syntax error"）',
        JSON.stringify(r.errText.slice(0, 90)));
  check(!hasNonAscii(r.errText), 'L1c 语法错文本无非 ASCII 污染',
        hasNonAscii(r.errText) ? JSON.stringify(r.errText) : '纯 ASCII');
}

// ── L2 运行时错：英文 `'x' undefined` ──
{
  const r = await run('__no_such_var_xyz__ + 1');
  check(r.rc !== 0 && r.rc !== '0', 'L2a 运行时错 rc!=0', `rc=${r.rc}`);
  check(/undefined/i.test(r.errText) && !hasNonAscii(r.errText),
        'L2b 运行时错文本是英文 "undefined"', JSON.stringify(r.errText.slice(0, 100)));
}

// ── L3 数字格式：C locale 小数点 ──
{
  const r = await evalVal("sprintf('%.3f', 3.14159)");
  check(r === '3.142', 'L3 数字小数点 = "."（C locale）', `sprintf = ${JSON.stringify(r)}`);
}

// ── L4 科学计数法 ──
{
  const r = await evalVal("sprintf('%e', 1234.5)");
  check(r === '1.234500e+03', 'L4 科学计数法格式确定', `sprintf = ${JSON.stringify(r)}`);
}

// ── L5 反证：非 ASCII 判据有分辨力 ──
check(hasNonAscii('中文') === true && hasNonAscii('abc') === false,
      'L5 反证：非 ASCII 判据有分辨力（中文⇒true / abc⇒false）');

console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
