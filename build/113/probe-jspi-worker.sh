#!/bin/sh
# Octave-Full-Wasm — Q4+E4 探针：JSPI × DedicatedWorker × dlopen × 两种 FS 来源
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 唯一变量相对 probe-jspi-b.sh：**宿主换成 DedicatedWorker**（worker.js + run.html）。
# 旗标组与 B 探针同族（wasm EH + MAIN_MODULE=2，**没有** -sJSPI / -sJSPI_EXPORTS / -sJSPI_IMPORTS）。
# E4 增量：side module 编两份用途 ——
#   · worker 运行时 fetch → FS.writeFile 写成 /side_rt.wasm（产品资产装载形态）
#   · --preload-file 烘进 main.data 成为 /side_pre.wasm（产品 octave.data 形态）
# ⚠️ 实测（2026-09-25）：`-sENVIRONMENT=worker` **单独指定会把开机打坏** ——
#    initRuntime → wasm 起函数 → `_environ_get` 抛
#    `RangeError: Maximum call stack size exceeded`（页面里同样复现 ⇒ 与 worker 无关）。
#    默认环境（web,worker,node）下同源代码正常。所以这里**不加** ENVIRONMENT 旗标。
# 用法（容器内）：sh probe-jspi-worker.sh [输出目录]
set -e
OUT="${1:-/src/libwork/jspi-worker}"
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SRC/main.c" ] || SRC=/src/probe-jspi-worker
mkdir -p "$OUT"
cp -a "$SRC"/main.c "$SRC"/side.c "$SRC"/jslib.js "$SRC"/worker.js "$SRC"/run.html "$SRC"/run-page.html "$OUT/"
cd "$OUT"

COMMON="-O2 -fwasm-exceptions"
MAINMOD="-sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0"

echo "== E4：side module（side_add + side_chain；side_chain 回调主模块的 worker_wait）"
# ⚠️ 两个坑（2026-09-26 实测）：① `-Wl,--export=a,b` 逗号列表**不行**，必须每个符号一个 flag；
#    ② `set -e` 管不住管道 ⇒ emcc 失败会被 `| tail` 吞掉 ⇒ 下面必须补"产物存在"硬检查。
emcc $COMMON -fPIC -sSIDE_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sEXPORTED_FUNCTIONS=_side_add,_side_chain -Wl,--export=side_add -Wl,--export=side_chain \
  side.c -o side.wasm 2>&1 | tail -3
[ -s side.wasm ] || { echo "FATAL: side.wasm 没编出来" >&2; exit 3; }
echo "   side.wasm=$(stat -c%s side.wasm)"

echo "== Q4+E4：主模块（**无 -sJSPI**；--preload-file 烘一份 side 进 .data）"
emcc $COMMON $MAINMOD \
  -sEXPORTED_FUNCTIONS=_worker_wait,_worker_ping,_worker_dlopen_rt,_worker_dlopen_pre \
  -sEXPORTED_RUNTIME_METHODS=FS \
  --preload-file side.wasm@/side_pre.wasm \
  main.c --js-library jslib.js -o main.js 2>&1 | tail -5
echo "   main.js=$(stat -c%s main.js) main.wasm=$(stat -c%s main.wasm) main.data=$(stat -c%s main.data 2>/dev/null || echo -)"
echo "   胶水里 Suspending 出现次数（应为 0 —— 包装在 worker.js 里）：$(grep -c Suspending main.js || true)"
echo "   .data 里应含 side_pre：$(grep -c side_pre main.data 2>/dev/null || true)（>0 即预载名单里有它）"
echo "== 产物就绪：$OUT"
