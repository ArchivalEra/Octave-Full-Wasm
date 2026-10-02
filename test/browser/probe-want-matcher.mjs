// 探针：断言匹配器的**数字边界**（批次 A / HANDOFF §8 待办 6）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：这条断言链的"被测对象"不是 Octave，而是**我们自己的断言匹配器**。
// 套件的 `ev()` 是在**整段页面捕获窗口**（eval 输出 + 加载器日志 + warning）里找子串，
// 于是 `want='0'` 会被输出里别的数字（`10`/`100`/`13`）里的那个 `0` 满足 ——
// `accept-hdf5` 就这么假过了几个月。修法是把单个数字的 want 按**数字边界**匹配。
//
// 这个探针把"旧写法会假过 / 新写法挡住 / 真值照样能对上 / 多字符 want 不误红"四条
// 钉在浏览器里（不是在纸上论证）。套件里那 26 份 `wantHit` 与这里逐字相同。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-want-matcher.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
// ★ 两段式就绪（工单 40/42）：先等 __octaveReady 再碰 feval（NT=8 下旧写法会挂死）。
let __ready = false;
for (let i = 0; i < 300; i++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { __ready = true; break; }
  await new Promise(r => setTimeout(r, 200));
}
if (!__ready) throw new Error('probe-want-matcher: 60s 内 __octaveReady 未就绪');
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}

// ── 两个匹配器：旧（本批修掉的写法）/ 新（各套件里那份 wantHit）─────────────
const oldHit = (hay, want) => hay.includes(want);
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function win (code) {
  logs.length = 0;
  await page.evaluate(c => window.Module.eval_string(c), code);
  await sleep(400);
  return [...logs].join(' ').replace(/\s+/g, ' ').trim();
}

let pass = 0, fail = 0;
function check (ok, label, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 160)}`);
}

// ① 计数里含别的数字 —— 这正是 `accept-hdf5` 假过的那一类
let w = await win('disp(10)');
check(oldHit(w, '0') === true, '对照：**旧写法**确实被 `10` 里的 `0` 满足（这就是要修的假过）', w);
check(!wantHit(w, '0'), '★ 新写法：want=0 不再被 10 满足', w);

w = await win('disp(100)');
check(!wantHit(w, '0'), '★ 新写法：want=0 不被 100 满足', w);

w = await win('disp(12)');
check(!wantHit(w, '2') && !wantHit(w, '1'), '★ 新写法：want=1/2 不被 12 满足', w);
check(wantHit(w, '12'), '真值就是 12 时，want=12 照样对上（没矫枉过正）', w);

// ② 真值就是那个数字时，必须还能对上（否则是"为了防假过把断言弄成永远红"）
w = await win('disp(exist("__no_such_thing__"))');
check(wantHit(w, '0'), '★ 真值就是 0（hdf5 那条探针的形状）照样能对上', w);

// ③ 多字符 want 保持子串：Octave 打印 1.5 是 `1.5000`，对它用严格词边界会**误红**
w = await win('disp(1.5)');
check(/1\.5000/.test(w), '前提：Octave 打印 1.5 = `1.5000`', w);
check(wantHit(w, '1.5'), '★ 多字符 want（1.5）不因位数补齐而误红', w);

// ④ 负号、小数、科学记数法这些"数字不是一个 \w 词元"的形态
w = await win('disp(-1)');
check(wantHit(w, '-1'), 'want=-1（负号开头的多字符）正常', w);
w = await win('disp(5.0005e+07)');
check(wantHit(w, '5.0005e+07'), 'want=5.0005e+07（科学记数法）正常', w);

// ⑤ 捕获窗口里的**版本号**不该贡献出孤立的 `0` —— 这是本探针第一版就抓到的漏洞：
//    起初只把「数字」当边界，于是加载器日志里的 `11.3.0` 让 `want='0'` 依然成立。
//    修法：**点也算边界字符**。（下面这串是从真页面捕获里抄下来的，不是编的。）
const NOISE = '11.3.0 [assets] 清单就绪：47 个资产 [assets] 加载 plotbridge … 就绪';
check(!wantHit(NOISE, '0'), '★ 版本号 `11.3.0` 最后那位 0 不算（点也是边界）', NOISE);
check(!wantHit(NOISE, '1'), '★ `11.3.0` 与 `47` 都贡献不出孤立的 1', NOISE);
check(wantHit(NOISE, '47'), '同一串里真·孤立数字（47）照样能对上', NOISE);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
