# NOTES · P5 图形线重构（OSMesa）—— **步骤① 已完成；步骤② 推进到一半**（2026-09-22）

> 计划里 P5 分三步，并**明确允许"只完成第 1 步并如实记录"**（HANDOFF §9.3）。
> 本文件记录：步骤① 已通过（硬断言）、步骤② 的进展与**卡点**（还有一个 🚨 主树混态警告）。
>
> **接手先看两段**：① 本文件末尾的「步骤② 进展」；② HANDOFF §9 里带 🚨 的那段。

## 一、结论先说

**OSMesa 在 wasm 里跑通了，而且能渲出正确的三角形（含立即模式）。**

计划原本的判断是"OSMesa 是唯一可信的完整路径，但风险最大"，依据是
edgetools.io 走 `LEGACY_GL_EMULATION` + Octave 自己的 `opengl_renderer`
死在 `glEnd: numVertices must be an integer`，emscripten 文档也自述
*"do not expect it to work"*。

**本次实测表明那条结论要分开看**：
- **失败的是"WebGL 模拟"路线**（`LEGACY_GL_EMULATION`，必须有 canvas、且立即模式不可靠）；
- **OSMesa + softpipe 这条路线是通的**，而且**立即模式（`glBegin/glEnd`）正常** ——
  那正是 Octave `opengl_renderer` 依赖的东西。

步骤① 的运行结果（`build/113/osmesa-smoke.sh`，node 里跑，无浏览器、无 canvas）：

```
=== P5 步骤①：OSMesa 渲到内存缓冲（32x32）===
OK: 上下文已建 / OK: make current
  GL_VERSION  = 3.3 (Compatibility Profile) Mesa 24.0.9
  GL_RENDERER = softpipe          ← 软件光栅化，没有 LLVM
  GL_VENDOR   = Mesa
[1] glClear 成红色：中心 (16,16) = 255 0 0 255        PASS
[2] 立即模式绿三角：重心 = 0 255 0 255                PASS
                     左下角 = 0 0 0 255（黑底）        PASS
                     右上角 = 0 0 0 255（黑底）        PASS
=== P5 步骤① 通过（失败 0 项）===
```

## 二、零重链现状探针（动手前先量）

`test/browser/probe-p5-run.mjs` + `fixtures/p5-graphics-probe.m` 在 8761 上实测：

| 问 | 结果 |
|---|---|
| `available_graphics_toolkits()` | `{web}`（上一批 T2 挂的最小 toolkit） |
| `__opengl_plot__` / `__opengl_plot_intern__` / `__init_gl__` | **0 / 0 / 0**（一个都没有） |
| `__go_draw_axes__` | **0**（原生绘制路径根本没编进来） |
| `__gnuplot_drawnow__` | 2（.m 在，但没有 gnuplot 二进制） |
| `print -dsvg` | ✅ 正常（走 plot 桥） |
| `print -dpng` | 干净报错 `raster output (-dpng) is not available in this build` |
| `getframe` | 报错（没有可捕获的图） |

⇒ 现状 = **"plot 桥 + `print -dsvg`"，没有任何 OpenGL 栈**。P5 要补的正是后者。

## 三、Mesa/OSMesa 的构建配方（可复现）

**版本**：Mesa **24.0.9**（`archive.mesa3d.org`，20MB；走宿主 2080 代理下到
`/mnt/hdd/octave-wasm-build/third_party/` → 容器里是 `/src/vendor/`）。

**工具**：容器里 meson 1.3.2 + ninja 1.11.1 ✓；Mesa 的代码生成要 **python3-mako**，
容器里没有、且容器出不了网 → 在**宿主**用 pip 下 cp312 轮子到
`third_party/pipwheels/`（挂载进容器）再 `pip install --no-index --find-links` 装上。

**交叉文件**：emsdk 5.0.7 **不自带 meson 交叉文件**，本仓自己写了一份 →
`build/113/emscripten-cross.ini`。踩过的点：
- meson 的 machine file **只认单引号**（双引号报 Malformed value）；
- `exe_wrapper = node` + `needs_exe_wrapper`（构建里有个别步骤要跑产物）；
- **`host_machine.system` 写什么都要配合补丁 2**：Mesa 的 `detect_os.h` 是按**编译器
  预定义宏**判断平台的，根本不看 meson 的 system 字段；
- 交叉构建下 meson 默认去找"host 机器的 pkg-config"（日志原文
  `Pkg-config for machine host machine not found. Giving up.`）→ 必须显式
  `pkgconfig = 'pkg-config'` + `PKG_CONFIG_PATH` 指到自建 wasm zlib 的 `.pc`；
- **meson 不用环境里的 `CPPFLAGS`/`LDFLAGS`**（实测失败目标的命令行里没有那些 `-I`）
  → 路径要写进 `[built-in options]` 的 `c_args`/`c_link_args`。

**配置命令**（完整可抄）见 `build/113/patch-mesa-osmesa-static.sh` 末尾的示例；关键开关：
`-Ddefault_library=static -Dshared-glapi=disabled -Dosmesa=true
-Dgallium-drivers=swrast -Dllvm=disabled -Dplatforms= -Dopengl=true
-Dglx=disabled -Degl=disabled -Dgbm=disabled -Dvulkan-drivers= -Dbuild-tests=false`。

**两处平台补丁**（都在 `build/113/patch-mesa-osmesa-static.sh`，幂等、带自检）：

| # | 位置 | 问题（实测报错原文） | 改法 |
|---|---|---|---|
| 1 | `src/gallium/targets/osmesa/meson.build` | `ERROR: ld.wasm does not support shared libraries.`（meson 的 `EmscriptenDynamicLinker.get_soname_args()` 只要见到 shared 目标就抛；`-Ddefault_library=static` 压不住硬写的 `shared_library`） | OSMesa 目标 `shared_library` → `static_library`，去掉只有 shared 才认的参数 |
| 2 | `src/util/detect_os.h` | `os_time.c: error: Unsupported OS` / `os_misc.c: unexpected platform` —— 因为是按预定义宏判平台，而 **emcc 不定义 `__linux__`** | 显式加 `#if defined(__EMSCRIPTEN__) → DETECT_OS_LINUX/UNIX` |

**链接期垫片**（`build/113/osmesa-stubs.c`）：emscripten 缺
`sched_getcpu` / `pthread_setname_np`（Mesa 的 `u_thread.c` 用到，纯装饰性）。
补两个返回 0 的实体即可；补完链接**零未定义符号**。

**体积代价（如实记录，是步骤②的决策依据）**：
`libOSMesa.a` **20.1MB**；最小 smoke 的 `osmesa-smoke.wasm` **11.3MB**（未压缩）。
⇒ 若按计划步骤②把它接进站点，主 wasm 会显著变大（要按 `-O`/裁剪再评估）。

## 四、步骤②③ 的确切路径（还没做）

- **步骤②**：把 T2 那个薄 toolkit 的 `redraw_figure` 从 no-op 换成"喂给 OSMesa"。
  代价在于：需要 `--with-opengl` 重编主树（Lane B，全量重编+重链），
  并新增一个 `__init_opengl__` 式的 toolkit 资产；OSMesa 还得进主模块或做成 side module
  （20MB 的静态库，放 side module 更合适，但要注意与主模块的 GL 符号共存）。
- **步骤③**：`plot/surf/mesh/contour` 逐个出图，与 7.2 桥的产物对照。
- **回退**：现有 plot 桥 + `print -dsvg` **保持不动**（两者不冲突：一个走 toolkit、
  一个走桥）—— 这也是计划里定的策略。

## 五、复现命令

```bash
# 1) Mesa（容器内）
bash /src/bin/patch-mesa-osmesa-static.sh                      # 两处补丁
cd /src/libwork/mesa-24.0.9 && PKG_CONFIG_PATH=/src/deps/zlibbz2/lib/pkgconfig \
  meson setup /src/libwork/mesa-build --cross-file=/src/bin/emscripten-cross.ini \
  --wrap-mode=nofallback -Ddefault_library=static -Dshared-glapi=disabled -Dosmesa=true \
  -Dgallium-drivers=swrast -Dllvm=disabled -Dplatforms= -Dopengl=true -Dglx=disabled \
  -Degl=disabled -Dgbm=disabled -Dvulkan-drivers= -Dbuild-tests=false
ninja -C /src/libwork/mesa-build -j24          # 806 个目标，全绿

# 2) 步骤① 验证
bash /src/bin/osmesa-smoke.sh                  # 编 + 用 node 跑，逐像素断言
```

---

# 步骤② 进展（2026-09-22，**未完成，且主树现在处于"配置与产物不一致"的状态**）

## 已经做完的（都有实测）

1. **libGLU 9.0.3 建到 wasm 了** ✔
   - 来源：`https://archive.mesa3d.org/glu/glu-9.0.3.tar.xz`（219KB，走宿主 2080 代理，
     落在 `third_party/glu-src.tar.xz`）。
   - ⚠️ 它**只带 meson.build、没有 configure**（第一版 `emconfigure ./configure` 直接
     报 `FileNotFoundError`）；用 meson + 我们那份交叉文件构建。
   - 它的 meson 有 **`-Dgl_provider`** 三个选项 `glvnd|gl|osmesa` → 用 **`osmesa`** ✔，
     配一份**手写的 `osmesa.pc`**（`/src/libwork/pc/osmesa.pc`）指向 Mesa 构建目录
     —— Mesa 自己生成的那份是交叉构建半成品（带 `-pthread`/`-sPTHREAD_POOL_SIZE` 垃圾，
     且 prefix 指向还没 install 的目录，别用）。
   - 产物 `/src/libwork/glu-build/src/libGLU.a`（**685742 字节**，90 个目标全绿）。

2. **GLU 剖分在 OSMesa 上验证通过** ✔（`build/113/osmesa-glu-smoke.c` + `.sh`）
   - 为什么单独验它：Octave 的 `gl-render.cc` 用 GLU **只为一件事** —— 多边形剖分
     （`gluNewTess`/`gluTessBeginPolygon`/`gluTessVertex`/`gluTessEndPolygon`/…，实测 grep 全族）。
     所以"GLU 剖分能跑"= 步骤② 的**最后一个库层面未知**被消掉。
   - 硬断言（读像素）：凹的 **L 形**多边形，剖分后画进 OSMesa：
     L 形横杠内=黄 PASS、竖杠内=黄 PASS、**凹口内=黑 PASS**、界外=黑 PASS。
   - 顺带记一个 API 细节：**GLU 默认吐的是 `GL_TRIANGLE_FAN`（type=6），不是 `GL_TRIANGLES`**
     —— 第一版把它按独立三角形画，恰好那 6 个顶点两两凑对、像素断言居然全过（运气），
     已改成**按 GLU 给的类型重画**。

3. **`glshim`：把 OSMesa 冒充成 `-lGL`/`-lGLU`** ✔（`/src/deps/glshim`）
   - `lib/libGL.a` = `libOSMesa.a`（软链式拷贝）、`lib/libGLU.a` = 上面那个 GLU；
     `include/GL/` 用 Mesa 的 `gl.h`/`glext.h`/`glx.h` + libGLU 的 `glu.h`。
   - 目的：让 Octave 的 `--with-opengl` 探测与最终链接都落在**软件光栅化**这条路上。

4. **`configure-113-full.sh` 加了 `WITH_OPENGL=1` 开关** ✔（默认仍是 `--without-opengl`，
   与之前逐字节一致）；打开时把 glshim 摆进 `CPPFLAGS`/`LDFLAGS`。

5. **带 OpenGL 的 configure 跑通了** ✔ —— `WITH_OPENGL=1 SKIP= bash configure-113-full.sh`
   返回 0，`config.h` 里 **`#define HAVE_OPENGL 1`**。
   日志：`/src/libwork/reconf-opengl.log`。

## ⚠️ 卡在哪（下次接着做，就一条）

`config.h` 里这几个门禁**还是 `#undef`**：

```
/* #undef HAVE_OPENGL_GL_H */
/* #undef HAVE_OPENGL_GLU_H */
/* #undef HAVE_OPENGL_GLEXT_H */
/* #undef HAVE_GLUTESSCALLBACK_THREEDOTS */
```

而 `gl-render.cc` 的 `#include` 块正是靠 `HAVE_OPENGL_GL_H`/`GLEXT_H`/`GLU_H` 决定
包哪个头（`acinclude.m4:1565/1616/1621/1648`）。**它们全 undef ⇒ gl-render.cc 编不过**
（一个 GL 头都不会被包含）。

⇒ **下一步就一件事**：查这几个头探测为什么失败并修好（八成是探测用的 include 路径
没吃到我们传的 `CPPFLAGS`，或者它按 macOS 的 `OpenGL/gl.h` 风格试的）。
修好后 `HAVE_OPENGL 1` + 这四个门禁一起为真，才能真正开编。

## 🚨 主树现在的状态（**接手的人务必先看这段**）

- `/src/work/octave-11.3.0/config.h` **已经是 opengl 版**（`HAVE_OPENGL 1`），
  但 `liboctave.a` / `libinterp.a` / `.o` **都是 opengl 之前的产物** ——
  **配置与产物不一致（混态）**。
- **部署产物没被动过**：8761/8762/磁盘 `site/`/`/src/websrc/out/` 都还是
  `bac48adb960c9c79…`（T2 那版，09:09 生成），本次只改配置、**没有 make、没有重链、没有部署**。
- **要退回"与部署一致"的配置**（下次想重链出部署同款 wasm 时必须先做）：
  ```bash
  cd /src/bin && PATH=/src/bin:$PATH SKIP= bash configure-113-full.sh   # 不带 WITH_OPENGL
  ```
  （备份在 `/src/libwork/config.h.pre-opengl`，可用于比对。）
- 想继续步骤②：先修上面那四个门禁，再 `PATH=/src/bin:$PATH make -k -j24 DLDFCN_LIBS=`
  （config.h 变了 ⇒ 大部分会重编）→ `link-web.sh` → **验证过再部署**。

