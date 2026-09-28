#!/bin/sh
# Octave-Full-Wasm — **wasm64 基线侦察**（需求书 `build/113/PLAN-wasm64.md` §1 的可跑版）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 它把"接手者必须先知道的那几条"一次跑完，省得他读一整页命令、也省得他重跑我跑过的实验：
#   ① 三个链接实验（平凡 / 线程 / side module + 主模块）—— 全部应 rc=0
#   ② 两个运行时对照（memory64 平凡 + memory64 dlopen）—— 在**宿主** node 上跑
#      （容器里的 node 是 22，装不进 memory64 模块；这不是缺陷，是引擎版本事实）
#
# 用法：bash build/113/probe-wasm64-baseline.sh
# 判据：结尾 `=== 基线 OK（N/N）===` ⇒ 起点正常，可以按需求书 §2 开工；
#       否则 ⇒ 环境变了，按需求书 §0 写否证并停（别在坏基线上做 Q2/Q3）。
set -u
C="${C:-o113}"
W=/tmp/w64

say() { echo "$*"; }
ok=0; bad=0
ck() { if [ "$2" = "0" ]; then echo "  ✅ $1"; ok=$((ok+1)); else echo "  ❌ $1（rc=$2）"; bad=$((bad+1)); fi; }

say "== 0) 容器 $C 要在跑"
sudo docker start "$C" >/dev/null 2>&1 || true
sudo docker exec "$C" true >/dev/null 2>&1 || { echo "FATAL: 容器 $C 起不来"; exit 2; }
echo "  ✅ 容器在"

say "== 1) 三个链接实验（容器内）"
# 只跑 1a，并只回传它的 rc；1b/1c/1d 由下面那个循环逐个判 —— 这样每条都有独立的 ✅/❌，
# 而不是"看一串 rc=0 猜哪条是哪条"。
sudo docker exec "$C" sh -c '
  set -u; mkdir -p '"$W"' && cd '"$W"'
  printf "int main(){return 0;}\n" > a.c
  printf "int f(){return 42;}\n"   > s.c
  emcc -sMEMORY64=1 -O2 a.c -o a.js
'
ck "链接实验 1a（平凡 MEMORY64=1）" "$?"
for spec in "1b:-pthread -sSHARED_MEMORY=1:a.c:p.js" "1c:-sSIDE_MODULE=1:s.c:s.wasm" "1d:-sMAIN_MODULE=2:a.c:m.js"; do
  tag=${spec%%:*}; rest=${spec#*:}; fl=${rest%%:*}; rest=${rest#*:}; src=${rest%%:*}; out=${rest##*:}
  sudo docker exec "$C" sh -c "cd $W && emcc -sMEMORY64=1 $fl -O2 $src -o $out >/dev/null 2>&1"
  ck "链接实验 $tag" "$?"
done

say "== 2) 运行时**冒烟**（宿主 node）—— ⚠️ 这不是判据：oracle 是 chromium"
# 为什么仍值得跑这一节：它是秒级的廉价冒烟，能立刻回答"产物是不是根本装不进去"。
# 为什么它不是判据：目标环境是浏览器；而 node 只是手上顺手的运行器。
#   · 本机系统 node = /usr/bin/node（v26 系）→ 跑得动 memory64
#   · 容器里唯一的 node 是 **emsdk 自带的** /emsdk/node/22.16.0_64bit/bin/node（v22）
#     它装不进 memory64 模块（invalid table elements limits flags）——
#     这**不影响任何验收**，只是意味着"想冒烟得用宿主那个 node"。
NODEV=$(node --version 2>/dev/null || echo none)
NODEPATH=$(command -v node 2>/dev/null || echo "找不到 node")
echo "  宿主 node：$NODEV（$NODEPATH）"
case "$NODEV" in
  v1[0-9]*|v2[0-2]*|none) echo "  ⚠️ 宿主 node 是 $NODEV（memory64 冒烟需要 ≥ v23 一类的引擎）⇒ 本节结果只作记录，不构成结论";;
esac

# dlopen 的 main 与 side：用相对路径（emscripten 的 FS 相对进程 CWD 解析绝对路径会踩坑 —— 实测）
sudo docker exec "$C" sh -c 'cat > '"$W"'/main2.c <<"EOF"
#include <stdio.h>
#include <dlfcn.h>
#ifndef SIDE
#define SIDE "s.wasm"
#endif
int main(){ void*h=dlopen(SIDE,RTLD_NOW);
  if(!h){printf("dlopen FAIL: %s\n",dlerror());return 1;}
  int(*f)(void)=(int(*)(void))dlsym(h,"f");
  if(!f){printf("dlsym FAIL: %s\n",dlerror());return 2;}
  printf("dlopen OK, f()=%d\n",f()); return 0; }
EOF
cd '"$W"' && emcc -sMEMORY64=1 -sMAIN_MODULE=2 -O2 -DSIDE=\"s64.wasm\" main2.c -o d64.js >/dev/null 2>&1 &&
emcc -sMEMORY64=1 -sSIDE_MODULE=1 -O2 s.c -o s64.wasm >/dev/null 2>&1 &&
emcc -sMAIN_MODULE=2 -O2 -DSIDE=\"s32.wasm\" main2.c -o d32.js >/dev/null 2>&1 &&
emcc -sSIDE_MODULE=1 -O2 s.c -o s32.wasm >/dev/null 2>&1'
ck "dlopen 夹具链接（memory64 + wasm32 两版）" "$?"

H=$(mktemp -d)
for f in a.js a.wasm d64.js d64.wasm s64.wasm d32.js d32.wasm s32.wasm; do
  sudo docker cp "$C:$W/$f" "$H/$f" >/dev/null 2>&1
done
( cd "$H" && node a.js >/dev/null 2>&1 ); ck "memory64 平凡模块在宿主 node 上跑" "$?"
o64=$( cd "$H" && node d64.js 2>&1 ); r64=$?
o32=$( cd "$H" && node d32.js 2>&1 ); r32=$?
ck "memory64 + dlopen（期望 'dlopen OK, f()=42'）" "$r64"; echo "      \$ $o64"
ck "wasm32  + dlopen（对照）" "$r32";                      echo "      \$ $o32"
rm -rf "$H"

say ""
if [ "$bad" = "0" ]; then
  echo "=== 基线 OK（$((ok+bad))/$((ok+bad))）===  ⇒ 起点正常，按 PLAN-wasm64.md §3 开工（Q1 浏览器）"
  echo "    注 1：这只是「最小情形」，**不构成** .oct 在 memory64 下可用的证据（那是 Q2 的事）。"
  echo "    注 2：目标形态是 memory64 **+ 多线程**、并保留**单线程兼容回退** ⇒ Q2/Q3 要**两种配置各跑一遍**。"
  exit 0
fi
echo "=== 基线有问题：$ok 过 / $bad 败 ==="
echo "    环境与需求书 §1 记录的不一致 ⇒ 按 §0 写否证并停，别在坏基线上做 Q2/Q3。"
exit 1
