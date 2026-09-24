#!/bin/sh
# Octave-Full-Wasm — **开机自检**（D8，2026-09-24）
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有它（**一次真实事故**）：G1 第一次把 `eval_async` 链进来时，那个绑定是坏的
# （`RuntimeError: null function`），而且开机路径上有人去调它 ⇒ **页面根本起不来**。
# 可当时的验收网只能靠"40 个套件各自超时（每个最多 420 秒）"才发现 —— 又慢又吵，
# 而且很容易被当成"偶发"忽略过去。
#
# ⇒ 本脚本就是那条**30 秒的快速判据**：页面能不能起来 + 解释器能不能算一句 2+2。
#   **promote 之前必须过**（`build/promote-webgl.sh` 收尾会调它）。
#
# 用法：
#   sh build/check-boot.sh                       # 默认查 http://127.0.0.1:8761/（验收底线）
#   sh build/check-boot.sh http://127.0.0.1:8768/ 30000
# 退出码：0 = 起来了且能算；1 = **没起来**（含加载失败 / 超时 / eval 非 0）
#
# ⚠️ 与 sweep 共用同一个 harness 目录：JS 落在 `$H/_bootcheck.mjs`（**自己一个文件名**，
#    不碰 sweep 的 `_run.mjs` —— 那是"一次只让一个东西写"的坑，HANDOFF §5.14）。
set -eu
URL="${1:-http://127.0.0.1:8761/}"
BUDGET="${2:-30000}"          # 等 __octaveReady 的上限（毫秒）
H=/mnt/hdd/octave-wasm-build/harness

[ -d "$H/node_modules" ] || { echo "FATAL: harness 缺 node_modules（$H）" >&2; exit 2; }

cat > "$H/_bootcheck.mjs" <<'JS'
import { chromium } from 'playwright-core';
const URL = process.argv[2];
const BUDGET = Number(process.argv[3] || 30000);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
page.on('console', m => { const t = m.text(); if (/error|failed|FATAL/i.test(t)) errs.push(t.slice(0, 160)); });
try {
  await page.goto(URL, { waitUntil: 'load', timeout: BUDGET });
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < BUDGET) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ready = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!ready) {
    console.error(`BOOT FAIL: ${secs}s 内没等到 __octaveReady（页面起不来 = 这个产物不能上线）`);
    if (errs.length) console.error('  线索: ' + errs.slice(0, 3).join(' | '));
    process.exit(1);
  }
  // 起来了还不够：解释器得真能算（G1 那种"绑定在但一调就炸"的产物也能过 ready 那关）
  const rc = await page.evaluate(() => {
    try { return window.Module.eval_string('2+2'); } catch (e) { return 'throw:' + String(e).slice(0, 140); }
  });
  if (rc !== 0) {
    console.error(`BOOT FAIL: eval_string("2+2") 返回 ${rc}（起来了但算不了）`);
    if (errs.length) console.error('  线索: ' + errs.slice(0, 3).join(' | '));
    process.exit(1);
  }
  console.log(`BOOT OK: ${secs}s 就绪，eval_string("2+2") rc=0`);
  process.exit(0);
} catch (e) {
  console.error('BOOT FAIL: ' + String(e).slice(0, 200));
  if (errs.length) console.error('  线索: ' + errs.slice(0, 3).join(' | '));
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}
JS

cd "$H"
# 外层再套一个硬超时：node 自己卡住（页面把主线程堵死时可能发生）也要**按时失败**
OUTER=$(( (BUDGET / 1000) + 45 ))
if timeout "$OUTER" node _bootcheck.mjs "$URL" "$BUDGET"; then
  exit 0
fi
echo "★ 开机自检没过：$URL（用时上限 ${OUTER}s）" >&2
exit 1
