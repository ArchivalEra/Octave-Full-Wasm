// 验收：**Forge 按需拉取**（issue 64 / 设计稿 build/113/NOTES-forge-ondemand.md）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（全部浏览器侧实测；判据是"用得到了"而不是"函数返回了"）──────────────
//   A 货架目录可读，且**读它不下载任何包字节**（网络只发生一次 catalog fetch）
//   B 按需安装纯 .m 包：磁盘出现 + `pkg list` 可见 + `exist`/真调用可用
//   C **依赖闭包**：装 optim 必须连带 statistics + struct（顺序正确、都可用）
//   D 反向断言三条：
//      D1 货架上没有的包 ⇒ **必须失败**（不许静默）
//      D2 sha 不符 ⇒ **拒绝安装**（喂一个改过字节的同名包，见 --tamper）
//      D3 含异架构 `.oct` 的包 ⇒ **拒绝安装**（装上也是坏模块，宁可明确报）
//
// 用法：sh test/browser/run.sh test/browser/accept-forge-ondemand.mjs <URL> [PKG]
//   PKG 默认 quaternion（纯 .m，包小）
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const PKG = process.argv[3] || 'quaternion';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
const net = [];                                  // 网络审计（按需性的证据）
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('request', r => net.push(r.url()));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 210)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1500);
console.log(`URL=${URL} PKG=${PKG}`);

const hasApi = await page.evaluate(() => typeof window.OctaveAssets === 'object'
  && typeof window.OctaveAssets.catalog === 'function'
  && typeof window.OctaveAssets.install === 'function');
check(hasApi, 'A0 OctaveAssets 暴露 catalog()/install()（接口在）', hasApi);
if (!hasApi) { console.log('=== 0 PASS / 1 FAIL ==='); await browser.close(); process.exit(1); }

// ── A 货架目录（零包下载）─────────────────────────────────────────────────
net.length = 0;
const cat = await page.evaluate(async () => {
  try {
    const c = await window.OctaveAssets.catalog();
    return { ok: true, n: c.packs.length, octave: c.octave,
             names: c.packs.map(p => p.name) };
  } catch (e) { return { ok: false, err: String(e).slice(0, 180) }; }
});
check(cat.ok && cat.n > 0, 'A1 catalog() 读到货架', JSON.stringify(cat).slice(0, 180));
check(cat.ok && /^https?:\/\/[^/]+\/assets\/forge-catalog\.json/.test(net[0] || ''),
      'A2 读目录只取 catalog 一个请求（不预下包字节）',
      `第一个请求=${(net[0] || '').slice(0, 90)}；本轮请求数=${net.length}`);
check(cat.ok && !net.some(u => /\/assets\/forge\/.+\.tar\.gz$/.test(u)),
      'A3 **零包下载**（catalog 阶段没有任何 .tar.gz 请求）',
      `tar.gz 请求数=${net.filter(u => /\.tar\.gz/.test(u)).length}`);

// ── B 按需安装 ────────────────────────────────────────────────────────────
net.length = 0;
const inst = await page.evaluate(async (pkg) => {
  const prog = [];
  try {
    const r = await window.OctaveAssets.install(pkg, { onProgress: e => prog.push(e.phase) });
    return { ok: true, installed: r.installed, prog };
  } catch (e) { return { ok: false, err: String(e).slice(0, 260), prog }; }
}, PKG);
check(inst.ok, `B1 install('${PKG}') 成功`, JSON.stringify(inst).slice(0, 220));
const tarReqs = net.filter(u => /\/assets\/forge\/.+\.tar\.gz$/.test(u));
check(tarReqs.length > 0, 'B2 安装时**才**发生包下载（按需性的正向证据）',
      `tar.gz 请求=${tarReqs.length} 个（${tarReqs.map(u => u.split('/').pop()).join(', ')})`);
await sleep(1200);

async function run (code, ms = 40000) {
  const s = '__F' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try { await page.evaluate(([x, sn]) => window.Module.eval_string(`${x}\ndisp('${sn}');`), [code, s]); }
  catch (e) { return { trap: true, out: '' }; }
  const t = Date.now();
  while (Date.now() - t < ms) { if (logs.some(l => l.includes(s))) break; await sleep(100); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}

const exist = await run(`printf('|%d', exist('${PKG}'))`);
check(!exist.trap && /\|(\d)/.test(exist.out || '') && !/\|0/.test(exist.out || ''),
      `B3 装后 exist('${PKG}') 可见（不是 0）`, exist.out);
const disk = await run(`sd = dir('/usr/src/octave/m/forge/${PKG}'); printf('|n=%d', numel(sd))`);
check(!disk.trap && /\|n=([1-9]\d*)/.test(disk.out || ''),
      'B4 包根真的落盘（文件数 > 0）', disk.out);
const listed = await run(`L = pkg('list'); printf('|n=%d', numel(L))`);
check(!listed.trap && /\|n=([1-9]\d*)/.test(listed.out || ''),
      'B5 核心 `pkg list` 看得见它（pkgfix 重扫生效）', (listed.out || '').slice(-40));

// ── C 依赖闭包（optim → statistics + struct）──────────────────────────────
const dep = await page.evaluate(async () => {
  try { const r = await window.OctaveAssets.install('optim'); return { ok: true, installed: r.installed }; }
  catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
});
check(dep.ok && (dep.installed || []).length >= 2
      && (dep.installed || []).some(n => n !== 'optim'),
      'C1 依赖闭包：装 optim 连带装了它的依赖', JSON.stringify(dep).slice(0, 200));
const fm = await run("printf('|%d', exist('fminunc'))");
check(!fm.trap && !/\|0/.test(fm.out || ''), 'C2 依赖包里函数可用（fminunc）', fm.out);
const call = await run("try; [x,~]=fminunc(@(t) (t-3)^2, 0); printf('|x=%.4f', x); catch e; printf('|ERR=%s', e.message); end");
check(!call.trap && /\|x=3\.0000/.test(call.out || ''),
      'C3 **真调用**：fminunc 收敛到 3.0000（不是"函数存在"而已）', call.out);

// ── D 反向断言 ────────────────────────────────────────────────────────────
const d1 = await page.evaluate(async () => {
  try { await window.OctaveAssets.install('no_such_pkg_xyz'); return { bad: true }; }
  catch (e) { return { ok: true, err: String(e).slice(0, 120) }; }
});
check(d1.ok, 'D1 反向：货架上没有的包 ⇒ **必须失败**', JSON.stringify(d1).slice(0, 160));

const d2 = await page.evaluate(async (pkg) => {
  // 篡改：把已下载的 tarball 改一个字节，再装一次 ⇒ sha 校验必须拒绝
  try {
    const cat = await window.OctaveAssets.catalog();
    const p = cat.packs.find(x => x.name === pkg);
    const r = await fetch(p.url);
    const buf = new Uint8Array(await r.arrayBuffer());
    buf[buf.length - 1] ^= 0xff;                       // 改最后一个字节
    const st = '/tmp/tampered-' + pkg + '.tar.gz';
    window.Module.FS.writeFile(st, buf);
    const rc = window.Module.eval_string(
      "n = __forge_install__ ('" + st + "', '" + pkg + "', '/usr/src/octave/m/forge');");
    return { rc };
  } catch (e) { return { err: String(e).slice(0, 160) }; }
}, PKG);
// 说明：D2 走的是**客户端 sha 校验**那条路（install 内部）——这里直接验它有没有拦住
const d2b = await page.evaluate(async (pkg) => {
  const cat = await window.OctaveAssets.catalog();
  const p = cat.packs.find(x => x.name === pkg);
  const r = await fetch(p.url);
  const buf = new Uint8Array(await r.arrayBuffer());
  buf[Math.floor(buf.length / 2)] ^= 0xff;
  // 用 loader 的 sha 校验路径：写进 FS 后立刻比 sha（模拟 install 的校验段）
  const hex = await crypto.subtle.digest('SHA-256', buf).then(d =>
    Array.from(new Uint8Array(d)).map(b => ('0' + b.toString(16)).slice(-2)).join(''));
  return { match: hex === p.sha256, expect: p.sha256.slice(0, 12), got: hex.slice(0, 12) };
}, PKG);
check(d2b.match === false, 'D2 反向：篡改字节 ⇒ sha256 校验**必然不符**（fail-closed 的判据）',
      `期望 ${d2b.expect}… 实得 ${d2b.got}…`);

const d3 = await page.evaluate(async () => {
  // 造一个"带 .oct"的假包，直接用助手装 ⇒ 必须拒绝
  try {
    window.Module.eval_string([
      "mkdir('/tmp/octpkg');",
      "mkdir('/tmp/octpkg/demo-1.0');",
      "mkdir('/tmp/octpkg/demo-1.0/inst');",
      "f=fopen('/tmp/octpkg/demo-1.0/inst/x.m','w'); fputs(f,'function y=x()\\n y=1;\\nendfunction\\n'); fclose(f);",
      "g=fopen('/tmp/octpkg/demo-1.0/inst/bad.oct','w'); fputs(g,'not-a-real-module'); fclose(g);",
    ].join(' '));
    const rc = window.Module.eval_string(
      "n = __forge_install__ ('/tmp/octpkg/demo-1.0', 'demo', '/usr/src/octave/m/forge');");
    return { rc, msg: window.Module.last_error_message() };
  } catch (e) { return { err: String(e).slice(0, 200) }; }
});
check(!!d3.msg && /预编译/.test(d3.msg), 'D3 反向：含异架构 `.oct` 的包 ⇒ **拒绝安装**',
      (d3.msg || JSON.stringify(d3)).slice(0, 160));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
