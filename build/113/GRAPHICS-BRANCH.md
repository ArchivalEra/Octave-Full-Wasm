# graphics-osmesa 分支 / 图形线（P5 OSMesa）—— **现行说明**

> **本文以 `main` 上这份为准。** 历史上这条分支只比 `main` 多一份说明文件
> （OSMesa 的源码/脚本/笔记一直都在 `main` 上），下面这份就是那份说明的**现行版本**；
> 分支上的旧副本已标注为过时。
>
> 一句话口径：**图形线不再是"开新分支才做"的事** —— 代码/测试/笔记都在 `main`，
> 实验只在**独立端口 8763（`/mnt/hdd/octave-wasm-build/siteP5`）**上做；8761 不动。

## 一、现状（2026-09-23）

| 阶段 | 状态 | 证据 |
|---|---|---|
| 步骤① OSMesa 在 wasm 里渲出图形（含立即模式） | ✅ | `build/113/osmesa-smoke.c/.sh`：清屏红 + 立即模式绿三角，4/4 像素断言 PASS；`GL_RENDERER=softpipe` |
| 步骤② 库层面（glshim / libGLU 剖分 / `WITH_OPENGL=1` configure） | ✅ | `build/113/NOTES-p5-osmesa.md` §1–§2 |
| 步骤② 真渲染：toolkit 挂上、figure 能建 | ✅ | `graphics_toolkit('osmesa')`=`osmesa`、`figure(7)` 真对象、`clf`/`line()` 正常 |
| 步骤② 真渲染：**画出像素** | ⬜ **卡住** | `drawnow` → `RuntimeError: table index is out of bounds`，位置在 `ensure_context()` 一带（精确坐标见 `NOTES-p5-osmesa.md` §7.5） |
| 步骤③ `plot/surf/mesh/contour` 逐个出图对照 | ⬜ 未开始（等②） | —— |

## 二、做法（**已从"资产自包含"改成"主 wasm 带 GL"**）

原计划是"A 档"：把 Mesa 全打进一个自包含的 `.oct`、**主 wasm 零改动**。
试到底后撞了三道墙（都有实测，见 `NOTES-p5-osmesa.md` §7.2），改用 **B 档**：

1. 主树 `WITH_OPENGL=1 SKIP= bash configure-113-full.sh` + `make clean` + `emmake make -k -j24`
   （**必须 `-k`**：`__fltk_uigetfile__.oct` 这个目标在 `--without-fltk` 下必然失败）
2. 主链带 GL：`link-web.sh` 的 `GL_LIBS=1` → 绝对路径的 `glshim/libGL.a`(=`libOSMesa.a`) /
   `libGLU.a` + `osmesa-stubs.c`
3. **toolkit 编进主模块**：`link-web.sh` 的 `P5_TOOLKIT=1`（`main.cc` 里
   `#if defined (P5_OSMESA_TOOLKIT)` 调 `p5_install_osmesa_graphics_toolkit()`）——
   `opengl_functions` 的虚表跨模块会失效，必须同模块
4. 页面侧：`bridge/p5canvas.js`（`OctaveP5.show/useOsmesa/useWeb/demo/status`）

**代价（如实）**：`octave.wasm` 34.30MB → **45.58MB（+11.3MB raw）**。这是 B 档的代价，
也是它不能直接上 8761 的原因（要上线得先谈这个体积账）。

**回退始终在**：`graphics_toolkit('web')`（T2 的稳定句柄面）+ plot 桥 + `print -dsvg`
三者不受影响；`siteP5` 是独立目录，删掉/重拷即可。

## 三、开工前必读

- **`build/113/NOTES-p5-osmesa.md`**（本线的主记录）：§1–§2 步骤①/② 已做成什么、
  §5 那张"误判更正"、**§7 本轮实况（A 档三道墙 → B 档做法 → 卡点坐标 → 已排除项）**
- **`HANDOFF.md` §5.16**（一句话现状 + 主树 opengl-ON 的切换办法）与 §5.17（网络/推送）
- **`build/113/vendor-edge-tools/`**：Edge-Tools 的参考实现（`webgl-graphics-toolkit.cc`）
  与他们的结论（`MILESTONE-2.md`）—— GPL-3.0-or-later，**用前须注明出处**

## 四、纪律（不变）

- **8761 永不退化**：图形一律在 **8763** 上做；上线要等全量回归全绿 + 体积账谈清
- 每步 `docker commit` 检查点；文档用 Read/Edit/Write 改；新文件同步 `.gitignore` 白名单
- **数值/行为只认实测**；做不到就如实记录（本线已按这条记了两次"探针更正"）
- 不 force-push / 不改历史 / 禁用 `--no-verify`
