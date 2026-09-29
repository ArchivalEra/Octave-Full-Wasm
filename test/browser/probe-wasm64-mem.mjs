// 探针（Q3 上键，2026-09-29）：memory64 的**可寻址上限** —— 引擎能力实测，不依赖任何产物。
//
// ## 它在量什么
//
// Q3（>4 GiB）的三个数字原来只活在一次性 `node -e` 命令与 NOTES 散文里 —— 那正是
// 事实系统要消灭的形状（散文会腐烂，没有闸门拦得住）。本探针把那三个数字变成
// **可复跑的测量**，输出机器可读行，`build/facts.py` 的 `w64_mem_*` 组从保存下来的
// 本探针日志里取值（照 `probe_lane_pass` 的形状）。
//
// ## 六格
//
//   1. 单线程 memory64 分配 80000 页（5 GiB）   → byteLength 量出（反 4 GiB 边界的证据一）
//   2. 单线程 memory64 分配 131072 页（8 GiB）  → byteLength 量出
//   3. COI 页 shared memory64 分配 80000 页（5 GiB 共享）→ buffer 必须是 SharedArrayBuffer
//   4. 反证：wasm32 内存要 >65536 页 → 必须抛（证明上面的成功**真走了** 64 位路径）
//   5. 反证（NOTES 记过的 API 陷阱）：`index:'i64'`（旧草案拼法）被 V8 当未知属性忽略
//      ⇒ 退回 32 位检查 ⇒ >65536 页必须抛（哪天 V8 认了 `index`，这里会红 ⇒ 翻面）
//   6. 反证：`address:'i64'` 配 Number 页数 → 必须抛 TypeError（必须是 BigInt）
//
// ## 为什么自托管
//
// 格 3 要 COI 头（shared 内存的前提），格 1/2/4/5/6 要**没有** COI 的普通页 ⇒ 一台
// 服务器两条路由：`/plain`（不带头）与 `/coi`（带头，照 probe-threads runner 的写法）。
// 本探针**不依赖任何站点产物**，URL 参数照惯例忽略。
//
// ## 机器可读行（facts.py 解析）
//
//   mem5g_bytes=<字节数>   mem8g_bytes=<字节数>   memshared5g_bytes=<字节数>
//
// 复跑：cd <仓库> && sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > <日志>
//       （默认取 <持久盘>/w64-logs/mem-probe.log；改 W64_MEM_LOG 覆盖）
import http from 'node:http';
import { chromium } from 'playwright-core';

const ALLOC_TIMEOUT_MS = Number(process.env.ALLOC_TIMEOUT_MS || 60000);
const WATCHDOG_MS = Number(process.env.WATCHDOG_MS || 180000);
const GIB = 1024 * 1024 * 1024;

let pass = 0, fail = 0;
function check (ok, name, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(52)} :: ${String(detail).slice(0, 90)}`);
}
function stat (line) { console.log(line); }   // 机器可读行，原样进日志

const server = http.createServer((req, res) => {
  if (req.url === '/coi') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end('<!doctype html><title>coi</title>');
    return;
  }
  if (req.url === '/plain') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>plain</title>'); return; }
  res.writeHead(404); res.end('no');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// 看门狗：探针自己绝不能挂（分配若卡死，宁可红着退出也不能拖住 sweep）
const watchdog = setTimeout(() => {
  console.log(`fail | 看门狗 | 超过 ${WATCHDOG_MS / 1000}s 没跑完，强制退出`);
  console.log(`=== ${pass} PASS / ${fail + 1} FAIL ===`);
  process.exit(1);
}, WATCHDOG_MS);

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});

async function openPage (route) {
  const page = await browser.newPage();
  await page.goto(`${base}${route}`, { waitUntil: 'load', timeout: 20000 });
  return page;
}

// 单次分配的硬超时赛跑（分配 hang 时 evaluate 的 Promise 永不 settle —— 照 probe-e2-threads 的教训）
async function withTimeout (promise, label) {
  let t;
  const boom = new Promise(res => { t = setTimeout(() => res({ __timeout: true }), ALLOC_TIMEOUT_MS); });
  const out = await Promise.race([promise, boom]);
  clearTimeout(t);
  if (out && out.__timeout) throw new Error(`${label} 超过 ${ALLOC_TIMEOUT_MS / 1000}s 未返回`);
  return out;
}

// ── 格 1/2：单线程 5 GiB / 8 GiB ────────────────────────────────────────────────
const plain = await openPage('/plain');
try {
  const r5 = await withTimeout(plain.evaluate(async () => {
    try {
      const m = new WebAssembly.Memory({ initial: 80000n, address: 'i64' });
      // ⚠️ 非 COI 页上 `SharedArrayBuffer` 这个**标识符本身不存在**（实测 ReferenceError，
      //    不只是"不能构造"）⇒ 这里只能走 typeof / constructor.name，不能裸引用。
      return { bytes: m.buffer.byteLength, ctor: m.buffer.constructor.name };
    } catch (e) { return { err: String(e).slice(0, 90) }; }
  }), '5GiB 分配');
  if (r5.err) check(false, '1 · 单线程 memory64 分配 80000 页', r5.err);
  else {
    check(r5.bytes === 80000 * 65536 && r5.ctor !== 'SharedArrayBuffer', '1 · 单线程 memory64 分配 80000 页（5 GiB，非共享）', `${r5.bytes} B = ${(r5.bytes / GIB).toFixed(2)} GiB, buffer=${r5.ctor}`);
    check(r5.bytes > 4 * GIB, '1b · 越过 4 GiB 边界', `${(r5.bytes / GIB).toFixed(2)} GiB`);
    stat(`mem5g_bytes=${r5.bytes}`);
  }
} catch (e) { check(false, '1 · 单线程 memory64 分配 80000 页', String(e).slice(0, 90)); }

try {
  const r8 = await withTimeout(plain.evaluate(async () => {
    try {
      const m = new WebAssembly.Memory({ initial: 131072n, address: 'i64' });
      return { bytes: m.buffer.byteLength };
    } catch (e) { return { err: String(e).slice(0, 90) }; }
  }), '8GiB 分配');
  if (r8.err) check(false, '2 · 单线程 memory64 分配 131072 页', r8.err);
  else {
    check(r8.bytes === 131072 * 65536, '2 · 单线程 memory64 分配 131072 页（8 GiB）', `${r8.bytes} B = ${(r8.bytes / GIB).toFixed(2)} GiB`);
    stat(`mem8g_bytes=${r8.bytes}`);
  }
} catch (e) { check(false, '2 · 单线程 memory64 分配 131072 页', String(e).slice(0, 90)); }

// ── 格 4/5/6：反证（在**同一张** plain 页上做，省一次导航）─────────────────────
try {
  const rev = await withTimeout(plain.evaluate(async () => {
    const out = {};
    try { new WebAssembly.Memory({ initial: 70000n }); out.wasm32 = 'no-throw'; }
    catch (e) { out.wasm32 = `${e.name}: ${String(e.message).slice(0, 60)}`; }
    try { new WebAssembly.Memory({ initial: 70000n, index: 'i64' }); out.index = 'no-throw'; }
    catch (e) { out.index = `${e.name}: ${String(e.message).slice(0, 60)}`; }
    try { new WebAssembly.Memory({ initial: 1, address: 'i64' }); out.number = 'no-throw'; }
    catch (e) { out.number = `${e.name}: ${String(e.message).slice(0, 60)}`; }
    return out;
  }), '反证组');
  check(rev.wasm32 !== 'no-throw', '4 · wasm32 要 >65536 页必须抛', `得到：${rev.wasm32}`);
  check(rev.index !== 'no-throw', '5 · index:"i64" 陷阱仍在（退回 32 位检查）', `得到：${rev.index}`);
  check(rev.number !== 'no-throw', '6 · address:"i64" 配 Number 必须抛', `得到：${rev.number}`);
} catch (e) {
  check(false, '4/5/6 · 反证组', String(e).slice(0, 90));
}
await plain.close().catch(() => {});

// ── 格 3：COI 页 shared memory64 ───────────────────────────────────────────────
try {
  const coi = await openPage('/coi');
  const iso = await coi.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer === 'function' }));
  check(iso.coi === true && iso.sab === true, '3a · COI 页前提（crossOriginIsolated + SAB）', JSON.stringify(iso));

  const rs = await withTimeout(coi.evaluate(async () => {
    try {
      const m = new WebAssembly.Memory({ initial: 80000n, maximum: 131072n, shared: true, address: 'i64' });
      return { bytes: m.buffer.byteLength, sab: m.buffer instanceof SharedArrayBuffer };
    } catch (e) { return { err: String(e).slice(0, 90) }; }
  }), '共享 5GiB 分配');
  if (rs.err) check(false, '3 · COI 下 shared memory64 分配 80000 页', rs.err);
  else {
    check(rs.sab === true && rs.bytes === 80000 * 65536, '3 · COI 下 shared memory64 分配 80000 页（5 GiB 共享）', `${rs.bytes} B, SharedArrayBuffer=${rs.sab}`);
    stat(`memshared5g_bytes=${rs.bytes}`);
  }
  await coi.close().catch(() => {});
} catch (e) {
  check(false, '3 · COI 下 shared memory64 分配 80000 页', String(e).slice(0, 90));
}

await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]).catch(() => {});
server.close();
clearTimeout(watchdog);

console.log('');
console.log('════ 机器可读（facts.py 的 w64_mem_* 组从这里取值）════');
console.log('（上面以 mem*_bytes= 开头的行）');
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
