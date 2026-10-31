#!/usr/bin/env node
// Octave-Full-Wasm — `var` → `let` 的**保守**转换器（工单 72 / GitRoll issue #7）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要它：GitRoll 报了 363 处 `Unexpected var, use let or const instead`。
// 我一开始判"ES5 兼容有意为之"——**用户纠正**：浏览器下限定在 **Chrome 123**，
// 之前的不再支持 ⇒ `let/const` 完全可用，那 363 条是**真债**。
//
// 为什么不能用 `sed s/var/let/g`：三种形状会**改变语义或语法错误**
//   ① `for (var i = 0; ...)` —— `let` 会变成块作用域，循环里创建的闭包捕获行为改变
//      （本仓 `bridge/*.js` 里现在就有 3 处 `for (var …)`）
//   ② 同一行多声明 `var a = 1, b = 2` —— 拆不拆决定语义，简单替换会漏
//   ③ `var` 后面直接是函数表达式/对象字面量时，行内替换容易撞上注释或字符串
//
// 所以本脚本按**行**做，只改"行首（含缩进）就是 `var `、且该行不含 `for (`"的声明，
// 并且把 `var` 换成 `let`（不用 `const`：判"之后有没有重新赋值"需要数据流分析，
// 用 `let` 在行为上与 `var` 等价于块作用域收窄，是**最小风险**的一步）。
// 剩下的（`for (var …)`、同行多声明）**报告出来、不自动改**，交人判断。
//
// 用法：
//   node build/113/var-to-let.mjs <文件...>          # 真改
//   node build/113/var-to-let.mjs --dry-run <文件...> # 只报告
//   node build/113/var-to-let.mjs --selftest
import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// 顶层 `var` 里**确实靠隐式挂全局**的名字（别处以 `self.X` / `window.X` 读它）。
// 加名字必须给证据：`grep -c "self\.<名字>" <文件>` > 0。空口加就是凭印象。
const TOP_LEVEL_GLOBALS = new Set([
  'Module',   // bracket/octave-worker.js:160 —— OctaveP5.show 读 self.Module
]);

// 语法校验：把候选文本交给 V8 编译（不执行）。ESM 用 `module` 不可靠，
// 用 `new Function` 对非 ESM 的脚本类文件足够（本仓 bridge/*.js 都是 UMD/IIFE）。
function syntaxOk(src) {
  try {
    // 包一层避免顶层 return
    new Function(src);
    return true;
  } catch (e) {
    return String(e && e.message || e);
  }
}

/** 保守转换：返回 {out, converted, skipped:[{line, why}]} */
export function convert(src) {
  const lines = src.split('\n');
  const skipped = [];
  let converted = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过注释行、字符串里以 var 开头的（极罕见，但要防）
    const m = line.match(/^(\s*)var\s+(\w+)/);
    if (!m) {
      // 只诊断"这行有 var 但我们没改"，用于报告
      if (/\bvar\b/.test(line)) {
        if (/for\s*\(\s*var/.test(line)) {
          skipped.push({ line: i + 1, why: 'for (var …)：let 会改变循环内闭包的捕获语义' });
        } else if (/^\s*\S.*\bvar\b.*,\s*\w+\s*[=;]/.test(line) && !/^(\s*)var/.test(line)) {
          skipped.push({ line: i + 1, why: '同行多声明：需人工判断是否拆分' });
        } else {
          skipped.push({ line: i + 1, why: '非行首 var（可能是续行/同行多语句）' });
        }
      }
      continue;
    }
    // 只改行首 `var ` 且该行不含 for (
    if (/for\s*\(\s*var/.test(line)) {
      skipped.push({ line: i + 1, why: 'for (var …)：let 会改变循环内闭包的捕获语义' });
      continue;
    }
    // ★ 不许改的第四类：**顶层 `var` 里那些真的靠"隐式挂全局"的**。
    //   `var X = …` 在脚本顶层会创建 `window.X`（worker 里 `self.X`），`let X` 不会 ——
    //   改成 let 会让"别处读 self.X"静默拿到 undefined。
    //   实测伤口（2026-10-31）：`bridge/octave-worker.js` 的
    //   `var Module = core.module;  // 顶层 var ⇒ 顺带挂上 self.Module（OctaveP5.show 读它）`
    //   转 let 后 accept-worker ★H/★I2 两条红（`plots:0`，图形根本没上屏）。
    //
    //   ⚠️ 第一版把**所有零缩进 var** 都拦了 —— 太粗：`octave-worker.js` 顶部 13 个
    //   `var HOME/BASE/booted/clickQ/…` 全是普通模块状态，没人读 `self.它们`
    //   （实测：只有 `Module` 有 `self.Module` 引用，且 2 处）。⇒ 改成**显式白名单**：
    //   只有 KNOWN_GLOBAL 里列出的名字保 var，其余顶层照转。
    const topName = (line.match(/^var\s+([\w$]+)/) || [])[1];
    if (topName && TOP_LEVEL_GLOBALS.has(topName)) {
      skipped.push({ line: i + 1,
        why: `顶层 var「${topName}」靠隐式挂全局（别处读 self/window.${topName}）` });
      continue;
    }
    lines[i] = line.replace(/^(\s*)var\s/, '$1let ');
    converted++;
  }
  return { out: lines.join('\n'), converted, skipped };
}

function selftest() {
  const cases = [];
  let bad = 0;

  // ① 正常：行首 var ⇒ 变 let，其余不动
  {
    const src = '  var a = 1;\n  var b = 2;\n  foo(a, b);\n';
    const r = convert(src);
    cases.push(['缩进的 var ⇒ let，且原文其余不变',
      r.converted === 2 && r.out === '  let a = 1;\n  let b = 2;\n  foo(a, b);\n']);
  }
  // ② 反向：for (var i) 不许改（会改变块作用域/闭包语义）
  {
    const src = 'for (var i = 0; i < 3; i++) { fs.push(function(){ return i; }); }\n';
    const r = convert(src);
    cases.push(['★ 反向：for (var i) 保持 var 且报告原因',
      r.converted === 0 && r.skipped.length === 1 && r.out.includes('for (var i')]);
  }
  // ③ 反向：注释里的 var 不许被当成声明
  {
    const src = '// var old = 1;\n  var real = 2;\n';
    const r = convert(src);
    cases.push(['★ 反向：注释里的 var 不动，真声明改',
      r.converted === 1 && r.out.startsWith('// var old = 1;\n  let real = 2;')]);
  }
  // ③b 反向：顶层 var（零缩进）不许改 —— 它可能靠隐式挂全局
  {
    const src = 'var Module = core.module;\nfoo(Module);\n';
    const r = convert(src);
    cases.push(['★ 反向：顶层 var 保持（隐式挂全局）', r.converted === 0 && r.skipped.length === 1]);
  }
  // ④ 空输入：空文件 ⇒ 零转换零报告，不崩
  {
    const r = convert('');
    cases.push(['★ 空输入：空文件 ⇒ 0 转换 0 报告', r.converted === 0 && r.skipped.length === 0]);
  }
  // ⑤ 转换后必须语法合法
  {
    const src = '  var a=1; function f(){ var b=2; return a+b; } f();\n';
    const r = convert(src);
    cases.push(['转换后语法合法（V8 编译通过）', syntaxOk(r.out) === true]);
  }

  for (const [label, ok] of cases) {
    console.log(`${ok ? 'PASS' : 'fail'} | ${label}`);
    bad += ok ? 0 : 1;
  }
  console.log(`=== var-to-let 自证：${cases.length - bad} PASS / ${bad} FAIL ===`);
  return bad ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const dry = argv.includes('--dry-run');
  const files = argv.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('用法：node build/113/var-to-let.mjs [--dry-run] <文件...>  ／ --selftest');
    return 2;
  }
  let totalConv = 0, totalSkip = 0, failed = 0;
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch (e) {
      console.error(`FATAL: 读不到 ${f}: ${e.message}`);
      return 2;
    }
    const r = convert(src);
    // ★ 转换后必须先过语法校验 —— 语法坏了的文件绝不落盘（fail-closed）
    const chk = syntaxOk(r.out);
    if (chk !== true) {
      console.error(`FATAL: ${f} 转换后语法不合法，拒绝写盘：${chk}`);
      failed++;
      continue;
    }
    totalConv += r.converted;
    totalSkip += r.skipped.length;
    console.log(`${dry ? '[dry] ' : ''}${f}: 改 ${r.converted} 处` +
                (r.skipped.length ? `，跳过 ${r.skipped.length} 处` : ''));
    for (const s of r.skipped) console.log(`    · 行 ${s.line}: ${s.why}`);
    if (!dry && r.converted) writeFileSync(f, r.out, 'utf8');
  }
  console.log(`== 合计：改 ${totalConv} 处，跳过 ${totalSkip} 处，失败 ${failed} 个文件`);
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
