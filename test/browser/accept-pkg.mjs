// T4 验收：pkg 语义（数据库生成 + 还原 fork 删掉的读取代码）
// 用法：harness/run.sh test/browser/accept-pkg.mjs [URL]
//
// 本批次修的是两件事，两条都要测到：
//   (1) 本构建的上游 fork 把 upstream `installed_packages.m` 里「读 .octave_packages」
//       的 16 行换成了 3 行空赋值 → pkg 永远看不到任何包。修法是把**官方文件放回去**，
//       所以断言里必须确认 `pkg list` 真的看到了包（而不是我们自己另写了个 pkg）。
//   (2) Forge 包由资产加载器直接写 FS + addpath，pkg 的数据库文件是空的 →
//       由 `__pkgfix_sync_db__` 描述"磁盘上实际有什么"。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 700)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a','b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 800));
}
await page.evaluate(async () => {
  for (let i = 0; i < 150; i++) { if (window.__octaveReady) break; await new Promise(r => setTimeout(r, 200)); }
});
console.log(`URL=${URL} ready=${((Date.now()-t)/1000).toFixed(1)}s`);

let pass = 0, fail = 0;
async function ev(name, code, check, ms) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, code);
  } catch (e) { console.log(`CRASH | ${name} :: ${String(e).slice(0,110)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, ms || 1500));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const ok = r.rc === 0 && check(out, r.err);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(34)} :: ${out.slice(0,150) || String(r.err).slice(0,120)}`);
}

console.log('--- 前置：装载若干 Forge 包并同步数据库 ---');
console.log('  装载: ' + await page.evaluate(async () => {
  const out = [];
  for (const a of ['control', 'signal', 'optim', 'statistics', 'struct']) {
    try { await window.OctaveAssets.load(a); out.push(a); } catch (e) { out.push(a + ':ERR'); }
  }
  return out.join(',');
}));
// 装载后再同步一次：数据库描述的必须是**磁盘现状**，而不是启动时的空状态。
await page.evaluate(() => window.Module.eval_string("__pkgfix_sync_db__();"));
await new Promise(r => setTimeout(r, 1200));

console.log('--- 数据库本体 ---');
await ev('sync 返回找到的包数 >= 5',
  "n=__pkgfix_sync_db__(); printf('SYNCED=%d\\n', n)",
  o => /SYNCED=[5-9]/.test(o));
await ev('数据库文件落在 pkg 实际读取的路径',
  "p=__pkgfix_local_list__(); printf('P=[%s] EXIST=%d\\n', p, exist(p))",
  o => /EXIST=2/.test(o) && /\.config\/octave\/api-v\d+\/octave_packages/.test(o));
await ev('数据库含 5 个包且版本正确',
  "d=load(__pkgfix_local_list__()); s=''; for k=1:numel(d.local_packages); s=[s d.local_packages{k}.name ':' d.local_packages{k}.version ' ']; end; disp(s)",
  o => /statistics:1\.7\.3/.test(o) && /signal:1\.4\.6/.test(o) && /struct:1\.0\.18/.test(o));
await ev('数据库不写 loaded 字段（由 Octave 运行时判定）',
  "d=load(__pkgfix_local_list__()); disp(isfield(d.local_packages{1},'loaded'))",
  o => /(^|\s)0(\s|$)/.test(o));

console.log('--- pkg list / load / describe（走官方代码路径）---');
await ev('pkg list 列出全部 5 个包',
  "pkg list",
  o => /statistics/.test(o) && /signal/.test(o) && /optim/.test(o) && /struct/.test(o) && /control/.test(o), 2000);
await ev('pkg list 显示版本号',
  "pkg list",
  o => /1\.7\.3/.test(o) && /1\.4\.6/.test(o), 2000);
await ev('pkg list 不再说 "no packages installed"',
  "pkg list",
  o => !/no packages installed/i.test(o), 2000);
await ev('pkg load statistics 成功',
  "pkg load statistics; disp('LOAD-OK')",
  o => /LOAD-OK/.test(o), 2000);
await ev('pkg load 后 list 标 * 表示已加载',
  "pkg list",
  o => /\*\s*\|/.test(o), 2000);
await ev('pkg("list") 带输出返回非空 cell',
  "s=pkg('list'); printf('N=%d CLASS=%s\\n', numel(s), class(s))",
  o => /CLASS=cell/.test(o) && !/N=0/.test(o));
await ev('pkg describe statistics 有内容',
  "s=pkg('describe','statistics'); printf('N=%d\\n', numel(s))",
  o => /N=[1-9]/.test(o), 2000);
await ev('pkg load 未安装的包 → 清晰报错',
  "try; pkg load zzznope; catch e; disp(['CAUGHT ' e.message]); end",
  o => /CAUGHT/.test(o) && /not installed/i.test(o), 2000);

console.log('--- 回归护栏 ---');
await ev('包内函数仍可用（normpdf）',
  "disp(exist('normpdf'))", o => /(^|\s)[25](\s|$)/.test(o));
await ev('which 指向包目录',
  "disp(which('normpdf'))", o => /forge\/statistics/.test(o));
await ev('核心函数不受影响（sin 是内建）',
  "disp(exist('sin'))", o => /(^|\s)5(\s|$)/.test(o));
await ev('addpath 路径未被破坏（pkg 仍可解析）',
  "disp(!isempty(which('pkg')))", o => /(^|\s)1(\s|$)/.test(o));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
