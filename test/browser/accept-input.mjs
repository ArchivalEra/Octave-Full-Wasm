// T5 验收：input() 在浏览器里的语义
// 用法：harness/run.sh test/browser/accept-input.mjs [URL]
//
// 结论（先给结论，断言围绕它展开）：**input() 不需要任何新代码。**
// Emscripten 的默认 stdin 是 `/dev/tty`，其 `get_char` 用 `window.prompt` 取一行
// （读源码确认：emscripten `library_tty.js` 的 `default_tty_ops.get_char`）。
// 之前观察到 "input: reading user-input failed!"，根因是探针把对话框**取消**了
// （返回 null = EOF），而这不是浏览器特有的失败：本机 `octave-cli < /dev/null`
// 报的是**一字不差**的同一句。所以是"stdin 到 EOF"的正常行为，两边一致。
//
// 本套件用**本机对照**（Octave 11.3）确定的语义做判据：
//   printf '2+3\n'   | octave-cli --eval "v=input('x? ')"      → v = 5        (double)
//   printf 'hello\n' | octave-cli --eval "v=input('s? ','s')"  → v = "hello"  (char)
//
// 输入来源：`bridge/index.html` 的 `Module.stdin` 从 `window.__octaveStdin` 队列取；
// 队列空时回退到 `window.prompt`（对真人用户与默认行为一致）。用队列而不是对话框，
// 是因为 playwright 的 dialog 处理是**异步**的、而 `window.prompt` 是**同步阻塞**，
// 两者交错会让连续多次 input() 拿到错位的答案（实测过）。
//
// ⚠️ **顺序很重要**：`std::cin` 一旦读到 EOF 就**永久**停在 EOF（本机同理）。
// 所以"取消对话框 = EOF"那条必须放在**最后**，否则它会污染后面所有断言
// （这个顺序问题第一次写的时候踩到了，表现为"第一条过、其余全 EOF"）。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();

// 对话框一律取消：队列有货时不会走到这里；队列空时正好用来验证 EOF 路径。
const seenDialogs = [];
page.on('dialog', async d => {
  seenDialogs.push(d.type());
  try { await d.dismiss(); } catch (e) { /* 已被别处处理 */ }
});

const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 500)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a','b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 800));
}
console.log(`URL=${URL} ready=${((Date.now()-t)/1000).toFixed(1)}s`);
await page.evaluate(() => { window.__octaveStdin = []; });

let pass = 0, fail = 0;
async function feed(lines) {
  await page.evaluate(ls => { window.__octaveStdin = ls.slice(); }, lines);
}
async function ev(name, code, check, ms) {
  logs.length = 0;
  let r;
  try {
    // 硬超时：input() 若真阻塞，绝不能把整个套件挂住
    const p = page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, code);
    r = await Promise.race([p, new Promise(res => setTimeout(() => res({ timeout: true }), ms || 9000))]);
  } catch (e) {
    console.log(`CRASH | ${name} :: ${String(e).slice(0,110)}`); fail++; return;
  }
  await new Promise(rr => setTimeout(rr, 700));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  if (r.timeout) {
    console.log(`fail | ${name.padEnd(40)} :: *** TIMEOUT（阻塞了）***`); fail++; return;
  }
  const ok = r.rc === 0 && check(out, r.err);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(40)} :: ${out.slice(0,130) || String(r.err).slice(0,110)}`);
}

console.log('--- input() 是内建（官方实现，非本项目覆写）---');
await ev('which input 指向核心 input.cc',
  "disp(which('input'))",
  o => /input\.cc|corefcn/.test(o));

console.log('--- 表达式模式（本机对照 v=5）---');
await feed(['2+3']);
await ev('input("x? ") 回答 2+3 → 5 (double)',
  "v=input('x? '); printf('GOT=[%s] CLASS=%s\\n', num2str(v), class(v))",
  o => /GOT=\[5\]/.test(o) && /CLASS=double/.test(o));
await feed(['k*2']);
await ev('在 caller 的 workspace 里求值（k=21 → 42）',
  "k=21; v=input('k? '); printf('GOT=[%s]\\n', num2str(v))",
  o => /GOT=\[42\]/.test(o));
await feed(['[1 2 3]', '2']);
await ev('连续两次 input() 各自拿到自己的答案',
  "a=input('a? '); b=input('b? '); printf('SUM=%d\\n', sum(a)+b)",
  o => /SUM=8/.test(o));

console.log('--- 字符串模式 input(x,"s")（本机对照 v="hello"）---');
await feed(['hello world']);
await ev('input("s? ","s") → 原样字符串',
  "v=input('s? ','s'); printf('GOT=[%s] CLASS=%s\\n', v, class(v))",
  o => /GOT=\[hello world\]/.test(o) && /CLASS=char/.test(o));
await feed(['3+4']);
await ev('字符串模式不求值（3+4 保持字面量）',
  "v=input('s? ','s'); printf('GOT=[%s]\\n', v)",
  o => /GOT=\[3\+4\]/.test(o));

console.log('--- 回归护栏 ---');
await feed(['7']);
await ev('input() 之后解释器仍正常',
  "v=input('again? '); printf('AFTER=%d\\n', v*2)",
  o => /AFTER=14/.test(o));
await ev('无对话框时 eval 正常（不残留 stdin 状态）',
  "disp(3*3)", o => /(^|\s)9(\s|$)/.test(o));

console.log('--- ⚠️ 最后一条：EOF 是**粘性**的，此后本进程 stdin 永久 EOF ---');
await feed([]);
await ev('队列空 + 取消对话框 → 报错与本机 </dev/null 一字不差',
  "try; v=input('x? '); disp('SHOULD-NOT-GET-HERE'); catch e; printf('CAUGHT=[%s]\\n', e.message); end",
  o => /CAUGHT=\[input: reading user-input failed!\]/.test(o));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
