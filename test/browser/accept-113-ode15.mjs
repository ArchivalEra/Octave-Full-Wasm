// R1 在 11.3.0 上的验收：SUNDIALS 6.1.1 IDA → ode15s / ode15i
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 与 7.2 版 accept-ode15.mjs 的**关键差别**（为什么不能照抄）：
//   1. 7.2 那套靠"console 输出里包含某子串"断言，数值只做**子串**比对。
//      这一版把数值**取回 JS 侧当数字**再比界（printf %.12e → parseFloat），
//      因为本轮的目标是"ode15s 真的在算"，把误差当字符串比是弱证据。
//   2. 7.2 那套每次断言只等 700ms 固定延迟。11.3.0 上有 sentinel 同步
//      （accept-113-oct 的既有做法），日志落定与否不再靠猜。
//   3. 加了两条 7.2 版没有的断言：
//      · 装载**之前**调用 ode15s 必须是**干净报错**（提到 sundials_ida），
//        不是整页 trap —— 这条正是"桩"和"真模块"的分水岭。
//      · 全流程扫日志确认没有 RuntimeError/unreachable/pageerror（trap 检测）。
//
// 真值的来源（不是"应该对"）：
//   · 刚性问题 y' = -1000(y-cos t) - sin t, y(0)=1 的**解析解是 y=cos t**，
//     所以 max|y-cos t| 就是绝对误差，与实现无关 —— 这是主证据。
//   · 容差关系：RelTol=1e-3 时误差应 ≲1e-3；收到 1e-10 应 ≲1e-8。
//   · 非刚 y'=-y 在 [0,2] 的解析解是 e^-2。
//   · Van der Pol：`vdp1000` **不是 Octave 装的函数**（实测 install 树与源码树都
//     找不到），必须内联定义 ODE 右端；[0 3000] 是经典刚性区间。
//   · ode15i 的 yp0 必须是数值 —— 传 [] 会被直接拒绝（本机原生 11.3.0 复核过）。
//   · 本机（宿主）装的 Octave 11.3.0 **没有编 SUNDIALS**（实测报
//     "support for sundials_ida … unavailable or disabled"），所以拿不到
//     本机同版对照 —— 这正是"桩 vs 真模块"必须靠解析解而非对照来判的原因。
//
// 用法：harness/run.sh test/browser/accept-113-ode15.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8762/';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run (code, timeoutMs = 60000, useSentinel = true) {
  const s = '__SW' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  let rc;
  try {
    rc = await page.evaluate(
      ([x, sentinel, want]) => window.Module.eval_string(want ? `${x}; disp('${sentinel}');` : x),
      [code, s, useSentinel]);
  } catch (e) {
    // 整页 trap 会让 page.evaluate 直接 reject。**必须接住**，否则一次 trap
    // 就把整个套件打死、连汇总都出不来（第一版踩过）。返回 trap 标记，
    // 让上层断言把它记成一次失败并继续跑。
    return { rc: 'TRAP', out: '', seen: false, trap: true, err: String(e).slice(0, 160) };
  }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    if (!useSentinel) { if (Date.now() - t > 1500) break; }
    else if (logs.some(l => l.includes(s))) break;
    await sleep(80);
  }
  const seen = useSentinel ? logs.some(l => l.includes(s)) : true;
  const out = logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim();
  const err = await page.evaluate(() => window.Module.last_error_message()).catch(() => '(页面已死)');
  return { rc, out, seen, trap: false, err };
}

// 断言"输出里含某子串"
// ⚠️ 参数顺序是 (code, name, expect) —— 与 7.2 的 accept-ode15.mjs 一致。
//    第一版写反成 (name, code)，于是把中文标签当 Octave 代码求值，
//    报了一堆 `invalid character '觠(ASCII 232)`。
async function ev (code, name, expect, timeoutMs = 60000) {
  const r = await run(code, timeoutMs);
  let ok = r.seen && r.rc === 0 && !/^error/i.test(r.out);
  if (ok && expect !== undefined) ok = r.out.includes(expect);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(34)} :: ${(r.out || r.err || '(空)').slice(0, 92)}`);
  return r;
}

// 断言"输出里唯一的那个数是数字，且满足 check(v)"
async function num (code, name, check, note = '') {
  const r = await run(code);
  const m = r.out.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
  const v = m ? parseFloat(m[0]) : NaN;
  const ok = r.seen && r.rc === 0 && Number.isFinite(v) && check(v);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(34)} :: ${Number.isFinite(v) ? v.toExponential(4) : (r.out || r.err || '(空)').slice(0, 60)}${note ? '  ' + note : ''}`);
  return { ok, v };
}

console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  try { const r = await run('1+1', 4000); if (r.seen && r.rc === 0) break; } catch {}
  await sleep(700);
}
console.log(`ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

// index.html 起来后会自己装 dldfcn 核心组 + help 数据 + pkg 支持，
// 那些"资产装载"日志会污染 start-up 阶段的断言输出；等它装完再清一次。
await page.evaluate(async () => {
  if (!window.OctaveAssets) return;
  for (let i = 0; i < 150; i++) {
    if (window.OctaveAssets.loaded().length >= 7) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
logs.length = 0;

console.log('\n--- 一、懒加载语义（.oct 不在主 wasm 里）---');
await ev('disp(exist("__ode15__"))', '装载前 exist(__ode15__)', '0');
await ev('disp(exist("ode15s"))', 'ode15s 的 .m 包装层在（核心）', '2');
// ★ 分水岭断言：装载前调用必须是**干净报错**（不是整页 trap）。
//   实测（第一版这里猜错了，下面是改正后的依据）：`.oct` 还没装时 `__ode15__`
//   这个符号根本不存在，报的是 `'__ode15__' undefined near line 324`；而不是
//   宿主原生 11.3.0（编了 Octave 但没开 SUNDIALS）那句
//   "support for sundials_ida … unavailable or disabled"。
//   两者都是干净报错但文案不同，所以只断言：非零返回 + 提到 __ode15__ +
//   没有任何 trap 字样。error() 会中止，sentinel 打不出来 → useSentinel=false。
{
  const r = await run('ode15s(@(t,y) -y, [0 1], 1);', 20000, false);
  const msg = (r.out + ' ' + r.err).toLowerCase();
  const ok = r.rc !== 0 && /__ode15__/.test(msg) && !/unreachable|runtimeerror|pageerror/.test(msg);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${'★ 装载前调用是干净报错'.padEnd(34)} :: ${(r.err || r.out || '(空)').slice(0, 92)}`);
}
{
  const lr = await page.evaluate(async () => {
    try { await window.OctaveAssets.load('__ode15__'); return 'ok'; }
    catch (e) { return 'ERR ' + String(e).slice(0, 140); }
  });
  const ok = lr === 'ok';
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${'OctaveAssets.load(__ode15__)'.padEnd(34)} :: ${lr}`);
}
await ev('disp(exist("__ode15__"))', '装载后 exist(__ode15__)', '3');

console.log('\n--- 二、ode15s 刚性方程（解析解 y=cos t 为真值）---');
// y' = -1000(y - cos t) - sin t, y(0)=1  →  精确解 y = cos t
await ev('[t,y]=ode15s(@(t,y) -1000*(y-cos(t))-sin(t), [0 1], 1); disp("solved")', '有解（默认容差）', 'solved');
await num('printf("%.12e\\n", max(abs(y-cos(t))))', '★ 默认容差误差（应 <1e-3）', v => v < 1e-3, '（7.2 实测 9.2e-05）');
await num('printf("%d\\n", numel(t))', '步数（应有界，非硬性）', v => v >= 3 && v < 100000);
// 收紧容差：误差必须跟着降
await ev('[t,y]=ode15s(@(t,y) -1000*(y-cos(t))-sin(t), [0 1], 1, odeset("RelTol",1e-10,"AbsTol",1e-12)); disp("solved")', '有解（RelTol=1e-10）', 'solved');
await num('printf("%.12e\\n", max(abs(y-cos(t))))', '★ 收紧容差误差（应 <1e-8）', v => v < 1e-8, '（7.2 实测 1.1e-08）');

console.log('\n--- 三、非刚退化 + 容差单调性 ---');
await ev('[t2,y2]=ode15s(@(t,y) -y, [0 2], 1); disp("solved")', 'y\'=-y 有解（默认）', 'solved');
const dflt = await num('printf("%.12e\\n", abs(y2(end)-exp(-2)))', '默认容差 |y(2)-e^-2|（<1e-3）', v => v < 1e-3);
await ev('[t2,y2]=ode15s(@(t,y) -y, [0 2], 1, odeset("RelTol",1e-8,"AbsTol",1e-10)); disp("solved")', 'y\'=-y 有解（收紧）', 'solved');
const tight = await num('printf("%.12e\\n", abs(y2(end)-exp(-2)))', '★ 收紧 |y(2)-e^-2|（<1e-7）', v => v < 1e-7);
{
  const ok = tight.v <= dflt.v * 10;   // 收紧后必须不更差（留 10× 余地）
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${'★ 容差单调（收紧 ≤ 默认×10）'.padEnd(34)} :: ${tight.v.toExponential(3)} vs ${dflt.v.toExponential(3)}`);
}

console.log('\n--- 四、Van der Pol μ=1000（经典刚性；长区间不炸）---');
// ⚠️ 不能写 @vdp1000：**Octave 根本不装这个函数**（它是 odepkg 的示例，
//    本仓的 install 树和源码树里 `find -name vdp1000*` 都是空的 —— 实测）。
//    7.2 那套也是内联定义的，照做，别去改路径找它。
//
// ⚠️ [0 3000] 上用**默认容差**（RelTol=1e-3 / AbsTol=1e-6）会失败：
//      `[IDA ERROR] IDASolve At t = 0 and h = 1.14e-05, the error test failed
//       repeatedly or with |h| = hmin`
//    **这不是本构建的缺陷** —— 已在 8761（7.2 的、已验收过的 SUNDIALS 构建）上
//    逐条对照，五个用例的判定**完全一致**（连步数都一样：54 / 失败 / 失败 / 537 / 724）。
//    即两个站点共有：AbsTol=1e-6 对这个刚性瞬变太紧。
//    给 AbsTol=1e-3 就正常（537 步，与 MATLAB 文档里 vdp1000 的约 600 步同量级）。
//    所以这里按"两个站点都成立"的口径断言，而不是按"MATLAB 能跑默认"猜。
const VDP = 'vdp=@(t,y) [y(2); 1000*(1-y(1)^2)*y(2)-y(1)]; ';
await ev(VDP + '[tv,yv]=ode15s(vdp,[0 20],[2;0]); disp("solved")',
  'vdp1000 [0 20] 默认容差', 'solved');
await num(VDP + 'printf("%.6f\\n", max(abs(yv(:))))', '解有界（max|y| < 3）', v => v > 1 && v < 3, '（振幅≈2）');
await ev(VDP + '[tv,yv]=ode15s(vdp,[0 3000],[2;0],odeset("AbsTol",1e-3)); disp("solved")',
  'vdp1000 [0 3000] AbsTol=1e-3', 'solved', 240000);
await num(VDP + 'printf("%d\\n", rows(tv))', '步数（真刚性积分应 >200）', v => v > 200, '（实测 537，与 7.2 站点一致）');

console.log('\n--- 五、ode15i 全隐式 ---');
// ⚠️ ode15i 的第 4 个参数是 yp0（初值导数），**必须是数值**。
//    第一版传了 `[]`（想"让求解器自己猜"），实测直接报
//    "YP0 must be a numeric vector"（本机原生 11.3.0 复核过同一句）。
//    y'+y=0 在 y(0)=1 时 yp(0)=-1，所以给 -1。
await ev('f=@(t,y,yp) yp+y; [t3,y3]=ode15i(f,[0 2],1,-1,odeset("RelTol",1e-8,"AbsTol",1e-10)); disp("solved")',
  'ode15i 求解 y\'+y=0', 'solved');
await num('printf("%.12e\\n", abs(y3(end)-exp(-2)))', '★ |y(2)-e^-2|（应 <1e-6）', v => v < 1e-6, '（7.2 实测 1.75e-04 默认 / <1e-6 收紧）');

console.log('\n--- 六、非刚性求解器无回归 ---');
await num('[t4,y4]=ode45(@(t,y) -y,[0 2],1); printf("%.12e\\n", abs(y4(end)-exp(-2)))', 'ode45 |y(2)-e^-2|（<1e-3）', v => v < 1e-3);
await num('[t5,y5]=ode23(@(t,y) -y,[0 2],1); printf("%.12e\\n", abs(y5(end)-exp(-2)))', 'ode23 |y(2)-e^-2|（<1e-3）', v => v < 1e-3);
// ⚠️ `lsode` **不在这里**断言：它会**整页 trap**（见第七节）。放在主序列里
//    会把整个套件打死，一条汇总都出不来 —— 第一版就是这么翻车的。

console.log('\n--- 七、主序列无整页 trap ---');
{
  const joined = logs.join(' ');
  const bad = /RuntimeError: unreachable|\[pageerror\]|Cannot read properties of undefined|abort\(/.test(joined);
  const ok = !bad;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${'无 trap / 无 pageerror'.padEnd(34)} :: ${bad ? joined.slice(0, 92) : '干净'}`);
}

// ───────────────────────────────────────────────────────────────────────────
// 八、`lsode`（**2026-09-22 已修好；本节从"已知缺陷复核"改成正式断言**）
//
// 修复前的症状：`lsode` 一调用就整页 trap（`RuntimeError: unreachable`），
// 7.2 与 11.3.0 都复现，且不装载 `__ode15__` 时也复现 —— 与 SUNDIALS 无关。
//
// 根因（证据链完整，见 build/113/NOTES-lsode.md）：
//   本树 odepack 的 Fortran 调用户回调时给 **4 个实参**（`dlsode.f:1393`
//   `CALL F (NEQ, T, Y, RWORK(LF0))`，dstode.f 3 处、dprepj.f 3 处同），f2c 因此
//   生成 4 参函数指针调用；而 Octave 的 `lsode_f` 有 **5 个形参**（多一个
//   `F77_INT& ierr`）。原生 x86 上 C 不检查签名，所以"看起来能用"；
//   **wasm 的 `call_indirect` 会精确检查类型 → 不符即 `unreachable`**。
//   （同批的 `lsode_j` 是 7 参，而 dprepj 的 `(*jac)(…)` 恰好也是 7 参 → 只有 f 不匹配。）
//   修法：`build/113/patch-odepack-callback-arity.sh` 给那 7 处 CALL F 补上第 5 个实参。
//
// ⚠️ 这里必须用**正确的输出约定**：`lsode` 返回的是 `[x, istate, msg]`（解与状态），
//    **不是** `[t, y]`。第一版写成 `[t,y]=lsode(...)` 会把 istate(=2) 当成 y(end)，
//    于是量到 err≈1.865 而误判"算错了"。本机原生 11.3.0 复核过同一坑。
console.log('\n--- 八、lsode（曾整页 trap，现已修复）---');
await num('x=lsode(@(y,t) -y,1,[0 2]); printf("%.12e\\n", abs(x(end)-exp(-2)))',
  '★ lsode |x(2)-e^-2|（应 <1e-6）', v => v < 1e-6, '（原生 11.3.0 同题 4.3e-08）');
await num('[x,ist,msg]=lsode(@(y,t) -y,1,[0 2]); printf("%d\\n", ist)',
  'lsode istate=2（成功退出）', v => v === 2);
await num('x=lsode(@(y,t) [-y(1);-2*y(2)],[1;1],[0 1]); printf("%.6f\\n", abs(x(end,2)-exp(-2)))',
  '★ 两状态系统 |y2(1)-e^-2|（<1e-6）', v => v < 1e-6);
await ev('lsode_options("integration method","non-stiff"); x=lsode(@(y,t) -y,1,[0 2]); disp("nonstiff-ok")',
  'lsode 非刚方法也能跑', 'nonstiff-ok');
await num('lsode_options("integration method","stiff"); x=lsode(@(y,t) -1000*(y-cos(t))-sin(t),1,0:0.05:1); printf("%.3e\\n", max(abs(x-cos((0:0.05:1)\'))))',
  '★ 刚性问题 |x-cos t|（<1e-6）', v => v < 1e-6);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
