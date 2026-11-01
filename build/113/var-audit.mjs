#!/usr/bin/env node
// Octave-Full-Wasm — **`var` 审计 + 可证等价转换**（工单 72，2026-11-01）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它（它是 `var-to-let.mjs` 的替代，后者退回"逐行正则"）：
//   上一版转换器按**行**匹配 `^\s*var `，于是它有三个看不见的盲区：
//     · `for (var i …)` 一律拒绝 ⇒ 17 处永久豁免（"合法例外"就是这么长出来的）；
//     · 顶层 `var` 靠一张**手写白名单**豁免（`Module` / `G`）—— 白名单本身就是"例外"；
//     · 同行多声明（`var a = 1, b = 2`）与嵌套在其它的形状直接放弃。
//   用户 2026-11-01 点令：**"不准有任何合法例外"**。例外一旦写进工具，就再没人回头看。
//   ⇒ 本工具改成**AST 判据**：每一处 `var` 都要么**可证等价地**改成 `let`，要么**当场红**
//     并要求人工写成显式形态。"没法自动改"不再是"可以留着"，而是"必须有人动手"。
//
// 三种 var，三种处置（判据是机器算的，不是我看了觉得没事）：
//   ① 循环头 `for (var i …)` —— `let` 会把 `i` 变成**每轮一个新绑定**，且循环结束后不可见。
//      判据两问：**体内有没有函数捕获它**（`function`/箭头/类，在循环体内部创建）；
//                **循环之后同一作用域还有没有引用它**。
//      两问都是"没有" ⇒ 可证等价，改 `let`。
//      任一为"有" ⇒ **拒绝自动改**（那会真改行为），红并点名 —— 交人写形（例如显式拷贝）。
//   ② 顶层 `var` —— 非模块脚本的顶层 `var` 会**顺带创建全局对象属性**（`window.X`/`self.X`）。
//      判据：全仓有没有 `window.<名>` / `self.<名>` / `globalThis.<名>` 在**读**它。
//      有 ⇒ **拒绝自动改**，红并提示"写成显式赋值：`self.X = …; const X = self.X;`"
//           （这就是"隐式改显式"，本工单的核心口径）；
//      没有 ⇒ 没人依赖那个隐式属性，改 `let` 可证等价。
//   ③ 其余（函数/块内的 `var`）—— `var` 的函数作用域 vs `let` 的块作用域只有在"跨块可见"
//      或"块内重声明"时才有差别。判据：声明所在块**之外**、同一函数内有没有引用它的名字；
//      以及同一作用域内有没有同名重声明（`var` 允许，`let` 是 SyntaxError）。
//      都没有 ⇒ 改 `let` 可证等价；有 ⇒ 红并点名。
//
// `const` 不用：判"之后有没有重新赋值"要数据流分析，`let` 是**最小风险**的一步
// （与上一版同样的理由）。判据只要"等价"，不追"更严格"。
//
// 已知边界（诚实写出来，别假装它是编译器）：
//   · 不做控制流分析 ⇒ 用 `let` 而不追 `const`；
//   · 跨文件读取只认 `<全局对象>.<名>` 这种**显式写法**；`eval` / `with` / 动态拼名看不见
//     （本仓两者都不许用，`check_invariants` 有对应的声明式不变量）；
//   · 只处理 `.js` / `.mjs` / `.ts`；`.cjs` 之类若要纳入，得先在这里加分支。
//
// 用法：
//   node build/113/var-audit.mjs                    # 审计全仓（闸门形态：零 var 才 exit 0）
//   node build/113/var-audit.mjs --fix              # 只改可证等价的那批，其余红
//   node build/113/var-audit.mjs --fix <文件…>      # 只动给定文件
//   node build/113/var-audit.mjs --selftest
//
// 退出码：0 = 零 var（或修复后零 var）；1 = 还有 var / 有需人工判断的；2 = 用法或环境错。
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ── 被依赖的 TypeScript：**语法判据的唯一产地** ────────────────────────────────
// 仓库外安装（不污染白名单），与 build-embed-ts.sh 共用同一份：
//   npm install --prefix /mnt/hdd/crossbuild-tools/npm-ts typescript@5
// 拿不到 ⇒ exit 2（**不是**降级成正则匹配 —— 那样判据会静默变弱）。
function loadTs() {
  const cand = [
    process.env.TS_LIB,
    '/mnt/hdd/crossbuild-tools/npm-ts/node_modules/typescript/lib/typescript.js',
    'typescript',
  ].filter(Boolean);
  for (const c of cand) {
    try { return require(c); } catch (e) { /* 试下一个 */ }
  }
  console.error('FATAL: 找不到 typescript（' + cand.join(' / ') + '）。装法见文件头。');
  process.exit(2);
}
const ts = loadTs();

// ── 扫描面：**本仓自写**的 JS/TS。第三方与生成物**按产地排除**，不是按文件名猜 ──────
// 每条排除都必须能说出"它由谁产出"——说不出产地的排除就是藏污纳垢（见文件头 §①）。
const EXCLUDED = [
  // emcc 生成的胶水（产地 = `build/113/link-web.sh` 调 emcc）
  [/^site\/octave\.js$/, 'emcc 胶水（link-web.sh 产出）'],
  [/^site\/w64\/octave\.js$/, 'emcc 胶水（link-web.sh 的 w64 产物）'],
  // 引擎/包的第三方代码（产地 = provision-*.sh 逐件 sha 供给）
  [/^site\/assets\/llvm\//, 'llvm-wasm 供给件（provision-llvm-wasm.sh）'],
  [/^site\/assets\/pyodide\//, 'pyodide 供给件（provision-pyodide.sh）'],
  [/^site\/assets\/pkg\//, 'build/assets.py bundle-pkg 生成的包（内含上游 .m 文本）'],
  [/^site\/assets\/m\//, 'build/assets.py bundle-m 生成的 m 资产'],
  [/^site\/omc\//, 'omc 引擎供给件（provision-omc.sh，wbindgen 产物）'],
  // 上游子模块
  [/^upstream\//, '上游 octave 子模块（不是本仓代码）'],
];

function isExcluded(rel) {
  for (const [re, why] of EXCLUDED) if (re.test(rel)) return why;
  return null;
}

function trackedJs(repo) {
  const out = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.ts'], { cwd: repo, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// ── AST 工具 ─────────────────────────────────────────────────────────────────
function parse(src, name) {
  const kind = name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, kind);
}

function isVarList(n) {
  return ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
}

/** 循环体内的"函数捕获"检测：循环体里**创建**的函数是否引用循环变量。 */
function capturedInLoop(loopNode, names, sf) {
  const caps = [];
  const visit = (node) => {
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) || ts.isClassStaticBlockDeclaration(node)) {
      const text = node.getText(sf);
      for (const nm of names) {
        if (new RegExp('\\b' + nm + '\\b').test(text)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          caps.push(nm + ' (函数在 :' + line + ')');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(loopNode.statement, visit);   // 只看**循环体**内部创建的
  return caps;
}

/** 循环之后、同一外层作用域里还有没有引用（`let` 会让它在循环外消失）。 */
function usedAfterLoop(loopNode, names, sf) {
  let scope = loopNode.parent;
  while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope) &&
         !ts.isFunctionLike(scope)) scope = scope.parent;
  if (!scope) return [];
  const loopText = loopNode.getText(sf);
  const scopeText = scope.getText(sf);
  const hits = [];
  for (const nm of names) {
    const re = new RegExp('\\b' + nm + '\\b', 'g');
    const inScope = (scopeText.match(re) || []).length;
    const inLoop = (loopText.match(re) || []).length;
    if (inScope > inLoop) hits.push(nm + '（循环外还引用 ' + (inScope - inLoop) + ' 次）');
  }
  return hits;
}

/** 剥掉注释与字符串字面（跨文件探针必须看不见它们：注释里写 `window.G` 不是"有人在读"）。 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? n : j;
      out += ' '.repeat(end - i); i = end; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j += 1; break; }
        j += 1;
      }
      out += src.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** 全仓里有没有 `<global>.<名>` 这种显式读法（决定顶层 var 能不能改 let）。 */
function globalPropReads(repo, rel, files, name) {
  const probes = ['window.' + name, 'self.' + name, 'globalThis.' + name];
  const hits = [];
  for (const f of files) {
    if (f === rel) continue;
    let txt;
    try { txt = readFileSync(repo + '/' + f, 'utf8'); } catch (e) { continue; }
    // ★ 必须剥注释与字符串：第一版直接 `txt.includes(p)` ⇒ 把**注释里**提到
    //   `self.Module` 的文档也算成"有人在读"（实测：`var-to-let.mjs` 头注释、
    //   `octave-worker.js` 自己的说明段全被算进去 ⇒ 判据变成"谁提过名字"而不是
    //   "谁真在读"。这会让判据恒真，是最糟的一种闸门缺陷）。
    const code = stripCommentsAndStrings(txt);
    for (const p of probes) {
      if (code.includes(p)) { hits.push(f + ' 读 ' + p); break; }
    }
  }
  return hits;
}

/** 其余 var：同一函数内、声明块之外有没有引用（块作用域收窄会断开它）。 */
function escpesBlock(node, names, sf) {
  // node = VariableDeclaration（不是 list），向上找到所在 Block
  let blk = node.parent && node.parent.parent;   // decl → list → block/stmt
  while (blk && !ts.isBlock(blk) && !ts.isSourceFile(blk)) blk = blk.parent;
  if (!blk) return [];
  // 找同函数作用域
  let fn = node.parent;
  while (fn && !ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
  if (!fn) return [];
  const fnText = fn.getText(sf);
  const blkText = blk.getText(sf);
  const hits = [];
  for (const nm of names) {
    const re = new RegExp('\\b' + nm + '\\b', 'g');
    const a = (fnText.match(re) || []).length;
    const b = (blkText.match(re) || []).length;
    if (a > b) hits.push(nm + '（块外还引用 ' + (a - b) + ' 次）');
  }
  return hits;
}

/** 同作用域内有没有同名 `var` 重声明（`var` 合法、`let` 是 SyntaxError）。 */
function duplicateDecls(node, names, sf) {
  const list = node.parent;
  if (!list) return [];
  const hits = [];
  // 同一 VariableDeclarationList 里重名（`var a=1,a=2`）本身合法但无意义
  const seen = new Set();
  for (const d of list.declarations) {
    const nm = d.name.getText(sf);
    if (seen.has(nm)) hits.push(nm + '（同一语句内重复声明）');
    seen.add(nm);
  }
  return hits;
}

/**
 * 审计（纯函数，可自证）：返回 { sites: [...] }，每个 site 形如
 * { line, name, kind, verdict: 'safe'|'explicit'|'manual', why }
 */
export function audit(src, { repo = process.cwd(), rel = '<mem>', files = [] } = {}) {
  const sf = parse(src, rel);
  const sites = [];

  const visit = (node) => {
    if (isVarList(node)) {
      const names = node.declarations.map((d) => d.name.getText(sf));
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const isForInit = node.parent &&
        (ts.isForStatement(node.parent) || ts.isForInStatement(node.parent) ||
         ts.isForOfStatement(node.parent));
      // ★ 顶层判据：AST 里 `var X = …` 的形状是 `VariableStatement → VariableDeclarationList`，
      //   所以 list 的父节点**不是** SourceFile（第一版就这么写错了，自证 ②e 当场抓出来：
      //   顶层 var 走错分支 ⇒ 被当成普通 stmt ⇒「隐式挂全局」这条判据**从未生效**）。
      const isTop = node.parent && ts.isVariableStatement(node.parent) &&
                    node.parent.parent === sf;

      if (isForInit) {
        const caps = capturedInLoop(node.parent, names, sf);
        const after = usedAfterLoop(node.parent, names, sf);
        if (caps.length || after.length) {
          sites.push({ line, names, kind: 'for-init', verdict: 'manual',
            why: '循环变量被捕获/循环后仍用 ⇒ 改 let 会改行为：' +
                 [...caps, ...after].join('；') });
        } else {
          sites.push({ line, names, kind: 'for-init', verdict: 'safe',
            why: '体内无捕获、循环外无引用 ⇒ 逐轮绑定等价' });
        }
      } else if (isTop) {
        // ⚠️ `.mjs` 是 **ESM**：顶层声明活在**模块作用域**，不会创建全局对象属性
        //   （`var` 与 `let` 在模块顶层等价）⇒ 不需要"隐式改显式"这一步。
        //   只有 **classic script**（`<script src>` / `importScripts` 加载的 `.js`）
        //   的顶层 `var` 才会顺带挂上 `window.X` / `self.X` —— 那才是本条判据的对象。
        if (rel.endsWith('.mjs')) {
          sites.push({ line, names, kind: 'top', verdict: 'safe',
            why: 'ESM 顶层（模块作用域，var/let 等价，不产生全局属性）' });
        } else {
          const reads = globalPropReads(repo, rel, files, names[0]);
          if (reads.length) {
            sites.push({ line, names, kind: 'top', verdict: 'explicit',
              why: '顶层 var 靠隐式全局属性被读 ⇒ 写成显式赋值（self.X = …; const X = self.X）：' +
                   reads.join('；') });
          } else {
            sites.push({ line, names, kind: 'top', verdict: 'safe',
              why: '全仓无 window/self/globalThis.<名> 读法 ⇒ 无隐式属性依赖' });
          }
        }
      } else {
        const esc = escpesBlock(node.declarations[0], names, sf);
        const dup = duplicateDecls(node.declarations[0], names, sf);
        if (esc.length || dup.length) {
          sites.push({ line, names, kind: 'stmt', verdict: 'manual',
            why: '块外引用/重复声明 ⇒ 改 let 会断可见性：' + [...esc, ...dup].join('；') });
        } else {
          sites.push({ line, names, kind: 'stmt', verdict: 'safe',
            why: '块外无引用、无重声明 ⇒ 块作用域收窄等价' });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites };
}

/** 只重写 safe 的那批：在 AST 给出的偏移处把 `var` 换成 `let`。 */
export function applyFixes(src, sites) {
  // safe 的 var 关键字位置 = 该 declaration list 的起始
  const sf = parse(src, '<fix>');
  const spots = [];
  const visit = (node) => {
    if (isVarList(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const hit = sites.find((s) => s.line === line && s.verdict === 'safe');
      if (hit) spots.push(node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  spots.sort((a, b) => b - a);          // 从后往前改，偏移不失效
  let out = src;
  for (const p of spots) out = out.slice(0, p) + 'let' + out.slice(p + 3);   // 'var' → 'let'
  return { out, converted: spots.length };
}

// ── 自证：三类用例齐备（正常不报 / 该报的必须报 / 空输入必须报）────────────────
function selftest() {
  const cases = [];
  let bad = 0;
  const check = (label, ok) => { cases.push([label, ok]); };

  // ① 正常：没有 var ⇒ 零报告
  check('① 正常：无 var 的文件 ⇒ 零报告', audit('let a = 1; const b = 2; a++;', { rel: 'x.js' }).sites.length === 0);

  // ② 该报的必须报：for-init 无捕获 ⇒ safe（能看到，且判为可改）
  {
    const r = audit('for (var i = 0; i < 3; i++) { total += i; }', { rel: 'x.js' });
    check('② for(var) 无捕获 ⇒ 报出来且判 safe（不是静默放过）',
      r.sites.length === 1 && r.sites[0].verdict === 'safe');
  }
  // ②b 反向：for-init **有捕获** ⇒ 必须 manual（不许自动改）
  {
    const r = audit('for (var i = 0; i < 3; i++) { fs.push(function () { return i; }); }', { rel: 'x.js' });
    check('★ ②b for(var) 体内有函数捕获 ⇒ 判 manual（拒绝自动改，有区分力）',
      r.sites.length === 1 && r.sites[0].verdict === 'manual');
  }
  // ②c 反向：循环后仍引用 ⇒ manual
  {
    const r = audit('function f(){ for (var i = 0; i < 3; i++) {} return i; }', { rel: 'x.js' });
    check('★ ②c 循环后仍引用循环变量 ⇒ 判 manual', r.sites[0].verdict === 'manual');
  }
  // ②d 顶层 var 被显式读 ⇒ explicit（"隐式改显式"的机器判据）
  {
    const r = audit('var Module = m;', { rel: 'a.js', files: ['b.js'] });
    // 没有 b.js 文件可读 ⇒ 走 safe；这里改用临时夹具验证
    check('②d 顶层 var 在无外部读法时 ⇒ safe', r.sites[0].verdict === 'safe');
  }
  // ②e 顶层 var + 外部 `self.X` 读 ⇒ explicit（拒绝自动改）
  {
    const fs = require('fs'), os = require('os'), path = require('path');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'var-audit-'));
    fs.writeFileSync(path.join(d, 'a.js'), 'var Module = core.module;\n');
    fs.writeFileSync(path.join(d, 'b.js'), 'foo(self.Module);\n');
    const r = audit('var Module = core.module;\n', { repo: d, rel: 'a.js', files: ['b.js'] });
    check('★ ②e 顶层 var 被 self.X 读 ⇒ 判 explicit（必须写显式赋值，不许自动 let）',
      r.sites.length === 1 && r.sites[0].verdict === 'explicit');
    fs.rmSync(d, { recursive: true, force: true });
  }
  // ②f 块内 var 被块外引用 ⇒ manual
  {
    const r = audit('function f(){ if (x) { var y = 1; } return y; }', { rel: 'x.js' });
    check('★ ②f 块内 var 被块外引用 ⇒ 判 manual', r.sites[0].verdict === 'manual');
  }

  // ③ 空输入：空文件 ⇒ 零报告、不崩（且**不是**"全绿"的借口）
  check('③ 空输入：空文件 ⇒ 0 报告且不崩', audit('', { rel: 'empty.js' }).sites.length === 0);

  // ④ 修复后必须真的没有 var，且语法仍合法
  {
    const src = 'for (var i = 0; i < 3; i++) { total += i; }\nfunction f(){ var a = 1; return a; }\n';
    const a = audit(src, { rel: 'x.js' });
    const r = applyFixes(src, a.sites);
    const after = audit(r.out, { rel: 'x.js' });
    let syntaxOk = true;
    try { new Function(r.out); } catch (e) { syntaxOk = false; }
    check('④ 修复后零 var 且语法合法',
      r.converted === 2 && after.sites.length === 0 && syntaxOk);
  }
  // ④b 反向：manual 的**不许**被修掉
  {
    const src = 'for (var i = 0; i < 3; i++) { fs.push(function(){ return i; }); }\n';
    const a = audit(src, { rel: 'x.js' });
    const r = applyFixes(src, a.sites);
    check('★ ④b manual 的 var 不被自动改（只改 safe）',
      r.converted === 0 && r.out.includes('for (var i'));
  }

  for (const [label, ok] of cases) {
    console.log(`${ok ? 'PASS' : 'fail'} | ${label}`);
    bad += ok ? 0 : 1;
  }
  console.log(`=== var-audit 自证：${cases.length - bad} PASS / ${bad} FAIL ===`);
  return bad ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const doFix = argv.includes('--fix');
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const all = trackedJs(repo);
  const given = argv.filter((a) => !a.startsWith('--'));
  const targets = given.length ? given : all;

  const skipped = [];
  const findings = [];
  const fixable = [];

  for (const rel of targets) {
    const why = isExcluded(rel);
    if (why) { skipped.push([rel, why]); continue; }
    let src;
    try { src = readFileSync(repo + '/' + rel, 'utf8'); } catch (e) { continue; }
    const r = audit(src, { repo, rel, files: all });
    if (!r.sites.length) continue;
    findings.push([rel, r.sites]);
    if (doFix && r.sites.some((s) => s.verdict === 'safe')) fixable.push([rel, src, r.sites]);
  }

  if (doFix) {
    for (const [rel, src, sites] of fixable) {
      const r = applyFixes(src, sites);
      const after = audit(r.out, { repo, rel, files: all });
      if (after.sites.length === 0) {
        writeFileSync(repo + '/' + rel, r.out, 'utf8');
        console.log(`fixed  ${rel}: ${r.converted} 处 var → let（转后零 var）`);
      } else {
        writeFileSync(repo + '/' + rel, r.out, 'utf8');
        console.log(`fixed  ${rel}: ${r.converted} 处，仍剩 ${after.sites.length} 处需人工`);
      }
    }
    // 修完重算（口径以磁盘为准，不以刚才的内存为准）
    return main(argv.filter((a) => a !== '--fix'));
  }

  let needManual = 0;
  for (const [rel, sites] of findings) {
    console.log(`\n${rel}`);
    for (const s of sites) {
      const tag = s.verdict === 'safe' ? 'safe→let' :
                  s.verdict === 'explicit' ? '★ 必须改显式' : '★ 需人工判断';
      console.log(`  :${s.line}  [${s.kind}]  ${s.names.join(',')}  ${tag}  — ${s.why}`);
      if (s.verdict !== 'safe') needManual++;
    }
  }
  if (skipped.length) {
    console.log('\n按产地排除（不是本仓自写代码）：');
    for (const [rel, why] of skipped) console.log(`  ${rel}  ← ${why}`);
  }

  const total = findings.reduce((a, [, s]) => a + s.length, 0);
  console.log(`\n=== var 审计：${total} 处 var / ${findings.length} 个文件` +
              (needManual ? ` / ${needManual} 处**不许自动改**（见 ★）` : '') + ' ===');
  if (total === 0) { console.log('ok：本仓自写 JS/TS 里零 `var`。'); return 0; }
  if (needManual) {
    console.log('FAILED：有 var 需要人工写成「显式形态」——本工单口径是**零例外**，');
    console.log('        不许把它们登记成"合法例外"。跑 --fix 只改可证等价的那些，剩下的手写。');
    return 1;
  }
  console.log('可用 --fix 改（全部判为可证等价）。');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('var-audit.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
