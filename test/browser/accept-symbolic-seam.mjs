// 验收：**symbolic 的 IPC 缝端到端**（零补丁接缝，2026-10-15）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（浏览器侧实测；判据是"真算对"不是"函数存在"）──────────────────────
//   接缝（设计判决，见 HISTORY 2026-10-15）：`symbolic` 的 `python_ipc_system` 后端调
//   **全局名 `system`** ⇒ 落到本仓 webshim ⇒ 转页面桥 `__octaveRunPython` ⇒ 同步调 Pyodide。
//   **包一个字节不改**（零补丁）。本套件钉住这条链的每一环：
//     P1 前置：catalog 里 `symbolic` 有 `deps:["pyodide"]`（能力层边）
//     P2 装载：`install('symbolic')` 成功且**先拉能力层**（`installed` 含 pyodide）
//     P3 后端选择：`pkg load symbolic` 后 `sympref('ipc') == 'system'`（pkg.m shim 钉的）
//     P4 桥就位：`system` 解析到 webshims shim（不是内建）+ `__octaveRunPython` 是函数
//     P5 **真算对**：`diff(sin(x),x)` == `cos(x)`（与宿主 Octave 语义一致）
//     P6 **类型往返**：`double(sym(3)/2)` == 1.5（sym→Python→sym 编组不丢）
//     R1 反向：非 python 的 system 调用**不许**被桥吞（落回"无 shell"清晰错）
//     R2 反向：**桥函数缺失时**报清晰错、点名运行时（不静默返回空）
//
// 用法：sh test/browser/run.sh test/browser/accept-symbolic-seam.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1500);
console.log(`URL=${URL}`);
const ready = await page.evaluate(() => window.__octaveReady === true);
if (!ready) { console.log('ENV: 页面没起来 ⇒ rc=3'); await browser.close(); process.exit(3); }

// ev：在 Octave 里跑一段、把结果写文件读回（探针惯例）
const ev = (code) => page.evaluate((c) => {
  try {
    window.Module.eval_string(
      "fid=fopen('/tmp/__seam.txt','w'); try; " + c + "; catch e; fprintf(fid,'ERR %s', e.message); end; fclose(fid); 0");
    return window.Module.FS.readFile('/tmp/__seam.txt', { encoding: 'utf8' });
  } catch (e) { return 'JS-ERR ' + String(e).slice(0, 200); }
}, code);

// ── P1 目录能力层边 ──
const p1 = await page.evaluate(async () => {
  const cat = await window.OctaveAssets.catalog();
  const sy = (cat.packs || []).find(p => p.name === 'symbolic');
  return sy ? sy.deps : null;
});
check(!!p1 && p1.includes('pyodide'), 'P1 symbolic 有 deps:["pyodide"] 能力层边',
  JSON.stringify(p1));

// ── P2 装载（先能力层）──
const p2 = await page.evaluate(async () => {
  try { const r = await window.OctaveAssets.install('symbolic');
        return { ok: true, state: r.state, installed: r.installed }; }
  catch (e) { return { ok: false, err: String(e).slice(0, 240) }; }
});
check(p2.ok && p2.installed && p2.installed.indexOf('pyodide') >= 0
  && p2.installed.indexOf('symbolic') > p2.installed.indexOf('pyodide'),
  'P2 install(symbolic) 成功且**先拉能力层**', JSON.stringify(p2).slice(0, 220));

// 加载包（异步入口）
const loadRes = await page.evaluate(async () => {
  try { await window.Module.eval_async('pkg load symbolic'); return 'ok'; }
  catch (e) { return 'ERR ' + String(e).slice(0, 200); }
});
check(loadRes === 'ok', 'P2b pkg load symbolic 成功', loadRes);

// ── P3 后端选择 ──
const p3 = await ev("fprintf(fid,'%s', sympref('ipc'))");
check(p3 === 'system', 'P3 装载后 sympref(ipc)==system（pkg.m shim 钉的）', p3);

// ── P4 桥就位 ──
const p4 = await page.evaluate(() => ({
  bridge: typeof window.__octaveRunPython,
  pyodide: !!(window.pyodide && typeof window.pyodide.runPython === 'function'),
  which: null
}));
const whichSys = await ev("w=which('system'); fprintf(fid,'%s', w)");
check(p4.bridge === 'function' && p4.pyodide === true && /webshims/.test(whichSys),
  'P4 桥就位（__octaveRunPython + global.pyodide + system 指向 webshims shim）',
  `bridge=${p4.bridge} pyodide=${p4.pyodide} which=${whichSys}`);

// ── P5 真算对 ──
const p5 = await ev("syms x; y=diff(sin(x),x); fprintf(fid,'%s', char(y))");
check(p5 === 'cos(x)', 'P5 真算对：diff(sin(x),x) == cos(x)', p5);

// ── P6 类型往返 ──
const p6 = await ev("y=double(sym(3)/2); fprintf(fid,'%g', y)");
check(p6 === '1.5', 'P6 类型往返：double(sym(3)/2) == 1.5', p6);

// ── R1 反向：非 python 的 system 调用不被桥吞 ──
const r1 = await ev("s=system('ls -la'); fprintf(fid,'%s', s)");
check(/no shell|unable to start subprocess|ERR/.test(r1),
  '★ R1 反向：非 python 的 system 调用**不被桥吞**（落回清晰错）', r1);

// ── R2 反向：桥函数缺失时报清晰错、点名运行时（不静默空）──
//   做法：临时把页面上的桥函数拿掉，跑一次 sym 调用 ⇒ 必须报"需要 Python 运行时"。
const r2 = await page.evaluate(async () => {
  const saved = window.__octaveRunPython;
  let r;
  try {
    window.__octaveRunPython = undefined;        // 模拟"运行时/桥不在"
    window.Module.eval_string(
      "fid=fopen('/tmp/__seam2.txt','w'); try; sympref('ipc','system'); syms z; catch e; fprintf(fid,'ERR %s', e.message); end; fclose(fid); 0");
    r = window.Module.FS.readFile('/tmp/__seam2.txt', { encoding: 'utf8' });
  } catch (e) { r = 'JS-ERR ' + String(e).slice(0, 200); }
  finally { window.__octaveRunPython = saved; }
  return r;
});
check(/运行时|runtime|Python|ERR/i.test(r2),
  '★ R2 反向：桥缺失 ⇒ 清晰报错（点名运行时，不静默返回空）', String(r2).slice(0, 160));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
