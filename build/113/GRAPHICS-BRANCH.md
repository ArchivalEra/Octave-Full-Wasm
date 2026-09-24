# graphics 分支 / 图形线 —— **现行说明**（2026-09-23 收口：只剩 `webgl` 一条后端）

> **本文以 `main` 上这份为准。**
> 一句话口径：**图形线不再是"开新分支才做"的事** —— 代码/测试/笔记都在 `main`，
> 实验只在**独立端口 8768（`/mnt/hdd/octave-wasm-build/siteWebGL`）**上做；
> 8761 的换装走 `build/promote-webgl.sh`（见 §四）。
>
> ## ✅ 2026-09-23：**A 档落地，图形线收口**
> 用户拍板的 "A" 一次做完四件（详见 `HISTORY.md` §5.21 与 `NOTES-webgl.md` §4.6）：
> 1. **`webgl` 成默认 toolkit** ⇒ 开箱 `plot(...); drawnow` 就出真图（`webgraphics/PKG_ADD`）；
> 2. 加 `FULL_ES3`（上下文本来就是 WebGL2；ES3 管的是 emscripten 那层 GLES3 模拟，
>    实测 +9,291 字节、全绿 ⇒ 保留）；
> 3. **OSMesa 后端退役** —— 仓内 7 个文件删除、`link-web.sh`/`main.cc`/桥/页面/测试的后端分支
>    全部收成一条（`GL_BACKEND` 给别的值会**明确失败**并指路到 `graphics-osmesa` 分支）；
>    编译期那处"隐藏依赖 Mesa 头"也换掉了（`build/113/gl-headers-webgl.sh`，见 §二末）；
> 4. **plot 桥的镜像层改一次性句柄缓存 + 深度转发** ⇒ **一次镜像 146 → 1.5 ms（~97×）**、
>    每图温开销 **395 → 94 ms（4.2×）**（`NOTES-webgl.md` §4.5.13）。
>
> 一手记录：**`build/113/NOTES-webgl.md`**（接手先读它）；OSMesa 那条线的全过程与教训保留在
> **`build/113/NOTES-p5-osmesa.md`**（**该线已退役**，脚本与配方在 git 历史的
> `graphics-osmesa` / `graphics-osmesa-p5` 分支）。
>
> ## ✅ 2026-09-24：**文字渲染补上（FreeType）+ 体积大降（`MAIN_MODULE=2`）**
> 两件都不是"图形算法"改动，但都直接影响这条线的观感与首包：
> 1. **FreeType 文字渲染上线**（批次 D）：刻度/`title`/`legend` 出字，**不需要 fontconfig**
>    （回落字体就是 Octave 自带的 4 个 FreeSans）。验收 `probe-text-render.mjs`（6 项，
>    加标题后 `getframe` 非白像素 **+2130**，无 FreeType 时是 +0）。见 `NOTES-webgl.md` §4.8
>    与 `build/CLIBS.md`「批次 D」。
> 2. **`MAIN_MODULE=2`（DCE）上线**（批次 C）：`octave.wasm` **36.86 → 29.28MB（含 FreeType）**、
>    主模块导出名 **44,987 → 703**。核心风险是 `.oct` 懒加载（当年 route A 就死在那），
>    每次换 M2 都必须过 `check-oct-imports.py` 保活闸门 + `probe-m2-lazyload.mjs`。
>    见 `NOTES-webgl.md` §4.9 与 `build/CLIBS.md`「批次 C」。


## 一、现状（2026-09-23）

| 阶段 | 状态 | 证据 |
|---|---|---|
| **默认真渲染：`webgl`（gl4es → GLES2 → WebGL2，GPU）** | ✅ **现行唯一后端** | 8768 上 `accept-p5-graphics.mjs` **64 PASS / 0 FAIL**；`graphics_toolkit()` 开箱返回 `webgl`；全量 **32 套 848 项全绿** |
| 步骤①②③（真渲出像素 / 逐图类型 / getframe） | ✅ | `NOTES-webgl.md` §4.4；15 种图解码 PNG 后全部非空白（`plot…surf`） |
| **plot 桥两刀提速** | ✅ | ①按行发 series：桥的 `surf(peaks(40))` **1686 → 480 ms（3.5×）**；②镜像层句柄缓存：一次镜像 **146 → 1.5 ms**、每图温开销 **395 → 94 ms**。见 `NOTES-webgl.md` §4.5.12 / §4.5.13 |
| 体积 | ✅ | `octave.wasm` 36.86MB（raw）；比基线（不带 GL）**+2.5MB**，比退役的 OSMesa 版**省 ~8.9MB** |
| 让 **toolkit/核心** 自己扛 `print` 矢量输出 | ❌ **走不通**（非本线问题） | Octave 的 `__opengl_print__.m` 要 **gl2ps + shell 管道 + (gs\|svgconvert)**；gl2ps **已补上**，但**没有 shell 是本构建的有意设计** ⇒ **plot 桥的 SVG 仍是唯一矢量实现，别当冗余砍**（§5.20 / NOTES §4.5.9–4.5.11）|
| OSMesa（Mesa 软件光栅化） | ⛔ **已退役** | 它能跑（步骤①②③ 都通过过），但 CPU 逐像素、体积 +11.3MB ⇒ 被 gl4es 取代。脚本/配方在 git 历史；记录在 `NOTES-p5-osmesa.md` |

**仍未做（如实记）**：① **手机真机速度**（模拟器验不了 WebGL，`HISTORY` §5.19）；
② ~~**文字渲染缺**~~ → **2026-09-24 已补上（FreeType，见上）**；
③ **首帧冷启动 ~0.6 s**（建上下文 + `initialize_gl4es()` + 编 shader；批次 E 量过，结论
见 `HISTORY.md` §5.27）；④ `print -dpdf/-dps` 的 gl2ps 路径未实测（缺 shell 管道，见上）。


## 二、做法（**"主 wasm 带 GL"**）

原计划是"A 档"：把 Mesa 全打进一个自包含的 `.oct`、**主 wasm 零改动**。
试到底后撞了三道墙（都有实测，见 `NOTES-p5-osmesa.md` §7.2），改用 **B 档**：


1. 主树 `WITH_OPENGL=1 SKIP= bash configure-113-full.sh` + `make clean` + `emmake make -k -j24`
   （**必须 `-k`**：`__fltk_uigetfile__.oct` 这个目标在 `--without-fltk` 下必然失败）
2. 主链带 GL：`link-web.sh` 的 `GL_LIBS=1` → 绝对路径的 `glshim/libGL.a`(=`libOSMesa.a`) /
   `libGLU.a` + `osmesa-stubs.c`
3. **toolkit 编进主模块**：`link-web.sh` 的 `P5_TOOLKIT=1`（`main.cc` 里
   `#if defined (P5_OSMESA_TOOLKIT)` 调 `p5_install_osmesa_graphics_toolkit()`）——
   `opengl_functions` 的虚表跨模块会失效，必须同模块
4. **`osmesa_toolkit.cc` 顶部必须 `#include "config.h"`**（`HAVE_CONFIG_H` 门闩下）——
   **这是打通渲染的那一条**：少了它，该 TU 里 `HAVE_OPENGL` 是未定义的，
   `octave::opengl_functions`（`oct-opengl.h` 里整份虚表被 `#if defined (HAVE_OPENGL)` 包着）
   会退化成**只有虚析构的空类**，而 `gl-render.o` 仍按 `HAVE_OPENGL=1` 去取第 77 槽 ⇒ 越界 trap
   （详见 `NOTES-p5-osmesa.md` §8.1）
5. **plot 桥同时建真对象**：`build/plotbridge/__pb_mirror__.m` —— 桥的每个绘图/状态函数结尾
   多调一句，把桥目录临时摘出 path 再 `feval` 同名核心函数（只在 `osmesa` 在线时生效）
6. 页面侧：`bridge/p5canvas.js`（`OctaveP5.show/useOsmesa/useWeb/demo/status`）

**代价（如实）**：`octave.wasm` 34.30MB → **45,580,621 字节（+11.3MB raw）**。这是 B 档的代价，
也是它不能直接上 8761 的原因（要上线得先谈这个体积账）。
另有一条**运行期**代价：镜像层每张图多约 **0.26s**（两次 `path()` 重扫，各约 0.13s）。

**回退始终在**：`graphics_toolkit('web')`（T2 的稳定句柄面）+ plot 桥 + `print -dsvg`
三者不受影响（镜像层在 `web` 下**完全不走**，验收里有一条专门守这个）；
`siteP5` 是独立目录，删掉/重拷即可。

## 三、开工前必读

- **`build/113/NOTES-p5-osmesa.md`**（本线的主记录）：§1–§2 步骤①/② 已做成什么、
  §5 那张"误判更正"、§7 本轮过程（含一处**被推翻的卡点推断**）、
  **§8 根因与修法（缺 `config.h`）+ 镜像层 + 本轮 5 个新坑 —— 接手先读它**
- **`HISTORY.md` §5.16**（一句话现状 + 主树 opengl-ON 的切换办法）与 §5.17（网络/推送）
- **`build/113/vendor-edge-tools/`**：Edge-Tools 的参考实现（`webgl-graphics-toolkit.cc`）
  与他们的结论（`MILESTONE-2.md`）—— GPL-3.0-or-later，**用前须注明出处**

## 四、纪律（不变）

- **8761 永不退化**：图形一律在 **8763** 上做；上线要等全量回归全绿 + 体积账谈清
- 每步 `docker commit` 检查点；文档用 Read/Edit/Write 改；新文件同步 `.gitignore` 白名单
- **数值/行为只认实测**；做不到就如实记录（本线已按这条记了三次更正：
  "四个 GL 头门禁"、"trap 在 `ensure_context()`"、"探针没输出"）
- 不 force-push / 不改历史 / 禁用 `--no-verify`
