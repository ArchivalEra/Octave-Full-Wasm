# NOTES · 图形线 WebGL（gl4es 翻译层）—— **2026-09-23 立项；步骤① 已通过（实测）**

> 分支 **`graphics-webgl`**（从 `graphics-osmesa-p5` 切出，见文末"分支拓扑"）。
> 这条线要解决的是 OSMesa 那条线的**性能/移动端**问题，**不是**它的正确性问题。
> 动手前先读 `build/113/NOTES-p5-osmesa.md`（尤其 §8）与 `GRAPHICS-BRANCH.md`。

## 零、一句话现状（2026-09-23）

| 步骤 | 状态 | 证据 |
|---|---|---|
| ① **gl4es + WebGL2 能把立即模式跑对**（本线唯一的真未知） | ✅ **实测通过** | `build/113/gl4es-smoke.c/.sh` + `test/browser/probe-gl4es-smoke.mjs`：真 Chromium 里 **16 PASS / 0 FAIL**；`GL_VERSION=2.1 gl4es wrapper 1.1.7`；立即模式绿三角**中心 (0,255,0)**、两角清屏红 **(255,0,0)**、绿像素 512/4096=12.5%，`glGetError` 全程 0 |
| ② 库：gl4es 编 wasm + **符号覆盖度核过** | ✅ **实测** | `libGL.a` **4.74MB**（OSMesa 那份 20MB）；Octave `gl-render.o`+`opengl_functions` 需要的 **76 个 GL 符号，gl4es 覆盖 76/76，缺 0** |
| ③ toolkit `webgl_toolkit.cc`（真 WebGL2 上下文 + gl4es） | ✅ **实测** | 8768 上 `graphics_toolkit('webgl')` 装载成功；`accept-p5-graphics.mjs`（同一套件，按站点自动选后端） |
| ④ 页面侧：隐藏 canvas + PNG 通道 | ✅ **实测** | toolkit 自己用 `EM_ASM` 建 `#octave-gl-canvas`（不依赖页面改 index.html）；页面 `<img>` 贴上真 PNG |
| ⑤ 逐图类型出图 | ✅ **实测** | **15/15 全部非空白**（plot/plot3/semilogy/loglog/stairs/stem/area/bar/pie/contour/errorbar/scatter/scatter3/mesh/surf），解码 PNG 数颜色 9–740 色 |
| ⑥ **plot 桥提速 3.5×**（`__pb_surface__` 改成按行发 series） | ✅ **实测** | 桥的 `surf(peaks(40))` **1686 → 480 ms**（§4.5.12）；两张图**人工看过**（surf 带状 / mesh 线框都对）|
| ⑦ `print` 的**核心**矢量路径 | ❌ **走不通**（不是本线的问题） | 要 gl2ps（**已补上**）+ **shell 管道**（本构建故意没有）+ (gs\|svgconvert)⇒ 桥的 SVG 仍是唯一矢量实现（§4.5.9–4.5.11）|
| ⑧ Android 模拟器实测 | ✅ 跑通，但**验不了 WebGL** | §4.5.8：站点在 Android WebView 里能起；模拟器 GL 被 Chromium blocklist |

**体积账（本线最重要的一条实测）**：`octave.wasm`

| 构建 | 字节 | 相对基线 |
|---|---|---|
| 基线（无 GL，8761） | ~34.3 MB | — |
| **OSMesa（软件光栅化）** | **45,580,621** | **+11.3 MB** |
| **WebGL（gl4es）** | **36,725,151** | **+2.4 MB** |
| WebGL + gl2ps（当前 8768） | **36,848,766** | +2.5 MB |

⇒ 换后端**省下约 8.9 MB raw**。这条直接回应"手机上体积吃不消"那个动因。

**为什么第①步值钱**：emscripten 自带的 `LEGACY_GL_EMULATION`（"让浏览器假装有固定管线"）
在这件事上是**实测失败**的 —— 外部团队 Edge-Tools 死在
`numVertices must be an integer` at `glEnd`（`build/113/vendor-edge-tools/MILESTONE-2.md`）。
本次实测说明**gl4es 那条路不一样**：它自己实现立即模式（顶点先缓冲、`glEnd` 时一次性提交），
在 WebGL2 上跑得**完全正确**。

## 零之二、本线立项时的回归基线（2026-09-23，全量 sweep 实测）

用来钉住"从此往后不许退化"的起点：

| 站点 | 结果 | 说明 |
|---|---|---|
| **8761**（`site/`，基线） | **32 套 / 784 PASS / 0 FAIL（全绿）** | `accept-p5-graphics` 因站点无真渲染器而**明确 SKIP**（0/0），所以是 32 套而不是 31 |
| **8763**（`siteP5`，OSMesa 图形版） | **32 套 / 838 PASS / 0 FAIL** | 首次 sweep 报 `accept-net` 1 项失败（`python3 -m http.server` 不支持 POST 的环境问题），**单独重跑 30/0 全绿** ⇒ 判定为 flaky，非回归 |

`8761` 的两条硬事实：`octave.wasm` 仍是 `bac48adb…`；`available_graphics_toolkits()` 里
**没有** `osmesa`（所以那套验收在它上面是 SKIP 而不是红）。


---

## 一、为什么另开一条线：把 OSMesa 的定位说准

**先纠正一个说法**（免得后面按错的前提做决策）：
"OSMesa 完全不能搁手机上用"**在 API 层面不成立** —— OSMesa 是 Mesa 的
**纯软件光栅化**（`softpipe`），它渲进一块内存，**不碰 GPU、不碰 EGL/WebGL**，
所以任何跑 wasm 的浏览器（含手机）它都**能**跑起来，没有"不兼容"这回事。

**真正的问题是两个，都是量的问题**：

1. **速度**：`softpipe` 是逐像素的 CPU 光栅化。桌面多核还能忍（静态图），
   手机 CPU + 单线程 wasm 就很吃力 —— 分辨率一上去（560×420 起步，retina ×2）
   就可能是秒级。
2. **体积/内存**：B 档把 OSMesa 链进主 wasm ⇒ `octave.wasm` +11.3MB raw
   （45,580,621 字节），手机上首包/内存都吃不消。
   （旁证：gl4es 的 `libGL.a` 只有 **4.74MB**，而 OSMesa 那份 `libGL.a` 是 **20MB** ——
   换后端本身就能把这块账压下来。）

⇒ **要 WebGL 的动因是"用 GPU + 别把 Mesa 整个链进来"，这个动因成立。**
上面第 1 条**还没在真机上量过**（本仓库没有手机测试环境），所以记为
"设计动因 + 待量"，不当既成事实（见第五节"待量"）。


---

## 二、为什么不能直接上 WebGL：Octave 渲染器要的东西 WebGL 没有

`opengl_renderer`（`gl-render.cc`）写的是**固定管线 + 立即模式**：
`glBegin/glVertex/glEnd`、矩阵栈、`glLight`、`glTexEnv`、`glPolygonStipple`…
而 **WebGL/GLES 根本没有固定管线**。

**这条路上已经有人撞过墙，而且结论是实测的**：外部团队 Edge-Tools
（`build/113/vendor-edge-tools/`，GPL-3.0-or-later）用 emscripten 的
**`LEGACY_GL_EMULATION`**（模拟固定管线）驱动 Octave 渲染器，死在

```
numVertices must be an integer   at glEnd
```

—— 立即模式的逐顶点步长在模拟层里对不齐。emscripten 自己的运行时横幅也写着
*"a collection of limited workarounds, do not expect it to work"*。
**所以"让浏览器假装有固定管线"这条路是死路，别再走一遍。**

### 两条真正可行的路

| 路 | 做法 | 判断 |
|---|---|---|
| **A. 用现成的 GL→GLES 翻译层（本线选的）** | 把 Octave 的 GL 1.x 调用交给一个**成熟的翻译库**，它翻译成 GLES2/WebGL2 的 shader 绘制 | ✅ **有现成实现且官方支持 Emscripten**（见第三节） |
| B. 把 `gl-render.cc` 重写到 GLES2/着色器 | 改 Octave 自己的渲染器 | ❌ 等于重写渲染器，是另一个项目；且以后每次升 Octave 都要重做 |

---

## 三、现成实现：**gl4es**（ptitSeb）—— 官方带 Emscripten 目标

**仓库**：`github.com/ptitSeb/gl4es`（★858，C，MIT/…见其 LICENSE）
**一句话**：OpenGL **1.5 / 2.1** → **GLES 2.0 / 1.1** 的翻译库，带完整的
固定管线模拟（立即模式是它实现的一部分，不是"变通"）。

### 3.1 官方 Emscripten 配方（`COMPILE.md`，抄的原文）

```
mkdir build; cd build;
emcmake cmake .. -DCMAKE_BUILD_TYPE=RelWithDebInfo -DNOX11=ON -DNOEGL=ON -DSTATICLIB=ON
make
```

用它的时候（`COMPILE.md` 原文）：

> Use `-s FULL_ES2=1 -I[gl4es]/include -lGL` when compiling your program for Emscripten.
> In your code, call `void initialize_gl4es()` as soon as possible after loading GL4ES,
> and before using any GL function.

### 3.2 ★ 关键设计：**符号被 mangling 成 `gl4es_gl*`**（解决了符号冲突）

`include/GL/gl.h:30`：

```c
#if defined(__EMSCRIPTEN__) || defined(__APPLE__)
#define USE_MGL_NAMESPACE    1
#define GL_GLEXT_PROTOTYPES  1
#define MANGLE(x)            gl4es_gl##x
#endif
#if defined(USE_MGL_NAMESPACE)
#include "gl_mangle.h"
#endif
```

即：**在 Emscripten 下 gl4es 导出的名字是 `gl4es_glBegin` / `gl4es_glViewport`…**，
而 `gl_mangle.h` 把客户端看到的 `glBegin` `#define` 成 `gl4es_glBegin`。
所以：

- gl4es 自己的 `libGL.a` 与 emscripten 提供的真 GLES2（`glViewport` 等）**不冲突**；
- **谁 include 了 gl4es 的 `<GL/gl.h>`，谁的 GL 调用就自动走 gl4es** ——
  包括 Octave 的 `gl-render.cc` / `oct-opengl.h`，**一行源码都不用改**。

gl4es 内部再通过 `emscripten_GetProcAddress()`（`src/gl/loader.c:213`
的 `#elif defined __EMSCRIPTEN__`）拿到真 GLES2 入口。

### 3.3 这条线的核心动作 = **把"GL 垫片"从 OSMesa 换成 gl4es**

现在（OSMesa/B 档）：`glshim/libGL.a` 就是 **`libOSMesa.a`**（软件光栅化），
`link-web.sh` 用绝对路径把它当 `-lGL` 链进主 wasm。

WebGL 线：**同样那个位置换成 gl4es 的静态 `libGL.a`**，并把 include 路径
指向 gl4es 的 `include/`（而不是 Mesa/glshim 的）。于是同一条
`opengl_renderer → m_glfcns.glXxx() → ::glXxx` 调用链，
落到 gl4es → GLES2 → **WebGL2（GPU）**。

### 3.4 实测：构建 / 体积 / **符号覆盖度**（2026-09-23）

**构建**（照 3.1 的官方配方，在 o113 容器里）：

```bash
cp -a /src/vendor/gl4es-master /src/libwork/gl4es-src     # ★ 必须可写副本，见坑 1
export PATH=/emsdk:/emsdk/upstream/emscripten:$PATH
mkdir -p /src/libwork/gl4es-build && cd /src/libwork/gl4es-build
emcmake cmake /src/libwork/gl4es-src -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DNOX11=ON -DNOEGL=ON -DSTATICLIB=ON
make -j24        # 全量编过，只有 warning
```

**体积**：`libGL.a` = **4,740,056 字节**（对比 OSMesa 那份 `glshim/libGL.a` = 20,112,808 字节）。

**★ 符号覆盖度**（这一步比"编过了"重要得多）：

```bash
# Octave 那边需要的完整清单 = opengl_functions 包装的那批 ::glXxx
llvm-nm /src/websrc/osmesa_toolkit.o | awk '$1=="U"{print $NF}' | grep -E '^(gl|glu)' | sort -u > need.txt   # 76 个
# gl4es 提供的（导出名带 gl4es_ 前缀，去掉后比对）
llvm-nm --defined-only libGL.a | awk '{print $NF}' | grep -E '^gl4es_' | sed 's/^gl4es_//' | sort -u > have.txt  # 1607 个
comm -23 need.txt have.txt      # ⇒ **空**：缺 0 个
```

**76/76 全覆盖**，而且覆盖的正是那几个"难"的：
`glBegin/glEnd`（立即模式）、`glNewList/glCallList/glGenLists/glDeleteLists`（显示列表）、
`glRenderMode/glSelectBuffer/glInitNames/glPushName/glPopName`（选择模式）、
`glBitmap/glDrawPixels/glRasterPos3d`（光栅操作）、`glLineStipple`、
`glClipPlane`、`glPushAttrib/glPopAttrib`、矩阵栈、光照、纹理、`glReadPixels`。

**GLU（剖分）**：gl4es **只带头文件**（`include/GL/glu.h` + `glu_mangle.h`），
**不带实现** ⇒ 我们继续用自己的 wasm GLU（`/src/libwork/glu-build`），
但要**改用它编译**：让 GLU 里的 `gl*` 调用也 mangle 成 `gl4es_gl*`
（include 路径指向 gl4es 的 `include/` 即可）。
不然 GLU 会去调**真 GLES2**，而 GLES2 没有固定管线 ⇒ 剖分出来的多边形画不出来。

### 3.5 步骤① 实测结果（`gl4es-smoke`，2026-09-23）

`build/113/gl4es-smoke.c/.sh` → `test/browser/probe-gl4es-smoke.mjs`（headless Chromium）：

```
GL_VERSION  = 2.1 gl4es wrapper 1.1.7
GL_RENDERER = GL4ES using an unknown renderer
[PASS] glGetString / glClear / glBegin-gVertex-gEnd / glReadPixels 之后 glGetError 全为 0
[PASS] 立即模式绿三角：中心 = 0 255 0 255      ← 真画出来了
[PASS] 左下角 = 255 0 0 255、右上角 = 255 0 0 255   ← 三角没铺满，位置对
[PASS] 绿像素 512 / 4096（12.5%）
=== 16 PASS / 0 FAIL ===
```

产物：`gl4es-smoke.wasm` **574,457 字节**（很小的 spike，不含 Octave）。
站点：`/mnt/hdd/octave-wasm-build/siteGL4ES`（8767）。

### 3.6 本线自己踩到的两个**构建坑**（都已解，别再踩）

**坑 1 ★ gl4es 的 CMake 把 `libGL.a` 写回「源码树」里**
⇒ 直接拿只读的 `/src/vendor/gl4es-master`（bind mount 是 `ro`）去建，会在
**最后一步**炸，前面 100% 的编译都白费：

```
[100%] Linking C static library /src/vendor/gl4es-master/lib/libGL.a
llvm-ar: error: /src/vendor/gl4es-master/lib/libGL.a: No such file or directory
```
**修法**：先拷一份可写副本（`cp -a /src/vendor/gl4es-master /src/libwork/gl4es-src`），
把 `-B` 指向副本，产物落在副本的 `lib/` 下。
（报错信息完全没提"只读"，只报 `llvm-ar` 找不到目录 —— 容易误判成工具链问题。）

**坑 2 ★ `-lGL` **不能**用 —— emcc 会把它改写进**它自带**的 GL 仿真库**
用 gl4es 的 `-L` + `-lGL` 链接时，报一堆：

```
wasm-ld: error: undefined symbol: gl4es_glBegin
wasm-ld: error: undefined symbol: gl4es_glVertex2f   ... （20+ 个）
```
原因是 `emcc` 对 `-lGL`/`-lEGL`/`-lGLESv2` 有**专门处理**，会解析到
`sysroot/lib/wasm32-emscripten/libGL-emu-*.a`，**我们那份 `libGL.a` 根本没被搜索**。
**修法**：把归档用**绝对路径**传进去（`emcc ... /path/to/libGL.a ...`），
别用 `-lGL`。

> 这两个坑与 `NOTES-p5-osmesa.md` §7.3 第 3 条（`-lGLU` 没解析到 `gluNewTess`，
> 改绝对路径才成）是**同一族**。本项目已经吃过两次 `-l` 的亏 ⇒ **凡是我们自己建的
> 归档，一律传绝对路径。**



### 3.7 已经排除的替代品（别再花时间）

| 方案 | 为什么不用 |
|---|---|
| emscripten `LEGACY_GL_EMULATION` | **实测死在 `numVertices must be an integer` at `glEnd`**（Edge-Tools，与我们无关的独立复现） |
| 重写 `gl-render.cc` 到 GLES2 | 是重写渲染器的项目，且随 Octave 升级要重做 |
| ANGLE / Regal | 没有"wasm + 固定管线"的可用路径；ANGLE 面的是 EGL/Vulkan 桌面后端 |
| Mesa 的 `virgl`/gallium "webgl" target | 不存在这样的 target（Mesa 在浏览器里只能走 OSMesa 软件路径，就是我们刚做完的那条） |

---

## 四、做法（**实现已完成，这里是实际落地的样子**）

### 4.1 完整复现命令（容器内，按顺序）

```bash
# ① gl4es 源码（只读的 /src/vendor 那份建不了，见 §3.6 坑 1）
cp -a /src/vendor/gl4es-master /src/libwork/gl4es-src
chmod -R u+w /src/libwork/gl4es-src
mkdir -p /src/libwork/gl4es-build && cd /src/libwork/gl4es-build
export PATH=/emsdk:/emsdk/upstream/emscripten:$PATH
emcmake cmake /src/libwork/gl4es-src -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DNOX11=ON -DNOEGL=ON -DSTATICLIB=ON && make -j24

# ② 给 gl4es 打两个补丁（见 §4.3 坑 4），然后**重编**
bash /src/bin/patch-gl4es.sh /src/libwork/gl4es-src
cd /src/libwork/gl4es-build && make -j24

# ③ GLU：用 gl4es 的头重编（gl 走 gl4es、glu 保持原名），必须带 SjLj（见 §4.3 坑 2）
bash /src/bin/build-glu-webgl.sh

# ④ 主链
cd /src/bin && PATH=/src/bin:$PATH M_SRC=/src/work/m-prerendered/m \
  GL_LIBS=1 GL_BACKEND=webgl P5_TOOLKIT=1 bash link-web.sh /src/websrc/out-webgl
```

### 4.2 toolkit 相对 `osmesa_toolkit.cc` 只改了"渲染目标"

`build/113/webgl_toolkit.cc` 与 OSMesa 那版**同一个骨架**，差异只有三处：

| | OSMesa | WebGL |
|---|---|---|
| 上下文 | `OSMesaCreateContextExt` + `OSMesaMakeCurrent`（渲进 `calloc` 的内存） | `emscripten_webgl_create_context("#octave-gl-canvas", attrs)` + `emscripten_webgl_make_context_current` |
| 初始化 | 无 | **`initialize_gl4es()`**，且必须在**任何 GL 调用之前**（gl4es 的 COMPILE.md 要求） |
| DOM | **不需要** canvas（所以那版能在 node 里跑） | **必须有** canvas —— 本 toolkit 用 `EM_ASM` **自己建**一个隐藏的 `#octave-gl-canvas`，不要求页面 index.html 加东西 |

`figure_pixsize` / 三件套 `set_viewport→draw→finish→get_pixels` / `write_png` / `publish_png` /
`print_figure` / `get_canvas_size` **一字不改照搬** —— 那些与后端无关（OSMesa 那轮验证过）。
页面侧因此也**一行没改**：给用户看的仍然是 `publish_png()` 落下的那张 PNG。

canvas 的 WebGL 属性（`ensure_context` 里）：`majorVersion=2`、`alpha=0`（读回纯 RGB，
不受合成影响）、`antialias=1`（画线好看）、`depth=1`（3D 要）、`preserveDrawingBuffer=1`
（不依赖"同一任务内读回"这个前提）。

### 4.3 本线在 ②③ 阶段踩到的**四个坑**（都已解，别再踩）

**坑 1 ★ `config.h` 不只是"要 include"，**位置**也是正确性**
`webgl_toolkit.cc` 第一版把 `#if defined (HAVE_CONFIG_H) #include "config.h"` 放在了
Octave 头**之后**（因为文件头写着"必须最先"，我却按 include 分组放错了），编出来是：

```
oct-conf-post-public.h:120:1: error: redefinition of 'octave_unused_parameter'
```
因为 `config.h` 自己也会 include `oct-conf-post-public.h`（`config.h:4442`），
而 `octave-config.h` 那一侧在 `OCTAVE_AUTOCONFIG_H_INCLUDED` 尚未定义时已经先吃过它一遍。
⇒ **放在所有 include 的最前面**（与 `gl-render.cc:26-28` 一致）。

**坑 2 ★ GLU 必须带 wasm-SjLj 重编**
`src/libtess/tess.c` 用 `setjmp/longjmp`。默认模式下 `longjmp` 落到 emscripten 的
**JS 库函数 `emscripten_longjmp`**，而主链是 PIC/动态链接，JS 库函数**不能**当
`R_WASM_TABLE_INDEX_SLEB` 的目标 ⇒ 链接期直接失败：

```
relocation R_WASM_TABLE_INDEX_SLEB cannot be used against symbol `emscripten_longjmp`; recompile with -fPIC
```
加 `-fwasm-exceptions -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh` 之后，
`longjmp` 降到主模块已导出的 `__wasm_longjmp`（真 wasm 函数）。
**与 OSMesa 线给 Mesa/GLU 重编 SjLj 是同一个坑、同一个修法**（`NOTES-p5-osmesa.md` §7.2 第 2 条）。

**坑 3 ★ `gl-render.cc` 直接引用的 GL 符号**是裸名，得手动转回 gl4es**
`gl-render.cc` 不是用 gl4es 的头编的，它**直接**引用的 GL/GLU 符号（不走 `opengl_functions` 虚表）
一共 **11 个**（量出来的，不是猜的）：

```bash
for a in libinterp.a liboctave.a libgnu.a; do llvm-nm "$a"; done \
  | awk '$1=="U"{print $NF}' | grep -E '^(gl|glu)[A-Z]' | sort -u
# → glGetIntegerv × 1 + glu* × 10
```
10 个 `glu*` 由我们的 GLU 提供（`build-glu-webgl.sh` 特意让它**保持原名**）。
剩下 `glGetIntegerv` 必须转回 gl4es —— 否则它会落到 emscripten 的**真 GLES2** 上，
而 GLES2 不认识固定管线枚举：
```
WebGL: INVALID_ENUM: getParameter: invalid parameter name
opengl_renderer: Error 'invalid enumerant' (1280) occurred drawing 'text' object
```
⇒ `build/113/gl4es-unmangled-shim.c`（**就一个函数**）。

**坑 4 ★ gl4es 的 getter 会把 WebGL 不认的枚举**原样转发**给 GLES2**
即使都走 gl4es，gl4es 对**不认识的枚举**也会 `default: gles_glGetXxx(pname, ...)` 直接转发。
Octave 要的枚举里有两个属于这类（**逐个核过，其余都不用**）：

| 枚举 | Octave 用在哪 | gl4es 的处理 | 补什么 |
|---|---|---|---|
| `GL_SAMPLE_BUFFERS` / `GL_SAMPLES` | `gl-render.cc:868` 判断有无多重采样 | `glGetIntegerv` 无 case → 转发 | 答 `0`（固定管线路径本就不维护多重采样）|
| `GL_LINE_SMOOTH` | `gl-render.cc:2167`（`draw_axes_grids`）| `glGetBooleanv` 是 wrap 层**纯转发** | 从 `glstate->enable.line_smooth` 如实回答 |
| `GL_MAX_LIGHTS` / `GL_ZOOM_X` / `GL_ZOOM_Y` | 同上文件 | **`gl4es_commonGet` 已经答了** ✅ | 不用动 |
| `GL_MAX_TEXTURE_SIZE` / `GL_VIEWPORT` | 同上 | GLES2 本来就有 ✅ | 不用动 |

⇒ `build/113/patch-gl4es.sh`（幂等 + 自检）。**注意**：patch 脚本里 `before`/`replace`
两种插入模式要显式区分 —— 第一版都写成 `before`，把同一个函数写了两份，
编出来是 `redefinition of 'gl4es_glGetBooleanv'`。

### 4.4 实测结果（2026-09-23，8768 = `/mnt/hdd/octave-wasm-build/siteWebGL`）

```
后端 = webgl（available = web,webgl）
=== 54 PASS / 0 FAIL ===          ← 与 OSMesa 站点跑的是**同一套件**
INVALID_ENUM 出现次数 = 0
逐图类型：15/15 全部非空白（色数 9–740）

# 8768 全量回归（sweep.sh，32 套）
合计：32 套 / 838 PASS / 0 FAIL
全绿
```
（对照：OSMesa 站点 8763 同样 32 套 / 838 项；8761 基线 32 套 / 784 项
—— 差的 54 项正是本套件在 8761 上 SKIP 掉的那些。）

`test/browser/accept-p5-graphics.mjs`（原 `accept-p5-osmesa.mjs`，**参数化成按站点自动选后端**）
覆盖：默认 toolkit 仍是 `web`、web 下镜像层关闭、切 webgl、`OctaveP5.demo()`、PNG 魔数 +
**解码数颜色**、`getframe` 真像素、镜像层建真对象、15 种图、切回 web 后镜像关闭、
`print -dsvg` 不回归、解释器还活着。
---

## 四点五、速度实测（2026-09-23）：渲染快了 3.4–9×，但**端到端看不出来**

**为什么测**：换 WebGL 后端的原始动因就是"OSMesa 用 CPU 软件光栅化，手机上慢"。
这条动因一直只是**假设**，没量过。本节把它量了 —— 用的是**本机桌面 Chromium + CDP 降频**，
不是真机，口径见 §4.5.4。

### 4.5.1 先确认"WebGL 跑在哪"（很关键，别拿软件数字当 GPU）

`test/browser/probe-gpu-backend.mjs`：

| Chromium 参数 | `UNMASKED_RENDERER_WEBGL` |
|---|---|
| 默认（headless） | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` —— **软件** |
| `--use-gl=angle --use-angle=gl` | **`ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4060/PCIe/SSE2, OpenGL ES 3.2)`** —— **真 GPU** |

⇒ 本机的 WebGL 能吃到真 GPU。**这条必须显式加参数**，否则默认是 SwiftShader，
量出来的"WebGL"其实是另一个软件光栅化器，白测。

### 4.5.2 渲染器本身：WebGL 明显更快

`test/browser/probe-gfx-bench.mjs`（用 `getframe` 计时：它必然走 toolkit 的 `render()`，
不像 `drawnow` 可能因"没脏"被跳过。单位 ms，越小越快）：

| 后端 | 2D @CPU×1 | 3D @CPU×1 | 2D @CPU×4 | 3D @CPU×4 |
|---|---|---|---|---|
| OSMesa（softpipe，纯 CPU） | 17 | **62** | 72 | **253** |
| WebGL → ANGLE → **真 GPU** | **5** | **7** | **18** | **26** |
| WebGL → SwiftShader（软件，对照） | 7 | 10 | 20 | 25 |

⇒ 纯渲染：**WebGL 快 3.4×（2D）/ 8.9×（3D）**；CPU 降频 4× 后差距拉到 4× / 9.7×。

### 4.5.3 ★ 但端到端几乎没差别 —— 瓶颈根本不在渲染

`figure(9); clf; surf(peaks(40)); drawnow`（用户真实写法）的墙钟：

| 后端 | CPU×1 | CPU×4 |
|---|---|---|
| OSMesa 8763 | 2137 ms | 9152 ms |
| WebGL 8768（真 GPU） | 2111 ms | 9018 ms |

**两个后端几乎一样**。拆解（`probe-gfx-e2e-breakdown.mjs`，8768 / CPU×1）：

```
peaks(40) 只算数据                5 ms
figure+clf                      193 ms      ← 桥的 clf 镜像（要动 path）
figure+clf+surf                2107 ms      ← ★ surf 自己就 ~1.9 s
figure+clf+surf+drawnow        2114 ms      ← drawnow 只 +7 ms
纯 getframe（强制渲染）           12 ms      ← 渲染真的只要十几毫秒
```

再分离"核心 vs 桥"（`probe-gfx-surf-cost.mjs`，各项均已含 `figure+clf`）：

| 调用 | 总计 | 减掉 figure+clf |
|---|---|---|
| `surface(peaks(40))`（**核心，不过桥**） | 238 ms | **~45 ms** |
| `surf(peaks(40))`（走桥 + 镜像） | 2070 ms | **~1877 ms** |
| `mesh(peaks(40))`（走桥 + 镜像） | 1960 ms | ~1767 ms |
| `line(1:100)`（核心，不过桥） | 210 ms | ~17 ms |
| `plot(1:100)`（走桥 + 镜像） | 347 ms | ~154 ms |

**结论（这一轮最值钱的发现）**：
1. **渲染只占 0.3%** —— `drawnow` +7 ms、`getframe` 12 ms，而后端换 GPU 省下的正是这十几毫秒。
2. **时间几乎全在 plot 桥的 3D 路径上**：`surf`/`mesh` 走桥要 ~1.8 s，而**核心 `surface` 只要 45 ms**
   —— 差约 **40 倍**。下一轮该查 `build/plotbridge/` 的 `surf → __pb_surface__ / __pb_add__`：
   疑似按网格单元逐段存 series，每段还 `save -ascii` 一个小文件到 MEMFS，40×40 就是几千次写。
3. ⇒ **换后端在真机上也不会让 `surf` 变快**，除非同时把桥这块 CPU 开销拿掉。
   当初"手机上慢"的方向判断没错，但**慢的不是渲染器**。

### 4.5.4 ★ 分辨率标定：差距**随像素数拉大**（这条才是"手机上"的答案）

`test/browser/probe-gfx-resolution.mjs` —— 同一张 3D 图，只改图窗像素尺寸：

| 图窗 | 像素 | OSMesa(softpipe) | WebGL(真 GPU) | 倍数 |
|---|---|---|---|---|
| 560×420（桌面默认） | 0.24 M | 64 ms | **7 ms** | 9.1× |
| 1120×840 | 0.94 M | 178 ms | 16 ms | 11.1× |
| 1680×1260 | 2.12 M | 350 ms | 34 ms | 10.3× |
| **2240×1680（≈高 DPR 手机屏）** | **3.76 M** | **572 ms** | **48 ms** | **11.9×** |

每百万像素的耗时：

| 后端 | 0.24 M | 3.76 M |
|---|---|---|
| OSMesa | 272 ms/Mpx | 152 ms/Mpx（近似线性于像素数） |
| WebGL | 30 ms/Mpx | **13 ms/Mpx**（**亚线性**，每像素越摊越便宜） |

**为什么这条比"跑个 Android 模拟器"更有说服力**：
- OSMesa 是**逐像素 CPU 光栅化** ⇒ 耗时与像素数近似成正比（272→152 ms/Mpx 的下降只是固定开销被摊薄）；
- GPU 那条是**并行**的 ⇒ 亚线性（30→13 ms/Mpx）。
- 这个**结构性差异与具体设备无关**：手机 GPU 比 RTX 4060 弱，但仍是并行的；
  手机 CPU 比这台 24 核桌面弱得多，而 softpipe 只能吃单核。
- 所以：**在高 DPR 手机上，OSMesa 一次重绘会到秒级，而 GPU 那条仍在几十毫秒量级**
  —— 这正是"手机上慢"的物理解释，也说明换后端**在渲染这一层是对的**。
- ⚠️ 但别忘了 §4.5.3：**端到端还有 plot 桥那 ~1.9 s**，两边都躲不掉。
  换后端解决的是"渲染会不会随分辨率爆掉"，**不解决**"`surf` 本身就要 1.9 s"。

### 4.5.5 口径（别把这节数字当成真机结论）

- 环境是**桌面 Chromium**（Linux/CachyOS，RTX 4060）。**不是手机。**
- CPU 侧用 `setCPUThrottlingRate` 近似，**GPU 侧没法降** ⇒ 对手机是**乐观**的。
- "瓶颈在桥不在渲染"是**结构性**结论（12 ms vs 1900 ms，差两个数量级），换平台也成立；
  **具体毫秒数不要外推**。
- **真机（或 Android 模拟器）仍值得测**，但优先级已不如"先把桥那 1.9 s 拿掉"。

### 4.5.6 ★ plot 桥那 ~1.7 s 的精确归属（2026-09-23，8768/桌面）

`test/browser/probe-bridge-cost.mjs` + `probe-bridge-cost2.mjs`（全部实测，ms）：

| 项 | 值 | 说明 |
|---|---|---|
| 写 1521 个小 `.dat`（`save -ascii`） | **306** | 每个 ~0.2 ms，**文件个数**是成本 |
| 写 1 个文件（1521 行，对照） | **1** | 数据量本身不要钱 |
| `__pb_project3__` 投影 40×40 | 1 | 不是瓶颈 |
| 建 1521 个 cell 的循环 | 3 | 不是瓶颈 |
| 纯 `__pb_add__` × 1521 | **67–844** | 见下（关掉管线后降到 67） |
| **桥的 `surf(peaks(40))` 总计** | **1686** | |
| 其中 `__pb_surface__` 建 1521 条 series | **1386** | 39×39 个单元 × 一条 series |
| 其中 `__pstate__` 两次 emit（每次 ~200，与 series 数成正比） | **~390** | `surf` 里 `__pstate__` 被调两次 |
| 对照：核心 `surface()`（不过桥） | 52 | |
| 对照：toolkit 真渲染（`getframe`） | 7–12 | |

**结构**：`__pb_surface__` 把曲面拆成 **1521 个单元多边形**，每个都走一遍
`__pb_add__`（建 struct + `save -ascii` 写一个文件），最后再把 1521 条序列化两次成 JSON。
**跟镜像无关**：把 toolkit 切成 `web`（镜像关闭）后仍是 **1705 ms**。

### 4.5.7 试过的正解与被谁挡住（**重要，别重走**）

> ⚠️ **本节末尾的"两条解锁路"后来被 §4.5.11 否掉了**（gl2ps 补上了，但 `print` 还卡在
> shell 管道；"跳过管线"在当前架构下不可达）。读到这里请直接跳到 §4.5.12 看真正落地的那一刀。

真渲染器在线时，桥那份 series **没有消费者**（页面显示的是 toolkit 的 PNG），
所以正确做法是**整条数据管线跳过**。实测（`__pb_real_renderer__` 门禁 + `__pb_add__`/
`__pb_surface__`/`contour` 短路）：

```
桥的 surf(peaks(40))   1686 ms  →  439 ms      （3.8×；__pb_add__ 782 → 67 ms）
剩余 439 ms ≈ 镜像的两次 path 手术 + 核心 surf
```

**但它**过不了验收**：`★ plot 桥 + print -dsvg 未受影响` 变红（另有一条 `contour` 出图变白 ——
短路时忘了照样调 `__pb_mirror__`，已修）。顺藤摸到的根因是：

```
gl2ps_print: support for gl2ps was unavailable or disabled when Octave was built
```

`config.h` 里 `HAVE_GL2PS_H` 是 **undef**，configure 日志原文
`checking for gl2ps.h... no → configure: WARNING: gl2ps library not found. Printing of OpenGL graphics will be disabled.`
⇒ **toolkit 的矢量打印（`print -dsvg/-dpdf/-dps`）本来就是不可用的**，
桥自己的 SVG 是这条能力**唯一的实现** ⇒ 它那条数据管线是**承载能力**，不是冗余。

**所以这一步先回退了**（`git checkout` 那四个文件，验收回到 **54 PASS / 0 FAIL**）。
`__pb_real_renderer__.m` 与 `__pb_mirror__.m` 的重构**保留**（那是干净的整理）。

**两条解锁路（按推荐排序）**：

1. **给 wasm 编一份 gl2ps，重跑 configure**（gl2ps 是外部库，树里只有 `gl2ps-print.cc` 这层胶水）。
   做成之后 toolkit 就能自己出 SVG/PDF/PS，桥的数据管线**才真正冗余**，那个 3.8× 直接落地，
   而且**顺带把 `print -dpdf/-dps` 这两个一直缺的能力补上**。
   代价：`config.h` 一变，`libinterp`/`liboctave` 要**大重建**（和当初 opengl-on 那次同一量级）。
2. **把管线改成"打印时再重建"**：绘图时只记原始调用，`print` 时回放进桥状态。
   不用动主构建，但要处理 hold/subplot/figure 切换的重放语义，容易出微妙错。

### 4.5.8 Android 模拟器实测（2026-09-23）——把"真机"这条腿也试了

**`android-emulator` 插件在这台 Linux 上真能跑**（它自己 preflight 那行 `Host OS: linux` 是红的，
但那只是个 `ok:` 标志，**不是硬门禁** —— 源码 `preflight.js:24` 就是个布尔）。

| 项 | 结果 |
|---|---|
| JDK 17 | Azul Zulu 17.0.13 → `/mnt/hdd/android-dev/jdk17`（Adoptium 会跳到被封的 github，用 Azul CDN）|
| Android SDK | `/mnt/hdd/android-sdk`（cmdline-tools + platform-tools + emulator + system-images;android-35;default;x86_64），约 2.8 GB |
| 免重启接上插件 | `~/Android/Sdk` → 软链到 hdd（`sdkRoots()` 认这个路径）；SDK 的 `cmdline-tools/latest/bin/java` 放 3 行 shim（插件在非 Windows 上 `javaHome()` 只认 macOS 路径，永远 undefined）|
| AVD | `medium_phone`；盘像也在 hdd（`~/.android/avd` → `/mnt/hdd/android-avd`）|
| 模拟器 | **起来了**：`emulator-5554`，Android 15 / API 35，截图/adb/logcat 全通 |

站点在里面：**Octave 正常启动**（资产全加载、`__octaveReady`）。探针走
`index.html?bench=1&tk=…`，输出经 `console.log` → `adb logcat`（Android WebView **没有 DevTools 可连**，
这是唯一能自动化取数的通道）。

| 后端 | 2D line | 3D surface | 端到端 surf+drawnow |
|---|---|---|---|
| OSMesa | 28.0 ms | 94.0 ms | 1831 / 1914 / 2038 ms |
| WebGL | **建不出上下文 ✗** | ✗ | 1755 / 1960 / 1836 ms |

两个结论：
1. **端到端 ~1.9 s 在 Android 上原样复现**（桌面 2111/2137 ms）⇒ 瓶颈在桥，换平台也一样。
2. WebGL 后端在这个模拟器里建不出上下文：logcat 是
   `eglCreateContext: EGL_BAD_CONFIG (0x3005)` +
   `ContextResult::kFatalFailure: WebGL1 blocklisted` —— 模拟器的 GL 是
   "Android Emulator OpenGL ES Translator"，被 Chromium blocklist 了。
   **所以模拟器不适合验 WebGL**（印证"模拟器≠手机 GPU"）。toolkit 已改成属性**逐级退让**
   （ideal → 关抗锯齿 → 不保缓冲 → emscripten 默认），真机上 config 受限的机型需要它。

### 4.5.9 实测"toolkit 自己能不能扛 print" ⇒ **扛不了，而且不是 toolkit 的问题**

用户问"先试试 toolkit 能不能自己扛"。做法：**绕开桥的 `print.m`**，用
`__pb_mirror__("print", …)`（它就是"摘掉桥再调核心同名函数"）逐个格式试。实测（8768）：

| 调用 | rc | 错误 |
|---|---|---|
| `print -dpng` | 2 | `__ghostscript__: 'gs' … required … not available` |
| `print -dsvg` | 2 | `gl2ps_print: support for gl2ps was unavailable or disabled` |
| `print -dpdf` / `-dps` / `-deps` | 2 | `__ghostscript__: 'gs' …` |

**根因**：`m/plot/util/private/__opengl_print__.m` 是**围绕 gl2ps 写的**
（全程 `gl2ps_device`），它**从不调用 toolkit 的 `print_figure`**。
⇒ 这个构建里 toolkit 根本没有被 `print` 调用到的机会；
**plot 桥自己那份 SVG 是唯一能出矢量的实现**。

⚠️ **一条测试教训（本项目为此误判过一次）**：查"文件到底有没有生成"时**别用**
`all(b(:) == [137;80;78;71;…])` —— 文件不存在时 `fread` 返回空数组，而
**`all([])` 是 `1`（真）** ⇒ 会得出"PNG 魔数正确"的**假阳性**。
要用 `isfile`/`dir` 的 bytes，或页面侧 `Module.FS.readFile` 直接读（本轮就是这么翻案的）。

### 4.5.10 于是去补 gl2ps（**已做完**，结果见 §4.5.11）

| 步骤 | 状态 |
|---|---|
| 找源码 | ✅ 上游 `geuz.org` 已连不上、`github.com` 被拦；**Debian pool 可达**：`deb.debian.org/debian/pool/main/g/gl2ps/gl2ps_1.4.2+dfsg1.orig.tar.xz` |
| 编 wasm 静态库 | ✅ `build/113/build-gl2ps.sh` → `/src/deps/gl2ps/{lib/libgl2ps.a, include/gl2ps.h}`（103 KB，`gl2psBeginPage/EndPage/LineJoin/LineCap/Text` 都在）|
| 接进 configure | ✅ `configure-113-full.sh` 新增 **`WITH_GL2PS=1`** 开关（默认关，与之前逐字节一致）|
| 接进链接 | ✅ `link-web.sh`：`/src/deps/gl2ps/lib/libgl2ps.a` **绝对路径**，存在就加（两条图形线都受益）|
| 重配 + 大重建 | ✅ 已做：`checking for gl2ps.h... yes`；`gl2ps-print.o` 重编（引用 14 个 gl2ps 符号）；链接 0 个未定义 |
| 复测 print | ✅ 已测：**错误变了**（不再是 gl2ps 缺失）但**仍失败** —— 卡在 `popen`，见 §4.5.11 |
| 再开桥的管线跳过 | ❌ **放弃**：核心 print 出不了矢量 ⇒ 桥的 SVG 是唯一实现，那管线不能砍；改走 §4.5.12 |

### 4.5.11 gl2ps 补上了，但 **`print` 还有第二道墙：它要 shell 管道**（实测）

gl2ps 全流程都做完了：源码（Debian pool）→ wasm 静态库 → `WITH_GL2PS=1` 重配
（`checking for gl2ps.h... yes`、`config.h` 出现 `#define HAVE_GL2PS_H 1`）→ 大重建
（`gl2ps-print.o` 重编、引用 14 个 gl2ps 符号）→ 链接（`libgl2ps.a` 绝对路径，0 个未定义）。

**`print -dsvg` 的错误确实变了**（说明 gl2ps 那条路真的走到了）：

```
之前: gl2ps_print: support for gl2ps was unavailable or disabled when Octave was built
之后: print: failed to open pipe "| cat > "/tmp/d.svg""
      at __opengl_print__.m:204  ← popen()
```

**根因**：Octave 的 `__opengl_print__.m` 把 gl2ps 的输出**穿过一个 shell 命令**再落盘
（`popen("| cat > \"<file>\"", "w")`），而本构建**故意没有 shell**（`system`/`unix`/`popen`
是清晰报错，见 README「已知偏差」与"纯客户端计算"铁律）。
⇒ **光有 gl2ps 不够，还得有 shell 管道**；`-dpdf/-dps/-deps` 另外还要 gs。
（`-dpng` 报的是 gs —— 它走 `svgconvert→eps→gs` 那条，根本不碰 gl2ps。）

**结论（如实）**：在这台构建里，**核心 `print` 出矢量这件事，不是补一个库能解决的**
—— 它依赖 shell 管道 + (gs | svgconvert)，三者本构建都没有、且"没有 shell"是**有意的设计**。
所以 **plot 桥自己那份 SVG 仍然是唯一能出矢量的实现**，
"跳过桥的数据管线"那个 3.8× **在当前架构下不可达**。（除非愿意给 wasm 做一个只认
`cat > <file>` 的假 `popen`—— 那是"假装有 shell"，与本项目的铁律冲突，不做。）
gl2ps 仍留在树里（`WITH_GL2PS=1` 开关默认关、库存在就自动链）：它把"gl2ps 缺失"这一层
永久去掉了，将来若真要走核心 print，只剩 popen 那一层。

### 4.5.12 ★ 于是改在桥内部提速：**按行发 series**（这才是能落地的那一刀）

既然桥的数据管线必须留着，那就让它便宜。改 `__pb_surface__.m`：

| | 原来 | 现在 |
|---|---|---|
| `surf` | **每个网格单元一条**闭合多边形 → 39×39 = **1521 条** | **每条行带一条**带状多边形 → **39 条** |
| `mesh` | 每个单元一条四点闭合轮廓 → 1521 条 | 行折线 + 列折线 → **80 条** |

**为什么遮挡关系不变**：`depth = sin(az)*X + cos(az)*Y` 对**行号单调**（Y 随行号递增、
cos(az)>0）⇒ 按行排序与按单元排序的前后关系一致。

**实测**（`probe-bridge-cost.mjs`，8768）：桥的 `surf(peaks(40))` **1686 → 480 ms（3.5×）**；
其中桥自己的建序列部分从 ~1.4 s 掉到 ~35 ms，剩下的 480 ms 当时**归因**成"镜像的两次
`path` 手术" —— **那条归因是错的**，下一节给出实测更正。
在 `web` toolkit 的站点（桥是显示路径、没有镜像）上，这一刀省的就是**全部 ~1.7 s → ~50 ms**。

**视觉核过**（这是渲染改动，必须看）：`probe-bridge-svg-out.mjs` 把桥自己渲染的图抠出来
（走 `web` toolkit + `print -dsvg` → `__svg_render__`），再渲染成 PNG 人眼看：
- `surf(peaks(40))` → `/mnt/hdd/octave-wasm-build/out-surf-ribbon.{svg,png}`：**形状与遮挡正确**
  （一条条彩色带跟着 peaks 起伏）。**如实记**：因为投影不是仿射的，逐行直边与逐单元边在
  边缘有极细的错位（斜视时看得出细缝），这是这条提速路的代价。
- `mesh(peaks(40))` → `out-mesh-ribbon.{svg,png}`：**经典线框，横竖都在**，观感比原来
  逐单元轮廓更干净。

**验收**：`accept-p5-graphics.mjs` **54 PASS / 0 FAIL**（surf/mesh 的非空白断言与改前一致）。
⚠️ 注意那套断言量的是 **toolkit 的渲染**，不覆盖桥的 SVG —— 所以桥的改动是靠上面的
**人工看图**核的，不能只靠它。

（`build-gl2ps.sh` 第一版自检写了 `gl2psPrintSVG` —— 那个符号**不存在**：
SVG 是 `gl2psBeginPage(..., GL2PS_SVG, ...)` 的**格式参数**，不是独立入口。已改。）

**★ 本轮连踩两次的流程坑（记下来，别再踩）**：容器里的构建脚本是**另一份拷贝**
（`/src/bin/*.sh`、`/src/websrc/*.cc`），改完仓库里的**必须 `docker cp` 进容器**才算数。
本轮两次都是"改了仓库 → 直接跑容器里的旧脚本 → 结果与预期不符"：
1. 改了 `configure-113-full.sh` 的 `WITH_GL2PS` 开关 → configure 打出来还是
   `checking for gl2ps.h... no`（用的是容器里的旧脚本）；
2. 改了 `link-web.sh` 的 `GL2PS_FLAGS` → 链接行里根本没有 `libgl2ps.a`，
   `wasm-ld` 报一堆 `undefined symbol: gl2psBeginPage`（同样是旧脚本）。
   ⚠️ 而且这类未定义符号会被 `ERROR_ON_UNDEFINED_SYMBOLS=0` **静默放过**变成 JS 导入，
   **链接照样"成功"** —— 只在运行期炸。**看到 `undefined symbol` 先查脚本同步，别先查代码。**
   （判据：`grep -c GL2PS_FLAGS /src/bin/link-web.sh` 该是 3，若是 0 就是没同步。）


### 4.5.13 ★ 桥的镜像层改"一次性句柄缓存"：**一次镜像 146 → 1.5 ms（~97×）**（2026-09-23）

**先更正 §4.5.12 末尾那条归因。** "剩下的 480 ms 基本是两次 `path` 手术" —— 实测**不成立**：
真凶是**冷启动**。同一条命令（`figure; clf; surf(peaks(40)); drawnow`）在同一站点分"冷/温"量
（`test/browser/probe-bridge-mirror-cost.mjs`，8768/桌面；A/B 用 `git archive HEAD build/plotbridge`
把旧桥打回同一个站点）：

| | 旧（每次摘 path） | 新（句柄缓存） |
|---|---|---|
| 会话里**第一次** clf / surf / drawnow | 230 / 304 / 179 ms | 304 / 133 / 181 ms |
| **温**（同一条命令连做三次） | **405 / 391 / 396 ms** | **101 / 93 / 88 ms** |
| 单次 `path()`（旧方案每次镜像要 2 次） | 61.3 ms | 同（但不再被镜像调用） |
| **镜像一次 `__pb_mirror__("clf")`（温）** | **146.2 ms** | **1.5 ms** |

⇒ 镜像层**每次快 ~97×**、一张图的**温开销 395 → 94 ms（4.2×）**；而"端到端 ~2.1 s"里的大头是
**一次性的**（建 WebGL 上下文 + `initialize_gl4es()` + 编 shader + 首帧 `glReadPixels`/PNG 编码/贴页面），
与"每张图的开销"是两码事。**把两者混着量就会得出错误归因**（第一版探针确实这么错过了）。

**新机制**（全文见 `build/plotbridge/__pb_core__.m` 的文件头）：
- **一次性取核心句柄**：用**一次** path 手术把 31 个核心函数 `str2func` 下来，之后**永不再动 path**
  （句柄创建时即绑定函数对象，`functions(fh).file` 可复核 —— 这就是旧实验"快 6.6×"的依据）。
- **深度计数 + 每个 shim 的前导**：核心调用期间 DEPTH>0，于是**每个挡住核心名字的桥 shim**
  开头那句 `if (__pb_in_core__ ())` 成立 → 转发给核心句柄。这复现了旧"把桥目录整条从 path 上
  摘掉"的语义，且**不需要枚举**"核心内部到底调了谁"。（当年"只换顶层句柄"死在这里：
  `__pie__.m:157/160` 的 `axis (h, …)`、`__contour__.m:229` 的 `axis (ax, …)`、
  `__plt__.m:154` / `__errplot__.m:279` 的 `legend (gca (), …)`。）
- 31 个 shim 的前导由 **`build/plotbridge/insert-core-forward.py`** 幂等插入
  （手工改 31 个文件必出错；工具带 3 条硬自检，含"与 `__pb_core__.m` 的名单逐字一致"）。

**过程中查出的两件"必须知道"**（都有实测）：
1. **Octave 的输出个数检查发生在函数体之前** —— `x = f()` 对"只声明 0 个输出"的 f 直接报
   `function called with too many outputs`，**函数体一行都没跑**。所以"转发那段"根本进不来，
   除非 shim 声明的输出个数 ≥ 核心实现的 ⇒ 工具顺手**加宽了 10 个 shim 的声明输出**
   （`axis/clf/legend/contour/stairs/title/xlabel/ylabel/xlim/ylim`，每个都按同版核心的
   `^function` 行核对过）。
2. 加宽之后，**桥自己的路径**上这些函数从"报 too many outputs"变成"返回空"（是放宽，不是回归）。

**验收**：`accept-p5-graphics.mjs` **64 PASS / 0 FAIL**（54 → 64：新增 10 条，其中 7 条是
**专门钉住上面那个坑**的 —— `pie`/`contour`/`legend` 三个"核心内部按名字调被挡函数"的用例 +
"核心调用里出错后 DEPTH 必须归零"（否则此后所有桥函数都会静默转给核心、桥的状态再不更新）+
默认 toolkit=webgl 三条）。`accept-plotv2` 54、`accept-plot3d` 34、`accept-print` 43、
`accept-t2-graphics` 26 全部不回归（t2 那套在开头**显式切回 `web`** —— 它验的就是 web 的句柄语义）。

**测量自身的两个坑**（都写进探针文件了，别再踩）：① 别"取日志里最后一个整数"当结果
（会抓到别的输出，第一版三个数一模一样地假）；② 测量表达式的传参别串位（第二版把"要打印的
表达式"和"计时表达式"搞混，所有数都成了 1）。统一约定：**code 把要报的数存进变量 V，用带标记的行输出**。

## 四点六、★ A 档落地：`webgl` 变默认 + `FULL_ES3` + **OSMesa 退役** + 编译期 GL 头换 gl4es（2026-09-23）

用户拍板的 "A"，一次做完四件（前三件**只重链**，第四件是**增量重编 3 个 TU**）：

### 4.6.1 `webgl` 成默认 toolkit（资产车道，零重链）

`build/webgraphics/PKG_ADD`：装资产时**有 `webgl` 就选它**，否则退回 `web`
（`webgl` 由 `main.cc` 启动时 register + load；`gtk_manager::register_toolkit` 在默认库为空时
本来就会顺手把它设为默认，这里只是"显式再确认 + 兜底"）。效果：**开箱 `plot(...); drawnow`
就是真渲染**，不用点任何 API（`accept-p5-graphics` §一 新增三条专门钉它）。

**★ 连带发现（重要，不是 bug）**：镜像层一开，桥里那些**比核心宽容**的调用会真的走到核心实现，
于是核心的严格性浮出来 —— 实测 `plot(x,x,'+','')`（末尾空串）在**桌面 Octave 上本来就报**
`plot: properties must appear followed by a value`，而桥以前宽容收下只是因为镜像没开。
⇒ 这是**行为向桌面看齐**，`accept-print` 里那条用例已改成合法写法并写明原因。
**凡"桥宽容、核心严格"的写法都要按这条重新对一遍**（全量 sweep 就是干这个的）。

### 4.6.2 `FULL_ES3`

`link-web.sh` 的 `GL_ES_FLAGS` 从 `-sFULL_ES2=1` 变成 **`-sFULL_ES2=1 -sFULL_ES3=1`**。
**口径要说准**：上下文**本来就是 WebGL2**（`webgl_toolkit.cc` 里 `attrs.majorVersion = 2`），
`FULL_ES3` 管的是 **emscripten 那一层 GLES3 API 模拟**。实测：加它之后体积
**36,848,766 → 36,858,057（+9,291 字节）**、图形验收 64/0、全量 sweep 全绿 ⇒ **保留**。
它**不是** gl4es 的要求（gl4es 的 COMPILE.md 只要求 `FULL_ES2`）；要回退就去掉这一项。

### 4.6.3 OSMesa 退役（仓内 7 个文件删除 + 三条分支删掉）

删（历史在 git 与该分支）：`build/113/{osmesa_toolkit.cc,osmesa-stubs.c,osmesa-smoke.c,
osmesa-smoke.sh,osmesa-glu-smoke.c,osmesa-glu-smoke.sh,patch-mesa-osmesa-static.sh}`，容器里
`/src/bin/`、`/src/websrc/` 的同名件也删了。代码侧：
`link-web.sh` 只剩 webgl 一条（`GL_BACKEND` 给别的值**明确失败**并指路到
`graphics-osmesa` 分支）、`main.cc` 去掉 `P5_OSMESA_TOOLKIT` 段、
`__pb_real_renderer__` 白名单 → `{"webgl"}`、`p5canvas.js` 的 `BACKENDS=['webgl']`（删 `useOsmesa`）、
`accept-p5-graphics` 的后端清单 → `['webgl']`、`probe-gfx-bench` 去掉 OSMesa 对照列。
`NOTES-p5-osmesa.md` 保留作历史记录。

### 4.6.4 编译期 GL 头：Mesa → gl4es+GLU（**最后一处隐藏依赖**）

`WITH_OPENGL=1` 给整棵树加的 `-I/src/deps/glshim/include` 是 **Mesa 的头**。换法见新脚本
**`build/113/gl-headers-webgl.sh`**：组装 `/src/deps/glheaders-webgl/include/GL`
（**gl4es 的 gl.h/glext/glx** + **GLU 自己那份不改名的 glu.h**），然后把
`/src/deps/glshim/include` 变成**指向它的软链** —— 编译命令行**逐字不变**，于是：
- ccache 不整片失效、automake 的 `.Plo` 只让**真正依赖 GL 头的 3 个 TU** 重编
  （`gl-render` / `gl2ps-print` / `__init_fltk__`；实测 make 只动了这三个，不是全树）；
- 实测 `gl-render.o` 重编后：裸 `glGetIntegerv` → **`gl4es_glGetIntegerv`**，
  **一个裸 `gl*` 都不剩**（`glEnd`/`glVertex3f`/`glFeedbackBuffer`/… 全没了），
  `glu*` 10 个仍是裸名（由 `glu-webgl/lib/libGLU.a` + `gl4es-unmangled-shim.c` 提供）。
- 链接结果**中性**：`gl4es_gl*` 出现 130 次、OSMesa 残留 0、wasm **36,858,059**（+2 字节）。
  ⚠️ 链接里那几条 `undefined symbol: glEnd/glVertex3f/glFeedbackBuffer/glPassThrough/glRenderMode`
  是 **gl2ps** 的（它按 emscripten sysroot 的 `<GL/gl.h>` 编，走反馈/立即模式那条 `print` 路），
  **与本节无关、且从来没被调用过**（本构建没有 shell 管道 ⇒ 那条 print 路不可达）。
  还原一行：`bash /src/bin/gl-headers-webgl.sh --revert`。

### 4.6.5 顺手给链接脚本补的自检（防"静默放过"）

`link-web.sh` 末尾（`GL_LIBS=1` 时）现在查**产物本身**：必须含 `gl4es_gl*`、
必须**不含** `OSMesaMakeCurrent`、toolkit 目标文件里必须有 `gl4es_gl*`。
为什么值得加：`ERROR_ON_UNDEFINED_SYMBOLS=0` 会把未定义符号**静默放过**，历史真踩过
（gl4es 入口没解析、链接"成功"、运行期第一次 GL 调用才炸）。

## 五、开工前必须知道的（**继承自 OSMesa 线的教训 + 本线新增的**）

1. **任何碰 Octave 头文件的 TU 都要先 `#include "config.h"`，而且要在所有 include 最前面**
   —— 见 `CLIBS.md` 坑 1 与 `NOTES-p5-osmesa.md` §8.1。少了它症状是"运行期在**别人的**
   函数里越界"（不是编译错）；**位置放错**则直接是 `redefinition of 'octave_unused_parameter'`
   （本线 §4.3 坑 1 实测）。
2. **诊断通道必须能穿过 trap**：用 `console.error`（`emscripten_run_script`）
   或写 MEMFS 文件；**别用 `octave_stdout`**（带缓冲，trap 后整个丢）。
   而且**先确认探针真的编进产物了**（`grep -c`）—— 上一轮为此误判了两轮。
   （本 toolkit 的 `describe()` 还踩过一次：用 `string_value()` 读 double 属性会刷
   `implicit conversion from scalar to sq_string`，把真输出淹掉 ⇒ 用 `double_value()`。）
3. **plot 桥不建真图形对象**：`build/plotbridge/` 的 .m 只记自己的状态，
   `plot(...)` 不会产生真 line 对象 ⇒ 渲出来是白图。镜像层
   `build/plotbridge/__pb_mirror__.m`（`graphics-osmesa-p5` 上做的，**本分支已继承**）
   把后端名字加进白名单即可：`__pb_mirror_on__` 的 `{"osmesa", "webgl"}`。
4. **验收套件是同一个文件**：`test/browser/accept-p5-graphics.mjs`（**原 `accept-p5-osmesa.mjs`**），
   按站点自动在 `webgl` → `osmesa` 里选第一个可用的后端；两个都没有就**明确 SKIP**（0/0）。
   **别把 SKIP 门禁去掉** —— 8761 基线靠它保持全绿。
5. **自己建的归档一律传绝对路径**，不要用 `-l`（见 `NOTES-p5-osmesa.md` §7.3 与 §3.6 坑 2）。

### 待量 / 已量

- [x] **gl4es + WebGL2 能不能渲出画面、立即模式对不对** ⇒ ✅ 已量：`gl4es-smoke` 16/16
      （逐像素），Octave 侧 15/15 图类型非空白。
- [x] **gl4es 对 Octave 用到的那批调用的覆盖度** ⇒ ✅ 已量：**76/76 符号全覆盖**（§3.4）。
- [x] **体积账** ⇒ ✅ 已量：WebGL **36,725,241** vs OSMesa **45,580,621**（**省 ~8.9MB**，§零表）。
- [~] **手机端速度** ⇒ **已用"桌面 + CPU 降频 + 真 GPU + 分辨率标定"回答**（§4.5.2/4.5.5）：
      纯渲染 WebGL 快 3.4–9×，且**差距随像素数拉大**（3.76 M 像素时 572 ms vs 48 ms）
      ⇒ 高 DPR 手机上 OSMesa 会到秒级。**真机仍未测**（Android 模拟器在本机不可用，见 HANDOFF §5.19）。
- [ ] **把 plot 桥 3D 路径那 ~1.9 s 拿掉**（§4.5.3）—— 现在**最值得做的一件事**，
      比继续抠渲染器有意义得多。
- [ ] 与 OSMesa 的**结构性对照**（形状/范围一致，不追求逐像素——两个光栅化器本就不同）。
      现在两边都能出图，但还没做逐图的形状对照。

---

## 六、分支拓扑（2026-09-23）

```
main                     9b211ae  ← 8761 部署的基线（未动）
  └─ graphics-osmesa-p5  c9ad754  ← OSMesa 后端：步骤①②③ 打通（根因=缺 config.h）
       └─ graphics-webgl  …       ← 本分支：WebGL（gl4es）实现，**也已打通**
graphics-osmesa         fb5b265  ← 历史遗留分支（只比当年的 main 多一份说明文件），本线不动它
```

**本分支相对 `graphics-osmesa-p5` 的改动**（一句话清点）：

| 类别 | 文件 |
|---|---|
| 新增·库 | `build/113/build-glu-webgl.sh`、`patch-gl4es.sh`、`gl4es-unmangled-shim.c` |
| 新增·toolkit | `build/113/webgl_toolkit.cc` |
| 新增·spike 与验收 | `build/113/gl4es-smoke.c/.sh`、`test/browser/probe-gl4es-smoke.mjs` |
| 新增·笔记 | `build/113/NOTES-webgl.md`（本文件） |
| 改 | `build/113/link-web.sh`（`GL_BACKEND=webgl` 口子）、`build/main.cc`（装 webgl toolkit）、`build/plotbridge/__pb_mirror__.m`（白名单加 webgl）、`bridge/p5canvas.js`（`useWebGL` + `demo()` 不再写死后端）、`test/browser/accept-p5-osmesa.mjs` → **改名** `accept-p5-graphics.mjs`（按后端参数化） |
| **没改** | `build/113/osmesa_toolkit.cc` 与 OSMesa 那条链的任何旗标 —— 两条后端**并存可切**，便于对照与回退 |

**为什么从 `graphics-osmesa-p5` 切而不是从 `main`**：那条线上有**与后端无关**
的三样东西，本线直接用得上 —— ① `config.h` 那条根因修正；② toolkit 骨架
（`figure_pixsize`/三件套/PNG）；③ plot 桥镜像层 + 验收套件。
要从干净基线重来也就一条 `git rebase --onto main graphics-osmesa-p5 graphics-webgl`。
