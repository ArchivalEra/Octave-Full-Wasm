#!/bin/sh
# Octave-Full-Wasm — R5 的**最小组合探针**：`-fwasm-exceptions` + `-sJSPI` + `MAIN_MODULE=2`
#                     + `SIDE_MODULE`/dlopen 这个组合到底成不成立
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么必须先做这个（外部审核的结论）──────────────────────────────────────
# JSPI 本身已经进入生产浏览器（Chrome 137+ / Firefox 153+ / Safari 27+），
# **JSPI 与 wasm EH 在规范层面也兼容**（Promise 的 reject 会按 wasm EH 的 JS API 传播）；
# 但 **"JSPI + MAIN_MODULE=2 + SIDE_MODULE/dlopen" 没有公开的大型项目先例** ⇒
#   探针没过之前，**不许**宣称 R5 可用，更不许据此改 `pause`/`kbhit`/`recordblocking`。
#
# 两段（跑法见 test/browser/probe-jspi.mjs；谁挂了看得清是哪一层）：
#   ① 主模块 helper：JS 调 `Module._main_wait(ms)` —— 它内部去等挂起 import。
#      这就是将来 `pause()` 的形态：**外层导出必须被 `WebAssembly.promising()` 包住**
#      （`-sJSPI_EXPORTS` 干的就是这件事）；没包住的普通导出**不能**挂起。
#   ② 完整链：JS 调 `Module._run_side("side.wasm", ms)` —— 主模块 **dlopen** 它、
#      dlsym 取指针、C 里直接调用，而它又回调主模块的 helper
#      ⇒ 逐字复刻 `.oct → 主模块 → JS`（中途任何一环不支持挂起都会当场炸）。
#
# 判据：墙上时间 ≥ 请求毫秒数 **且** 等待期间 JS 的 tick 计数增加（busy-loop 不会增加）。
#
# 用法（容器内）：sh probe-jspi.sh [输出目录]
set -e

OUT="${1:-/src/libwork/jspi}"
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SRC/main.c" ] || SRC=/src/probe-jspi     # 容器里单独拷过来时的落点
mkdir -p "$OUT"
cp -a "$SRC"/main.c "$SRC"/side.c "$SRC"/jslib.js "$SRC"/run.html "$OUT/"

cd "$OUT"

# 公共旗标：**`-fwasm-exceptions` 与主链口径一致**（本项目的整棵树都是它，见 CLIBS.md「批次 D」）
COMMON="-O2 -fwasm-exceptions"
JSPI="-sJSPI -sJSPI_IMPORTS=browser_wait_ms"
# ⚠️ `-sJSPI_EXPORTS` 写**不带下划线**的名字（emscripten 自己加 `_`）；写 `_main_wait` 会静默不生效。
# ⚠️⚠️ **每一个"可能间接挂起"的 JS 入口都要列进来**（实测踩到、而且报错文本很有信息量）：
#     只列 `main_wait` 时，从 `run_side` 进入的那条链会抛
#        SuspendError: trying to suspend without WebAssembly.promising
#     —— 因为 V8 要求**挂起点所在的整条入口**都是 promising 的。这正是将来接 `pause()`
#     时要记的一条：**JS 侧调的必须是 `JSPI_EXPORTS` 里的那个入口**。
JSPI_EXPORTS="-sJSPI_EXPORTS=main_wait,run_side"
MAINMOD="-sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0"

echo "== P0/P1：主模块（JSPI + wasm EH + MAIN_MODULE=2）"
# 同一份产物同时给 P0/P1 用：`main_wait` 既是 JSPI 导出（P0 从 JS 直接调），
# 也可以被 run_side 在 C 里调（P1/P2）。
# ⚠️ 注释**不能插在续行中间**（`\\` 续行的下一行仍然是同一条命令 —— 把 `#` 注释塞进去
#    会让 emcc 收到一堆垃圾参数，报 `no input files`。踩过）。
# ⚠️ `FS` 必须**显式导出**：宿主脚本要把 `side.wasm` 写进 MEMFS 才能 dlopen；
#    不写它时 `Module.FS` 是 `undefined`（第一版就卡在这里）。
emcc $COMMON $JSPI $JSPI_EXPORTS $MAINMOD \
  -sEXPORTED_FUNCTIONS=_main_wait,_run_side \
  -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap \
  main.c --js-library jslib.js -o main.js 2>&1 | tail -5
echo "   main.js=$(stat -c%s main.js 2>/dev/null) main.wasm=$(stat -c%s main.wasm 2>/dev/null)"

echo "== P2：side module（-fPIC + SIDE_MODULE=2 + 同一套异常模式）"
# ⚠️ **必须显式导出符号**：side module 不写 `-sEXPORTED_FUNCTIONS=_side_wait` 时，
#    `-O2` 会把没人引用的 `side_wait` 直接 DCE 掉 ⇒ 产物只剩 64 字节的 dylink 壳，
#    `dlsym("side_wait")` 当然找不到（第一版实测就是 64 字节，`strings` 里连名字都没有）。
#    这跟本仓 `.oct` 的既有经验一致：**side module 的符号面要自己声明**（main.cc 的
#    keep-list/EXPORT_IF_DEFINED 就是同一类事）。
emcc $COMMON -fPIC -sSIDE_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sEXPORTED_FUNCTIONS=_side_wait -Wl,--export=side_wait \
  side.c -o side.wasm 2>&1 | tail -5
echo "   side.wasm=$(stat -c%s side.wasm 2>/dev/null) 导出：$(strings -a side.wasm | grep -c side_wait) 处出现 side_wait"

echo "== 产物就绪：$OUT"
ls -l "$OUT"
