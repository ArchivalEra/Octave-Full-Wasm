// 批次 1 验收：HDF5 往返 + CXSparse 稀疏能力
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-hdf5.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
// ⚠️ **还要等启动资产装完**（`window.__octaveReady` 在 index.html 里是"整条启动链跑完"
//    —— 含 help 数据与 webgraphics —— 才置真的）。只等解释器可用就往下跑时，页面侧的
//    资产加载器会继续打 `[assets] …就绪` 日志，那些行落进前几次 eval 的捕获窗口，
//    把要匹配的文本挤出截断窗口 ⇒ **偶发假红**（2026-09-23 实测：accept-hdf5 与
//    accept-net 各中过一次；这两条的根因是同一个，不是两条独立的毛病）。
for (let _w = 0; _w < 600; _w++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
await new Promise(r => setTimeout(r, 400));
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
// ★ 匹配规则（`.githooks/check-wants.py` 会查这一条）：**单个数字**的 want 按「数字边界」匹配，
//   不是裸子串 —— `want='0'` 绝不该被输出里的 `10`/`100`/`13` 满足（`accept-hdf5` 就这么
//   假过了几个月：它查的 `__have_hdf5__` 在 11.3.0 里根本不存在，靠加载器日志里的杂数字对上）。
//   **点也算边界字符**：捕获窗口里有 `11.3.0` 这类版本号，`want='0'` 不该被它最后那位满足
//   （探针 `test/browser/probe-want-matcher.mjs` 把这几条钉在真浏览器里）。
//   多字符 want 保持子串匹配（`'0.7071'`、`'100 100'` 已足够具体；而 Octave 打印 1.5 是
//   `1.5000`，对它用严格词边界反而会误红）。
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 700));
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const out = full.slice(0, 190);      // ★ 只用于显示；匹配必须用 full（不许先截断再匹配）
  const ok = r.rc === 0 && (!want || wantHit(full, want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}

console.log('--- HDF5 ---');
// ── 这条断言**曾经是假的**（2026-09-23 查清）────────────────────────────────
// 原来写的是 `disp(exist("__have_hdf5__"))` want='1'。而 `__have_hdf5__` **在 Octave
// 11.3.0 里根本不存在** —— 源码树 / 安装树 / 核心 .m 里都搜不到（它不是上游的东西）。
// 它之所以长期"绿"：want 是单个数字 `1`，而当时套件只等"解释器可用"，页面侧资产加载器的
// 日志（`[assets] 清单就绪：47 个资产 …`）落在同一个捕获窗口里，随便哪个数字把它对上了。
// ⇒ 两条教训（都记进 HANDOFF §8）：
//   ① **单个数字当 want 是弱断言**，噪声里的同数字会让它假过；
//   ② 套件必须等 `window.__octaveReady`（本轮 23 个套件都补上了），噪声才不会串窗。
// 改成上游真正提供的探针：`__octave_config_info__("HDF5")`，返回 1/0 表示这个构建是否带 HDF5。
await ev('disp(__octave_config_info__("HDF5"))', '★ 本构建带 HDF5（上游探针 __octave_config_info__）', '1');
await ev("A=magic(4); B='hello'; C=struct('x',1.5); save('-hdf5','/tmp/t.h5','A','B','C'); disp(exist('/tmp/t.h5'))", 'save -hdf5 落盘', '2');
await ev('clear A B C; load("/tmp/t.h5"); disp(A(1,1))', 'load 回读 A', '16');
await ev('disp(B)', 'load 回读字符串 B', 'hello');
await ev('disp(C.x)', 'load 回读 struct C', '1.5');
await ev('s=whos("-file","/tmp/t.h5"); disp(numel(s))', 'whos -file 列表长度', '3');
await ev('disp(isequal(load("/tmp/t.h5").A, magic(4)))', '往返一致性', '1');
// 压缩 + 大数组
await ev('X=reshape(1:10000,100,100); save("-hdf5","-z","/tmp/big.h5","X"); clear X; Y=load("/tmp/big.h5").X; disp([rows(Y) columns(Y)]); disp(sum(Y(:)))', '带压缩的 100x100 往返', '100 100');
await ev('Y=load("/tmp/big.h5").X; disp(sum(Y(:)))', '压缩往返数值', '5.0005e+07');

// HDF5 文件魔数（89 48 44 46 0d 0a 1a 0a）——证明确实是 HDF5 容器而非别的格式
const magic = await page.evaluate(() => {
  const b = Module.FS.readFile('/tmp/t.h5');
  return Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join(' ');
});
const magicOk = magic === '89 48 44 46 0d 0a 1a 0a';
magicOk ? pass++ : fail++;
console.log(`${magicOk ? 'PASS' : 'fail'} | HDF5 魔数 :: ${magic}`);

console.log('--- CXSparse（稀疏）---');
await ev('disp(exist("__have_cxsparse__"))', 'exist __have_cxsparse__（无此内建则见下）', null);
await ev("s=gallery('poisson',8); x=ones(64,1); b=s*x; xx=s\\b; disp(norm(xx-x,inf)<1e-8)", '稀疏反斜杠求解（确定性 Poisson）', '1');
await ev("s=gallery('poisson',6); [L,U,P,Q]=lu(s); disp(issparse(L))", '稀疏 LU（CXSparse 路径）', '1');
// 注意：qr(s,0) 经济模式在 CXSparse 后端不受支持（Octave 自身限制，桌面版同样报错）
await ev("s=gallery('poisson',5); [Q,R]=qr(s); disp(issparse(R))", '稀疏 QR（完整模式）', '1');
// CXSparse 路径下 P/p 返回空，但 s=Q*R 恒等式成立——这才是实质判据（实测残差 7e-15）
await ev("s=gallery('poisson',5); [Q,R]=qr(s); disp(norm(full(s)-full(Q*R),1)<1e-8)", '稀疏 QR 一致性 s=Q*R', '1');
await ev('disp(nnz(speye(5)*2))', '稀疏基本运算', '5');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
