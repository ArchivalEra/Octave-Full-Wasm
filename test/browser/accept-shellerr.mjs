// R1/R0 验收：无 shell 构建下 shell 入口的**清晰报错**（覆写层）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-shellerr.mjs [URL]
//
// ── 本套钉住什么 ──────────────────────────────────────────────────────────────
// 缺口的形状（2026-09-24 实测，HISTORY §5.29 R0/R1）：Octave 的 `system` 只有
// **两输出**形态会走 `popen` 那条路并在失败时 `error`；`st = system(cmd)` / `system(cmd)`
// 走"返回状态"那条路 —— 在无 shell 的构建里**静默拿到 -1 / 静默通过**。
// `popen` 同理（内建直接返回 -1）。这与本项目"能做对就做对、做不了明确报错"相悖。
//
// 做法（外部审核 R1 方案）：`build/webshims/{popen,system}.m` —— **同名 `.m` 覆写**。
// 关键性质：只影响**解释器的名字解析**；Octave 自己的 C++ 代码直接调 `octave::popen()`
// （`libinterp/corefcn/oct-prcstrm.cc`），不会被拦。所以这不是"全局禁掉 popen"。
// 它随页面装载（覆写要在 path 前面才遮得住内建）⇒ `index.html` 的启动清单里有 `webshims`。
//
// ⚠️ 覆写**不许改掉别的语义**：本套同时钉住"没坏的形态一个都没坏"（两输出的文本、
//    用法错误、`unix` 的既有行为、以及 `exist`/普通函数不受影响）。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 600)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a','b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 800));
}
// ⚠️ 还要等 `__octaveReady`（启动资产装完才置真，见 accept-fileops 的同一条注释）——
//    本套的断言全在 **webshims 装完之后**才成立，不等就是假红。
for (let _w = 0; _w < 600; _w++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
await new Promise(r => setTimeout(r, 400));
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

// ★ 匹配规则与其它套件一致（`.githooks/check-wants.py` 会查）：单个数字的 want 按数字边界。
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

let pass = 0, fail = 0;
async function ev(label, code, want, mustThrow = true, wait = 700) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, code);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 110)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, wait));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim() + ' ' + (r.err || '');
  const ok = wantHit(out, want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label.padEnd(46)} :: ${out.slice(0, 150)}`);
}

console.log('--- ① 覆写层确实生效（which 指向站点上的 webshims 目录）---');
// 这一条是"覆写装上了"的**唯一硬证据**：没装的话下面几条也会以另一种方式失败，
// 但会看不出是"没装"还是"装了没生效"。
await ev('which(popen) 指向覆写文件', 'disp(which("popen"))', 'webshims/popen.m');
await ev('which(system) 指向覆写文件', 'disp(which("system"))', 'webshims/system.m');

console.log('--- ② 以前静默的三种形态：现在必须清晰报错 ---');
await ev('popen(…)：以前静默 fid=-1', 'try; fid = popen("ls", "r"); disp(sprintf("fid=%d", fid)); catch e; disp(["E: " e.message]); end',
  'popen: unable to start subprocess');
await ev('st = system(…)：以前静默 st=-1', 'try; st = system("ls"); disp(sprintf("st=%d", st)); catch e; disp(["E: " e.message]); end',
  'system: unable to start subprocess');
await ev('system(…) 无输出参数：以前静默通过', 'try; system("ls"); disp("NOERR"); catch e; disp(["E: " e.message]); end',
  'system: unable to start subprocess');
// `st = unix(cmd)` 走的是核心 `unix.m`（它内部是两输出调 system）⇒ 本来就报错；
// 这里作为"覆写没有把它弄坏"的对照留着。
await ev('对照 st = unix(…)（核心 .m 路径）', 'try; st = unix("pwd"); disp(sprintf("st=%d", st)); catch e; disp(["E: " e.message]); end',
  'unable to start subprocess');

console.log('--- ③ 以前就报错的形态：文本一字不改 ---');
// 报错文本是本项目的对外契约（§5.24 的政策），覆写层不许顺手改掉它。
await ev('★ [st,out]=system(…)：文本保持不变（少了 " (this build has no shell)"）',
  'try; [st,out] = system("ls"); disp("NOERR"); catch e; disp(["E: " e.message]); end', 'system: unable to start subprocess');
await ev('[st,out]=unix(…) 同上', 'try; [st,out] = unix("pwd"); disp("NOERR"); catch e; disp(["E: " e.message]); end',
  'unable to start subprocess');

console.log('--- ④ 覆写没吃掉的边角（用法错误、正常函数）---');
await ev('system() 无参：仍是用法错误', 'try; system(); catch e; disp(["E: " e.message]); end', 'Invalid call to system');
await ev('system("a",1,2,3) 参数过多：同上', 'try; system("a",1,2,3); catch e; disp(["E: " e.message]); end', 'Invalid call to system');
// 上游怪癖：两输出 + 显式 return_output=false ⇒ "element number 2 undefined"。
// 覆写把它透传（宿主 11.3.0 实测同一条文本）。
await ev('两输出 + 显式 false：上游怪癖原样透传',
  'try; [s,o] = system("ls", false); disp("NOERR"); catch e; disp(["E: " e.message]); end',
  'element number 2 undefined in return list');
await ev('对照：普通函数不受影响', 'disp(sprintf("sin=%g", sin(pi/2)))', 'sin=1');
await ev('对照：exist 语义未变', 'disp(sprintf("ls=%d system=%d popen=%d", exist("ls"), exist("system"), exist("popen")))', 'ls=2 system=2 popen=2');
await ev('对照：没 shell 的替代实现仍在（gunzip 走 webio，不经 shell）',
  'disp(sprintf("gunzip=%d", exist("gunzip")))', 'gunzip=2');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
