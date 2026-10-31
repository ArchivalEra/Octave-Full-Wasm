#!/usr/bin/env node
// Octave-Full-Wasm — coi-serviceworker fork 的**同源校验**自证（工单 72 / GitRoll issue #7）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// 验什么：`build/embed/coi-serviceworker.js` 里那个 `_sameOrigin(ev)` 守卫。
//
// 为什么要有它：上游 v0.1.7 的 `message` handler **不校验来源**，GitRoll 标成
// VULNERABILITY（CWE/HTML5 "Verify the origin of the received message"）。危害不是读机密，
// 是**让本该隔离的站点不再隔离**：
//   · `deregister` —— 任意同 SW 作用域下的页面能把正在工作的 SW 注销掉（服务拒绝）
//   · `coepCredentialless` —— 把 COEP 从 `require-corp` 翻成 `credentialless`，
//     隔离强度下降。而本仓"纯客户端计算"的底座正是这个隔离。
//
// 判据（三类齐备）：
//   ① 同源消息 ⇒ 接受
//   ② 非同源消息 ⇒ **拒**（反向）
//   ③ 拿不到 source 且 origin 是 opaque（"null"）⇒ 拒（不许因为信息不足就放行）
//
// 用法：
//   node build/113/coi-sw-origin-selftest.mjs
//   node build/113/coi-sw-origin-selftest.mjs --selftest   （同上；保持统一入口形状）
//
// 实现方式：从源文件里**抽出 `_sameOrigin` 的定义**（正则取函数体），在 node 里用假 self
// 求值 —— 不启动浏览器、不起 SW。这样判据既快又确定，且**测的是真源码里的那个函数**
// （不是另写一份拷贝，那种"测了个替代品"是本仓反复踩的坑）。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'embed', 'coi-serviceworker.js');

/** 从源码抽出 `_sameOrigin` 函数体，返回可调用函数（注入假 self）。 */
export function loadGuard(srcText, origin) {
  const m = srcText.match(/const _sameOrigin = \(ev\) => \{[\s\S]*?\n    \};/);
  if (!m) throw new Error('源码里找不到 _sameOrigin 守卫（改结构了？本自证要跟着改）');
  // 去掉行首缩进，拼成可求值的表达式
  const body = m[0].replace(/^\s*const _sameOrigin = /m, '').replace(/;\s*$/, '');
  const fakeSelf = { location: { origin } };
  // eslint-disable-next-line no-new-func
  return new Function('self', `return ${body};`)(fakeSelf);
}

function main() {
  const src = readFileSync(SRC, 'utf8');
  const ORIGIN = 'https://octave.example';
  const guard = loadGuard(src, ORIGIN);

  const cases = [];
  const add = (label, ok) => cases.push([label, ok]);

  // ① 正常：同源 source（同 origin 的 WindowClient）⇒ 接受
  add('同源 WindowClient 的消息 ⇒ 接受',
      guard({ origin: ORIGIN, source: { url: ORIGIN + '/index.html' } }) === true);

  // ①b 同源但无 source（只剩 origin 可比）⇒ 仍接受
  add('同源、无 source 但 origin 对 ⇒ 接受', guard({ origin: ORIGIN }) === true);

  // ② 反向：非同源 source ⇒ **必须拒**
  add('★ 反向：非同源 WindowClient ⇒ 拒',
      guard({ origin: 'https://evil.example', source: { url: 'https://evil.example/x' } }) === false);

  // ②b 反向：source 的 URL 跨源（哪怕 ev.origin 被伪造成同源）⇒ 拒
  add('★ 反向：source.url 跨源 ⇒ 拒（不信 ev.origin 的自述）',
      guard({ origin: ORIGIN, source: { url: 'https://evil.example/x' } }) === false);

  // ③ 空输入：opaque origin（"null"）⇒ 拒（信息不足不许放行）
  add('★ 空输入：opaque origin("null") ⇒ 拒（不因信息不足而放行）',
      guard({ origin: 'null', source: null }) === false);

  // ③b 空输入：什么都没有 ⇒ 拒
  add('★ 空输入：无 origin 无 source ⇒ 拒', guard({}) === false);

  // ④ source.url 是坏 URL ⇒ 拒（不因为抛异常就放行）
  add('★ 反向：source.url 非法 ⇒ 拒（catch 里返回 false）',
      guard({ origin: ORIGIN, source: { url: 'not a url' } }) === false);

  let bad = 0;
  for (const [label, ok] of cases) {
    console.log(`${ok ? 'PASS' : 'fail'} | ${label}`);
    bad += ok ? 0 : 1;
  }
  console.log(`=== coi-sw-origin 自证：${cases.length - bad} PASS / ${bad} FAIL ===`);
  return bad ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
