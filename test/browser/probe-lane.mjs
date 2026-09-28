// 探针：**选档**（线程档 / 基础档）与"线程档真的在跑"（B6，2026-09-27）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它：B6 的产品决定是"**要求宿主发 COI 头** ⇒ 有头就用线程档，没头落回基础档"。
// 这条决定只有在浏览器里才验得了 —— 构建成功、产物自检绿、身份证 verdict=ok **都不算**：
//   · 线程档是不是**真的**被选中（选档判据在 `bridge/lane.js`，同步判据）；
//   · 选中的那一档是不是**真的**拿到了 shared 内存（`HEAP8.buffer instanceof SharedArrayBuffer`）
//     —— 这是"线程档在跑"的**唯一硬证据**（不是看命令行写了 -pthread）；
//   · 没有 COI 时是不是**老实落回**基础档（而不是装作能用）；
//   · **显式选错档时必须响亮地失败**（`?lane=threads` 在没有 COI 的站点上 —— 反证档）。
//
// 输入（F4 契约，在 test/browser/manifest.json 的 inputs 里声明）：
//   SITE_DIR = **双档站点目录**（必须是已经部署了 `threads/` 子目录的那一份）
//   REPO     = 仓库路径（用它起 `build/serve-coi.py` —— 顺带把"发头脚本"本身也测了）
//
// 用法（从仓库原路径直跑）：
//   cd /mnt/hdd/octave-wasm-build/harness && \
//     SITE_DIR=/mnt/hdd/octave-wasm-build/siteWebGL sh run.sh \
//       /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-lane.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.REPO || '/mnt/hdd/zcode-projects/Octave-Full-Wasm';
const SITE_DIR = process.env.SITE_DIR || '/mnt/hdd/octave-wasm-build/siteWebGL';
const PORT_COI = Number(process.env.PORT_COI || 8831);
const PORT_NOCOI = Number(process.env.PORT_NOCOI || 8832);
const A = `http://127.0.0.1:${PORT_COI}`;
const B = `http://127.0.0.1:${PORT_NOCOI}`;

const hasW64 = fs.existsSync(path.join(SITE_DIR, 'w64'));

let pass = 0, fail = 0;
let laneWrong = false;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 260)}`);
};

// 两台服务器：同一个目录，一台带头、一台不带 —— 两档在**同一份产物**上验
const kids = [];
function serve(port, coi) {
  const args = [`${REPO}/build/serve-coi.py`, '--dir', SITE_DIR, '--port', String(port)];
  if (!coi) args.push('--no-coi');
  const k = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(k);
  return k;
}
async function waitUp(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) return true; }
    catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

/** 打开一页，等就绪，汇报"选档 + 事实"。neverReady=true 时只等固定时长（反证档用）。 */
async function probeLane(browser, url, { expectReady = true, waitMs = 90000, disableMemory64 = false } = {}) {
  const ctx = await browser.newContext();
  if (disableMemory64) {
    await ctx.addInitScript(() => {
      const origMem = WebAssembly.Memory;
      WebAssembly.Memory = function (desc) {
        if (desc && (desc.address === 'i64' || desc.indexType === 'i64' || typeof desc.initial === 'bigint')) {
          throw new RangeError('memory64 is not supported');
        }
        return new origMem(desc);
      };
      WebAssembly.Memory.prototype = origMem.prototype;
    });
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  page.on('console', m => { if (/SharedArrayBuffer|crossOriginIsolated|shared|线程|memory64/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(e => errs.push('goto:' + String(e).slice(0, 120)));
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < waitMs) {
    ready = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
    if (ready || !expectReady && Date.now() - t0 > 12000) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const info = await page.evaluate(() => {
    const c = window.__octaveCaps || null;
    const buf = (() => {
      try {
        const b = window.Module && window.Module.HEAP8 && window.Module.HEAP8.buffer;
        return b ? { shared: b instanceof SharedArrayBuffer, bytes: b.byteLength } : null;
      } catch (e) { return 'err:' + e.name; }
    })();
    return {
      coi: self.crossOriginIsolated,
      sab: typeof SharedArrayBuffer,
      laneState: (window.octaveLaneState || {}).lane || null,
      lanePlan: (window.__octaveLanePlan || {}).lane || null,
      capsLane: c && c.lane ? c.lane.chosen : null,
      capsArtifactThreads: c && c.artifact ? c.artifact.threads : null,
      capsArtifactWasm64: c && c.artifact ? c.artifact.wasm64 : null,
      capsVerdict: c && c.artifact ? c.artifact.verdict : null,
      sharedMemory: c ? c.sharedMemory : null,
      buf,
    };
  }).catch(e => ({ evalFail: String(e).slice(0, 160) }));
  await ctx.close();
  return { ready, info, errs };
}

serve(PORT_COI, true);
serve(PORT_NOCOI, false);
const upA = await waitUp(`${A}/index.html`);
const upB = await waitUp(`${B}/index.html`);
check(upA && upB, '★ 两台服务都起来了（带头 / 不带头，同一目录）',
      `${A}=${upA} ${B}=${upB} dir=${SITE_DIR}`);

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

if (hasW64) {
  console.log('--- wasm64 两轴探针 (COI × memory64 四格矩阵) ---');

  // ── Cell 1: COI + native m64 ⇒ w64 (shared memory) ──────────────────────
  {
    const r = await probeLane(browser, `${A}/index.html`);
    const i = r.info;
    const ok = i.laneState === 'w64' && i.lanePlan === 'w64' && i.capsLane === 'w64';
    if (!ok) laneWrong = true;
    check(i.coi === true, 'Cell 1: 带头站点 crossOriginIsolated = true', JSON.stringify({ coi: i.coi, sab: i.sab }));
    check(ok, 'Cell 1: ★ COI + m64 ⇒ 选中 w64 档', JSON.stringify({ state: i.laneState, plan: i.lanePlan, caps: i.capsLane }));
    check(r.ready === true, 'Cell 1: 页面跑到 ready', JSON.stringify({ ready: r.ready, errs: r.errs.slice(0, 2) }));
    check(i.sharedMemory === true, 'Cell 1: ★★ w64 真的拿到 shared 内存', JSON.stringify({ sharedMemory: i.sharedMemory, heap8: i.buf }));
    check(i.capsArtifactWasm64 === true, 'Cell 1: 产物实测为 wasm64', JSON.stringify({ wasm64: i.capsArtifactWasm64, verdict: i.capsVerdict }));
  }

  // ── Cell 2: no-COI + native m64 ⇒ w64-base (non-shared) ─────────────────
  {
    const r = await probeLane(browser, `${B}/index.html`);
    const i = r.info;
    const ok = i.laneState === 'w64-base' && i.lanePlan === 'w64-base' && i.capsLane === 'w64-base';
    if (!ok) laneWrong = true;
    check(i.coi === false, 'Cell 2: 不带头站点 crossOriginIsolated = false', JSON.stringify({ coi: i.coi, sab: i.sab }));
    check(ok, 'Cell 2: ★ no-COI + m64 ⇒ 选中 w64-base 档', JSON.stringify({ state: i.laneState, plan: i.lanePlan, caps: i.capsLane }));
    check(r.ready === true, 'Cell 2: 页面跑到 ready', JSON.stringify({ ready: r.ready, errs: r.errs.slice(0, 2) }));
    check(i.sharedMemory === false, 'Cell 2: w64-base 不是 shared 内存', JSON.stringify({ sharedMemory: i.sharedMemory }));
    check(i.capsArtifactWasm64 === true, 'Cell 2: 产物实测为 wasm64', JSON.stringify({ wasm64: i.capsArtifactWasm64, verdict: i.capsVerdict }));
  }

  // ── Cell 3: COI + no-m64 ⇒ threads (shared memory wasm32) ───────────────
  {
    const r = await probeLane(browser, `${A}/index.html`, { disableMemory64: true });
    const i = r.info;
    const ok = i.laneState === 'threads' && i.lanePlan === 'threads' && i.capsLane === 'threads';
    if (!ok) laneWrong = true;
    check(i.coi === true, 'Cell 3: 带头站点 crossOriginIsolated = true', JSON.stringify({ coi: i.coi, sab: i.sab }));
    check(ok, 'Cell 3: ★ COI + no-m64 ⇒ 回退到 threads 档', JSON.stringify({ state: i.laneState, plan: i.lanePlan, caps: i.capsLane }));
    check(r.ready === true, 'Cell 3: 页面跑到 ready', JSON.stringify({ ready: r.ready, errs: r.errs.slice(0, 2) }));
    check(i.sharedMemory === true, 'Cell 3: threads 真的拿到 shared 内存', JSON.stringify({ sharedMemory: i.sharedMemory }));
    check(i.capsArtifactThreads === true, 'Cell 3: 产物实测为 threads', JSON.stringify({ threads: i.capsArtifactThreads, verdict: i.capsVerdict }));
  }

  // ── Cell 4: no-COI + no-m64 ⇒ base (non-shared wasm32) ──────────────────
  {
    const r = await probeLane(browser, `${B}/index.html`, { disableMemory64: true });
    const i = r.info;
    const ok = i.laneState === 'base' && i.lanePlan === 'base' && i.capsLane === 'base';
    if (!ok) laneWrong = true;
    check(i.coi === false, 'Cell 4: 不带头站点 crossOriginIsolated = false', JSON.stringify({ coi: i.coi, sab: i.sab }));
    check(ok, 'Cell 4: ★ no-COI + no-m64 ⇒ 回退到 base 档', JSON.stringify({ state: i.laneState, plan: i.lanePlan, caps: i.capsLane }));
    check(r.ready === true, 'Cell 4: 页面跑到 ready', JSON.stringify({ ready: r.ready, errs: r.errs.slice(0, 2) }));
    check(i.sharedMemory === false, 'Cell 4: base 不是 shared 内存', JSON.stringify({ sharedMemory: i.sharedMemory }));
  }

  // ── Cell 5: 显式覆盖 ?lane=base ──────────────────────────────────────────
  {
    const r = await probeLane(browser, `${A}/index.html?lane=base`);
    const i = r.info;
    check(i.laneState === 'base' && i.capsLane === 'base', 'Cell 5: ★ `?lane=base` 覆盖生效', JSON.stringify({ state: i.laneState, caps: i.capsLane }));
    check(r.ready === true && i.sharedMemory === false, 'Cell 5: 带头站点上基础档照常可用', JSON.stringify({ ready: r.ready, sharedMemory: i.sharedMemory }));
  }

  // ── Cell 6: 反证：no-COI 下显式 ?lane=w64 必须硬失败 ────────────────────
  {
    const r = await probeLane(browser, `${B}/index.html?lane=w64`, { expectReady: false });
    const i = r.info;
    check(i.laneState === 'w64', 'Cell 6: 反证档：选档确实被覆盖成 w64', JSON.stringify({ state: i.laneState }));
    check(r.ready === false, 'Cell 6: ★★ 没有 COI 时强行选 w64 ⇒ 起不来', JSON.stringify({ ready: r.ready }));
    const why = (r.errs || []).join(' | ');
    check(/SharedArrayBuffer|crossOriginIsolated|shared|DataClone/i.test(why), 'Cell 6: ★ 失败原因指向隔离/共享内存', why.slice(0, 200) || '(无错误文本)');
  }

  // ── Cell 7: 反证：no-m64 下显式 ?lane=w64 必须硬失败 ────────────────────
  {
    const r = await probeLane(browser, `${A}/index.html?lane=w64`, { expectReady: false, disableMemory64: true });
    const i = r.info;
    check(i.laneState === 'w64', 'Cell 7: 反证档：选档确实被覆盖成 w64', JSON.stringify({ state: i.laneState }));
    check(r.ready === false, 'Cell 7: ★★ 没有 memory64 时强行选 wasm64 档 ⇒ 起不来', JSON.stringify({ ready: r.ready }));
    const why = (r.errs || []).join(' | ');
    check(/memory64/i.test(why), 'Cell 7: ★ 失败原因指向 memory64 不支持', why.slice(0, 200) || '(无错误文本)');
  }

  // ── Cell 8: 带头 + ?worker=1 ⇒ 自动落 base ───────────────────────────────
  {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${A}/index.html?worker=1`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    const i = await page.evaluate(() => ({
      coi: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
      lane: window.octaveLaneState && window.octaveLaneState.lane,
      workerMode: window.octaveLaneState && window.octaveLaneState.workerMode,
      why: window.octaveLaneState && window.octaveLaneState.why,
    })).catch(e => ({ err: String(e).slice(0, 120) }));
    check(i.coi === true, 'Cell 8: 前提：带头站点确实是 COI', JSON.stringify(i));
    check(i.lane === 'base' && i.workerMode === true,
          'Cell 8: ★ 带头 + ?worker=1 ⇒ 自动落基础档',
          JSON.stringify({ lane: i.lane, workerMode: i.workerMode, why: i.why }));
  }

  await browser.close();
  for (const k of kids) { try { k.kill('SIGTERM'); } catch (e) { /* 已退出 */ } }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  if (laneWrong) {
    console.log('FATAL: 四格选档有错误 ⇒ exit 7');
    process.exit(7);
  }
  process.exit(fail ? 1 : 0);
}

// ── 格 1：带头 ⇒ 线程档，且**真的**是 shared 内存 ────────────────────────────────
{
  const r = await probeLane(browser, `${A}/index.html`);
  const i = r.info;
  check(i.coi === true, '带头站点：crossOriginIsolated = true', JSON.stringify({ coi: i.coi, sab: i.sab }));
  check(i.laneState === 'threads' && i.lanePlan === 'threads' && i.capsLane === 'threads',
        '★ 带头站点选中**线程档**', JSON.stringify({ state: i.laneState, plan: i.lanePlan, caps: i.capsLane }));
  check(r.ready === true, '带头站点：页面跑到 ready', JSON.stringify({ ready: r.ready, errs: r.errs.slice(0, 2) }));
  check(i.sharedMemory === true,
        '★★ 线程档**真的**拿到 shared 内存（caps.sharedMemory：主模块内存是 SharedArrayBuffer）',
        JSON.stringify({ sharedMemory: i.sharedMemory, heap8: i.buf }));
  check(i.capsArtifactThreads === true,
        '★ 产物的实测事实也是线程档（身份证 measured.threads.shared_memory）',
        JSON.stringify({ artifactThreads: i.capsArtifactThreads, verdict: i.capsVerdict }));
}

// ── 格 2：不带头 ⇒ 基础档（老实回落，不许装作能用）────────────────────────────
{
  const r = await probeLane(browser, `${B}/index.html`);
  const i = r.info;
  check(i.coi === false, '不带头的站点：crossOriginIsolated = false', JSON.stringify({ coi: i.coi, sab: i.sab }));
  check(i.capsLane === 'base', '★ 不带头 ⇒ 落回**基础档**', JSON.stringify({ caps: i.capsLane, state: i.laneState }));
  check(r.ready === true, '不带头：基础档照常跑到 ready（任何静态托管都能跑）',
        JSON.stringify({ ready: r.ready, errs: r.errs.slice(0, 2) }));
  check(i.sharedMemory === false, '基础档不是 shared 内存（与现役形态一致）',
        JSON.stringify({ sharedMemory: i.sharedMemory }));
}

// ── 格 3：带头 + 显式 base ⇒ 基础档在隔离环境里也能跑（健壮性）──────────────────
{
  const r = await probeLane(browser, `${A}/index.html?lane=base`);
  const i = r.info;
  check(i.laneState === 'base' && i.capsLane === 'base', '★ `?lane=base` 覆盖生效',
        JSON.stringify({ state: i.laneState, caps: i.capsLane }));
  check(r.ready === true && i.sharedMemory === false,
        '带头站点上基础档照常可用（两档不互斥）',
        JSON.stringify({ ready: r.ready, sharedMemory: i.sharedMemory }));
}

// ── 格 4（反证）：不带头 + 显式 threads ⇒ **必须响亮地失败** ─────────────────────
{
  const r = await probeLane(browser, `${B}/index.html?lane=threads`, { expectReady: false });
  const i = r.info;
  check(i.laneState === 'threads', '反证档：选档确实被覆盖成 threads', JSON.stringify({ state: i.laneState }));
  check(r.ready === false,
        '★★ **没有 COI 时强行选线程档 ⇒ 起不来**（不是"静默降级"，是硬失败）',
        JSON.stringify({ ready: r.ready, buf: i.buf }));
  const why = (r.errs || []).join(' | ');
  check(/SharedArrayBuffer|crossOriginIsolated|shared|DataClone/i.test(why),
        '★ 失败原因指向隔离/共享内存（而不是别的偶发失败）', why.slice(0, 200) || '(没有错误文本)');
}

// ── 格 5（B6，2026-09-27）：带头 + `?worker=1` ⇒ **自动落基础档**（不自动选未验证组合）─────
// 判据只看**页面自己的选档状态**（boot 与否不影响）：`octaveLaneState.workerMode === true`
// 且 `lane === 'base'`，而环境本身是 COI（不然这条恒真、没有判别力 —— 所以同时断言 coi=true）。
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${A}/index.html?worker=1`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  const i = await page.evaluate(() => ({
    coi: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
    lane: window.octaveLaneState && window.octaveLaneState.lane,
    workerMode: window.octaveLaneState && window.octaveLaneState.workerMode,
    why: window.octaveLaneState && window.octaveLaneState.why,
  })).catch(e => ({ err: String(e).slice(0, 120) }));
  check(i.coi === true, '格5 前提：这台带头站点确实是 COI（否则本格无判别力）', JSON.stringify(i));
  check(i.lane === 'base' && i.workerMode === true,
        '★ B6 带头 + ?worker=1 ⇒ 自动落**基础档**（线程产物在 worker 里当主宿主未验证）',
        JSON.stringify({ lane: i.lane, workerMode: i.workerMode, why: i.why }));
}

await browser.close();
for (const k of kids) { try { k.kill('SIGTERM'); } catch (e) { /* 已退出 */ } }
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
