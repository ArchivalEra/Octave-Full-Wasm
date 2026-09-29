// 验收：G3 取点 + G4 Ctrl-C + D9 门槛（批次 3，2026-09-25）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/accept-ginput.mjs [URL]
// 判据：
//   A ★ ginput(1) 全链：Octave 读几何 → 反算数据点 (5,5) 的画布像素 → dispatch 点击
//     → ginput 返回数据坐标 (5,5) + 左键；
//   B ★ 两次 ginput(1) 各收各的点（"第二次点击不误触发下一次"，arm 先收后保证）；
//   C ginput(2) 两点按点击顺序返回；
//   D D9 门槛 __web_suspend_ok__() Octave 层可见；
//   E ★ G4 Ctrl-C：pause-yield 循环 + web_request_interrupt ⇒ rc 3、解释器存活；
//   F ginput 无参 ⇒ rc 2 清晰报错（v1 边界）。
// ⚠️ 纪律：所有 ginput 调用 **await 到底**（串行）—— 重入（并发第二条 eval_async）
//    是复审点名的影子栈风险，产品用法禁止；压力矩阵已单独实测记录。
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function freshPage () {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
    await sleep(200);
  }
  return { page, logs };
}
const run = (page, jsBody, guardMs = 20000) => {
  const inner = page.evaluate(async (code) => {
    let val, err = null;
    try { val = await eval(code); } catch (e) { err = String(e).slice(0, 220); }
    return { val, err };
  }, jsBody);
  const guard = new Promise(res => setTimeout(() => res({ val: null, err: 'HARD-TIMEOUT' }), guardMs));
  return Promise.race([inner, guard]);
};
const evalOct = (page, code, guardMs) => run(page, `Module.eval_async(${JSON.stringify(code)})`, guardMs);
const waitPlotImg = (page) => page.waitForFunction(() => {
  const els = [...document.querySelectorAll('#output img, #output canvas, body img, body canvas')];
  return els.some(e => e.getBoundingClientRect().width > 100);
}, null, { timeout: 30000 }).catch(() => {});
const readRect = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('#output img, #output canvas, body img, body canvas')];
  let el = null, best = 0;
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (r.width * r.height > best) { best = r.width * r.height; el = e; }
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
});
const click = (page, cssX, cssY, btn = 0) => page.evaluate(({ x, y, b }) => {
  const els = [...document.querySelectorAll('#output img, #output canvas, body img, body canvas')];
  let el = null, best = 0;
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (r.width * r.height > best) { best = r.width * r.height; el = e; }
  }
  if (!el) return 'no-img';
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: r.left + x, clientY: r.top + y, button: b, bubbles: true,
  }));
  return 'ok';
}, { x: cssX, y: cssY, b: btn });

async function main () {
  const { page } = await freshPage();

  // 准备：一张已知坐标系的图
  const setup = await evalOct(page, "clf; plot([0 10],[0 10],'.'); set(gca,'xlim',[0 10]); set(gca,'ylim',[0 10]); drawnow; 0");
  check(setup.err === null && Number(setup.val) === 0, '准备：2-D 图（xlim/ylim=[0 10]）', setup.err || 'ok');
  await waitPlotImg(page);

  // 几何一次读全（figure 尺寸 + axes 像素框），派生所有目标像素
  await evalOct(page, [
    "fp = get(gcf,'position');",
    "saveu = get(gca,'units'); set(gca,'units','pixels'); ap = get(gca,'position'); set(gca,'units',saveu);",
    "xl = get(gca,'xlim'); yl = get(gca,'ylim');",
    "mk = @(dx, dy) [ap(1) + ap(3) * (dx - xl(1)) / (xl(2) - xl(1)), ap(2) + ap(4) * (dy - yl(1)) / (yl(2) - yl(1))];",
    "p1 = mk(5, 5); p2 = mk(2.5, 5); p3 = mk(7.5, 5);",
    "fid = fopen('/tmp/geo.txt','w');",
    "fprintf(fid, '%.4f %.4f %.4f %.4f %.4f %.4f %.4f %.4f %.4f %.4f', fp(3), fp(4), p1(1), p1(2), p2(1), p2(2), p3(1), p3(2), xl(2), yl(2));",
    'fclose(fid); 0'].join('\n'));
  const geo = (await page.evaluate(() => Module.FS.readFile('/tmp/geo.txt', { encoding: 'utf8' }))).trim().split(/\s+/).map(Number);
  const [figW, figH, a1x, a1y, b1x, b1y, c1x, c1y] = geo;
  check(figW > 0 && figH > 0, '几何读出（figure 尺寸 + 三个目标点的窗口像素）',
    `${figW}x${figH} p1=(${Math.round(a1x)},${Math.round(a1y)})`);
  const rect = await readRect(page);
  check(!!rect && rect.w > 0, '找到绘图图元素及其显示尺寸', JSON.stringify(rect));
  const toCss = (wx, wy) => [wx * (rect.w / figW), (figH - wy) * (rect.h / figH)];
  const [A1x, A1y] = toCss(a1x, a1y);
  const [B1x, B1y] = toCss(b1x, b1y);
  const [C1x, C1y] = toCss(c1x, c1y);

  // ── A：ginput(1) 反算像素点击 ⇒ 数据 (5,5) ──
  {
    const g = page.evaluate(() => Module.eval_async([
      "global __expect = '-';",
      '[gx, gy, gb] = ginput(1);',
      "__expect = sprintf('%d %.6f %.6f', gb, gx, gy);",
      '0'].join('\n')));
    await sleep(400);
    await click(page, A1x, A1y, 0);
    await g;
    await evalOct(page, "global __expect; fid=fopen('/tmp/expect.txt','w'); fprintf(fid,'%s',__expect); fclose(fid); 0", 12000);
    const expectVal = await page.evaluate(() => Module.FS.readFile('/tmp/expect.txt', { encoding: 'utf8' }));
    check(/^1 5(\.0+)? 5(\.0+)?$/.test(String(expectVal).trim()),
      '★ A ginput(1)：反算像素点击 ⇒ 数据 (5,5) + 左键', `expect=${String(expectVal).trim()}`);
  }

  // ── B：两次 ginput(1) 各收各的点 ──
  {
    const g1 = page.evaluate(() => Module.eval_async("[gx,gy,gb]=ginput(1); global __b1 = sprintf('%.3f', gx); 0"));
    await sleep(400);
    await click(page, B1x, B1y, 0);
    await g1;
    await evalOct(page, "global __b1; fid=fopen('/tmp/b1.txt','w'); fprintf(fid,'%s',__b1); fclose(fid); 0", 12000);
    const b1 = Number(await page.evaluate(() => Module.FS.readFile('/tmp/b1.txt', { encoding: 'utf8' })));
    const g2p = page.evaluate(() => Module.eval_async("[gx,gy,gb]=ginput(1); global __b2 = sprintf('%.3f', gx); 0"));
    await sleep(400);
    await click(page, C1x, C1y, 0);
    await g2p;
    await evalOct(page, "global __b2; fid=fopen('/tmp/b2.txt','w'); fprintf(fid,'%s',__b2); fclose(fid); 0", 12000);
    const b2 = Number(await page.evaluate(() => Module.FS.readFile('/tmp/b2.txt', { encoding: 'utf8' })));
    check(Number.isFinite(b1) && Number.isFinite(b2) && b1 < 4 && b2 > 6,
      '★ B 两次 ginput(1) 各收各的点（左点 x≈2.5、右点 x≈7.5；stale 点击不串场）', `b1=${b1} b2=${b2}`);
  }

  // ── C：ginput(2) 两点按序 ──
  {
    const g = page.evaluate(() => Module.eval_async("[gx,gy]=ginput(2); global __c = sprintf('%.3f %.3f', gx(1), gx(2)); 0"));
    await sleep(400);
    await click(page, B1x, B1y, 0);
    await sleep(250);
    await click(page, C1x, C1y, 0);
    await g;
    await evalOct(page, "global __c; fid=fopen('/tmp/c.txt','w'); fprintf(fid,'%s',__c); fclose(fid); 0", 12000);
    const mm = (await page.evaluate(() => Module.FS.readFile('/tmp/c.txt', { encoding: 'utf8' }))).trim().split(/\s+/).map(Number);
    check(mm.length === 2 && mm[0] < 4 && mm[1] > 6, '★ C ginput(2)：两点按点击顺序返回', `c=${mm}`);
  }

  // ── D：D9 门槛 ──
  {
    const d = await evalOct(page, 'assert(__web_suspend_ok__()); 0');
    check(d.err === null && Number(d.val) === 0, '★ D D9 门槛：__web_suspend_ok__() Octave 层可见且为真', d.err || 'ok');
  }

  // ── E：G4 Ctrl-C ──
  {
    const pE = page.evaluate(() => Module.eval_async('__k = 0; while (true); __k += 1; pause(0.02); end; 0')
      .then(v => ({ rc: v })).catch(e => ({ rc: 'reject:' + String(e).slice(0, 60) })));
    await sleep(400);
    await page.evaluate(() => window.__octaveRequestInterrupt());
    const eR = await Promise.race([pE, new Promise(res => setTimeout(() => res({ rc: 'TIMEOUT' }), 10000))]);
    const eMsg = await page.evaluate(() => { try { return Module.last_error_message(); } catch (e) { return ''; } });
    // rc 口径如实记：Octave 把中断折算成 execution_exception 时是 rc=2（msg 含 interrupted），
    // 走 interrupt_exception 路径时是 rc=3。判别性要求 = **settle**（不永不挂起）+ 解释器存活。
    check(eR.rc === 3 || (eR.rc === 2 && /interrupt/i.test(eMsg)),
      '★ E Ctrl-C：死循环被中断收尾（settle，不永不挂起）', JSON.stringify(eR) + ' msg=' + String(eMsg).slice(0, 60));
    const alive = await evalOct(page, '1+1');
    check(alive.err === null && Number(alive.val) === 0, '★ E 中断后解释器存活、旗标已复位', alive.err || 'ok');
  }

  // ── F：ginput 无参 ⇒ rc 2 清晰报错 ──
  {
    const f = await evalOct(page, 'ginput()');
    const fMsg = await page.evaluate(() => { try { return Module.last_error_message(); } catch (e) { return ''; } });
    check(Number(f.val) === 2 && /点数/.test(fMsg), 'F ginput() 无参 ⇒ rc 2 清晰报错（v1 边界如实记）',
      `val=${f.val} msg=${String(fMsg).slice(0, 80)}`);
  }
  await page.close();

  // ── G（工单 06 的反向断言）：**真·关掉 JSPI** ⇒ 必须优雅降级，不是 TypeError ──
  // 做法：addInitScript 在**任何页面脚本之前**废掉 WebAssembly.Suspending/promising
  // ⇒ 宿主的 B 姿势包装跳过（jspiApi=false）⇒ D9 门必须**关**，pause 走内建阻塞照常返回。
  // 反向语义：若降级是靠 TypeError/挂死，这里必红。
  {
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.addInitScript(() => {
      try { WebAssembly.Suspending = undefined; WebAssembly.promising = undefined; } catch (e) {}
    });
    await page2.goto(URL, { waitUntil: 'load', timeout: 240000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      if (await page2.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
      await sleep(200);
    }
    const caps = await page2.evaluate(() => ({
      ready: window.__octaveReady === true,
      jspiApi: !!(window.__octaveCaps && window.__octaveCaps.engine &&
                  window.__octaveCaps.engine.jspiApi),
    })).catch(() => ({ ready: false, jspiApi: null }));
    // ⚠️ 无 JSPI 时宿主**不暴露 eval_async**（降级形态 = 只有同步口；实测 G1 车道）
    //    ⇒ 这里只能走 eval_string；值经 error 消息通道带回（worker 批次教训的页面版）。
    const gate = await page2.evaluate(() => {
      try { window.Module.eval_string("s = __web_suspend_ok__; error('GATE %d', s);"); }
      catch (e) { /* Octave error ⇒ JS 异常；文本从 last_error_message 取（F 格同款） */ }
      const m = /GATE (\d+)/.exec(String((() => { try { return window.Module.last_error_message(); } catch (e2) { return ''; } })()) || '');
      return { gate: m ? +m[1] : null };
    });
    const pauseRun = await page2.evaluate(() => {
      const t0 = Date.now();
      try { const rc = window.Module.eval_string('pause(0.2);'); return { rc, ms: Date.now() - t0, err: null }; }
      catch (e) { return { rc: null, ms: Date.now() - t0, err: String(e.message || e).slice(0, 80) }; }
    });
    check(caps.ready === true && caps.jspiApi === false,
      'G1 无 JSPI API ⇒ 页面照常 ready（api 门如实为 false）', JSON.stringify(caps));
    check(gate.gate === 0,
      '★ G2 D9 门在无 JSPI 时必须**关**（不许误报可挂起）', JSON.stringify(gate));
    check(pauseRun.err === null && pauseRun.rc === 0 && pauseRun.ms >= 150 && pauseRun.ms < 5000,
      '★ G3 无 JSPI 时 pause 走内建阻塞照常返回（优雅降级：≥0.2s 真等待，不是 TypeError/挂死）',
      JSON.stringify(pauseRun));
    await page2.close();
  }
}
await main();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
