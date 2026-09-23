# NOTES · P5 图形线重构（OSMesa）—— **已退役（2026-09-23 晚）**，本文保留作历史记录

> ⛔ **2026-09-23：OSMesa 后端已退役**，图形线只剩 `webgl`（gl4es → GLES2 → WebGL2/GPU）。
> 原因不是"跑不起来"（**这条线是通的**，下面全部结论都成立），而是**量**：CPU 逐像素、
> `octave.wasm` 45.58MB（比 gl4es 版多 ~8.3MB）。
> **退役动作**：仓内 7 个文件删除（`osmesa_toolkit.cc`/`osmesa-stubs.c`/两个 smoke/patch 脚本）、
> 容器里的同名件删除、`link-web.sh` 的 osmesa 分支删掉（给 `GL_BACKEND=osmesa` 会**明确失败**
> 并指路到 git 历史的 `graphics-osmesa` / `graphics-osmesa-p5` 分支）、`main.cc` 去掉
> `P5_OSMESA_TOOLKIT`、`__pb_real_renderer__` 白名单收成 `{"webgl"}`。
> 详见 `HANDOFF.md` §5.21 与 `NOTES-webgl.md` §4.6。
> **本文件仍然值得读**：那条线上的教训（`config.h` 必须最先 include、镜像层的由来、
> A 档三道墙、`shared-glapi`/meson 的坑）**大部分对 WebGL 线同样成立**。

> 计划里 P5 分三步，并**明确允许"只完成第 1 步并如实记录"**（HANDOFF §9.3）。
> 现状：**三步都做完了** —— 步骤① OSMesa 在 wasm 里渲出图形（硬断言）；
> 步骤②③ `plot(...); drawnow` 走 Octave 自己的 `opengl_renderer` + OSMesa
> **真渲出像素**，8763 上 `accept-p5-osmesa.mjs` **54 PASS / 0 FAIL**（该文件后来**改名** `accept-p5-graphics.mjs`，按站点自动选后端 —— 见 NOTES-webgl）。
>
> **接手先看第八节**（2026-09-23 收尾）：那里的根因（**缺 `#include "config.h"`**）、
> 镜像层（`build/plotbridge/__pb_mirror__.m`）、以及本轮踩到的 5 个新坑，
> 是这一整条线最值钱的部分。第七节的"卡点"推断**已被推翻**，保留只为记录过程。
>
> 另有一次更早的源码级核查推翻了"四个 GL 头门禁卡住"的误判（见「~~卡在哪~~ → 更正」）。

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

## ~~⚠️ 卡在哪~~ → **更正：那不是卡点，是误判**（2026-09-22 源码级核查）

原先这里记着"`config.h` 里四个门禁还是 `#undef` ⇒ `gl-render.cc` 编不过"，
并把"查这四个头探测为什么失败"列为下一步。**核查后发现这个判断是错的**：

```
/* #undef HAVE_OPENGL_GL_H */        ← Apple 目录布局（OpenGL/gl.h）的宏
/* #undef HAVE_OPENGL_GLU_H */       ← 同上（OpenGL/glu.h）
/* #undef HAVE_OPENGL_GLEXT_H */     ← 同上（OpenGL/glext.h）
/* #undef HAVE_GLUTESSCALLBACK_THREEDOTS */  ← 只在 macOS framework 分支里才查
```

逐条的事实（都有文件行号）：

1. `m4/acinclude.m4:1544` 是 `AC_CHECK_HEADERS([GL/gl.h OpenGL/gl.h])` ——
   **同一个 break 循环**，`GL/gl.h` 先成功就 `break`，所以
   `<OpenGL/gl.h>` **根本没被探测**（`ac_cv_header_OpenGL_gl_h` 压根不存在）。
   `GL/glu.h` 同理。⇒ 这两个 `#undef` 是**正确的、预期的**结果。
2. `HAVE_OPENGL_GLEXT_H` 对应 `<OpenGL/glext.h>`，我们**确实没有** `OpenGL/` 目录
   （glshim 只有 `include/GL/`）⇒ 也是正确结果。
3. `HAVE_GLUTESSCALLBACK_THREEDOTS` 的检查（`acinclude.m4:469`）**唯一调用点在
   `acinclude.m4:1536`**，而那句在 `if test $have_framework_opengl = yes` 分支里 ——
   非 macOS 上**从不执行**。而且它只与 `HAVE_FRAMEWORK_OPENGL` 一起被消费
   （`gl-render.cc:345`）。
4. **真正的门禁是 `HAVE_GL_GL_H` / `HAVE_GL_GLU_H` / `HAVE_GL_GLEXT_H`**，
   而它们在当时的 config.h 里**已经全是 1**（`oct-opengl.h:29-51` 正是用这三个
   决定包哪组 GL 头）。

⇒ **`gl-render.cc` 不是"编不过"，是从没试过编。** 下一步不是查探测，而是**直接编**。

## 顺带核清的三件事（都影响做法，别再假设）

- **11.3.0 里 `gl-render.cc` 是*无条件*编译的**（`libinterp/corefcn/module.mk:182`，
  全树**没有** `AMCOND_HAVE_OPENGL` 门）⇒ 配置里开着 opengl 它就会编进去。
- **11.3.0 没有 `__init_opengl__.cc`**（`ls` 确认不存在）—— opengl toolkit 已经搬到
  **libgui 的 `GLCanvas`** 里。⇒ **没有现成的 toolkit 可以抄**，要像 T2 那样自己写一个
  （`libgui/graphics/GLCanvas.cc:66-83` 的 `draw`/`begin_rendering` 是那份最小配方：
  `set_viewport` → `opengl_renderer::draw(go)`）。
- **ABI 已核，可以走资产车道**：安装头树里 `HAVE_OPENGL`/`HAVE_GL_` **零命中**
  （`octave-config.h` 由 `mk-octave-config-h.sh` 生成，只搬 `OCTAVE_*`/ABI 宏），
  唯一相关的 `oct-opengl.h` 只在 `#include` 与 inline 函数体上开门，
  `opengl_functions` 两种配置下都只是 `{vptr}`。
  ⇒ **可以在 opengl-on 的配置下编我们的 `.oct`，而主 wasm 保持 opengl-off**
  （`oct-opengl.h` 的类体是 inline 包装 `::glXxx`，把 OSMesa 静态链进 `.oct` 就行）。
- **文本需要 freetype**：现在 `--without-freetype` ⇒ `text_to_pixels` 返回空
  （`text-renderer.cc:130-151`），刻度/title 会**空白但不崩**。要出文字得先建 freetype
  + 解决无 fontconfig 的字体查找。
- **唯一的真未知**：主模块里**已经有 stub 版 `opengl_renderer` 符号**
  （`gl-render.cc` 的方法体总是编译，只是 opengl-off 时走 `err_disabled_feature`）。
  要实测确认 side module 绑的是**它自己那份定义**。

## ✅ 主树混态**已清除**（2026-09-22 收尾时做的）

- 已跑 `SKIP= bash configure-113-full.sh`（**不带** `WITH_OPENGL`）；
  `config.h` 与 `/src/libwork/config.h.pre-opengl` **逐行一致**。
- opengl-on 那份 `config.h` + `Makefile` **备份在 `/src/libwork/config.h.opengl-on`**
  （`Makefile.opengl-on` 同目录）—— 图形分支直接拿来 diff 或复用。
- 部署产物全程未动：`site/`、`site113/`、`o113:/src/websrc/out/` 的
  `octave.wasm` sha256 都是 `bac48adb960c9c79…`。

## 图形分支上的下一步（本文件写在这里，分支自带计划）

1. 先把主树切回 opengl-on：`WITH_OPENGL=1 SKIP= bash configure-113-full.sh`
   （glshim 已在 `/src/deps/glshim`，`libGL.a` 就是 `libOSMesa.a`）。
2. 写 `osmesa_toolkit.cc`：`base_graphics_toolkit` 子类，内含
   `opengl_functions m_glfcns; opengl_renderer m_renderer;` + OSMesa context；
   `redraw_figure(go)` = `set_viewport` → `m_renderer.draw(go)` → `glReadPixels`
   → 写 MEMFS → 通知页面贴 canvas（`EM_ASM` 在 side module 里不可用，见 §4.13）。
3. 编成 `.oct`（`build/113/build-oct.sh --cc`，用 `OCT_DEFS/OCT_INCS/OCT_LIBS` 挂
   `libOSMesa.a` + `libGLU.a` + `libsoftpipe.a` + `blake3` + `--start-group` + `-lz`
   + `osmesa-stubs.c`），**主 wasm 零改动**。
4. **先验符号绑定**（文件末尾那条"唯一真未知"），再谈渲染。
5. 步骤③：`plot/surf/mesh/contour` 逐个出图并与 plot 桥产物对照。
6. 回退不变：**plot 桥 + `print -dsvg` 保持可用**，两者不冲突。


---

## 七、2026-09-23：步骤② 实做（A 档试到底 → 改走 B 档），卡在 GL 调用处

> 本节的每条结论都有实测；命令都可复现。**接手请先读"七.5 当前卡点"**。

### 7.1 先把"现成实现"搜齐（这一轮的第一件事）

| 来源 | 拿了什么 | 落地 |
|---|---|---|
| `github.com/Edge-Tools/octave-wasm` | `build/octave-patches/webgl-graphics-toolkit.cc`（7126B）、`MILESTONE-2.md`、`build-glu.sh`、`Dockerfile`、`README.txt` | `build/113/vendor-edge-tools/`（GPL-3.0-or-later，**用前须注明出处**）|
| Octave 11.3.0 官方源码（宿主盘有整棵树：`/mnt/hdd/octave-wasm-build/probe11/octave-11.3.0/`）| `libgui/graphics/GLCanvas.cc:66-133`（`draw`/`do_getPixels`/`do_print` = **渲染三件套的官方最小配方**）、`qt-graphics-toolkit.cc`（toolkit 契约）、`__init_gnuplot__.cc`（薄 toolkit 模式）、`gl-render.h`、`oct-opengl.h`、`gl2ps-print.h` | 本仓 `build/113/osmesa_toolkit.cc` 直接照抄这三处 |
| 本仓既有资产 | `web_graphics_toolkit.cc`（T2：登记/装载/`.oct` 打包/命名空间坑）、`webnet.cc`（`.oct`→JS 通道：`EM_ASM` 在 side module 不可用 ⇒ `emscripten_run_script` + MEMFS）、`webimage.cc`（`stbi_write_png_to_func` 回调式 PNG）| 同上 |
| 本仓步骤① | `osmesa-smoke.c/.sh`（context 创建 + `glReadPixels` + 精确链接行）、`osmesa-stubs.c` | 同上 |

**结论**：`osmesa_toolkit.cc` = **Edge-Tools 的骨架** + **GLCanvas 的三件套** + **webnet 的通道** + **smoke 的 context 代码**。没有从零设计。

### 7.2 A 档（OSMesa 全打进 `.oct`）：试到底，三道墙

做法：主树保持 opengl-off，把 `gl-render.cc`（改名 `p5_opengl_renderer` 避开与主模块同名符号的抢占）
连同 Mesa/GLU 一起编进一个自包含 `.oct`。**三道墙，全部实测**：

1. **Chrome 禁止主线程同步编译 >8MB 的 wasm**
   `RangeError: WebAssembly.Compile is disallowed on the main thread, if the buffer size is larger than 8MB`
   （`__dlopen_js` 恒走同步路径；SLICOT 那个 8.1MB 的模块刚好在限内，10.8MB 的不行）。
   **已解**：页面侧**异步预加载** —— `Module.loadDynamicLibrary(path,{loadAsync:true})` 开头就查
   `LDSO.loadedLibsByName`，命中即返回，Octave 之后同步 `dlopen` 不再编译。
   接线：`build/post.js` 暴露 `Module.loadDynamicLibrary`；`bridge/assets-loader.js` 的
   `SYNC_COMPILE_LIMIT` 对 >8MB 的 `kind: oct` 走这条路。
2. **`.oct` 需要主模块胶水里的 JS 库函数**（`emscripten_longjmp`）。资产车道的 `.oct` 不在主链
   命令行上 ⇒ 它们的 JS 导入不会被自动收进胶水（`tools/link.py:2876` 只对**命令行上的**
   side module 做这件事）。**已解**：按主树同款（wasm-SjLj）重编 Mesa/GLU
   （`-mllvm -wasm-enable-sjlj` ⇒ `longjmp` 落到主模块**已导出**的 `__wasm_longjmp`）。
   顺带得到一条通用教训：`EXPORTED_FUNCTIONS` 传 JS 库函数名是**硬错误**
   （`undefined exported symbol`，带不带下划线都一样）。
3. **体量本身**：即使①②都解决，**10.8MB / 数据段 4.5MB / `dylink.0` `tableSize=12543`** 的
   side module 在装载期会读到**错位的字符串** —— 实测 Octave 的 API 版本检查把
   `__init_osmesa__` 错读成紧邻的 `__VERSION__`、把 `api-v61` 错读成 Mesa 的
   `VARYING_SLOT_*` 串，于是报
   `API version SLOT_VA found in .oct file function '__VERSION__'`。
   **未解**，判定为"这个体量超出 side module 那条路能干净处理的范围" ⇒ 转 B 档。

### 7.3 B 档（主 wasm 带 GL）：做法与实测进展

1. 主树 `WITH_OPENGL=1 SKIP= bash configure-113-full.sh` → `config.h` 里
   `HAVE_OPENGL/HAVE_GL_GL_H/HAVE_GL_GLU_H/HAVE_GL_GLEXT_H` 全 1 ✔
2. **`make clean` + 全量重编**（`emmake make -k -j24`）：必须 `-k` ——
   `libinterp/dldfcn/__fltk_uigetfile__.oct` 这个目标在 `--without-fltk` 下必然失败
   （`/usr/bin/install: omitting directory 'libinterp/dldfcn/.libs/'`）。
   验证 `gl-render.o` 真的带 GL：`emnm libinterp/corefcn/libcorefcn_la-gl-render.o | grep -c " U gl"` → 11 ✔
3. 主链加 `-lGL -lGLU`：`link-web.sh` 新增 `GL_LIBS=1`。**必须用绝对路径**
   （`/src/deps/glshim/lib/libGL.a`、`libGLU.a`）—— 实测 `-lGL` 能解析 `gl*`，
   但 `-lGLU` **没能**解析 `gluNewTess` 等 9 个，而 `ERROR_ON_UNDEFINED_SYMBOLS=0`
   把未定义符号静默放过（运行期才炸）。另需把 `/src/websrc/osmesa-stubs.c` 也加进去
   （`sched_getcpu`/`pthread_setname_np`）。glshim 里的 `libGL.a/libGLU.a` 要指向
   **wasm-SjLj 版**的 Mesa/GLU（否则 `emscripten_longjmp` 又冒出来）。
4. **toolkit 必须编进主模块**（`link-web.sh` 的 `P5_TOOLKIT=1`，`main.cc` 里
   `#if defined (P5_OSMESA_TOOLKIT)` 调 `p5_install_osmesa_graphics_toolkit()`）：
   `opengl_functions` 的**虚表跨模块会失效** —— 对象若由 side module 创建，
   主模块里 `opengl_renderer::set_viewport` 的回调会打到不属于它的表槽
   （`RuntimeError: table index is out of bounds`，栈顶正是 `set_viewport`）。
   Edge-Tools 的参考实现也是这个形态（toolkit 编进主模块）✔
5. **产物**：`octave.wasm` 34.30MB → **45.58MB（+11.3MB raw）**；`octave.data` 不变；
   toolkit 目标文件仅 78,731 字节（不内嵌 Mesa）。

**实测进展（8763，`siteP5`）**：
```
graphics_toolkit('osmesa')  → osmesa          ✔ 装载成功
figure(7)                   → figure，position 300 200 560 420   ✔ 真 figure
clf / line([0 1],[0 1])     → ✔ 真图形对象（不经 plot 桥）
drawnow                     → RuntimeError: table index is out of bounds   ✘ 卡在这里
```

### 7.4 已经排除的（别再重复排查）

- **签名不一致** ✔ 排除：`build/113/check-dylink-signatures.py`（本轮新增）逐个比对
  .oct 的 72 个函数导入 vs 主 wasm 的 42,267 个导出 ⇒ **0 处不匹配**。
  （这个工具踩过两个假阳性坑，都写在它的文件头：rec-group 类型段编码、
  `function` 段索引要减去导入函数个数。）
- **JS 库函数缺失** ✔ 排除（`MISSING-OCT-SYMBOL` 诊断补丁无输出）。
- **跨模块虚表** ✔ 排除（把 toolkit 编进主模块后现象相同，说明不是这条）。

### 7.5 ~~当前卡点~~ → **已解（2026-09-23 定位到根因并修好）**

> 下面 7.5 原文保留（含一处**被推翻的推断**），根因与修法见 **第八节**。
> 一句话：卡点是 `RuntimeError: table index is out of bounds`，栈顶
> `octave::opengl_renderer::set_viewport(int, int)`，**真因是 toolkit 那个编译单元
> 没 `#include "config.h"`** ⇒ `octave::opengl_functions` 被编成一个**空类**。
> **不是** `ensure_context()`、**不是** Mesa glapi、**不是**表槽没填。

原文（推断部分已作废，保留以示过程）：

`drawnow` → `redraw_figure` → **`ensure_context(w,h)` 一带**就 trap：
`RuntimeError: table index is out of bounds`。位置是**推断**得到的：
在 `render()` 里 `set_viewport` 之前插了一段**直接调 GL 入口**的探针
（`P5TK_GLPROBE`），**探针一个字都没打出来** ⇒ 推断 trap 发生在更早的 `ensure_context()`。

⚠️ **这条推断是错的，错在两处**（第八节有完整复盘）：
1. 当时那一版**根本没把探针编进去** —— `P5_GLPROBE` 只是 `link-web.sh` 的口子，
   部署产物里 `grep -c 'P5TK GL_VERSION='` = **0**。"探针没输出"是"没有探针"。
2. `octave_stdout` 是**带缓冲**的流：就算探针在，trap 之后那几行也会整个丢掉。
   ⇒ 诊断必须走 `console.error` / MEMFS 文件这类**不进 C 缓冲**的通道。

原候选清单（**全部作废**，仅供"别再走一遍"记录）：`DIAG_NAMES` 抓名、
查 Mesa glapi 的 dispatch 表、退到窄目标只做 `print -dpng`、A 档压到 8MB 以下。

### 7.6 本轮新增/修改的工具与文件

- `build/113/osmesa_toolkit.cc`（**新**；骨架抄 Edge-Tools + 官方三件套）
- `build/113/check-dylink-signatures.py`（**新**；side module ABI 检查器）
- `build/113/vendor-edge-tools/`（**新**；上游参考实现与文档，GPL-3.0-or-later）
- `bridge/p5canvas.js`（**新**；`OctaveP5.show/useOsmesa/useWeb/demo/status`）
- `build/p5osmesa/PKG_ADD`（**新**；`.oct` 车道时的登记层；B 档下已不需要）
- `test/browser/accept-p5-osmesa.mjs`（**新**，后改名 `accept-p5-graphics.mjs`；真渲染的验收，含 PNG 魔数/getframe/逐图类型）
- `build/113/link-web.sh`：新增 `GL_LIBS` / `LIB_FUNCS` / `P5_TOOLKIT` / `P5_GLPROBE` / `P5_TRACE` 五个口子
- `build/post.js`：暴露 `Module.loadDynamicLibrary`（>8MB `.oct` 的异步预加载）
- `bridge/assets-loader.js`：`SYNC_COMPILE_LIMIT` + `preloadIfHuge()`
- `build/main.cc`：`P5_OSMESA_TOOLKIT` 下安装 osmesa toolkit
- **Mesa/GLU 用 wasm-SjLj 重编**：`/src/libwork/mesa-build-sjlj`、`/src/libwork/glu-build-sjlj`
  （交叉文件 `emscripten-cross-sjlj.ini`：加 `-fwasm-exceptions -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh`）

---

## 八、2026-09-23（当天收尾）：卡点根因 = 缺 `config.h`；步骤②③ 打通并验收

**结果**：8763 上 `accept-p5-osmesa.mjs` **54 PASS / 0 FAIL**，逐图类型真出图。
`plot/plot3/semilogy/loglog/stairs/stem/area/bar/pie/contour/errorbar/scatter/scatter3/mesh/surf`
全部渲出非空白画面（解码 PNG 数颜色：plot 375 色、surf 5465 色、contour 2943 色…）。

### 8.1 根因：toolkit 的编译单元没包含 `config.h`

`oct-opengl.h` 里 **`class opengl_functions` 的整份虚函数表被 `#if defined (HAVE_OPENGL)` 包着**
（内层还有一处 `HAVE_GLBLENDFUNCSEPARATE`）：

```cpp
class opengl_functions {
  virtual ~opengl_functions () = default;      // 无条件，永远在
#if defined (HAVE_OPENGL)
  virtual void glAlphaFunc (...) { ::glAlphaFunc (...); }   // ← 几百个
  ...
#if defined (HAVE_GLBLENDFUNCSEPARATE)
  virtual void glBlendFuncSeparate (...) { ... }
#endif
#endif
};
```

`HAVE_OPENGL` / `HAVE_GLBLENDFUNCSEPARATE` **只来自 autoconf 的 `config.h`** ——
`octave-config.h` 与 `oct-conf-post-public.h` 里**都没有**（两个文件都 grep 过，零命中）。
而 `osmesa_toolkit.cc` 的 include 列表里**根本没有 `config.h`**（`-DHAVE_CONFIG_H` 只是
个门闩，没人 `#include` 就没用）。

后果：
- **toolkit 的 TU** 里 `HAVE_OPENGL` 未定义 ⇒ `opengl_functions` = **只有虚析构的空类**，
  虚表**只有 2 槽**；
- **`gl-render.o`** 按 `HAVE_OPENGL=1` 编的，`opengl_renderer::set_viewport` 会去取
  **第 77 槽**（反汇编原文：`i32.load offset=0` 取 vptr → `i32.load offset=0x134` 取槽
  → `call_indirect type=7`，type7 = `(i32×5)->void`，正是 `glViewport` 的 `this+4` 参）
  ⇒ 读到虚表以外的字节 ⇒ `table index is out of bounds`。

**对象级证据**（比推断硬）：
```
$ llvm-nm /tmp/tk_old.o | grep 'opengl_functions'     # 旧版
   W _ZN6octave16opengl_functionsD0Ev      ← 删除析构
   W _ZN6octave16opengl_functionsD2Ev      ← 析构
   W _ZTIN…  _ZTSN…  _ZTVN…                ← typeinfo + 虚表
   （**一个 glXxx 都没有**）
$ llvm-nm /tmp/tk_fixed.o | grep -c opengl_functions  # 修好后
   83
   W _ZN6octave16opengl_functions10glViewportEiiii
   W _ZN6octave16opengl_functions7glBeginEj
```
**修法**：在 `osmesa_toolkit.cc` 顶部按 Octave 自己的惯例加上

```cpp
#if defined (HAVE_CONFIG_H)
#  include "config.h"
#endif
```

（`gl-render.cc:26-28` 就是这么写的。所有碰 `opengl_functions` 的 TU 必须口径一致。）
产物只大了 **+5KB**（45,575,425 → 45,580,621 字节），代价可忽略。

### 8.2 为什么之前会在 `ensure_context()` 上误判

因为诊断通道选错了（见 7.5 的两条更正）。这次换了三条**能穿过 trap** 的手段：

1. `DIAG_NAMES=1`（`--profiling-funcs`）→ 浏览器栈里出**函数名**，一次就把
   `set_viewport(int,int)` 点名；
2. 解析 wasm 二进制定位**具体指令**：trap 偏移处的字节是 `11 07 00`
   （`call_indirect type=7 table=0`），前面 `28 02 b4 02` 是 `i32.load offset=0x134`
   ⇒ 槽号 77，实锤"虚表槽越界"而不是"GL 入口不可用"。
   （`function` 段索引 = 报告索引 − 导入函数数；本模块导入 392 个。）
3. `P5_TRACE=1`（新增，`link-web.sh` 口子）：把 `render()` 的每一步**同时**写到
   `console.error` 和 **MEMFS 的 `/tmp/p5trace.txt`** —— 后者不怕 trap、不怕
   console 被轮询清空。

### 8.3 步骤③：plot 桥要**同时**建真图形对象（`build/plotbridge/__pb_mirror__.m`）

修好渲染之后，`plot(...); drawnow` 仍然是**白图** —— 这次是另一个原因，**实测**：

```
plot(1:10,(1:10).^2)  → findall(gcf,"type","axes") = 0, "line" = 0
surf(peaks(13))       → findall(gcf,"type","axes") = 0, "surface" = 0
line([0 1],[0 1])     → 真对象正常（不走桥）
title("t")            → 1 个真 axes（title 走 gca，gca 会建 axes）
```

**plot 桥（`build/plotbridge/`）的 .m 只把数据记进自己的状态**（`__pstate__` 的
series/panels），**一个真图形对象都不建** —— 那是 v1 时代（没有 toolkit、渲染在 JS 侧）
的设定。渲染器没毛病，是**没有东西可画**。

**做法**：新增 `build/plotbridge/__pb_mirror__.m`，桥的每个绘图/状态函数在结尾多调一句：

```matlab
h = __pb_mirror__ ("plot", varargin{:});   ## 有返回值的绘图函数
__pb_mirror__ ("hold", varargin{:});       ## 纯状态函数（hold/clf/grid/xlim/ylim/legend/axis/subplot）
```

它把桥目录**临时从 path 上摘掉**，`feval` 同名**核心**函数，再**原样**恢复 path。

为什么不从零抄：`__plt__` 是 `plot/draw/private/` 的**私有**函数，桥在别的目录调不到；
手抄 newplot/box/颜色循环/hold 语义必然走样。

**⚠️ 关键实测：整段核心调用期间都必须摘掉桥**（不能只把顶层函数换成句柄）。
试过"一次性 `str2func` 取核心句柄、之后不再动 path"（快 6.6×：0.058s vs 0.386s/图），
**但 `pie`/`contour` 必炸**：

```
error: axis: limits must be a 2- or 4-element vector
called from axis … __pie__ at line 158
```
因为核心 `__pie__` 里写的是 `axis (h, [-1.5 1.5 -1.5 1.5], "square", "off")` ——
**首参是句柄**，而桥的 `axis.m` 只认"当前 axes"的两种形式。整段摘 path 之后那句
`axis` 解析到核心，问题消失。

**代价（如实）**：一次 `path(…)` 会重扫整条路径，实测 **0.13 s**；一次镜像要两次
⇒ **每张图多约 0.26 s**。接受，并记在这里。

**门禁**：只在**真渲染器在线**时才镜像（白名单目前只有 `osmesa`）。
默认的 `web` toolkit 不渲染，镜像只会凭空多出真对象、改掉 `findall`/`get` 语义 ——
T2 验收正按老语义写的。**8761 部署用的 `web` ⇒ 行为逐字节不变**（验收里有一条专门守这个）。

### 8.4 这一轮踩到的新坑（都写进代码注释了）

| 坑 | 现象 | 修法 |
|---|---|---|
| `mfilename("fullpath")` 在**子函数**里不给全路径 | `fileparts` 得空串 ⇒ 桥没被摘掉 ⇒ `feval` 调回桥自己 ⇒ **无限递归** | 改用 `which("__pb_mirror__")`，并加"path 没变就明确报错"的兜底 |
| `h = feval("hold","on")` | `error: hold: function called with too many outputs`（hold 没有返回值） | 按 `nargout` 分两条路：有输出才赋值 |
| `path()` 重扫会重报 `Octave:shadowed-function` | 站点本来就有 `m/forge/fft.m` 影子内建 `fft`，刷屏到看不见别的输出 | 只针对这一个 id `warning("off",…)` + 退出时按原状态恢复 |
| `m_last_pixels(i) != 255` | 编译期歧义（`octave_uint8` 有一堆隐式转换） | 拿 `octave_uint8 (255)` 比 |
| "探针没输出"≠"没走到那里" | 见 7.5 | 诊断通道选 `console.error`/MEMFS 文件 |

### 8.5 复现命令（容器内）

```bash
# 修好的主 wasm（工具链一切照旧，只多了一句 config.h）
cd /src/bin && PATH=/src/bin:$PATH M_SRC=/src/work/m-prerendered/m \
  GL_LIBS=1 P5_TOOLKIT=1 bash link-web.sh /src/websrc/p5fix
# 诊断版（带函数名 + 逐步 trace）
cd /src/bin && PATH=/src/bin:$PATH M_SRC=/src/work/m-prerendered/m \
  GL_LIBS=1 P5_TOOLKIT=1 P5_TRACE=1 DIAG_NAMES=1 bash link-web.sh /src/websrc/p5tr
# 桥资产（改了 .m 之后必须重打；manifest 的 sha256 也要同步）
python3 build/assets.py bundle-m plotbridge build/plotbridge /usr/src/octave/m/plotbridge <site>/assets/m/plotbridge.js
```

