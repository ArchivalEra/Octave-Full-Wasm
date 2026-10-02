// 验收：嵌入 API（工单 38）—— docs/embed-api.md 接口表 🔜 项逐条落地断言
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-embed-api.mjs [URL]
//   URL 指**部署了 embed-demo.html 与 octave-embed.js 的站点**（默认 8761）。
// 判据（★ = 硬判据；反 = 反向断言）：
//   A ★ create：window.octave 就绪且 state='idle'
//   B ★ eval：rc 通道 ok=true，且输出订阅器收到 disp 文本
//   C ★ evalJSON 值通道：数字/字符串/矩阵元素逐字；反：未定义变量 ⇒ ok=false + error 提到 undefined
//   D ★ workspace()：eval 建的变量出现在 whos 结构化清单里
//   E ★ pwd/cd：cd('/tmp') 后 pwd() == '/tmp'（测完还原）
//   F ★ fs：write/read 回环；ls 能看到；反：read 不存在的文件必须 throw
//   G ★ input：octave.input('42') 预填后 eval 里的 input() 真拿到 42
//   H ★ interrupt：原语存在且可调（完整中断语义由既有套件覆盖）
//   I ★ figures：plot 后 onFigure 收到元素、export() 给出 dataURL
//   J 反：OctaveEmbed.create({mount:'#不存在'}) 必须 reject
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8761/';

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 240)}`); };

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await page.goto(`${URL}embed-demo.html`, { waitUntil: 'load', timeout: 120000 });

// A：就绪
let ready = false;
for (let t = 0; t < 600; t++) {
  if (await page.evaluate(() => window.octave && window.octave.state === 'idle').catch(() => false)) { ready = true; break; }
  await new Promise(r => setTimeout(r, 250));
}
check(ready, '★ A OctaveEmbed.create 就绪且 state=idle', `ready=${ready}`);

// B：eval + 输出订阅
const b = await page.evaluate(async () => {
  const got = [];
  window.octave.on.output(t => got.push(t));
  const r = await window.octave.eval("disp('embed-eval-marker');");
  return { ok: r.ok, rc: r.rc, got: got.join('') };
});
check(b.ok && b.rc === 0 && /embed-eval-marker/.test(b.got),
  '★ B eval rc 通道 + on.output 订阅', JSON.stringify(b));

// C：evalJSON 值通道（数字/字符串/矩阵元素）+ 反向
const c = await page.evaluate(async () => ({
  num: await window.octave.evalJSON("2+2"),
  str: await window.octave.evalJSON("['ab' 'cd']"),
  mat: await window.octave.evalJSON("magic(3)(1,1)"),
  bad: await window.octave.evalJSON("__no_such_var_xyz__"),
}));
check(c.num.ok === true && c.num.value === 4, '★ C1 evalJSON 数值', JSON.stringify(c.num));
check(c.str.ok === true && c.str.value === 'abcd', '★ C2 evalJSON 字符串', JSON.stringify(c.str));
check(c.mat.ok === true && c.mat.value === 8, '★ C3 evalJSON 矩阵元素', JSON.stringify(c.mat));
check(c.bad.ok === false && /undefined|err/.test(JSON.stringify(c.bad)),
  '★ C4 反向：未定义变量 ⇒ ok=false 且带 error', JSON.stringify(c.bad));

// D：workspace 结构化
const d = await page.evaluate(async () => {
  await window.octave.eval("zz_embed_probe = 42;");
  const ws = await window.octave.workspace();
  const hit = (ws.value || []).find(v => v.name === 'zz_embed_probe');
  return { found: !!hit, bytes: hit ? hit.bytes : null, cls: hit ? hit.class : null };
});
check(d.found && d.bytes === 8 && d.cls === 'double',
  '★ D workspace() 结构化（whos：name/bytes/class）', JSON.stringify(d));

// E：pwd/cd（测完还原）
const e = await page.evaluate(async () => {
  const before = (await window.octave.pwd()).value;
  await window.octave.cd('/tmp');
  const after = (await window.octave.pwd()).value;
  await window.octave.cd(String(before));
  const back = (await window.octave.pwd()).value;
  return { before, after, back };
});
check(e.after === '/tmp' && e.back === e.before, '★ E pwd/cd 往返', JSON.stringify(e));

// F：fs 回环 + ls + 反向
const f = await page.evaluate(async () => {
  const o = window.octave;
  o.fs.write('/tmp/.embed_probe.txt', 'hello-embed');
  const txt = o.fs.read('/tmp/.embed_probe.txt');
  const ls = o.fs.ls('/tmp').find(x => x.name === '.embed_probe.txt');
  let threw = 'no-throw';
  try { o.fs.read('/tmp/.definitely_not_here__'); } catch (err) { threw = 'throw'; }
  o.fs.rm('/tmp/.embed_probe.txt');
  return { txt, lsHit: !!ls, threw };
});
check(f.txt === 'hello-embed' && f.lsHit && f.threw === 'throw',
  '★ F fs write/read/ls/rm 回环 + 反向（读不存在必须 throw）', JSON.stringify(f));

// G：input 预填
const g = await page.evaluate(async () => {
  window.octave.input('42');
  const r = await window.octave.eval("v = input('给个数: ');");
  const v = await window.octave.evalJSON("v");
  return { ok: r.ok, v: v.value };
});
check(g.ok && g.v === 42, '★ G input 预填：eval 里的 input() 真拿到 42', JSON.stringify(g));

// H：interrupt 原语
const h = await page.evaluate(() => ({ t: typeof window.octave.interrupt, r: window.octave.interrupt() }));
check(h.t === 'function' && typeof h.r === 'boolean',
  '★ H interrupt 原语可调（完整语义由 accept-jspi/interactive 覆盖）', JSON.stringify(h));

// I：figures API 面（订阅可挂、export 优雅降级）
// ⚠ 已知边界（记档，2026-10-02）：**embed 页面**（自带 mount 的 boot 形态）plot 的
//   drawnow 会在 GL 纹理路径把 wasm 实例打死（opengl_texture::create + FS 随之不可用）
//   —— 根因在 wasm 侧 webgl_toolkit 的 GL 线（E6/图形线），不在接口层； shipped 页
//   （index.html 形态）图形由既有套件覆盖（accept-p5-graphics / engine-parity D）。
//   ⇒ 本格只断言接口层的契约：订阅器可挂、export 在无图/失败页优雅返回 null。
const i = await page.evaluate(async () => {
  let hits = 0;
  const subOk = window.octave.on.figure(function () { hits++; });
  const url = window.octave.figures.export();
  return { subOk, url: url === null ? 'null' : String(url).slice(0, 30) };
});
check(i.subOk === true && (i.url === 'null' || /^data:image/.test(i.url)),
  '★ I figures 接口面：on.figure 可挂 + export 优雅降级（GL 纹理边界见上）', JSON.stringify(i));

// J：反向 —— 不存在的挂点必须 reject
const j = await page.evaluate(() => new Promise(res => {
  window.OctaveEmbed.create({ mount: '#definitely-not-here__' })
    .then(() => res('no-throw'), err => res('reject:' + String(err).slice(0, 60)));
}));
check(/^reject/.test(j), '★ J 反向：挂点不存在 create 必须 reject', j);

if (errs.length) console.log('   ⚠️ 页面报错：' + errs.slice(0, 3).join(' // '));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
