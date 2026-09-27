#!/usr/bin/env bash
#
# 在 emscripten 下跳过 AX_PTHREAD，但**保留 pthread.h 的检测**
#
# 为什么这么做（这一步是本轮的关键认识，出处见 build/113/GATE3-QUESTION.md）：
#   我们原先把「不要线程」实现成了 `ac_cv_header_pthread_h=no`，即「告诉 gnulib
#   本机没有 pthread.h」。但 gnulib 的反应是**自己生成 libgnu/pthread.h**，
#   于是与 Emscripten sysroot 的 pthread.h 撞车，make 死在
#     ./pthread.h:718:13: error: typedef redefinition with different types
#
#   其实这两件事应该解耦：
#     - 「有没有 pthread.h」      → Emscripten 有，就该是 yes（gnulib 于是不造替代头）
#     - 「要不要 pthread 线程模型」→ 我们不要，得让 AX_PTHREAD 在 emscripten 下不生效
#
# 为什么必须改到 configure**生成物**上（而不是仅改 configure.ac）：
#   11.3.0 的 release tarball 里 `configure` 是**预生成**的，只改 configure.ac
#   再直接 ./configure 不会生效（要 autoreconf 重新生成）。
#   本脚本走「直接 patch 生成好的 configure」这条；上游 recipe 若要更正规，
#   应改成 configure.ac + autoreconf（两条路都把同一处逻辑放进去）。
#
# 为什么 `--disable-threads` 没用：
#   Octave 的 configure.ac 是**无条件** `AX_PTHREAD` 的，之后把 PTHREAD_CFLAGS
#   拼进 CFLAGS/CXXFLAGS（本文件里能看到 `BUILD_CFLAGS="${CFLAGS}"`），
#   所以 -pthread 会顺着 CFLAGS 进到 BUILD_CFLAGS 与最终链接。
#   而 AX_PTHREAD 没有可用的 cache 变量（`ax_pthread_ok` 是宏内部 shell 变量，
#   不是 ac_cv_*），压不住。
#
# 行为：在 AX_PTHREAD 展开块的「ACTION-IF-FOUND 判定」之前插入一段，
#   使 emscripten 目标下：
#     ax_pthread_ok=no          → 不定义 HAVE_PTHREAD
#     PTHREAD_CFLAGS= / LIBS=   → 后面 Octave 消费它们时拼进去的是空串
#   于是全树不带 -pthread → wasm 内存不再 shared → 免 COOP/COEP。
#
# 用法：bash patch-ax-pthread.sh <octave 源码目录>
#
set -euo pipefail

# ⚠️ `--revert` 必须在**算 CFG 之前**分派：否则 SRC 会变成字符串 "--revert"，
#    于是 CFG="--revert/configure" ⇒ 报"找不到 --revert/configure"（实测踩到）。
#    参数形态：`patch-ax-pthread.sh [SRC]` 或 `patch-ax-pthread.sh --revert [SRC]`。
REVERT=0
if [ "${1:-}" = "--revert" ]; then
  REVERT=1
  SRC="${2:-/src/work/octave-11.3.0}"
else
  SRC="${1:-/src/work/octave-11.3.0}"
fi
CFG="$SRC/configure"
[ -f "$CFG" ] || { echo "FATAL: 找不到 $CFG" >&2; exit 2; }

MARK="Octave-Full-Wasm: emscripten 下跳过 AX_PTHREAD"

# ── --revert：撤掉本补丁（B6 线程档必须做的第一步，2026-09-27 加）──────────────────
# 为什么补丁工具必须**可逆**：闸门③（"不引入 COI/SAB 需求"）就是靠这段插入实现的；
# 线程档要的恰好相反（让 AX_PTHREAD 正常生效 ⇒ PTHREAD_CFLAGS=-pthread 流进 CFLAGS）
# ⇒ 不撤掉它，`--enable-threads` 也是白配（configure 里 2 处覆盖点会把 PTHREAD_CFLAGS
# 清空，全树照旧不带 -pthread、wasm 内存照旧不是 shared）。
# 删除是**按标记精确删**那 12 行（不是拿备份覆盖 —— 树里还有别的补丁必须留着：
# `-fexceptions`→`-fwasm-exceptions`、`postdeps_CXX` 置空）。逻辑在
# `unpatch-ax-pthread.py` 里（带 --selftest：该删的删掉 / 形状不对必须拒 / 幂等）。
if [ "$REVERT" = "1" ]; then
  python3 "$(dirname "$0")/unpatch-ax-pthread.py" "$CFG" || exit $?
  # 撤销后复核。⚠️ **别用 `ax_pthread_ok=no` 当判据**（我第一版就错了）：那两处是
  # AX_PTHREAD 宏**自己的初始化**（宏体开头先置 no 再逐项试），原始 tarball 里也有。
  # 真正能证伪的判据是**差分**：撤销后与原始 tarball 的差异里，不许再有任何 pthread 字样。
  grep -qF "$MARK" "$CFG" && { echo "FATAL: 撤销后仍能找到标记" >&2; exit 1; }
  # 差分复核：从原始 tarball 里现取一份 configure 当基准（**不依赖我手工准备的 /tmp**）。
  TARBALL="${OCTAVE_TARBALL:-/src/probe11/octave-11.3.0.tar.xz}"
  PRISTINE=""
  if [ -f "$TARBALL" ]; then
    PTMP="$(mktemp -d)"
    if tar -xJf "$TARBALL" -C "$PTMP" octave-11.3.0/configure 2>/dev/null; then
      PRISTINE="$PTMP/octave-11.3.0/configure"
    fi
  fi
  if [ -n "$PRISTINE" ] && [ -f "$PRISTINE" ]; then
    n=$(diff "$PRISTINE" "$CFG" | grep -ci pthread || true)
    rm -rf "$PTMP"
    [ "$n" = "0" ] || { echo "FATAL: 与原始 tarball 仍有 $n 行 pthread 差异" >&2; exit 1; }
    echo "  ✅ 撤销完成：标记 0 处；与原始 tarball（$TARBALL）的差异里 **0 行**与 pthread 有关" \
         "⇒ AX_PTHREAD 会正常给出 -pthread"
  else
    echo "  ✅ 撤销完成：标记 0 处"
    echo "  ⚠️ **本次没做差分复核**（找不到原始 tarball：$TARBALL）—— 设 OCTAVE_TARBALL 指过去可补验"
  fi
  exit 0
fi

if grep -qF "$MARK" "$CFG"; then
  echo "  已应用（跳过）"
  exit 0
fi

# 锚点：AX_PTHREAD 展开块里、ACTION-IF-FOUND 判定之前的这一行。
# 注意 **AX_PTHREAD 在 configure 里展开了两遍**（实测：该锚点出现 2 次，
# 且 `PTHREAD_CFLAGS=`/`ax_pthread_ok=yes` 也各有两组）——所以要对每一处都压，
# 否则后一次展开会把前一次清掉的 PTHREAD_CFLAGS 再填回来。
ANCHOR='test -n "$PTHREAD_CXX" || PTHREAD_CXX="$CXX"'
if ! grep -qF -- "$ANCHOR" "$CFG"; then
  echo "FATAL: configure 里找不到锚点：$ANCHOR" >&2
  echo "       版本可能不是 11.3.0，或该处已改动 → 不要猜，先人工核对" >&2
  exit 1
fi
n_anchor=$(grep -cF -- "$ANCHOR" "$CFG")
echo "  锚点命中 $n_anchor 处（AX_PTHREAD 展开次数）"

python3 - "$CFG" "$ANCHOR" "$MARK" <<'PY'
import sys, io
path, anchor, mark = sys.argv[1], sys.argv[2], sys.argv[3]
src = io.open(path, encoding='utf-8', errors='surrogateescape').read()
lines = src.split('\n')
out = []
inserted = 0
ins = [
    '',
    '# ' + mark + '（Octave-Full-Wasm 平台补丁）',
    '# 保留 pthread.h 检测（HAVE_PTHREAD_H=1，gnulib 于是不生成替代头），',
    '# 但清空 AX_PTHREAD 的结论，使 PTHREAD_CFLAGS/LIBS 为空。',
    '# 这样全树不带 -pthread，wasm 内存不会是 shared，浏览器侧免 COOP/COEP。',
    'case $host in',
    '  *-emscripten*)',
    '    ax_pthread_ok=no',
    '    PTHREAD_CFLAGS=""',
    '    PTHREAD_LIBS=""',
    '    ;;',
    'esac',
]
for ln in lines:
    if ln.strip() == anchor:
        out.extend(ins)
        inserted += 1
    out.append(ln)
if inserted == 0:
    sys.stderr.write('FATAL: 插入点未命中\n')
    sys.exit(1)
io.open(path, 'w', encoding='utf-8', errors='surrogateescape').write('\n'.join(out))
print('  已插入 %d 处（每处 %d 行）' % (inserted, len(ins)))
PY

# 立即复核。真正有意义的不变量不是「逐对比较」——实测 AX_PTHREAD 展开两遍，
# 每遍含 C/CXX 两处消费，所以是 2 个覆盖点对 4 个消费点。
# 该查的是：**最后一次覆盖之后，不得再有把 PTHREAD_CFLAGS/LIBS 赋成非空的语句**，
# 否则后一次展开会把清掉的值又填回来。
mapfile -t ins_lines < <(grep -nF "$MARK" "$CFG" | cut -d: -f1)
[ "${#ins_lines[@]}" -eq "$n_anchor" ] || {
  echo "FATAL: 覆盖点 ${#ins_lines[@]} 处，与 AX_PTHREAD 展开次数 $n_anchor 不符，需人工看" >&2; exit 1; }

last_marker="${ins_lines[$((${#ins_lines[@]}-1))]}"
# 非空赋值：PTHREAD_CFLAGS/PTHREAD_LIBS 后面跟的不是空串
bad=$(awk -v start="$last_marker" '
  NR > start && /^[[:space:]]*PTHREAD_(CFLAGS|LIBS)=/ && !/PTHREAD_(CFLAGS|LIBS)=""/ { print NR": "$0 }
' "$CFG")
if [ -n "$bad" ]; then
  echo "FATAL: 最后一次覆盖（第 $last_marker 行）之后仍有非空的 PTHREAD_* 赋值：" >&2
  echo "$bad" | head -5 >&2
  exit 1
fi
echo "  ✅ ${#ins_lines[@]} 处覆盖已生效（第 ${ins_lines[*]} 行），且其后无非空 PTHREAD_* 赋值"
