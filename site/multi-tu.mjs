// Octave-Full-Wasm — **多 TU 编排**：源码集合 → 一组 side module（深模块，2026-10-18）
// Copyright (C) 2026 Archivalera · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么是独立模块（不是埋在 worker 里）──────────────────────────────────────
// 这条逻辑此前**只活在浏览器 Worker 里**，于是每一次"改一行 → 验证"都要付
// 8 分钟往返（拉 66 MB 工具链 + 起页面 + 编 + 回读）。实测今天在这条线上花了四小时，
// 绝大部分是等这一个循环。编排与"运行在谁的 wasm 里"本来就没有关系：
//   · 浏览器：clang/lld 在 Worker 的 MEMFS 里；
//   · 本地：同一份 clang.wasm 在 Node 里（生产者 `driver/toolchain.mjs` 就是这么跑的）。
// ⇒ 把**分组、编序、链接拼装、对象命名**收进本模块（纯编排，零 I/O、零实例化），
//   runtime 由调用方注入。于是同一份编排有**两个 adapter**（worker / local bench），
//   而不是"两份实现"（生产者 `compile-core.mjs` 的教训：两个 adapter 曾经漂过）。
//
// ── 它拥有什么 ────────────────────────────────────────────────────────────────
//   ① **模块分组**：DEFUN_DLD 扫描。两条实测规则（都不是"一个 .cc 一个模块"）：
//      · 一个源可注册多个 DEFUN ⇒ 它们共用**同一个**模块（partint.cc = partcnt + partint，
//        共用文件内的 pcnt()；拆开链 ⇒ undefined symbol）；
//      · 一个模块可跨多个源（optim 的 __bfgsmin = __bfgsmin.cc + error-helpers.cc）。
//   ② **命名**：产物名取该源**第一个** DEFUN（`partint.cc` ⇒ `partcnt.oct`），
//      不是源文件名（Octave 按函数名找模块）。
//   ③ **编序与对象命名**（每 TU 一个 .o，带模块前缀；与容器 build-pkg-oct.sh 同名）。
//   ④ **链接 argv**：把 abi.mjs 的 `linkArgv` 单对象位换成对象列表（旗标仍单一产地）。
//   ⑤ **basename 摊平**：包源 `#include "./config.h"` 依赖"源与 config.h 同目录"。
//
// ── 它不拥有什么（故意）───────────────────────────────────────────────────────
//   · 实例化 / FS / 抓字节 / sha 校验 —— runtime 注入；
//   · 失败分类的上层语义（m-only 软失败等）—— 调用方决定；
//   · 单 TU 的既有路径 —— 仍走生产者 `compile-core.mjs`（不复制它的编排）。
//
// ── runtime 接口（四个成员，与 compile-core 同风格）────────────────────────────
//   runtime.targetsAvailable(): string[]
//   runtime.clang(): Promise<{FS, callMain, collected?}>   ← **必须是一艘新实例**
//   runtime.lld(target): Promise<{FS, callMain, collected?}>
//   runtime.log?(text)
// ⚠️ `clang()` 每次返回新实例是**硬要求**（实测：同实例第二次 callMain 会
//    `LLVM ERROR: too many signal callbacks already registered` ⇒ abort）。
//    本模块按"每 TU 调一次 clang()"的形状写，adapter 内部缓存字节即可。

// ⚠️ **不 import 具体 driver 路径**：`compileArgv` / `linkArgv` 由调用方注入（见
//   `req.abiModule`）。理由：本模块要被**两个 adapter** 复用（浏览器 worker 在站点根、
//   本地台在仓库里），而 `assets/llvm/driver/` 只存在于**站点**（provision 产物）⇒
//   写死相对路径会让"仓库副本跑不了自证"（实测：ERR_MODULE_NOT_FOUND）。
//   注入的这两个函数仍是**单一产地**（生产者的 driver/abi.mjs），只是不在这里解析路径。

const C_SRC_RE = /\.(cc|cpp|c)$/;
const DEFUN_RE = /DEFUN_DLD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g;

/** 从一个源的文本里取所有 DEFUN_DLD 注册名（顺序 = 源码顺序）。 */
export function defunNames(text) {
  const out = [];
  let m;
  DEFUN_RE.lastIndex = 0;
  while ((m = DEFUN_RE.exec(String(text || ''))) !== null) out.push(m[1]);
  return out;
}

/**
 * 源码集合 → 模块表。
 * @param {Record<string,string>} files  相对路径 → 源文本
 * @returns {Array<{name:string, sources:string[], defuns:string[]}>|null}  null = 无 DEFUN
 */
export function buildModuleTable(files, log = () => {}) {
  const cc = Object.keys(files || {}).filter((n) => C_SRC_RE.test(n));
  const mods = [];
  for (const rel of cc) {
    const names = defunNames(files[rel]);
    if (!names.length) continue;
    // ⚠️ 产物名 = **源文件 basename**，不是第一个 DEFUN 名 —— 这是实测定的口径：
    //   现役 `assets/octdir/miscellaneous/partint.oct` 的导出表里
    //   `Gpartcnt` 与 `Gpartint` **同时存在**（容器 build-pkg-oct.sh 的表行是
    //   `miscellaneous|partint|partint.cc|`）⇒ 一个源里的多个 DEFUN 共用一个
    //   以**源名**命名的模块，Octave 靠 PKG_ADD 的 autoload 把 `partcnt` 指过来。
    //   （我第一版按"第一个 DEFUN"命名成 partcnt.oct —— 与现役站点不一致，已改回。）
    const base = rel.split('/').pop().replace(/\.[^.]+$/, '');
    mods.push({ name: base + '.oct', sources: [rel], defuns: names });
  }
  if (!mods.length) return null;

  // 无 DEFUN 的源 = 辅助源（error-helpers.cc / svm.cpp …）。保守策略：并进**第一个**模块
  // —— 真实包里它们确实被多个模块共用；并进第一个至少保证"不再整包漏编"，
  // 且不会造出没有入口的孤儿模块。要更精细就得有逐包表（容器侧那张），
  // 那属于"数据"而不是"编排"，留给后续按需接。
  const owner = Object.create(null);
  for (const m of mods) owner[m.sources[0]] = 1;
  const helpers = cc.filter((rel) => !owner[rel]);
  if (helpers.length) {
    mods[0].sources = mods[0].sources.concat(helpers);
    log(`[tu] 辅助源并进 ${mods[0].name}：${helpers.join(', ')}`);
  }
  log(`[tu] 模块表（${mods.length}）：` + mods.map((m) =>
    m.name + (m.defuns.length > 1 ? `[${m.defuns.join('+')}]` : '')
    + (m.sources.length > 1 ? `(${m.sources.length} 源)` : '')).join(', '));
  return mods;
}

/** 源路径 → basename（摊平用）。带冲突检测：两个不同源同名 ⇒ 抛错（静默覆盖最难查）。 */
export function flattenSources(files) {
  const flat = Object.create(null);
  const origin = Object.create(null);
  for (const [name, text] of Object.entries(files || {})) {
    const base = String(name).replace(/^\.\//, '').split('/').pop();
    if (!base) continue;
    if (base in flat) {
      throw new Error(`源文件 basename 冲突：${base}（来自 ${origin[base]} 与 ${name}）`
        + `—— 摊平会互相覆盖，拒绝而不是静默编错`);
    }
    flat[base] = text;
    origin[base] = name;
  }
  return flat;
}

/** 模块表 → 每个 (模块, 源) 的编译单元清单（对象路径唯一）。 */
export function compileUnits(modules) {
  const units = [];
  for (const mod of modules) {
    for (const srcRel of mod.sources) {
      const srcBase = String(srcRel).split('/').pop();
      units.push({ module: mod.name, source: srcRel, sourceBase: srcBase,
                   objPath: `/out/${mod.name}--${srcBase}.o` });
    }
  }
  return units;
}

/**
 * 编译 argv（把一个 TU 编成对象）。旗标来自注入的 `compileArgv`（生产者
 * `driver/abi.mjs` = 单一产地），只把写死的 `-o /out/tu.o` 换成该 TU 的对象名。
 */
export function compileUnitArgv({ unit, target, abi, defines = [], includes = [], flags = [], compileArgv }) {
  if (typeof compileArgv !== 'function') throw new Error('compileUnitArgv: 缺 compileArgv 注入');
  const argv = compileArgv({
    triple: `${target}-unknown-emscripten`, files: unit.sourceBase, abi,
    defines, includes, extra: flags,
  });
  const i = argv.lastIndexOf('/out/tu.o');
  if (i >= 0) argv[i] = unit.objPath;
  return argv;
}

/** 链接 argv（一个模块的**全部**对象一次链接）。旗标来自注入的 `linkArgv`，只扩对象列表。 */
export function linkModuleArgv({ target, abi, objs, linkArgv }) {
  if (typeof linkArgv !== 'function') throw new Error('linkModuleArgv: 缺 linkArgv 注入');
  if (!objs || !objs.length) throw new Error('linkModuleArgv: 没有对象可链');
  const base = linkArgv({ target, abi, hasCrt: true, objPath: objs[0] });
  // ★ emcc 同款链接级 -mllvm（2026-10-19 C2c 根因）：em++ -shared 会传
  //   combiner-global-alias-analysis=false / wasm-enable-sjlj / wasm-use-legacy-eh / disable-lsr。
  //   实测缺编译侧四个时对象就错；链接侧四个由 emcc 全传。正式修在生产者 abi.mjs。
  base.push('-mllvm', '-combiner-global-alias-analysis=false',
            '-mllvm', '-wasm-enable-sjlj',
            '-mllvm', '-wasm-use-legacy-eh',
            '-mllvm', '-disable-lsr');
  // ★ lld 是**通用驱动器**：不给 `-flavor wasm` 它会打印
  //   "lld is a generic driver. Invoke ld.lld/…/wasm-ld instead" 并退 1
  //   （实测：只设 thisProgram 不够）。生产者 glue 是同款 lld-wasm-only，
  //   它的 node 驱动传的是 `thisProgram: 'wasm-ld'` —— 两者都试过，只有 -flavor 生效。
  base.unshift('-flavor', 'wasm');
  const i = base.lastIndexOf(objs[0]);
  if (i < 0) throw new Error('linkModuleArgv: linkArgv 里找不到对象位（上游改了形状？）');
  // ⚠️ 必须把**全部**对象（含第 0 个）放回原位：`slice(0,i)` 到 i 之前为止，
  //   所以 i 位置那个对象已被切掉 —— 第一版写成 `objs.slice(1)` ⇒ 单对象模块的
  //   链接命令里**一个对象都没有**（wasm-ld 只报 exited 1，无其它线索；实测踩到）。
  return base.slice(0, i).concat(objs, base.slice(i + 1));
}

/**
 * 主编排：编所有模块。返回 `{ok, modules:[…], built, error?, stage?}`。
 * 每个模块 = 它所有源的 .o 一次链接。**一个模块失败不影响其他模块的尝试**（全部跑完再报）。
 */
export async function compileAllModules(runtime, req) {
  const { target } = req;
  const abi = { exceptions: 'wasm-legacy', pthread: true, memory64: target === 'wasm64',
                ...(req.abi || {}) };
  const log = runtime.log || (() => {});
  const diagnostics = [];

  const avail = runtime.targetsAvailable();
  if (!avail.includes(target)) {
    return { ok: false, stage: 'precheck', diagnostics,
             error: `sysroot for ${target} is missing (available: ${avail.join(', ') || 'none'})` };
  }

  let flat;
  try {
    flat = flattenSources(req.files);
  } catch (e) {
    return { ok: false, stage: 'validate', diagnostics, error: String(e.message || e) };
  }
  // ★ 模块表优先来自**数据**（`req.modules`，跟 catalog/包档案走），扫 DEFUN 只是兜底。
  //   实测依据：`miscellaneous` 的 `sample.cc` 在 11.3.0 头下**编不过**
  //   （`OCTAVE__RAND_UNIFORM()` 无参调用 vs 11.3.0 的 `rand_uniform(n, p)`），
  //   而容器 `build-pkg-oct.sh` 的模块表**本来就没列它**（现役站点只有
  //   cell2cell.oct + partint.oct）⇒ "包里所有含 DEFUN 的源都该编"是错的。
  //   扫 DEFUN 只用于"档案没给表"的包（至少不整包漏编），且失败按模块如实报。
  const modules = req.modules || buildModuleTable(flat, log);
  if (!modules || !modules.length) {
    return { ok: false, stage: 'validate', diagnostics, error: '没有可编译的模块（无 DEFUN_DLD）' };
  }

  const results = [];
  const abiMod = req.abiModule || {};
  for (const mod of modules) {
    const units = compileUnits([mod]);
    log(`[tu] 模块 ${mod.name}：${units.length} 个 TU`);
    const objs = [];
    let failed = null;

    for (const unit of units) {
      // ★ 每个 TU 一艘新 clang 实例（runtime 契约；见文件头）
      const clang = await runtime.clang();
      if (clang.collected) clang.collected.length = 0;   // 清空而非替换（printErr 持有原数组）
      if (req.prepare) await req.prepare(clang, flat);       // 写 config.h / 源到头文件目录
      const argv = compileUnitArgv({ unit, target, abi,
                                     defines: req.define, includes: req.include, flags: req.flags,
                                     compileArgv: abiMod.compileArgv });
      log(`clang ${argv.join(' ')}`);
      let rc;
      try {
        rc = clang.callMain(argv);
      } catch (e) {
        // emscripten 的 abort 抛异常（不是返回码）—— 必须接住并把 stderr 带出去
        failed = { module: mod.name, source: unit.source, error: `clang 抛异常（abort）：${(e && e.message) || e}`,
                   detail: (clang.collected || []).slice(-12) };
        break;
      }
      if (rc !== 0) {
        failed = { module: mod.name, source: unit.source, error: `clang exited ${rc}`,
                   detail: (clang.collected || []).slice(-8) };
        break;
      }
      let o = null;
      try { o = clang.FS.readFile(unit.objPath); } catch (e) { /* below */ }
      if (!o || !o.length) {
        failed = { module: mod.name, source: unit.source, error: 'clang produced no object' };
        break;
      }
      objs.push({ path: unit.objPath, bytes: o });
    }
    if (failed) { results.push({ name: mod.name, ok: false, ...failed }); continue; }

    // 链接：一个模块一次（fresh lld —— 它会 latch -mllvm 特性集）
    let lld;
    try {
      lld = await runtime.lld(target);
    } catch (e) {
      results.push({ name: mod.name, ok: false, error: `lld 起不来：${(e && e.message) || e}` });
      continue;
    }
    if (lld.collected) lld.collected.length = 0;
    lld.FS.mkdirTree('/out');
    for (const o of objs) lld.FS.writeFile(o.path, o.bytes);
    const cmd = linkModuleArgv({ target, abi, objs: objs.map((o) => o.path),
                                 linkArgv: abiMod.linkArgv });
    log(`wasm-ld ${cmd.join(' ')}`);
    let rcL;
    try {
      rcL = lld.callMain(cmd);
    } catch (e) {
      results.push({ name: mod.name, ok: false, error: `wasm-ld 抛异常：${(e && e.message) || e}`,
                     detail: (lld.collected || []).slice(-10) });
      continue;
    }
    if (rcL !== 0) {
      results.push({ name: mod.name, ok: false, error: `wasm-ld exited ${rcL}`,
                     detail: (lld.collected || []).slice(-8) });
      continue;
    }
    let so = null;
    try { so = lld.FS.readFile('/out/module.so'); } catch (e) { /* below */ }
    if (!so || !so.length) {
      results.push({ name: mod.name, ok: false, error: 'wasm-ld produced no module' });
      continue;
    }
    log(`[tu] ${mod.name} → ${so.length} B（${objs.length} 对象）`);
    results.push({ name: mod.name, ok: true, moduleBytes: so, objects: objs.length });
  }

  const okOnes = results.filter((r) => r.ok);
  if (!okOnes.length) {
    const first = results[0] || {};
    return { ok: false, stage: 'compile', error: first.error || 'no module built',
             detail: first.detail, modules: results, diagnostics };
  }
  return { ok: true, modules: results, built: okOnes.map((r) => r.name),
           moduleBytes: okOnes[0].moduleBytes, diagnostics };
}

