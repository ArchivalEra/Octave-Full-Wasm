// 探针：**双引擎对齐**（Chromium × Firefox）—— 用户的 Firefox 体验是不是真的没退化
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它：`accept-*` 全套（43 套 / 1076 断言）**都只在 Chromium 上跑**（`test/browser/run.sh`
// 里硬编码 `/usr/bin/chromium`）⇒ Firefox 的体验一直只被 `probe-browser-matrix.mjs` 的 5 项扫到。
// 也就是说：**一次改动把 Firefox 弄坏，日常回归是全绿的**（2026-09-26 实测确认过这一点）。
//
// 这个探针把"Firefox 能用吗"变成**可复跑、可证伪**的：
//   对**每个引擎**跑同一批用户可见的轴，逐条断言（不是"两边数字一样"，而是"这台引擎真的能用"），
//   外加一条**反证**：把 JSPI API 删掉（模拟老浏览器/ESR）后，页面必须照样起、`pause` 必须照样完成。
//
// 用法（从仓库原路径直跑）：
//   cd /mnt/hdd/octave-wasm-build/harness && \
//     sh run.sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-engine-parity.mjs [URL]
// Firefox 用 playwright 托管的那份（默认缓存在 ~/.cache/ms-playwright；
// 没有的话设 PLAYWRIGHT_BROWSERS_PATH=/mnt/hdd/crossbuild-tools/pw-browsers）。
//
// 断言口径（每条都必须在**两个引擎**上成立；实测基准：Chromium 152 / Firefox 155 全平齐）：
//   A 起得来：ready，且 `Capabilities.engine` 形状齐全
//   B JSPI 真挂起：`eval_async(pause 0.2)` rc=0 **且 ticks>0**（等待期间页面定时器照常跑），
//     能力门 `__octaveJspiProbe()` = pass
//   C 纯计算：det([1 2;3 4]) = -2
//   D 真渲染（主线程）：`graphics_toolkit()` = webgl 且 `getframe` 的 cdata 有尺寸
//   E 字体：`listfonts()` ≥ 2 且 `set(0,'defaulttextfontname','FreeMono')` 真生效
//   F 同步 XHR 网络：懒加载 webnet 后 `urlread` 真取回内容（两侧都不许"未编入"）
//   G Worker 模式：`?worker=1` ready，且**真出图**（页面上的 <img> ≥ 1、worker 侧 glCtx=true）
//   H（反证）无 JSPI：删掉 Suspending/promising ⇒ 页面照样 ready、`pause` 照样完成（阻塞回落），
//     能力门如实记 api=false（**不许崩、不许卡死**）
import { chromium, firefox } from 'playwright-core';

const URL = (process.argv[2] && !/^http/.test(process.argv[2]) ? '' : process.argv[2]) || 'http://127.0.0.1:8761/';
const BASE = URL.endsWith('/') ? URL : URL + '/';
const READY_MS = 180000;

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`);
};

async function waitReady(page, ms = READY_MS) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) return (Date.now() - t) / 1000;
    await new Promise(r => setTimeout(r, 250));
  }
  return -1;
}
// 经 MEMFS 取回值（避免 printf 匹配；`last_error_message()` 是**粘性**的，rc=0 时别去读它）
const evalFile = (page, code, file) => page.evaluate(async ([c, f]) => {
  try {
    const rc = window.Module.eval_string(c);
    let v = '';
    try { v = new TextDecoder().decode(window.Module.FS.readFile(f)).trim(); } catch (e) {}
    return { rc, v };
  } catch (e) { return { rc: -1, err: String(e).slice(0, 110) }; }
}, [code, file]).catch(e => ({ rc: -1, err: 'evaluate: ' + String(e).slice(0, 100) }));

async function runEngine(name, launcher, engineTag) {
  const br = await launcher();
  try {
    const page = await (await br.newContext()).newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
    // ⚠️ 别漏这一行：漏了页面停在 about:blank，`__octaveReady` 永远不来 ⇒ 两个引擎都"超时未 ready"
    //    （这个探针第一次跑就是这么假红的 —— 探针**必须真跑一遍**，否则它会在 PROBES=1 里永远红）
    await page.goto(BASE, { waitUntil: 'load', timeout: 240000 }).catch(() => {});
    const secs = await waitReady(page);
    check(secs >= 0, `${name}/A1 页面 ready`, secs >= 0 ? secs.toFixed(1) + 's' : '超时未 ready');
    if (secs < 0) return;
    const caps = await page.evaluate(() => window.__octaveCaps && window.__octaveCaps.engine);
    check(!!caps && typeof caps.jspiApi === 'boolean' && caps.jspiApi === true,
      `${name}/A2 Capabilities 形状 + 本机 jspiApi=true`, JSON.stringify(caps));

    // B：JSPI 真挂起（**必须走 eval_async** —— 可能挂起的命令用同步入口在任何引擎上都会抛）
    const b = await page.evaluate(async () => {
      if (typeof window.Module.eval_async !== 'function') return { no: true };
      const before = window.Module.__tick || 0; const t = performance.now();
      try { const rc = await window.Module.eval_async('pause(0.2); 43');
        return { rc, ticks: (window.Module.__tick || 0) - before, ms: Math.round(performance.now() - t) }; }
      catch (e) { return { err: String(e).slice(0, 110) }; }
    });
    check(b.rc === 0 && b.ticks > 0, `${name}/B1 eval_async(pause 0.2) 真挂起（rc=0 且 ticks>0）`,
      JSON.stringify(b));
    const smoke = await page.evaluate(() => window.__octaveJspiProbe(8000)).catch(e => 'ERR ' + String(e).slice(0, 80));
    check(smoke === 'pass', `${name}/B2 能力门冒烟 = pass`, smoke);

    // C：纯计算
    const c = await evalFile(page, 'A=[1 2;3 4]; fid=fopen("/tmp/_ep1.txt","w"); fprintf(fid,"%.1f",det(A)); fclose(fid);', '/tmp/_ep1.txt');
    check(c.rc === 0 && c.v === '-2.0', `${name}/C 纯计算 det=-2`, JSON.stringify(c));

    // D：真渲染
    const d = await evalFile(page,
      'figure(1); clf; plot(1:10); drawnow(); p=getframe(1); fid=fopen("/tmp/_ep2.txt","w"); fprintf(fid,"%s %dx%d",graphics_toolkit(),rows(p.cdata),columns(p.cdata)); fclose(fid);',
      '/tmp/_ep2.txt');
    check(d.rc === 0 && /^webgl \d+x\d+$/.test(d.v || '') && !/ 0x| x0$/.test(d.v || ''),
      `${name}/D 真渲染后端出图（tk=webgl + 有尺寸）`, JSON.stringify(d));

    // E：字体
    const e1 = await evalFile(page, 'f=listfonts(); fid=fopen("/tmp/_ep3.txt","w"); fprintf(fid,"%d",numel(f)); fclose(fid);', '/tmp/_ep3.txt');
    const e2 = await evalFile(page, 'set(0,"defaulttextfontname","FreeMono"); fid=fopen("/tmp/_ep4.txt","w"); fprintf(fid,"%s",get(0,"defaulttextfontname")); fclose(fid);', '/tmp/_ep4.txt');
    check(e1.rc === 0 && Number(e1.v) >= 2 && e2.rc === 0 && e2.v === 'FreeMono',
      `${name}/E 字体面（listfonts>=2 且 fontname 真生效）`, `fonts=${e1.v} name=${e2.v}`);

    // F：同步 XHR 网络（懒加载 webnet 后才可用）
    const f = await page.evaluate(async () => {
      try { await window.OctaveAssets.load('webnet'); } catch (e) { return { loadErr: String(e.message || e).slice(0, 100) }; }
      try {
        const rc = window.Module.eval_string('fid=fopen("/tmp/_ep5.txt","w"); try; s=urlread("' + location.origin + '/VERSION"); fprintf(fid,"OK:%s",strtrim(s)); catch e; fprintf(fid,"ERR:%s",e.message); end; fclose(fid);');
        let v = ''; try { v = new TextDecoder().decode(window.Module.FS.readFile('/tmp/_ep5.txt')).trim(); } catch (e) {}
        return { rc, v: v.slice(0, 60) };
      } catch (e) { return { err: String(e).slice(0, 110) }; }
    });
    check(f.rc === 0 && /^OK:/.test(f.v || ''), `${name}/F 同步 XHR urlread 真取回`, JSON.stringify(f));

    // G：Worker 模式 + 真出图
    const p2 = await (await br.newContext()).newPage();
    await p2.goto(BASE.split('?')[0] + '?worker=1', { waitUntil: 'load', timeout: 240000 }).catch(() => {});
    const wsecs = await waitReady(p2, 120000);
    let g = { ready: wsecs >= 0 };
    if (g.ready) {
      await p2.evaluate(() => window.OctaveWorker.evalAsync('figure(1); clf; plot(1:10); drawnow();')).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      const dg = await p2.evaluate(() => window.OctaveWorker.diagnose()).catch(e => ({ E: String(e).slice(0, 80) }));
      const imgs = await p2.evaluate(() => document.querySelectorAll('img').length);
      g = { ready: true, tk: dg.tk, glCtx: dg.glCtx, imgs };
    }
    check(g.ready && g.glCtx === true && Number(g.imgs) >= 1,
      `${name}/G Worker 模式真出图（glCtx=true 且页面上有 <img>）`, JSON.stringify(g));

    // H（反证）：没有 JSPI 的浏览器（老版本/ESR）—— 必须**降级**而不是崩
    const ctx2 = await br.newContext();
    await ctx2.addInitScript(() => {
      try { Object.defineProperty(WebAssembly, 'Suspending', { value: undefined, configurable: true }); } catch (e) {}
      try { Object.defineProperty(WebAssembly, 'promising', { value: undefined, configurable: true }); } catch (e) {}
    });
    const p3 = await ctx2.newPage();
    const errs3 = [];
    p3.on('pageerror', e => errs3.push(String(e).slice(0, 140)));
    // ⚠️ **别漏 goto** —— 这个探针头一版就是漏了它两处（正路 + H 反证），两处都"超时未 ready"：
    //    漏了页面停在 about:blank，任何断言都恒假。新建页面之后**第一件事永远是 goto**。
    await p3.goto(BASE, { waitUntil: 'load', timeout: 240000 }).catch(() => {});
    const hsecs = await waitReady(p3, 120000);
    let h = { ready: hsecs >= 0 };
    if (h.ready) {
      h.api = await p3.evaluate(() => window.__octaveJspi && window.__octaveJspi.api);
      h.pause = await p3.evaluate(() => {
        const t = performance.now();
        try { const rc = window.Module.eval_string('pause(0.2); 7'); return { rc, ms: Math.round(performance.now() - t) }; }
        catch (e) { return { err: String(e).slice(0, 90) }; }
      });
    }
    check(h.ready && h.api === false && h.pause && h.pause.rc === 0,
      `${name}/H（反证）无 JSPI 时：照常 ready、能力门如实 api=false、pause 仍完成（阻塞回落）`,
      JSON.stringify(h) + (errs3.length ? ' errs=' + errs3[0] : ''));
    check(errs.length === 0, `${name}/Z 全程无 pageerror（有 JSPI 那一路）`,
      errs.length ? errs.slice(0, 2).join(' // ') : '(无)');
  } finally {
    await br.close().catch(() => {});
  }
}

await runEngine('chromium', () => chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] }), 'chromium');

let ffErr = '';
try {
  await runEngine('firefox', () => firefox.launch(), 'firefox');
} catch (e) {
  ffErr = String(e).slice(0, 200);
  check(false, 'firefox/启动', 'firefox.launch() 失败：' + ffErr
    + '\n      提示：`npx playwright install firefox`，或设 PLAYWRIGHT_BROWSERS_PATH=/mnt/hdd/crossbuild-tools/pw-browsers');
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
