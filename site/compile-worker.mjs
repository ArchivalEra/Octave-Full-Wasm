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
let octincFiles = null;         // Octave 头（解包一次，逐实例灌入）
let clangUrls = null;           // { glue, wasm }（freshClang 用；字节在 _assetCache）
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
// ★ 2026-10-18 多 TU 实测：**每次 callMain 都要一个全新实例**。
//   clang 每次 run 会注册 signal handler，同一个 Module 上第二次 callMain 直接
//   `LLVM ERROR: too many signal callbacks already registered` ⇒ abort()。
//   v1 永远只编一个 TU，所以这条从没暴露过（与 lld 的 latch 是同族但不同机制：
//   lld 是"特性集被记住"，clang 是"信号回调只能注册一次"）。
//   因此本函数按 URL **缓存字节**（不重下，网络代价仍是 66 MB 一次），实例每次新造。
const _assetCache = new Map();       // url → ArrayBuffer（wasm）/ string（glue）
async function loadAsset (url) {
  if (!_assetCache.has(url)) {
    const r = await fetch(url);
    _assetCache.set(url, url.endsWith('.wasm') ? await r.arrayBuffer() : await r.text());
    const n = url.endsWith('.wasm') ? _assetCache.get(url).byteLength : _assetCache.get(url).length;
    bytesSeen[url.includes('lld') ? 'lld' : 'clang'] += n;
    log(`  ${url.split('/').pop()}: ${n} B（已缓存，复编不重下）`);
  }
  return _assetCache.get(url);
}

async function instantiate (glueUrl, wasmUrl, importObject) {
  const glueText = await loadAsset(glueUrl);
  const wasmBytes = await loadAsset(wasmUrl);
  const wrapped = `${glueText}\nexport default createToolChain;`;
  const blob = URL.createObjectURL(new Blob([wrapped], { type: 'text/javascript' }));
  const mod = await import(blob);
  const factory = mod.default;
  const errs = [];                   // 每个实例自己的 stderr（别跨实例共享，会串）
  const inst = await factory({
    ...(importObject || {}),
    wasmBinary: wasmBytes,
    printErr: (s) => { const t = String(s).slice(0, 300); errs.push(t); lastErr.push(t); },
    locateFile: () => wasmUrl,
    instantiateWasm: (info, receive) => {
      WebAssembly.instantiate(wasmBytes, info).then(
        (r) => receive(r.instance), (e) => { throw e; });
      return {};
    },
    noInitialRun: true,
  });
  inst.collected = errs;             // 与生产者的字段名对齐（detail 取它）
  return inst;
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
  configMacros = msg.configMacros || null;   // 25 宏：源里 "./config.h" 的内容
  // ★ Octave 头与 sysroot 的解包结果**各只做一次**（tar 解包是 CPU 活，字节已缓存）；
  //   每个 clang 实例只是把这些文件灌进自己的 FS（见 freshClang）。
  if (msg.octincTarUrl) {
    log('phase 2b: octave headers（' + msg.octincTarUrl.split('/').pop() + '）');
    // ★ 头按档（loader 已选）：wasm64 用 wasm64 树的头（mxtypes.h 的 mwSize=int64）。
    //   旧站点缺 wasm64 那份时 loader 会传 wasm32 的 URL —— fetch 404 ⇒ 这里抛
    //   （fail-loud，不静默用错档头 —— 那正是 C2c 边界的根因形状）。
    let res;
    try {
      res = await fetch(msg.octincTarUrl);
    } catch (e) {
      throw new Error('Octave 头取不到（' + msg.octincTarUrl + '）：' + e.message);
    }
    if (!res.ok) {
      throw new Error('Octave 头取不到（' + msg.octincTarUrl + '）：HTTP ' + res.status
        + ' —— wasm64 档需要 octave-headers.wasm64.tar.gz（跑 provision-llvm-wasm.sh fetch）');
    }
    const incBuf = new Uint8Array(await res.arrayBuffer());
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
    octincFiles = readTar(raw);
    log(`octave headers: ${octincFiles.size} members（解包一次，逐实例灌入）`);
  }
  clangUrls = { glue: msg.clangGlueUrl, wasm: msg.clangWasmUrl };   // 必须在 freshClang 之前
  clangMod = await freshClang();
  log('clang ready（lld 未拉 —— 首次链接时才取）');

  lldArgs = { glue: msg.lldGlueUrl || null, wasm: msg.lldWasmUrl || null };
  post({ type: 'ready', bytes: { clang: bytesSeen.clang, sysroot: bytesSeen.sysroot } });
}

// ── ★ 每个编译动作一首新 clang 实例（2026-10-18 多 TU 实测）─────────────────
// `LLVM ERROR: too many signal callbacks already registered` —— clang 每次 run 注册
// signal handler，同实例第二次 callMain 直接 abort。v1 只编一个 TU 所以没暴露。
// 字节已缓存（loadAsset），新实例的代价 = 实例化 + 把 sysroot/头灌进新 FS。
async function freshClang () {
  if (!clangUrls) throw new Error('freshClang: clang URLs 未初始化（init 未跑？）');
  const inst = await instantiate(clangUrls.glue, clangUrls.wasm);
  installFiles(inst.FS, sysrootFiles);
  if (octincFiles) {
    let n = 0;
    for (const [rel, data] of octincFiles) {
      const clean = rel.replace(/^\.\//, '').replace(/\/+$/, '');
      if (!clean) continue;
      const dst = '/src/octinc/' + clean;
      const dir = dst.slice(0, dst.lastIndexOf('/'));
      if (dir) inst.FS.mkdirTree(dir);
      try { inst.FS.writeFile(dst, data); n++; } catch (e) { /* 目录项跳过 */ }
    }
    inst.octincCount = n;
  }
  return inst;
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

// ── 多 TU 编排（v2）──────────────────────────────────────────────────────────
// 为什么在 worker 里做、而不改生产者的 compile-core.mjs：那个文件是 **vendored**
// （`provision-llvm-wasm.sh` 逐件核 sha 从 bundle 取），改它 = 下次 provision 覆盖掉，
// 而且是"两处产地"。本 worker 已经是"本仓自建的分阶段适配器"，多 TU 编排属于同一层。
//
// 用到的两个生产者导出（abi.mjs 的旗标拼装 = 单一产地，不复制）：
//   compileArgv({triple, files, abi, defines, includes, extra})  → argv（编译一个 TU）
//   linkArgv({target, abi, hasCrt, objPath})                     → argv（链接）
// ⚠️ linkArgv 只有一个 objPath 参数（生产者口径 = 单 TU）。多对象时我们**自己拼**
//   对象列表部分，其余旗标仍经 linkArgv 原样取用 —— 这样"链接旗标"仍只有一个产地。
// ── 多 TU：**委托给深模块** `bridge/multi-tu.mjs`（2026-10-18 交互升级）──────────
// 为什么不再在本文件里写编排：这条逻辑此前只活在浏览器 Worker 里 ⇒ 每次"改一行 → 验证"
// 都要付 8 分钟往返（拉 66 MB + 起页面 + 编 + 回读），失败还只回一句 `Aborted()`。
// 编排与"跑在谁的 wasm 里"无关 —— 抽成深模块后，本地台（test/local/compile-local.mjs）
// 用同一份逻辑跑，**8 秒一轮**且拿到完整 stderr。本 worker 现在只是它的一个 adapter：
//   · clang()/lld() 每次新实例（字节已缓存，见 _assetCache）；
//   · prepare() 把 config.h + 摊平后的源灌进**这艘新实例**的 FS。
import { compileAllModules } from './multi-tu.mjs';

async function compileMany (msg) {
  // abi 两函数由生产者 driver 提供（单一产地）；深模块只负责编排
  const abiMod = await import('./assets/llvm/driver/abi.mjs');
  const flat = {};
  for (const [name, text] of Object.entries(msg.files || {})) {
    flat[String(name).replace(/^\.\//, '').split('/').pop()] = text;
  }
  const r = await compileAllModules({
    targetsAvailable: () => ['wasm32', 'wasm64'].filter((a) =>
      sysrootFiles.has(`sysroot/lib/${a}-emscripten/pic/crtbegin-mt.o`)),
    clang: () => freshClang(),          // ★ 每 TU 新实例（实测：复用会 LLVM ERROR）
    lld: (t) => _ensureLld(t, msg.lld),
    log,
  }, {
    target: msg.target, abi: msg.abi, abiModule: abiMod,
    files: msg.files, modules: msg.modules,
    define: msg.define, include: msg.include, flags: msg.flags,
    // 每艘新 clang 实例都要重灌（FS 每实例独立）
    prepare(inst) {
      inst.FS.mkdirTree('/src');
      inst.FS.mkdirTree('/out');
      if (configMacros) {
        const lines = Object.keys(configMacros).map((k) => '#define ' + k + ' ' + configMacros[k]);
        inst.FS.writeFile('/src/config.h', lines.join('\n'));
      }
      for (const [base, text] of Object.entries(flat)) inst.FS.writeFile('/src/' + base, text);
    },
    hostBytes: msg.hostWasmBytes,
  });
  return r;
}


async function compile (msg) {
  // ── 多 TU（v2，2026-10-18）：`files` 里**每个含 DEFUN_DLD 的源**都要进链接 ────────
  // v1 只编 `Object.keys(files)[0]`（compile-core 的口径）⇒ `miscellaneous` 的
  // partint/sample/text_waitbar 三个模块从未被编出来（判据 `partint(5)` 空）。
  // 真实包的分组规则（不是"每个 .cc 一个模块"，也不是"全链一个模块"）：
  //   · 一个 .cc 里可以有**多个 DEFUN_DLD**（真实包确有）；
  //   · 一个模块可以**跨多个 .cc**（optim 的 `__bfgsmin` = __bfgsmin.cc + error-helpers.cc，
  //     statistics 的 svmtrain = svmtrain.cc + svm.cpp + svm_model_octave.cc）。
  // 所以我们不再靠源文件名猜分组，而是接受**显式模块表**（`msg.modules`）：
  //   [{name:'partcnt', sources:['partint.cc'], main:'partint.cc'}, …]
  // 表缺席 ⇒ 退回 v1 单 TU 路径（compile-core 编排，不复制它）。
  if (Array.isArray(msg.modules) && msg.modules.length) return compileMany(msg);
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
