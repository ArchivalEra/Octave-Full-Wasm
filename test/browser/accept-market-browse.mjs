// 验收：**browse() —— 市场读面的 async 正门**（NOTES-market-design §3 / §5 第 5 步）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（全部浏览器侧实测）────────────────────────────────────────────────
//   设计判决：`statusOf` 是同步方法但依赖异步缓存（接口缺陷）⇒ 读面正门 = async `browse()`；
//   内容仓 mail/028 §④ 点令上调优先级，mail/029 请把包级 description/links 带进 Entry[]。
//     B1  `browse()` 在产物里（API 面存在），返回 Entry[]（货架包条数 ≥ 10）
//     B2  **Entry 形状**：name/version + 三属性（fromSource/compatible/installed）+
//         description/links（**缺省空值不省键** —— UI 恒可渲染，不用判有没有）
//     B3  **description/links 透传端到端**：symbolic 的 description 非空（来自货架档案
//         upstream.description，13 包全带）；links 是 {label,url} 数组
//     B4  **versions[] 带出**：多版本包（statistics）每版一条候选；staged 带派生轴、
//         withheld 只带 withheld_cause（**不许编**派生轴 —— 不变量③ 的客户端面）
//     B5  **三属性与 statusOf 同源**：同一包两者逐字段一致（一条产地 `_browseEntry`；
//         N6 教训：同一事实两个出口不许两个答案）
//     B6  **installed 会翻**：装一个纯 .m 包（cgl）⇒ browse() 里该包 state 从
//         available → installed（会话态是实测不是猜）
//     B7  ★ **反向**：注入一条 arch 与宿主不符的条目 ⇒ browse() 里该包 state='blocked'
//         + compatible=false + why 点名 arch（读面也要响亮，不许静默 available）
//     B8  ★ **反向**：注入一条选中版本 withheld 的条目 ⇒ state='blocked' + why 点名
//         未 stage（不装、如实报因）
//     B9  ★ **反向**：注入目录缺 description/links 键的**老形状**条目 ⇒ Entry 仍带
//         空串/空数组（缺省兜底，不炸、不 undefined）
//
// 用法：sh test/browser/run.sh test/browser/accept-market-browse.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1500);

// ── B1/B2 API 面 + Entry 形状 ──────────────────────────────────────────────────
const b12 = await page.evaluate(async () => {
  try {
    const list = await window.OctaveAssets.browse();
    const shelf = list.filter(e => e.name !== 'pyodide');   // 能力层不是包
    const sample = shelf.find(e => e.name === 'symbolic') || shelf[0];
    return {
      ok: Array.isArray(list) && list.length >= 10,
      n: list.length,
      keys: sample ? Object.keys(sample).sort() : null,
      hasTriple: sample ? ['fromSource', 'compatible', 'installed'].every(k => k in sample) : false,
      hasDescKeys: sample ? ('description' in sample && 'links' in sample) : false,
      name: sample ? sample.name : null
    };
  } catch (e) { return { ok: false, err: String(e && e.message) }; }
});
check(b12.ok, 'B1 browse() 在产物里，返回货架条目数组', `n=${b12.n} ${b12.err || ''}`);
check(b12.ok && b12.hasTriple && b12.hasDescKeys,
  'B2 Entry 带 name/version + 三属性 + description/links（缺省也不省键）',
  `keys=${JSON.stringify(b12.keys)}`);

// ── B3 description/links 透传端到端 ───────────────────────────────────────────
const b3 = await page.evaluate(async () => {
  const list = await window.OctaveAssets.browse();
  const sy = list.find(e => e.name === 'symbolic');
  // ⚠️ 排除口径 = **能力层**（form:'tree'），不是按名字硬编码：能力层不是货架包，
  //   没有 description 是正当的（pyodide 先例 + 2026-10-19 新增的 llvm-wasm）。
  //   第一版只写死 'pyodide' ⇒ llvm-wasm 进表后 B3c 假红（这条实测抓到）。
  //   ⚠️ 第二版先用 e.form 也错了：Entry 的 form 在 **detail.form** 里（顶层没有）
  //   ⇒ 过滤恒真。判据：读 detail.form。
  // 排除口径（2026-10-25 再扩）：能力层（form:'tree'）+ **非 octave 消费面**的外部
  // 生产者条目（consumer 不含 octave，如 MSL 的 consumer:["omc"]）—— 它们不是本市场
  // 的货架包，没有包级 description 是合理形态（内容仓 mail/048 C-2 的同一裁定）。
  const noDesc = list
    .filter(e => {
      const d = e.detail || {};
      const consumer = d.consumer || e.consumer || null;
      const external = Array.isArray(consumer) && consumer.indexOf('octave') < 0;
      return d.form !== 'tree' && !external && !(e.description || '').length;
    })
    .map(e => e.name);
  return {
    syDesc: sy ? sy.description : null,
    syDescLen: sy ? (sy.description || '').length : 0,
    syLinks: sy ? sy.links : null,
    linkOk: sy && Array.isArray(sy.links) && sy.links.length > 0
      && sy.links.every(l => typeof l.label === 'string' && typeof l.url === 'string'),
    noDesc
  };
});
check(b3.syDescLen > 10 && b3.syDesc.startsWith('Symbolic calculation'),
  'B3a symbolic.description 透传到位（货架档案 upstream.description）',
  String(b3.syDesc).slice(0, 60));
check(b3.linkOk, 'B3b symbolic.links 是 {label,url} 数组（瘦身口径结构）',
  JSON.stringify((b3.syLinks || []).slice(0, 2)));
check(b3.noDesc.length === 0, 'B3c 反向：货架包全部带非空 description（13/13）',
  `空 description 的包：${b3.noDesc.join(',') || '无'}`);

// ── B4 versions[] 带出（statistics 多版本：1.7.7 staged / 1.7.3 withheld）──────
const b4 = await page.evaluate(async () => {
  const list = await window.OctaveAssets.browse();
  const st = list.find(e => e.name === 'statistics');
  if (!st || !Array.isArray(st.versions)) return { ok: false, why: 'no versions[]' };
  const v177 = st.versions.find(c => c.version === '1.7.7');
  const v173 = st.versions.find(c => c.version === '1.7.3');
  return {
    n: st.versions.length,
    v177: v177, v173: v173,
    stagedOk: v177 && v177.stage === 'staged' && Array.isArray(v177.content),
    withheldOk: v173 && v173.stage === 'withheld' && !!v173.withheld_cause
      && !('form' in v173) && !('content' in v173),
    topMatch: st.version === '1.7.7'
  };
});
check(b4.ok !== false && b4.n >= 2, 'B4a 多版本包每版一条候选', `statistics versions=${b4.n} ${b4.why || ''}`);
check(!!b4.stagedOk, 'B4b staged 候选带派生轴（content）',
  JSON.stringify(b4.v177));
check(!!b4.withheldOk, 'B4c ★ withheld 候选只带 cause、不带派生轴（不变量③客户端面）',
  JSON.stringify(b4.v173));
check(!!b4.topMatch, 'B4d 顶层标量 = 选中候选（1.7.7）', `top=${b4.v177 && b4.v177.version}`);

// ── B5 三属性与 statusOf 同源 ─────────────────────────────────────────────────
const b5 = await page.evaluate(async () => {
  await window.OctaveAssets.catalog();                  // 确保同步 statusOf 有目录缓存
  const list = await window.OctaveAssets.browse();
  const names = ['symbolic', 'statistics', 'optim'].filter(n =>
    list.some(e => e.name === n));
  return names.map(n => {
    const e = list.find(x => x.name === n);
    const s = window.OctaveAssets.statusOf(n);
    return { n, same: s && e && e.fromSource === s.fromSource
      && e.compatible === s.compatible && e.installed === s.installed
      && e.version === s.version };
  });
});
check(b5.length > 0 && b5.every(x => x.same),
  'B5 三属性与 statusOf 逐字段同源（一条产地 _browseEntry）',
  JSON.stringify(b5));

// ── B6 installed 会翻（装 splines 前后）───────────────────────────────────────
//   （选 splines：货架真包、纯 .m、不在随站清单 ⇒ 装载必走 forge 路径。cgl 不在货架上，
//    2026-10-17 实测 B6a null —— 环境前提写成不存在的包是套件 bug，不是产物问题。）
const b6a = await page.evaluate(async () => {
  const list = await window.OctaveAssets.browse();
  const c = list.find(e => e.name === 'splines');
  return c ? { state: c.state, installed: c.installed } : null;
});
check(b6a !== null, 'B6a 货架上有 splines（环境前提）', JSON.stringify(b6a));
const b6install = await page.evaluate(async () => {
  try { const r = await window.OctaveAssets.install('splines');
        return { ok: r.state === 'ok' }; }
  catch (e) { return { ok: false, err: String(e && e.message) }; }
});
check(b6install.ok, 'B6b install(splines) 成功', b6install.err || '');
const b6c = await page.evaluate(async () => {
  const list = await window.OctaveAssets.browse();
  const c = list.find(e => e.name === 'splines');
  return c ? { state: c.state, installed: c.installed } : null;
});
check(!!b6c && b6c.state === 'installed' && b6c.installed === true,
  'B6c 装后 browse() 里 splines state=installed（会话态真翻）',
  `前=${JSON.stringify(b6a)} 后=${JSON.stringify(b6c)}`);

// ── B7/B8/B9 注入反向（不碰站点：__catalogSource 测试缝）──────────────────────
//   ⚠️ 注入面 = **新实例**（createOctaveAssets 工厂 + __catalogSource，与 accept-arch-boundary
//   同款）—— 不能在全局实例上改：全局实例的 catalog 缓存开机就被 octave-core.js 填过
//   （T4：货架目录必须开机读）⇒ __catalogSource 不再生效（实测 B7 undefined 两轮）。
//   新实例与全局实例状态完全隔离（工厂闭包）⇒ 本页即可，不必另开页面。
const b789 = await page.evaluate(async () => {
  if (typeof window.createOctaveAssets !== 'function') return { skip: 'no-factory' };
  // 探宿主档（全局实例开机已读目录 ⇒ statusOf 可用）
  const probe = window.OctaveAssets.statusOf('symbolic');
  const ha = probe && probe.detail ? probe.detail.hostArch : null;
  const wrongArch = ha === 'wasm64' ? 'wasm32' : 'wasm64';
  const packs = [
    { name: '__zz_arch_bad', version: '1.0.0', sha256: 'a'.repeat(64),
      url: 'assets/forge/__zz_arch_bad-1.0.0.tar.gz', form: 'pkg',
      content: ['m', 'oct'], kinds: ['m', 'oct'], deps: [],
      description: 'arch mismatch fixture', links: [], arch: wrongArch,
      versions: [{ version: '1.0.0', stage: 'staged', form: 'pkg', content: ['m', 'oct'],
                   arch: wrongArch, url: 'assets/forge/__zz_arch_bad-1.0.0.tar.gz' }] },
    { name: '__zz_wheld', version: '2.0.0', sha256: 'b'.repeat(64),
      url: 'assets/forge/__zz_wheld-2.0.0.tar.gz', form: 'pkg',
      content: ['m'], kinds: ['m'], deps: [],
      description: 'withheld-top fixture', links: [],
      versions: [{ version: '2.0.0', stage: 'withheld', withheld_cause: 'bytes-not-staged' }] },
    // 老形状：不带 description/links/versions（2026-10-16 之前的目录形状）
    { name: '__zz_legacy', version: '1.0.0', sha256: 'c'.repeat(64),
      url: 'assets/forge/__zz_legacy-1.0.0.tar.gz', form: 'pkg',
      content: ['m'], kinds: ['m'], deps: [] }
  ];
  // ★ 新实例 + 注入缝（arch-boundary 同款）：只影响本实例，全局实例的缓存不动
  const inst = window.createOctaveAssets(window.Module, '', () => true);
  inst.__catalogSource(() => ({ schema: 2, octave: '11.3.0', packs }));
  const list = await inst.browse();
  const archBad = list.find(e => e.name === '__zz_arch_bad');
  const wheld = list.find(e => e.name === '__zz_wheld');
  const leg = list.find(e => e.name === '__zz_legacy');
  return {
    ha, wrongArch,
    archBad: archBad && { state: archBad.state, compatible: archBad.compatible,
                          why: archBad.why },
    wheld: wheld && { state: wheld.state, why: wheld.why,
                      versions: wheld.versions },
    legacy: leg && { description: leg.description, links: leg.links,
                     versions: leg.versions }
  };
});
check(!!b789.archBad && b789.archBad.state === 'blocked'
  && b789.archBad.compatible === false
  && /arch/.test((b789.archBad.why || []).join(' ')),
  'B7 ★ 反向：arch 不符条目 ⇒ state=blocked + compatible=false + why 点名',
  `host=${b789.ha} ${JSON.stringify(b789.archBad)}`);
check(!!b789.wheld && b789.wheld.state === 'blocked'
  && /未 stage/.test((b789.wheld.why || []).join(' '))
  && b789.wheld.versions[0].withheld_cause === 'bytes-not-staged',
  'B8 ★ 反向：选中版本 withheld ⇒ state=blocked + why 点名未 stage',
  JSON.stringify(b789.wheld));
check(!!b789.legacy && b789.legacy.description === ''
  && Array.isArray(b789.legacy.links) && b789.legacy.links.length === 0,
  'B9 ★ 反向：老形状条目（无 description/links 键）⇒ Entry 兜底空值，不炸',
  JSON.stringify(b789.legacy));

// ── B10 browse() 不下载任何字节（读面 = 零网络承诺的目录读取）──────────────────
const page2 = await (await browser.newContext()).newPage();
const net2 = [];
page2.on('response', r => { if (/assets\/(forge|pkg)\//.test(r.url())) net2.push(r.url()); });
await page2.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page2.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1500);
net2.length = 0;                       // 清掉开机资产请求，只看 browse 期间
const b10n = await page2.evaluate(async () => {
  const l = await window.OctaveAssets.browse();
  return l.length;
});
check(net2.length === 0 && b10n > 0,
  'B10 browse() 期间零包字节请求（读面只读目录）',
  `entries=${b10n} bytes-requests=${net2.length} ${net2.slice(0, 2).join(' ')}`);

// ── B11 ★ files[] 下载闭包（工单 69，内容仓 mail/090，2026-10-26）────────────────
//   omc（tree）条目带 files = {文件名 → {bytes,sha256}}，值 = OM 生产者台账投影
//   （omc_web_wasm_sha / omc_web_js_sha —— 两件 sha 的产地，UI 硬编码退役的前提）。
//   非下发件（.d.ts）不列 ⇒ files 和 ≠ size 是**设计**（size = 目录和，R14 轴）。
//   无 files 的 tree 条目（llvm-wasm/pyodide）detail.files === null（缺省兼容形状）。
const b11 = await page.evaluate(async () => {
  const list = await window.OctaveAssets.browse();
  const omc = list.find(e => e.name === 'omc');
  const lw = list.find(e => e.name === 'llvm-wasm');
  const py = list.find(e => e.name === 'pyodide');
  const f = omc && omc.detail && omc.detail.files;
  const keys = f ? Object.keys(f).sort() : null;
  const wasm = f && f['OpenModelicaCompiler_bg.wasm'];
  const js = f && f['OpenModelicaCompiler.js'];
  const closureBytes = f ? Object.values(f).reduce((s, v) => s + (v.bytes || 0), 0) : 0;
  return {
    hasOmc: !!omc,
    keys,
    wasm: wasm || null, js: js || null,
    closureBytes,
    size: omc ? omc.detail.size ?? null : null,
    sizeNeqClosure: omc ? (omc.detail.size !== closureBytes) : null,
    lwNull: !!(lw && lw.detail && lw.detail.files === null),
    pyNull: !!(py && py.detail && py.detail.files === null)
  };
});
check(b11.hasOmc && JSON.stringify(b11.keys) ===
    JSON.stringify(['OpenModelicaCompiler.js', 'OpenModelicaCompiler_bg.wasm']),
  'B11a omc Entry detail.files 恰为两件下发件（.d.ts 不列）',
  JSON.stringify(b11.keys));
check(!!b11.wasm && b11.wasm.bytes === 74579404
  && b11.wasm.sha256 === '8287589ebdb53b4cc37c337c2ae88f798d8889f7ac3c29d693ca12e539b8d001'
  && !!b11.js && b11.js.bytes === 56586
  && b11.js.sha256 === '56c399bd455d57c8e21206287445643b81db6fd4e3ac183989616b903d165f17',
  'B11b files 值 = OM 台账投影（bg.wasm 8287589e…/JS 56c399bd… —— 产地非宿主另算）',
  JSON.stringify({ wasm: b11.wasm, js: b11.js }));
check(b11.sizeNeqClosure === true && b11.closureBytes === 74635990,
  'B11c 闭包预算 ≠ size（有意设计：size=目录和 R14 轴，files 和=下载预算）',
  `closure=${b11.closureBytes} size=${b11.size}`);
check(b11.lwNull && b11.pyNull,
  'B11d ★ 无 files 的 tree 条目 detail.files === null（缺省兼容形状，不编空对象）',
  `llvm-wasm=${b11.lwNull} pyodide=${b11.pyNull}`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
