#!/usr/bin/env node
// Octave-Full-Wasm — **多 TU 本地台**（2026-10-18，用户点令「必须升级交互」）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 它解决的问题（实测代价）──────────────────────────────────────────────────
// 多 TU 编排原先只能在浏览器 Worker 里验证：改一行 → 起页面 → 拉 66 MB 工具链 →
// 编 → 回读 ⇒ **单轮 8 分钟**。今天在这条线上花了四小时，绝大部分是等这一个循环，
// 而且拿回来的只是一句 `Aborted()`。
// 但编排与"跑在谁的 wasm 里"无关 —— 同一份 clang.wasm/lld.wasm 在 Node 里也能跑
// （生产者 `driver/toolchain.mjs` 本来就是 Node 驱动）。于是：
//   · 编排 = `bridge/multi-tu.mjs`（深模块，纯逻辑，零 I/O）；
//   · 本文件 = **第二个 adapter**（第一个是浏览器的 compile-worker.mjs）：
//     它把 runtime 注入成"Node 里的 wasm 实例 + 磁盘 sysroot"。
// ⇒ 本地一轮 = **秒级**，且失败时拿到**完整 stderr**（不再是一句 Aborted）。
//
// ── runtime 契约（与 multi-tu.mjs 文件头一致）─────────────────────────────────
//   targetsAvailable() / clang() / lld(target) / log()
//   ⚠️ clang() 每次**新实例**（实测：同实例第二次 callMain ⇒ LLVM ERROR: too many
//      signal callbacks already registered）。字节在磁盘，实例化 ~0.2s。
//
// ── 用法 ────────────────────────────────────────────────────────────────────
//   node test/local/compile-local.mjs <包 src 目录> [--target wasm32|wasm64]
//        [--site <站点目录>] [--out <目录>] [--only <模块名>]
//   node test/local/compile-local.mjs --selftest        # 编排层单测（不碰 wasm）
//
//   默认站点 = /mnt/hdd/octave-wasm-build/site（assets/llvm 在那），
//   默认从站点的 catalog 找包名对应的 tarball；也可直接给 **本地 tar.gz**。
//
// 退出码：0 全部模块编出；1 有失败（逐模块点名 + stderr 尾段）；2 用法/环境。
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { buildModuleTable, compileAllModules, flattenSources, compileUnits } from '../../bridge/multi-tu.mjs';

const REPO = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const DEFAULT_SITE = '/mnt/hdd/octave-wasm-build/site';

function log(t) { console.log(t); }

// ── 工具：从站点 assets/llvm 取三件（clang / lld / sysroot）─────────────────
function llvmPaths(site) {
  const d = join(site, 'assets', 'llvm');
  const p = {
    clangJs: join(d, 'clang.js'),
    clangWasm: join(d, 'clang.wasm'),
    lldJs: join(d, 'lld-wasm-only.js'),
    lldWasm: join(d, 'lld-wasm-only.wasm'),
    sysroot32: join(d, 'sysroot-headers.tar'),
    sysroot64: join(d, 'sysroot-headers.wasm64.tar'),
  };
  const missing = Object.entries(p).filter(([, v]) => !existsSync(v)).map(([k]) => k);
  if (missing.length) {
    throw new Error(`站点缺工具链资产：${missing.join(', ')}（先跑 sh build/113/provision-llvm-wasm.sh fetch）`);
  }
  return p;
}

// ── wasm 实例化：EMSCRIPTEN glue 是 UMD（尾部 `module.exports = createToolChain`）
//    ⇒ Node 里**直接 createRequire 加载**最省事（浏览器 worker 才用 blob import）。
//    ⚠️ 别用 `new Function(text)` 包一层：glue 顶部读
//    `globalThis.document?.currentScript?.src`，且 `var createToolChain=(()=>{…})()`
//    在函数作用域里的求值时机与顶层不同 —— 实测拿到 `factory is not a function`。
function loadGlueFactory(jsPath) {
  const mod = require(jsPath);
  const f = (mod && mod.default) || mod;
  if (typeof f !== 'function') {
    throw new Error(`glue 没导出工厂函数（${jsPath}）：得到 ${typeof f}`);
  }
  return f;
}

async function makeInstance({ jsPath, wasmPath, importObject }) {
  const factory = loadGlueFactory(jsPath);
  const wasmBinary = readFileSync(wasmPath);
  const errs = [];
  const inst = await factory({
    ...(importObject || {}),
    wasmBinary,
    printErr: (s) => { const t = String(s).slice(0, 400); errs.push(t); },
    print: (s) => { /* clang 的 stdout 不是诊断，静音 */ },
    locateFile: (f) => join(dirname(jsPath), f),
    instantiateWasm: (info, receive) => {
      WebAssembly.instantiate(wasmBinary, info).then((r) => receive(r.instance), (e) => { throw e; });
      return {};
    },
    noInitialRun: true,
    thisProgram: 'clang',
  });
  inst.collected = errs;
  return inst;
}

// ── tar 读取：直接用生产者的 driver/tar-reader.mjs（单一产地）────────────────
async function readTarFiles(site, tarPath) {
  const mod = await import(pathToFileURL(join(site, 'assets/llvm/driver/tar-reader.mjs')).href);
  return mod.readTar(new Uint8Array(readFileSync(tarPath)));
}

function installFiles(fs, files) {
  let n = 0;
  for (const [rel, data] of files) {
    const clean = String(rel).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!clean || !data) continue;
    const dst = `/${clean}`;
    const dir = dst.slice(0, dst.lastIndexOf('/'));
    if (dir && dir !== '/') fs.mkdirTree(dir);
    fs.writeFile(dst, data);
    n++;
  }
  return n;
}

// ── runtime：Node 里的 wasm + 磁盘 sysroot ──────────────────────────────────
function makeRuntime({ site, target, cwd }) {
  const p = llvmPaths(site);
  const sysrootTar = target === 'wasm64' ? p.sysroot64 : p.sysroot32;
  let sysrootFiles = null;

  return {
    targetsAvailable() {
      return ['wasm32', 'wasm64'].filter((a) =>
        existsSync(a === 'wasm64' ? p.sysroot64 : p.sysroot32));
    },
    async clang() {
      if (!sysrootFiles) {
        sysrootFiles = await readTarFiles(site, sysrootTar);
        log(`sysroot: ${sysrootFiles.size} 文件（${basename(sysrootTar)}）`);
      }
      const inst = await makeInstance({ jsPath: p.clangJs, wasmPath: p.clangWasm });
      installFiles(inst.FS, sysrootFiles);
      // Octave 头：站点 assets/octinc/octave-headers.tar.gz（gzip）
      const inc = join(site, 'assets', 'octinc', 'octave-headers.tar.gz');
      if (existsSync(inc)) {
        const gunzipped = execFileSync('gzip', ['-dc', inc], { maxBuffer: 1 << 30 });
        const files = await readTarFilesBuffer(site, new Uint8Array(gunzipped));
        let n = 0;
        for (const [rel, data] of files) {
          const clean = rel.replace(/^\.\//, '').replace(/\/+$/, '');
          if (!clean) continue;
          const dst = '/src/octinc/' + clean;
          const d = dst.slice(0, dst.lastIndexOf('/'));
          if (d) inst.FS.mkdirTree(d);
          try { inst.FS.writeFile(dst, data); n++; } catch (e) { /* 目录项 */ }
        }
        inst.octincCount = n;
      }
      return inst;
    },
    async lld(t) {
      // ⚠️ lld 的 FS 是**独立**的：必须也装 sysroot，否则找不到
      //   `/sysroot/lib/<arch>-emscripten/pic/crtbegin-mt.o`（实测：clang 里装了不够）
      if (!sysrootFiles) {
        sysrootFiles = await readTarFiles(site, sysrootTar);
        log(`sysroot: ${sysrootFiles.size} 文件（${basename(sysrootTar)}）`);
      }
      const inst = await makeInstance({ jsPath: p.lldJs, wasmPath: p.lldWasm,
                                        importObject: { thisProgram: 'wasm-ld' } });
      installFiles(inst.FS, sysrootFiles);
      return inst;
    },
    log,
  };
}

async function readTarFilesBuffer(site, u8) {
  const mod = await import(pathToFileURL(join(site, 'assets/llvm/driver/tar-reader.mjs')).href);
  return mod.readTar(u8);
}

// ── 源码来源：本地 tar.gz 或站点的 forge tarball ─────────────────────────────
async function loadSources(tarPath) {
  const gz = readFileSync(tarPath);
  const raw = execFileSync('gzip', ['-dc', tarPath], { maxBuffer: 1 << 30 });
  // 用生产者的 tar reader（单一产地）；这里不依赖站点（先试仓库附近，再试站点）
  const candidates = [
    join(DEFAULT_SITE, 'assets/llvm/driver/tar-reader.mjs'),
    join(REPO, 'site/assets/llvm/driver/tar-reader.mjs'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`找不到 tar-reader.mjs（试过 ${candidates.join(' / ')}）`);
  const mod = await import(pathToFileURL(found).href);
  const files = mod.readTar(new Uint8Array(raw));
  const out = {};
  for (const [rel, data] of files) {
    if (!/\.(cc|cpp|c|h|hpp)$/.test(rel)) continue;
    out[rel] = Buffer.from(data).toString('utf8');
  }
  return out;
}

// ── 自证：编排层（纯逻辑，不碰 wasm）────────────────────────────────────────
function selftest() {
  const cases = [];
  const misc = {
    'pkg-1.3.3/src/cell2cell.cc': 'DEFUN_DLD (cell2cell, args, , "") {}',
    'pkg-1.3.3/src/partint.cc': 'DEFUN_DLD (partcnt, args, , "") {}\nDEFUN_DLD (partint, args, , "") {}',
    'pkg-1.3.3/src/sample.cc': 'DEFUN_DLD (sample, args, , "") {}',
    'pkg-1.3.3/src/helper.cc': '#include "x.h"\nint helper() { return 1; }',
  };
  const mods = buildModuleTable(misc);
  cases.push(['★ 一个源里多个 DEFUN ⇒ 同一个模块（partint.oct 含 partcnt+partint）',
    mods.length === 3 && mods.some((m) => m.name === 'partint.oct' && m.defuns.length === 2)]);
  cases.push(['★ 模块名 = 源 basename（partint.cc ⇒ partint.oct；与容器表/现役站点同口径）',
    mods.some((m) => m.name === 'partint.oct') && !mods.some((m) => m.name === 'partcnt.oct')]);
  cases.push(['辅助源（无 DEFUN）并进第一个模块，且不单独成模块',
    mods[0].sources.some((s) => s.endsWith('helper.cc')) && mods.length === 3]);
  cases.push(['对象路径按模块前缀唯一（跨模块互不覆盖）',
    new Set(compileUnits(mods).map((u) => u.objPath)).size === compileUnits(mods).length]);
  cases.push(['★ basename 冲突 ⇒ 响亮抛错（不许静默覆盖）', (() => {
    try {
      flattenSources({ 'a/x.cc': '1', 'b/x.cc': '2' });
      return false;
    } catch (e) { return /冲突/.test(e.message); }
  })()]);
  cases.push(['★ 没有 DEFUN ⇒ 返回 null（调用方走 v1 单 TU 路径）',
    buildModuleTable({ 'x/y.cc': 'int main(){}' }) === null]);

  let bad = 0;
  for (const [name, ok] of cases) {
    console.log(`${ok ? 'PASS' : 'fail'} | compile-local/${name}`);
    if (!ok) bad++;
  }
  console.log(`\n=== compile-local 自证：${cases.length - bad} PASS / ${bad} fail ===`);
  return bad ? 1 : 0;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const tar = argv[0];
  if (!tar || tar.startsWith('--')) {
    console.error('用法：node test/local/compile-local.mjs <tar.gz> [--target wasm32|wasm64] [--site <目录>] [--out <目录>]');
    return 2;
  }
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const target = opt('--target', 'wasm64');
  const site = opt('--site', DEFAULT_SITE);
  const outDir = opt('--out', '/tmp/compile-local');
  const only = opt('--only', null);

  if (!existsSync(tar)) { console.error(`FATAL: 源 tar 不存在：${tar}`); return 2; }
  log(`源    = ${tar}（${statSync(tar).size} B）`);
  log(`目标  = ${target}   站点 = ${site}`);

  const t0 = Date.now();
  const files = await loadSources(tar);
  log(`源文件 ${Object.keys(files).length} 个（${Date.now() - t0} ms）`);

  const flat = flattenSources(files);
  // ★ 模块表**优先来自数据**（build/pkg-module-table.json = 容器手写表的对账副本）。
  //   扫 DEFUN 只作兜底：实测 `sample.cc` 在 11.3.0 头下编不过，而容器表本来就不列它
  //   —— 靠扫 DEFUN 会报一个"编译失败"，让人以为工具链坏了。
  const tablePath = join(REPO, 'build', 'pkg-module-table.json');
  let modules = null, tablePkg = null;
  if (existsSync(tablePath)) {
    const tbl = JSON.parse(readFileSync(tablePath, 'utf8')).module_table || {};
    // 包名从 tar 名推（<pkg>-<ver>.tar.gz / <pkg>-release-<ver>.tar.gz）
    const bn = basename(tar).replace(/\.tar\.gz$/, '');
    const cand = Object.keys(tbl).find((k) => bn === k || bn.startsWith(k + '-'));
    if (cand) { modules = tbl[cand]; tablePkg = cand; log(`模块表来自数据：${cand}（${modules.length} 个模块）`); }
  }
  if (!modules) { modules = buildModuleTable(flat, log); log('模块表来自 DEFUN 扫描（兜底）'); }
  if (!modules) { console.error('FATAL: 没有 DEFUN_DLD —— 这个包没有可编模块'); return 1; }
  if (only) modules = modules.filter((m) => m.name === only || m.name === only + '.oct');
  if (!modules.length) { console.error(`FATAL: --only ${only} 没有匹配模块`); return 2; }

  const rt = makeRuntime({ site, target });
  // ★ abi 由站点里的生产者 driver 提供（单一产地）；本台只注入，不复制旗标表
  const abiMod = await import(pathToFileURL(join(site, 'assets/llvm/driver/abi.mjs')).href);
  const r = await compileAllModules(rt, {
    abiModule: abiMod,
    target, files, modules,
    define: ['HAVE_CONFIG_H=1'],
    // 两个 include 根（与容器侧同口径）：`-I octinc` 解 <octave/oct.h>，
    // `-I octinc/octave` 解 `#include <randmtzig.h>` 这类**扁平**内部头（sample.cc 实测缺它）
    include: ['/src/octinc', '/src/octinc/octave'], flags: ['-std=c++17'],
    // 每个新 clang 实例都要重灌 config.h + 全部源（FS 是每实例独立的）
    prepare(inst) {
      inst.FS.mkdirTree('/src');
      inst.FS.mkdirTree('/out');
      const cfg = join(site, 'assets', 'llvm', 'config.h.json');
      if (existsSync(cfg)) {
        const macros = JSON.parse(readFileSync(cfg, 'utf8'));
        inst.FS.writeFile('/src/config.h',
          Object.keys(macros).map((k) => `#define ${k} ${macros[k]}`).join('\n'));
      }
      for (const [base, text] of Object.entries(flat)) inst.FS.writeFile('/src/' + base, text);
    },
  });

  mkdirSync(outDir, { recursive: true });
  let bad = 0;
  for (const m of r.modules || []) {
    if (m.ok) {
      const p = join(outDir, m.name);
      writeFileSync(p, m.moduleBytes);
      console.log(`  ✅ ${m.name.padEnd(20)} ${String(m.moduleBytes.length).padStart(8)} B  ${p}`);
    } else {
      bad++;
      console.log(`  ❌ ${m.name.padEnd(20)} ${m.error}`);
      for (const d of (m.detail || []).slice(-6)) console.log(`       ${String(d).slice(0, 220)}`);
    }
  }
  const ms = Date.now() - t0;
  console.log(`\n=== compile-local：${(r.modules || []).length - bad} 模块成功 / ${bad} 失败（${ms} ms）===`);
  if (!(r.modules || []).length) console.log(`顶层错误：${r.error}${r.detail ? ' ｜ ' + r.detail.join(' ') : ''}`);
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main(process.argv.slice(2)).then((rc) => process.exit(rc)).catch((e) => {
    console.error('FATAL:', e && e.stack || e);
    process.exit(1);
  });
}

export { selftest, loadSources, makeRuntime };
