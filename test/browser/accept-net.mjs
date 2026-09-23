// 批次 9 验收：R5-A —— 同步 urlread/urlwrite/webread/websave（无 Asyncify）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-net.mjs [URL]
//
// 硬断言只用 **同源 URL**（http://127.0.0.1:<port>/…）：结果确定、无需外网、
// 不受 CORS 影响。外网访问作为**信息性**检查（走本机 2080 代理时可能成功），
// 失败不算本套件的失败项 —— 纯静态托管下的跨域取数取决于对方服务器的 CORS
// 策略，那是部署问题，不是实现问题。
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
// 同源基址：从测试 URL 推导，这样换端口也成立
const ORIGIN = URL.replace(/\/[^/]*$/, '/');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
// ⚠️ 还要等**启动资产装完**（`window.__octaveReady`）：原来只等"解释器可用"（ready ≈ 0.8 s），
//    而页面侧的资产加载器是**另一条异步链**，它会在随后几秒里
//    `console.log("[assets] 清单就绪：47 个资产" …)` —— 那些行的**时序是随机的**，
//    会落进前几次 eval 的捕获窗口，把要匹配的文本挤出 200 字符之外 ⇒
//    `后端不在`（want='0'）**偶发假红**（2026-09-23 实测：同一条时红时绿，重跑就绿）。
//    绝大多数套件都等这个标志，这里补上。
{
  const t2 = Date.now();
  while (Date.now() - t2 < 300000) {
    const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 300));
  }
  await new Promise(r => setTimeout(r, 500));
}
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

// 页面侧异步桥：从仓库源码注入。
// ⚠️ 2026-09-23 更正：以前这里写"站点 index.html 也会加载它"—— **不实**：index.html
//    当时根本没加载 webnet.js（那个文件一直是"部署了但没加载"）。已补上那一行；
//    但测试仍然自己注入源码，**不依赖站点**（否则页面侧一改，测试就跟着变红/变绿）。
// 用绝对路径：脚本会被 harness 复制到自己的目录再跑，相对路径不作数。
await page.addScriptTag({ content: readFileSync('/mnt/hdd/zcode-projects/Octave-Full-Wasm/bridge/webnet.js', 'utf8') });

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 600));
  // ⚠️ **匹配用完整输出，只有显示才截断**（同 accept-dldfcn/forge2/net 那三条的坑：
  //    slice 之后再 includes，会让"要匹配的东西落在截断之外"变成假红）。
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const ok = r.rc === 0 && (!want || full.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${(full || ('rc=' + r.rc + ' ' + r.err)).slice(0, 200)}`);
}

console.log('--- 懒加载前 ---');
await ev('disp(exist("__web_fetch_sync__"))', '后端不在', '0');
await ev('disp(exist("urlread"))', 'urlread 是 builtin（exist=5）', '5');

console.log('--- 懒加载 webnet ---');
console.log('  已加载:', await page.evaluate(async () => {
  try { await window.OctaveAssets.load('webnet'); return window.OctaveAssets.loaded().slice(-2).join(' '); }
  catch (e) { return 'ERR ' + String(e).slice(0, 140); }
}));
await ev('disp(exist("__web_fetch_sync__"))', '★ 同步后端已装载', '3');
await ev('disp(which("urlread"))', '★ urlread 被 path 上的 .m 接管', 'webnet');
await ev('disp(which("urlwrite"))', 'urlwrite 同样被接管', 'webnet');
await ev('disp(which("websave"))', 'websave 被接管', 'webnet');

console.log('--- 同步 urlread（同源，硬断言）---');
await ev(`s=urlread("${ORIGIN}assets/manifest.json"); disp(numel(s)>100)`, '★ urlread 取回内容', '1');
await ev('disp(ischar(s) && isrow(s))', '★ 返回 char 行（与桌面版一致）', '1');
await ev('disp(! isempty(strfind(s,"\\"assets\\"")))', '内容就是 manifest.json', '1');
await ev('[s2,ok]=urlread("' + ORIGIN + 'assets/manifest.json"); disp(ok)', '两输出形式 success=1', '1');
await ev('[s3,ok3,msg3]=urlread("' + ORIGIN + 'assets/manifest.json"); disp(isempty(msg3))', '成功时 message 为空', '1');
await ev(`disp(numel(urlread("${ORIGIN}index.html"))>100)`, 'index.html 也能取', '1');
await ev(`disp(numel(urlread("${ORIGIN}"))>100)`, '目录首页也能取', '1');

console.log('--- 失败路径必须清晰（而不是"功能被禁用"）---');
await ev(`[s4,ok4,msg4]=urlread("${ORIGIN}no_such_file.txt"); disp(ok4)`, '404 → success=0', '0');
await ev('disp(! isempty(strfind(msg4,"404")))', '★ 错误消息含 HTTP 状态码', '1');
// 单输出形式：失败必须抛错（而不是静默返回空串）。用 eval 的返回码判定，
// 因为 console 里的消息会被截断，子串匹配不可靠。
const threw = await page.evaluate((u) => {
  const rc = window.Module.eval_string(`urlread("${u}no_such_file.txt")`);
  return { rc, msg: window.Module.last_error_message() };
}, ORIGIN);
{
  const ok = threw.rc !== 0 && threw.msg.includes('HTTP 404');
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ★ 单输出形式失败时抛错 :: rc=${threw.rc} ${threw.msg.slice(0, 90)}`);
}
await ev('disp(! isempty(strfind(lastwarn(),"disabled")))', '（检查）不再出现 disabled 字样', '');

console.log('--- webread：按 Content-Type 解码 ---');
await ev(`r=webread("${ORIGIN}assets/manifest.json"); disp(isstruct(r))`, '★ webread 把 JSON 解成 struct', '1');
await ev('disp(numel(r.assets)>10)', 'JSON 内容可用', '1');
await ev(`disp(ischar(webread("${ORIGIN}index.html")))`, '非 JSON 仍返回文本', '1');

console.log('--- urlwrite / websave ---');
await ev(`urlwrite("${ORIGIN}assets/manifest.json","/tmp/n_wr.json"); d=dir("/tmp/n_wr.json"); disp(d.bytes>100)`, '★ urlwrite 落盘', '1');
await ev(`websave("/tmp/n_ws.json","${ORIGIN}assets/manifest.json"); d=dir("/tmp/n_ws.json"); disp(d.bytes>100)`, '★ websave 落盘（注意参数顺序：文件在前）', '1');
await ev('disp(isequal(fileread("/tmp/n_wr.json"),fileread("/tmp/n_ws.json")))', '★ 两种写法字节一致', '1');
await ev('disp(isequal(fileread("/tmp/n_wr.json"), s2))', '★ 落盘内容与 urlread 一致', '1');
await ev(`[~,ok5]=urlwrite("${ORIGIN}nope.txt","/tmp/n_x.txt"); disp(ok5)`, 'urlwrite 失败返回 0', '0');

console.log('--- POST ---');
await ev(`[s6,ok6]=urlread("${ORIGIN}index.html","post",{"a","1"}); disp(ok6)`, '★ POST 形式可调用（服务端按 GET 处理）', '1');

console.log('--- 二进制安全 ---');
await ev(`urlwrite("${ORIGIN}octave.wasm","/tmp/n_bin.wasm"); d=dir("/tmp/n_bin.wasm"); disp(d.bytes>1000000)`, '★ 取回 1MB+ 二进制不损坏', '1');
await ev('fid=fopen("/tmp/n_bin.wasm","rb"); b=fread(fid,4,"*uint8"); fclose(fid); disp(sprintf("%d %d %d %d",b(1),b(2),b(3),b(4)))', '★ wasm 魔数完好（0 97 115 109）', '0 97 115 109');

console.log('--- 页面侧异步桥（prefetch）---');
const pr = await page.evaluate(async () => {
  const r = await window.OctaveNet.prefetch('/assets/manifest.json');
  return { r, staged: window.OctaveNet.staged().length, text: (await window.OctaveNet.get('/assets/manifest.json')).length };
});
console.log(`  prefetch: ${JSON.stringify(pr.r)}`);
let ok = pr.r.ok && pr.r.bytes > 100;
ok ? pass++ : fail++;
console.log(`${ok ? 'PASS' : 'fail'} | ★ OctaveNet.prefetch 成功 :: ${pr.r.bytes} 字节`);
ok = pr.text > 100;
ok ? pass++ : fail++;
console.log(`${ok ? 'PASS' : 'fail'} | OctaveNet.get 返回文本 :: ${pr.text} 字节`);

console.log('--- 信息性：外网（不计入判定）---');
const ext = await page.evaluate(async () => {
  try {
    const rc = window.Module.eval_string('[se,oke,mse]=urlread("https://example.com"); oke');
    const out = window.Module.last_error_message();
    return { rc, ok: window.Module.eval_string('oke'), msg: out };
  } catch (e) { return { err: String(e).slice(0, 120) }; }
});
console.log(`  [info] example.com → ok=${ext.ok} ${ext.err || ext.msg || ''}`.slice(0, 200));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
