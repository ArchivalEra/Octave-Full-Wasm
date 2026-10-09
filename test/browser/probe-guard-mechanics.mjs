// 探针：守卫机制力学（覆盖 stub 后是否免 clear 生效 / eval_string 能否包装）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 决定两件事：
//   M1 覆写 `/figure.m`（0 输出 stub → 真实现内容）后，**不 clear** 的直接调用是否生效
//      （E2 已示 gca 会跑新内容；这里对 figure 的全链重验：title/gcf/gca）
//   M2 `Module.eval_string` 覆写是否可行（包装一层计数，调用仍返回正确 rc）
//   M3 被覆盖的是**核心路径**时同样成立（对 R2 的补充）
//
// 用法：sh test/browser/run.sh test/browser/probe-guard-mechanics.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(1200);

async function run (code, timeoutMs = 20000) {
  const s = '__M' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try {
    await page.evaluate(([x, sn]) => window.Module.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 160) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}
const head = (o, n = 220) => (o || '').slice(0, n);
console.log(`URL=${URL}`);

// ── 快照核心 figure.m（真实现），供恢复用 ────────────────────
const snapshot = await page.evaluate(() => {
  return window.Module.FS.readFile('/usr/src/octave/m/plot/util/figure.m', { encoding: 'utf8' });
});
console.log('snapshot 长度:', snapshot.length, 'B；含 0 输出签名?', /function\s+figure\s*\(/.test(snapshot.split('\n').find(l => l.startsWith('function')) || ''));

// ── M1：写 stub → 验证崩 → 直接覆写真实现（不 clear）→ 验证活 ──
console.log('\n── M1：/figure.m stub → 崩 → 覆写真实现（无 clear）──');
await page.evaluate((s) => {
  window.Module.FS.writeFile('/figure.m', s);
}, '% Safe Figure Stub\nfunction figure (varargin)\n  % No-op safe stub preventing GL4ES window init\nendfunction\n');

let r = await run('which("figure")');
console.log('  which(figure) [stub 存在]:', head(r.out, 120));
r = await run('try; h=gcf(); printf("GCF-OK %g\\n", h); catch e; printf("GCF-ERR: %s\\n", e.message); end');
console.log('  gcf() [stub]:', head(r.out));
r = await run('try; title("t"); printf("T-OK\\n"); catch e; printf("T-ERR: %s\\n", e.message); end');
console.log('  title [stub]:', head(r.out));

// 覆写同一路径（内容 = 核心实现），不 clear
await page.evaluate((s) => { window.Module.FS.writeFile('/figure.m', s); }, snapshot);
r = await run('which("figure")');
console.log('  which(figure) [已覆写]:', head(r.out, 120));
r = await run('try; h=gcf(); printf("GCF-OK %g type=%s\\n", h, get(h,"type")); catch e; printf("GCF-ERR: %s\\n", e.message); end');
console.log('  gcf() [覆写后，无 clear]:', head(r.out));
r = await run('try; title("t"); printf("T-OK %s\\n", get(get(gca(),"title"),"string")); catch e; printf("T-ERR: %s\\n", e.message); end');
console.log('  title [覆写后]:', head(r.out));

// ── M2：核心路径 stub → 覆写恢复（R2 的补验，无 clear）────────
console.log('\n── M2：核心路径 stub → 覆写恢复（无 clear）──');
await page.evaluate(() => {
  window.Module.FS.writeFile('/usr/src/octave/m/plot/util/figure.m',
    '% Safe Figure Stub\nfunction figure (varargin)\n  % No-op safe stub preventing GL4ES window init\nendfunction\n');
});
r = await run('try; gcf(); printf("GCF-OK\\n"); catch e; printf("GCF-ERR: %s\\n", e.message); end');
console.log('  gcf() [核心路径被 stub]:', head(r.out));
await page.evaluate((s) => { window.Module.FS.writeFile('/usr/src/octave/m/plot/util/figure.m', s); }, snapshot);
r = await run('try; h=gcf(); printf("GCF-OK %g\\n", h); catch e; printf("GCF-ERR: %s\\n", e.message); end');
console.log('  gcf() [核心路径恢复后，无 clear]:', head(r.out));

// ── M3：eval_string 包装可行性 ─────────────────────────────
console.log('\n── M3：eval_string 包装 ──');
const wrapRes = await page.evaluate(() => {
  try {
    const orig = window.Module.eval_string;
    if (typeof orig !== 'function') return 'eval_string 不是函数: ' + typeof orig;
    let calls = 0;
    window.Module.eval_string = function () {
      calls++;
      return orig.apply(this, arguments);
    };
    window.__wrapCalls = () => calls;
    // 立即经包装调用
    const rc = window.Module.eval_string('x_wrap_probe = 41;');
    return { wrapped: true, rc1: rc, calls: calls };
  } catch (e) { return 'ERR ' + String(e).slice(0, 200); }
});
console.log('  wrap:', JSON.stringify(wrapRes));
r = await run('printf("x=%d calls=%d\\n", x_wrap_probe+1, 0)');
console.log('  包装后求值:', head(r.out, 140));

// 属性还是自有属性？（决定 embed/host 是否都能见到包装）
const prop = await page.evaluate(() => {
  const d = Object.getOwnPropertyDescriptor(window.Module, 'eval_string');
  return { has: !!d, writable: d && d.writable, isAccessor: !!(d && (d.get || d.set)), t: typeof window.Module.eval_string };
});
console.log('  eval_string 属性:', JSON.stringify(prop));

// ── M4：reverse —— 未被污染的路径上，守卫应"什么都不做"（文件 bytes 相同）──
const clean = await page.evaluate(() => {
  const p = '/usr/src/octave/m/plot/util/figure.m';
  const before = window.Module.FS.readFile(p, { encoding: 'utf8' });
  return { len: before.length, sig: /function\s+figure\s*\(/.test(before.split('\n').filter(l => l.startsWith('function'))[0] || '') };
});
console.log('\n── M4：当前核心 figure.m 干净？（0 输出签名应为 false）──');
console.log('  ', JSON.stringify(clean));

console.log('\n=== 探针结束 ===');
await browser.close();
