# NOTES · P5 图形线重构（OSMesa）—— **步骤① 已完成**（2026-09-22）

> 计划里 P5 分三步，并**明确允许"只完成第 1 步并如实记录"**（HANDOFF §9.3）。
> 本文件记录：步骤① 已通过（硬断言），以及 ②③ 的确切路径与代价。

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
