#!/usr/bin/env bash
#
# P5 第一步：让 Mesa 24.0.9 在 wasm 上**能配置、能构建**所需的平台补丁（两处）
#
# ⚠️ 两个补丁都要打 —— 早期版本在补丁 1 后面写了 `exit 0`，导致补丁 2 永远不生效
#    （实测踩过：detect_os.h 一直没被改，os_time.c 一直报 "Unsupported OS"）。
#
# ── 补丁 1：OSMesa 目标 shared → static ──────────────────────────────────────
# 上游 `src/gallium/targets/osmesa/meson.build` 把 OSMesa 声明成 `shared_library`，
# 而 wasm-ld 不支持 `-shared`（main module 之外）。meson 自己会在这里抛：
#     ERROR: ld.wasm does not support shared libraries.
# （出处：meson 的 `EmscriptenDynamicLinker.get_soname_args()`，只要出现 shared 目标就抛。）
# `-Ddefault_library=static` **压不住它**（那个 target 是硬写的），只能改源码。
# 改法：→ `static_library(`，并去掉只有 shared 才认的参数
#   （gnu_symbol_visibility / vs_module_defs / soversion / version / darwin_versions）。
#
# ── 补丁 2：`detect_os.h` 认 emscripten ──────────────────────────────────────
# 现象：`src/util/os_time.c` 报 `error: Unsupported OS`、
#       `src/util/os_misc.c` 报 `unexpected platform in os_sysinfo.c`。
# 原因：`src/util/detect_os.h` 是按**编译器预定义宏**判断平台的 ——
#   `#if defined(__linux__) → DETECT_OS_LINUX/DETECT_OS_UNIX`，而 **emcc 不定义 `__linux__`**。
#   （改 meson 的 host_machine.system 没用：那个头根本不看 meson。）
# 修法：加一个 emscripten 分支。emscripten 给的是 linux 式 POSIX
#   （unistd.h / sys/time.h / sched.h / errno.h 都在），走 DETECT_OS_UNIX 是对的。
#
# 幂等：两处都已是目标状态就跳过。用法（容器内）：
#   bash patch-mesa-osmesa-static.sh [mesa 源码目录]        默认 /src/libwork/mesa-24.0.9
set -euo pipefail

SRC="${1:-/src/libwork/mesa-24.0.9}"
F="$SRC/src/gallium/targets/osmesa/meson.build"
G="$SRC/src/util/detect_os.h"

[ -f "$F" ] || { echo "FATAL: 找不到 $F" >&2; exit 2; }
[ -f "$G" ] || { echo "FATAL: 找不到 $G" >&2; exit 2; }

# ── 补丁 1 ──────────────────────────────────────────────────────────────────
if grep -q "^libosmesa = static_library(" "$F"; then
  echo "补丁 1：已是 static_library，跳过（幂等）"
else
  python3 - "$F" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = """libosmesa = shared_library(
  osmesa_lib_name,
  'target.c',
  gnu_symbol_visibility : 'hidden',
  link_args : [ld_args_gc_sections, osmesa_link_args],
  vs_module_defs : osmesa_def,
  include_directories : [
    inc_include, inc_src, inc_gallium, inc_gallium_aux, inc_gallium_winsys,
    inc_gallium_drivers,
  ],
  link_depends : osmesa_link_deps,
  link_whole : [libosmesa_st, libglapi_static],
  link_with : [
    libmesa, libgallium, libws_null, osmesa_link_with,
  ],
  dependencies : [
    dep_ws2_32, dep_selinux, dep_thread, dep_clock, dep_unwind, driver_swrast
  ],
  name_prefix : host_machine.system() == 'windows' ? '' : [],  # otherwise mingw will create libosmesa.dll
  soversion : host_machine.system() == 'windows' ? '' : '8',
  version : '8.0.0',
  darwin_versions : '9.0.0',
  install : true,
)"""
new = """# ── wasm 平台补丁（本仓，见 build/113/patch-mesa-osmesa-static.sh）──────────
# 上游这里是 shared_library，而 wasm-ld 不支持 -shared：
#     ERROR: ld.wasm does not support shared libraries.
# 改成 static_library，并去掉只有 shared 才接受的参数。
libosmesa = static_library(
  osmesa_lib_name,
  'target.c',
  link_args : [ld_args_gc_sections, osmesa_link_args],
  include_directories : [
    inc_include, inc_src, inc_gallium, inc_gallium_aux, inc_gallium_winsys,
    inc_gallium_drivers,
  ],
  link_depends : osmesa_link_deps,
  link_whole : [libosmesa_st, libglapi_static],
  link_with : [
    libmesa, libgallium, libws_null, osmesa_link_with,
  ],
  dependencies : [
    dep_ws2_32, dep_selinux, dep_thread, dep_clock, dep_unwind, driver_swrast
  ],
  install : true,
)"""
assert old in s, "上游那段与预期不一致（换 Mesa 版本时要重看）"
open(p, 'w').write(s.replace(old, new, 1))
print("  OSMesa: shared_library → static_library")
PY
fi
grep -q "^libosmesa = static_library(" "$F" && echo "✅ 补丁 1 生效：$F"

# ── 补丁 2 ──────────────────────────────────────────────────────────────────
if grep -q "__EMSCRIPTEN__" "$G"; then
  echo "补丁 2：detect_os.h 已有 emscripten 分支，跳过（幂等）"
else
  python3 - "$G" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = """#if defined(__linux__)
#define DETECT_OS_LINUX 1
#define DETECT_OS_UNIX 1
#endif
"""
add = anchor + """
/*
 * Emscripten（本仓补丁，见 build/113/patch-mesa-osmesa-static.sh）：
 * emcc **不定义 __linux__**，所以这里显式认它 —— 否则 os_time.c / os_misc.c 会走到
 * `#error Unsupported OS`。emscripten 提供的是 linux 式 POSIX。
 */
#if defined(__EMSCRIPTEN__)
#define DETECT_OS_LINUX 1
#define DETECT_OS_UNIX 1
#endif
"""
assert anchor in s, "detect_os.h 里找不到 __linux__ 那段（换 Mesa 版本时要重看）"
open(p, 'w').write(s.replace(anchor, add, 1))
print("  detect_os.h: 加 emscripten 分支")
PY
fi
grep -q "__EMSCRIPTEN__" "$G" && echo "✅ 补丁 2 生效：$G"

echo
echo "打完两处补丁后重新配置 + 构建（示例）："
echo "  PKG_CONFIG_PATH=/src/deps/zlibbz2/lib/pkgconfig meson setup <builddir> \\"
echo "    --cross-file=build/113/emscripten-cross.ini --wrap-mode=nofallback \\"
echo "    -Ddefault_library=static -Dshared-glapi=disabled -Dosmesa=true \\"
echo "    -Dgallium-drivers=swrast -Dllvm=disabled -Dplatforms= -Dopengl=true \\"
echo "    -Dglx=disabled -Degl=disabled -Dgbm=disabled -Dvulkan-drivers= -Dbuild-tests=false"
