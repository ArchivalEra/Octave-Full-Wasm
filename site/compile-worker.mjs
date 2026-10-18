// Octave-Full-Wasm — **分次懒加载的编译 Worker**（compileExtension 批，2026-10-18）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么要本仓自建这一个（不直接用生产者仓的 browser/worker.mjs）──────────────
// 用户点令（2026-10-18）：「虽然网站管理员会帮你做 gzip。你需要保证能分次懒加载」。
// 生产者 worker 在 `init` 里**同时**实例化 clang + lld ⇒ 首编一次性拉 45.8 + 31.8 MB
// 原始字节（gzip 后约 14 + 8.5 MB，仍是一次性 ~23 MB 且必须全下完才能开始）。
// 实测：这样在验收预算内跑不完，且用户明确不接受。
//
// 本 worker = **同一份编排**（import 生产者的 driver/compile-core.mjs —— 不复制逻辑，
// 只改"何时取哪一件"），把工具链拆成**两段**：
//   ① init 阶段只拉 clang.wasm + 本档 sysroot（wasm32/wasm64 二选一）→ 立刻 ready
//   ② lld 在**首次 compile（真正要链接）时**才拉（`_ensureLld()`）—— 只编译不链接的路径
//      永远不付这 31.8 MB
// 三段资产各自独立 fetch + 独立核 sha（manifest 的逐资产 sha；fail-closed）。
//
// 协议（与生产者兼容，外加一条 ready 的阶段信息）：
//   in:  { type:'init', clangWasmUrl, clangGlueUrl, sysrootTarUrl, sysrootSha256,
//          octincTarUrl }        ← Octave 头（6 MB tar.gz；解进 clang.FS 的 /src/octinc）
//   in:  { type:'compile', source, target, abi, define, include, flags, lld:{wasmUrl,glueUrl} }
//   out: { type:'ready', bytes:{clang,sysroot} }         ← 此时 lld 未拉
//   out: { type:'phase', phase:'lld-fetch', bytes }      ← 首链前的第二次网络
//   out: { type:'result', ok, moduleBytes?, error?, gap? }
//   out: { type:'log', text }
// ⚠️ 本文件在**站点根**（compile-worker.mjs），driver 在 assets/llvm/driver/ ⇒ 路径带前缀。
import { compileWith } from './assets/llvm/driver/compile-core.mjs';
import { readTar } from './assets/llvm/driver/tar-reader.mjs';

const post = (m) => self.postMessage(m);
const log = (text) => post({ type: 'log', text });

let clangMod = null;
let sysrootFiles = null;
let lldMod = null;              // ★ 懒：首链才实例化
let lldArgs = null;             // { glue, wasm }（init 只记住 URL，不 fetch）
let lastErr = [];
let bytesSeen = { clang: 0, sysroot: 0, lld: 0 };
let configMacros = null;        // 25 宏（init 时从页面传入；包源普遍 #include "./config.h"）

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 与生产者 worker 同款（UMD glue 重导出 + 自己 instantiateWasm 绕开两个实测坑）。
async function instantiate (glueUrl, wasmUrl, importObject) {
  const glueText = await (await fetch(glueUrl)).text();
  const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();
  bytesSeen[wasmUrl.includes('lld') ? 'lld' : 'clang'] += wasmBytes.byteLength;
  log(`  ${glueUrl.split('/').pop()}: glue ${glueText.length} B, wasm ${wasmBytes.byteLength} B`);
  const wrapped = `${glueText}\nexport default createToolChain;`;
  const blob = URL.createObjectURL(new Blob([wrapped], { type: 'text/javascript' }));
  const mod = await import(blob);
  const factory = mod.default;
  return factory({
    ...(importObject || {}),
    wasmBinary: wasmBytes,
    printErr: (s) => { lastErr.push(String(s).slice(0, 300)); },
    locateFile: () => wasmUrl,
    instantiateWasm: (info, receive) => {
      WebAssembly.instantiate(wasmBytes, info).then(
        (r) => receive(r.instance), (e) => { throw e; });
      return {};
    },
    noInitialRun: true,
  });
}

function installFiles (fs, files) {
  // ⚠️ 门槛 2（设计稿 §10 实测）：多文件写 FS 必须逐级建父目录，且要**跳过目录项**
  //   （tar 里 `./octave/` 这类 rel 的 basename 为空 ⇒ writeFile 报 ErrnoError 44）。
  //   原生产者版本直接用 `/${rel}` 并只 mkdirTree(dir)：对带 `./` 前缀 / 尾斜杠的成员
  //   会写出 `/./x` 或以空 basename 写盘 —— 在 lld 的 fresh FS 上就炸（本批实测）。
  let n = 0;
  for (const [rel, data] of files) {
    const clean = String(rel).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!clean || !data) continue;      // 目录项（name 以 / 结尾 ⇒ clean 为空）
    // ⚠️ 不许按 size 跳过：sysroot 里有 7 个**合法空文件**（实测 tar 成员统计）
    const dst = `/${clean}`;
    const dir = dst.slice(0, dst.lastIndexOf('/'));
    if (dir && dir !== '/') {
      try { fs.mkdirTree(dir); } catch (e) {
        throw new Error('installFiles: mkdirTree(' + dir + ') 失败：' + (e && e.message));
      }
    }
    try { fs.writeFile(dst, data); n++; } catch (e) {
      throw new Error('installFiles: writeFile(' + dst + ') 失败：' + (e && e.message));
    }
  }
  return n;
}

// ── ① init：只拉 clang + 本档 sysroot（两件，各自核 sha）────────────────────
async function init (msg) {
  log('phase 1/3: sysroot');
  const tarBuf = new Uint8Array(await (await fetch(msg.sysrootTarUrl)).arrayBuffer());
  bytesSeen.sysroot += tarBuf.byteLength;
  const got = await sha256Hex(tarBuf);
  if (msg.sysrootSha256 && got !== msg.sysrootSha256) {
    throw new Error(`sysroot sha256 mismatch — refusing.\n  expected ${msg.sysrootSha256}\n  got      ${got}`);
  }
  sysrootFiles = readTar(tarBuf);
  log(`sysroot verified (${got.slice(0, 12)}…), ${sysrootFiles.size} files`);

  log('phase 2/3: clang');
  clangMod = await instantiate(msg.clangGlueUrl, msg.clangWasmUrl);
  installFiles(clangMod.FS, sysrootFiles);
  // ★ Octave 头必须装进 **clang 的 FS**（编译在 worker 里跑，页面 FS 它看不见）。
  //   取 assets/octinc/octave-headers.tar.gz（tar 根 = ./octave/…）⇒ 解到 /src/octinc 后
  //   路径为 /src/octinc/octave/oct.h ⇒ `-I /src/octinc` 正好解析 <octave/oct.h>。
  configMacros = msg.configMacros || null;   // 25 宏：源里 "./config.h" 的内容
  if (msg.octincTarUrl) {
    log('phase 2b: octave headers');
    const incBuf = new Uint8Array(await (await fetch(msg.octincTarUrl)).arrayBuffer());
    // driver/readTar 只吃**未压缩** tar ⇒ 先用浏览器原生 DecompressionStream 解 gzip
    //   （现代浏览器都有；没有就明确失败，不静默）。
    let raw = incBuf;
    if (typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('gzip');
      const stream = new Blob([incBuf]).stream().pipeThrough(ds);
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
      log(`octave headers: gzip ${incBuf.byteLength} → ${raw.byteLength} B`);
    } else {
      throw new Error('本浏览器没有 DecompressionStream —— 换未压缩头 tar 或升级浏览器');
    }
    const incFiles = readTar(raw);
    // ⚠️ installFiles 恒写 `/<rel>`；头要落 **/src/octinc/<rel>**（-I /src/octinc 才能解析
    //   <octave/oct.h>）。成员名带 `./` 前缀 ⇒ 逐条规范化后加前缀。
    let n = 0;
    for (const [rel, data] of incFiles) {
      const clean = rel.replace(/^\.\//, '').replace(/\/+$/, '');
      if (!clean) continue;
      const dst = '/src/octinc/' + clean;
      const dir = dst.slice(0, dst.lastIndexOf('/'));
      if (dir) clangMod.FS.mkdirTree(dir);
      try { clangMod.FS.writeFile(dst, data); n++; } catch (e) { /* 目录项跳过 */ }
    }
    log(`octave headers installed: ${n} files → /src/octinc/`);
  }
  log('clang ready（lld 未拉 —— 首次链接时才取）');

  lldArgs = { glue: msg.lldGlueUrl || null, wasm: msg.lldWasmUrl || null };
  post({ type: 'ready', bytes: { clang: bytesSeen.clang, sysroot: bytesSeen.sysroot } });
}

// ── ② lld 懒加载（首链才付 31.8 MB）─────────────────────────────────────────
async function _ensureLld (target, override) {
  // 两种字段名都认（compile 里传 {wasmUrl,glueUrl}；init 里传 {wasm,glue}）
  const o = override || {};
  const args = { wasm: o.wasmUrl || o.wasm || (lldArgs && lldArgs.wasm),
                 glue: o.glueUrl || o.glue || (lldArgs && lldArgs.glue) };
  if (!args.wasm) throw new Error('lld URL 未提供（init 或 compile 里带 lldWasmUrl/lldGlueUrl）');
  post({ type: 'phase', phase: 'lld-fetch' });
  log('phase 3/3: lld（首次链接）');
  const mod = await instantiate(args.glue, args.wasm, { thisProgram: 'wasm-ld' });
  installFiles(mod.FS, sysrootFiles);
  return mod;
}

async function compile (msg) {
  const r = await compileWith({
    targetsAvailable: () => ['wasm32', 'wasm64'].filter((a) =>
      sysrootFiles.has(`sysroot/lib/${a}-emscripten/pic/crtbegin-mt.o`)),
    clang: async () => {
      clangMod.collected = lastErr = [];
      // config.h 必须与源同目录（源里 #include "./config.h"）——compileWith 会 mkdirTree('/src')
      // 并写 /src/<name>，我们在此之前把 config.h 放进 /src。
      try { clangMod.FS.mkdirTree('/src'); } catch (e) {}
      if (configMacros) {
        const lines = Object.keys(configMacros).map((k) => '#define ' + k + ' ' + configMacros[k]);
        clangMod.FS.writeFile('/src/config.h', lines.join('\n'));
      }
      return clangMod;
    },
    lld: async (arch) => {
      const m = await _ensureLld(arch, msg.lld);   // ★ 一次一实例（lld 会 latch 特性集）
      m.collected = lastErr = [];
      return m;
    },
    log,
  }, {
    source: msg.source, target: msg.target, abi: msg.abi,
    define: msg.define, include: msg.include, flags: msg.flags,
    hostBytes: msg.hostWasmBytes,
  });
  return { ok: r.ok, error: r.error, detail: r.detail, moduleBytes: r.moduleBytes,
           gap: r.symbolGap, stage: r.stage };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') { await init(msg); }
    else if (msg.type === 'compile') { const r = await compile(msg); post({ type: 'result', ...r }); }
  } catch (err) {
    post({ type: 'result', ok: false, error: String((err && err.message) || err) });
  }
};
