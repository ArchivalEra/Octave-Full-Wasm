# Octave-Full-Wasm

目标：**浏览器里跑满功能 Octave**（当前基线 **11.3.0**）——把官方发行版缺的宿主组件
换成浏览器原生 API，并把 C 库长尾尽量补全：全量核心脚本、Forge 包、
SuiteSparse / ARPACK / FFTW / QHull / GLPK / HDF5、图像与音频 I/O、同步网络、
plot 桥 + `print -dsvg`。

起点是 `rwl/octave-wasm`（BSD）的 7.2 骨架；**第四轮已换基线到 vanilla
Octave 11.3.0 + emsdk 5.0.7**（计划见 `HISTORY.md` §9，实况与坑见 §10）。
构建产物（wasm/data/js）体积大，走 Release 分发，不进 git。

## 为什么是网页版

省磁盘空间只是它最不重要的一个意义。真正区分度在于：

1. **零安装零配置**——桌面 Octave 的使用链是：下载→安装→摸清路径→装包→配
   gnuplot/图形，每一步劝退一批人；网页版是**一个链接**。对"考前冲刺"场景，
   安装成本直接等于放弃率。
2. **手机能用**——桌面版永远做不到。通勤/课间用手机跑一段矩阵、看一眼图。
3. **可分享、可复现、版本钉死**——URL 即环境；Octave 11.3.0 + 具体 BLAS/包版本
   全打包，所有人算出的数字一致。桌面版是"在我机器上能跑"。
4. **示例可以内嵌成"活的"**——教材解析里的例子不再需要"自己复制到 Octave 试"，
   点一下就跑，输出长在讲解旁边。文字/符号气泡/可执行代码是**同一个产物**。
   plot 桥（Octave 算→SVG 上屏）正是靠这个接缝才成立。
5. **沙箱与确定性**——用户代码跑在隔离 wasm 里：碰不到文件系统、发不了进程
   （`system()` 清晰报错）。做自动评测/作业批改不必起 Octave 服务器。
6. **分发边际成本为零**——纯静态资源上 CDN，算力在用户浏览器；用户数从 1 涨到
   1 万，服务端成本不变。
7. **教学上"受限"反而可能是优点**——能精确定义哪些可用、哪些明确报错；受控子集
   比"什么都能装、装完就崩"更适合初学者。

一句话：桌面版是「**一台装着 Octave 的电脑**」，网页版是「**一个能算、能画、
能被链接和嵌入的 Octave**」。前者拼功能完整性，后者拼**分发与集成**。
代价也要认清：慢（wasm 单线程、无 JIT）、无工具箱生态、无 GUI 工具链、内存受限——
它不是取代桌面版，是**另一个产品**。

## 架构

```text
Octave 11.3.0 wasm（build/113/configure-113-full.sh + link-web.sh；-O2 编译）
├── 全量核心 .m（plot/ode/signal/special-matrix/…，两段式 addpath）
├── vendor/forge：forge statistics 纯 .m（normpdf/tcdf/ttest 依赖…）
├── 真 .oct 动态装载：主模块 -s MAIN_MODULE=1，模块编成 wasm side module
│   运行时 dlopen —— 与桌面版插件模型一致，加模块不必重链那 36MB 主 wasm。
│   连 dldfcn（convhulln/gzip/glpk/fftw/audioread/…）也走这条路。
├── 资产懒加载车道：站点 assets/ 下按需 fetch → 写 wasm FS → addpath
│   （Forge 包、SUNDIALS、图像、音频、网络、plot 桥覆写全在这里）
├── plot 桥 v2：Octave 算 → spec → SVG（2D + 3D，含 subplot/figure(n)/axis）
└── print -dsvg：纯 .m SVG 生成器（不依赖 gnuplot，也不需 Asyncify）
```

构建命令里 `-s MAIN_MODULE=1` 与 `-fPIC` 是一对：主链带 MAIN_MODULE 时，
Octave 本体与静态库必须全部 `-fPIC` 重编，否则 wasm-ld 报 `recompile with -fPIC`。
**11.3.0 车道的重配/重链是 `build/113/configure-113-full.sh` + `build/113/link-web.sh`**
（依赖写成一张表，`SKIP=<库名>` 可按库集合二分；7.2 时代的 `build/reconf-pic.sh`
保留作历史记录）。配方与坑见 `build/CLIBS.md`。

## 状态（2026-09-24 实测）

**基线 = Octave 11.3.0（带真渲染器 + FreeType 文字 + fontconfig 字体匹配 + `MAIN_MODULE=2`）**。`http://127.0.0.1:8761/`
服务的就是**最近一次通过浏览器实测**的构建（**wasm sha256 见 `HANDOFF.md` 文末 `AUTO:STATE`**，
别在这里抄 —— 默认 toolkit = `webgl`）。
**全量回归的套件数与项数以 `HANDOFF.md` 文末的 `AUTO:STATE` 区块为准** —— 那几件数字由
`.githooks/update-handoff.py` 从部署件与最近一次全绿回归重算，本文不再抄一份（抄一份必烂）。**R1–R10 需求全部落地**，第三轮 T1–T5 亦已完成
（见 `build/GAPS.md` 的需求书与 `HISTORY.md` §5 / §10 的结论表）。

| 项 | 结果 |
|---|---|
| 线代/微积分/优化/ODE45/多项式 | ✅ 全对（与本机同版 11.3.0 **逐位一致**） |
| 统计分布 + ttest/regress + fft 后备 | ✅ 全对 |
| R1 SUNDIALS → `ode15s`/`ode15i` | ✅ 真 `__ode15__.oct`（SUNDIALS 静态码全在模块内，主 wasm 零改动） |
| R2 Forge 包（statistics/optim/signal/control/…） | ✅ 懒加载，真数值验证 |
| R3 HDF5 → `save/load -hdf5` | ✅ 往返/压缩/`whos -file` 全通 |
| R4 图像 → `imread`/`imwrite`/`imfinfo` | ✅ PNG/BMP/TGA 像素级无损 |
| R5 网络 → `urlread`/`urlwrite`/`webread`/`websave` | ✅ **真同步**（同步 XHR，无需 Asyncify） |
| R6 压缩归档（6 个函数无 shell 化） | ✅ 二进制字节级往返 |
| R7 CXSparse | ✅ 已开（SPQR 不是缺口，`spqr` 3.6.0 就被 `qr` 取代） |
| R8 WebAudio → `audioplayer` | ✅ 18 个符号纯 `.m` 实现，真实 AudioContext 调度 |
| R9 图形导出 → `print -dsvg` | ✅ 2D + 3D 都能出，不依赖 gnuplot |
| R10 编译级别 | ✅ 11.3.0 车道走 `-O2`；R10 计时护栏（1e6 循环 <1.5s）通过 |
| plot 桥 | ✅ v2：2D（含 subplot/figure(n)/axis）+ 3D（plot3/mesh/surf/contour）+ 中文标签 |
| **图形句柄（T2）** | ✅ `web` toolkit：`figure/gcf/gca/get/set/title/close` 全可用（资产车道） |
| **真渲染（2026-09-23）** | ✅ **默认 toolkit = `webgl`**（gl4es → WebGL2/GPU）：开箱 `plot(...); drawnow` 出真图、`getframe` 真像素；`accept-p5-graphics` **65/65** |
| 官方 `.oct` 装载 | ✅ dldfcn 也走 dlopen，`exist=3` / `which()` 返回 `.oct` 路径 |
| 稀疏 `lu`（UMFPACK） | ✅ 可用（根因：建 SuiteSparse 时漏传 `-DNBLAS`/`-DNSUPERNODAL`） |
| `lsode` | ✅ 可用（根因：f2c 回调实参个数 4 vs 5，wasm `call_indirect` 做精确类型检查） |
| SLICOT（control 编译件） | ✅ 可用（根因：CHARACTER 隐藏长度 ABI + 主模块不导出 LAPACK/BLAS；`accept-slicot` 25/25） |
| 交付包（可静态托管） | ✅ `dist/octave-full-wasm-site-20260924`（**含真渲染 + 持久化 + 两个字体家族**），首包 gzip ≈**10.26MB**（准确值见 `HANDOFF.md` 的 `AUTO:STATE`） |
| 验收 | ✅ **全绿**（8761；**套件数与项数见 `HANDOFF.md` 的 `AUTO:STATE`**，含需求级 `accept-requirements`、图形线 `accept-p5-graphics` **65 项**、无 shell 报错 `accept-shellerr` 14 项） |


### 已知偏差（如实）
- ~~**`help` 对非平凡输入报 `makeinfo` 子进程错误**（无 shell）~~ → **T1 已修（内建）**：
  构建期用**真 makeinfo 预渲染** `built-in-docstrings`（与 Octave 自己的
  `mk-doc-cache.pl` 同一技术），运行时零新代码。`help sin`/`help sqrt`/`help disp` 可用。
  （**2026-09-23 更新**：`help ode45` 这类 `.m` 的 docstring 也修好了 —— 构建期预渲染 + 去标记，
  见 HISTORY §5.13；`accept-t9-helpm` 18/18。**该缺口已彻底消除。**）
- `fftw('threads',N)` 静默 no-op（`fftw_init_threads` 桩须返回成功，否则核心 `fft` 崩）。
- **无 shell 的入口一律"清晰报错"**（2026-09-24 起，覆写层 `build/webshims/`）：
  `[st,out]=system(...)`/`unix(...)` 一向如此；`st = system(...)`、`system(...)`（无输出参数）、
  `popen(...)` 这三条**以前静默返回 -1 / 静默通过**，现在同样抛清晰错误（HISTORY §5.30，`accept-shellerr` 14 项）。
  ⇒ 这不只是措辞：**任何调 `system()` 的 `.m` 现在会明确失败，而不是悄悄拿到 -1 继续跑**。
- **"等用户动作"一族一律"清晰报错"**（2026-09-24 起，同一覆写层）：`ginput`/`keyboard`/
  `uisetfont`/`uiwait`/`waitfor` **以前会挂死页面**（8 s 无响应，比报错更糟），现在报错并点明
  替代办法（`input()` 走 `window.prompt` 可用；字体直接 `set(h,"fontname",…)`）。
  连带 `waitforbuttonpress`/`gtext`（内部调 `ginput`）。钉子 `accept-interactive` 15 项。
  ⇒ 真实现要等 JSPI 车道（`build/113/PLAN-jspi.md` 的 G3/G5），届时**删掉那几个覆写文件**。
- **`waitbar` 可用**（2026-09-24 修）：以前整族坏在桥的 `figure` 上（`integerhandle=off` 形态），
  现在建图/更新/取帧都正常（HISTORY §5.35）。
- ~~**control 包的 SLICOT 编译件未发布**~~ → **2026-09-23 已修好并发布**（HISTORY §5.15）：
  `ss`/`step`/`pole`/`zero`/`norm`/`lyap`/`dlyap`/`care`/`tf2ss`/`c2d` 全可用且数值正确
  （`step` 与解析解 `1-e^-t` 误差 1.1e-16）。
- ~~`voronoi` 单输出形式（要画图）不可用~~ → **2026-09-24 已修**（桥支持 `plot(hax,…)`，HISTORY §5.30）；两输出形式照旧。
- **`print` 的矢量输出只有 plot 桥那一条路**（`-dsvg` 由桥自己的 `__svg_render__.m` 出）。
  Octave **核心**的 `print` 管线（`__opengl_print__.m`）要 **gl2ps + shell 管道 + (gs|svgconvert)**：
  gl2ps **2026-09-23 已补上**（`build/113/build-gl2ps.sh` + `configure-113-full.sh` 的
  `WITH_GL2PS=1`），但**"没有 shell"是本构建的有意设计**（`system`/`unix`/`popen` 清晰报错）
  ⇒ `print -dsvg` 仍报 `failed to open pipe "| cat > …"`，`-dpdf/-dps/-deps` 另需 gs。
  **所以别把桥的数据管线当冗余砍掉**（详见 `HISTORY.md` §5.20、`build/113/NOTES-webgl.md` §4.5.9–4.5.11）。

## 下一步（第三轮：浏览器环境语义）

R1–R10 已全部落地。第三轮做的不是数学能力，而是**"宿主 API 怎么换成浏览器原生"**
（完整计划见 `HISTORY.md` §5.5）：

**T1** `help`（构建期 makeinfo 预渲染）、**T2** graphics 句柄半真化（薄 `web` toolkit）、
**T3** `copyfile`/`movefile`/`ls`、**T4** `pkg` 语义、**T5** `input()`、
**T6** `audiodevinfo` + `doc`（+ 页面输出落点）、**T7** `audiorecorder`、
**T8** `uigetfile`（浏览器文件选择器）、**T10** Asyncify 实验（结论：不可采用）
—— ✅ **八项均已完成**，各自验收套件全绿（`accept-help` 12、`accept-t2-graphics` 26、
`accept-fileops` 20、`accept-pkg` 16、`accept-input` 9、`accept-t6-audio-doc` 33、
`accept-t7-recorder` 40、`accept-t8-uigetfile` 19）。

**覆盖率已收口**：拿**同版桌面 Octave 11.3.0** 的 `__list_functions__`（927 个可调用名字）
逐个在浏览器里 `exist()` 对照 → **926/926 可用**；唯一不在的是 Debian 打包产物
`debian_missing_handler`（不属 Octave）。详见 `build/113/NOTES-coverage-100.md`。

**非图形待办已清零**（2026-09-23/24）：`help` 覆盖 `.m` docstring 已完成（构建期预渲染，见
`HISTORY.md` §5.13）；**T9/G1 `MAIN_MODULE=2` + 保活清单也做成了** —— `octave.wasm` 从
36.86MB 降到 **29.46MB**（含 FreeType + fontconfig），主模块导出名 44,987 → **703**，`.oct` 仍走资产车道懒加载。
配方与 7 个坑见 `build/CLIBS.md`「批次 C · `MAIN_MODULE=2`」。

依据：`build/GAPS-2.md`（缺口清单，逐条实测证据）+ `build/GPT-REVIEW-2.md`
（外部审核：两处纠错——`spqr` 早已被 `qr` 取代、`record()` 本就不阻塞；
以及 A1 的核心建议——**不复活 gnuplot 后端，改写薄 toolkit 复用现有桥**）。

> **图形线 —— 2026-09-23 收口：只剩 `webgl` 一条后端，且已是 8761 的默认**：
> Octave **自己的 `opengl_renderer`**（一字不改）真渲出像素（`getframe` 真 cdata、
> 页面 `<img>` 贴真 PNG、15 种图解码后全部非空白）。
>
> | 后端 | 做法 | `octave.wasm` | 状态 |
> |---|---|---|---|
> | `webgl` | **gl4es** 把 GL 1.x 翻译到 GLES2 ⇒ **WebGL2（GPU）** | 36.86MB raw / 8.43MB gz | ✅ **默认**（`accept-p5-graphics` 64 PASS / 0 FAIL） |
> | `osmesa` | Mesa **软件光栅化**（CPU，渲进内存） | 45,580,621（+11.3MB） | ⛔ **已退役**（脚本/配方在 git 历史的 `graphics-osmesa*` 分支） |
>
> 卡了两轮的根因只有一行：toolkit 的编译单元**缺 `#include "config.h"`** ⇒
> `octave::opengl_functions` 被编成空类（虚表 2 槽），而 `gl-render.o` 要取第 77 槽 ⇒ 越界 trap。
> plot 桥的镜像层让桥**同时**建出真图形对象（默认 toolkit 是 `webgl` ⇒ 这条链默认就开着）。
>
> **plot 桥两刀提速**：① `surf` 从"每单元格一条 series"改成"**每条行带一条**"
> （`peaks(40)`：1521 → 39 条）⇒ 桥的 `surf(peaks(40))` **1686 → 480 ms**；
> ② 镜像层从"每次摘 path"改成**一次性句柄缓存 + 深度转发** ⇒ 一次镜像
> **146 → 1.5 ms（~97×）**、一张图的温开销 **395 → 94 ms（4.2×）**。
> （顺带更正：之前把"端到端 2.1s"归因成 path 手术是**错的**，真凶是**首帧冷启动 ~0.6s**。）
>
> **已上线 8761**（换装脚本 `build/promote-webgl.sh`）：首包 gzip 9.62MB → 9.91MB。
> **没有 WebGL2 的设备也能看见图**（2026-09-23 起）：浏览器拿不到 GL 上下文时（旧设备、
> GPU 被 blocklist、`--disable-webgl`）桥把自己渲的 **SVG** 交给页面显示
> —— 此前是『命令成功、页面静默空白』。见 `HISTORY.md` §5.22 / `NOTES-webgl.md` §4.7。
> **文字渲染 + 字体匹配都有**（2026-09-24）：构建开 FreeType（批次 D）+ **fontconfig（R3）**，
> 预载 Octave **自带**的 4 个 FreeSans 面 ⇒ 刻度/标题/图例都出字，且
> `fontname`/`fontweight`/`fontangle` **真的改像素**、`listfonts()` 返回 `FreeSans`。
> **仍如实记**：只有这 4 个面，填别的家族名（如 `Courier`）会落回 FreeSans；
> 证据 `test/browser/probe-fontname.mjs`（13 项，含像素级判别）。
> 证据：`test/browser/probe-text-render.mjs`（加 `title/xlabel` 后 `getframe` 非白像素 +2130，
> 无 FreeType 时是 +0）。一手记录：`build/CLIBS.md`「批次 D」、`NOTES-webgl.md` §4.8。
> 一手记录：**`build/113/NOTES-webgl.md`**（§4.5.12 / §4.5.13 / §4.6）、
> `build/113/GRAPHICS-BRANCH.md`、`HISTORY.md` §5.20 / §5.21。

## 第四轮：已换基线到 **Octave 11.3.0**（2026-09-22 落地）

计划见 `HISTORY.md` §9，**实况、坑与结论见 §10**，外部事实依据 `build/BASELINE-11.3.md`。
要点：

- **收益**：11.x 的卷积快 10%–150×、`randi` 4.5×、logical 求和最高 6×；MATLAB 兼容
  有一整节（稀疏/对角 broadcasting、一大批函数的 `"all"`/`vecdim`/`nanflag`、
  `qr` 单输出只返回 R…）。且**与本机参照版 Octave 同版**，验收可逐位对照。
- **代价比原估小得多**：原以为 19 个 patch 要全部重推，**实测 16/19 直接可用**
  （1 个已进上游该删、2 个局部重做，共 4 个文件）。
- **取法**：工具链 emsdk 5.0.7 + **f2c（`emf77` 那套，与我们现有路线同源）** +
  Edge-Tools 的 5 处平台补丁（实测 5/5 命中 11.3.0）；**链接模型与 C 库长尾用我们自己的**。
- **结果**：三道闸门（能编能跑数值对 / `.oct` side module 可用 / **免 COI**）**全部通过**；
  8761 已切到 11.3.0，7.2 快照留在 `/mnt/hdd/octave-wasm-build/site-72bak/`。
  9 个长尾库（glpk/qhull/fftw3+3f/sndfile/qrupdate/hdf5/arpack/SuiteSparse）全部重开。
- **换基线时补的三处内容缺口**：`dldprobe.oct` 的源码入仓、`lanetest` 资产、
  `m/forge` 的 20 个预装 `.m`（否则 `normpdf` 从"开箱即有"退化成"要先加载包"）。
- **图形**（2026-09-23 已更新，见上一条引用框）：**默认 toolkit = `webgl`**（gl4es → WebGL2/GPU），
  开箱 `plot(...); drawnow` 就出真图、`getframe` 真像素；plot 桥 + `print -dsvg` 仍是
  **唯一的矢量输出**路径（核心那条要 shell 管道 + gs，本构建没有 shell 是有意的）。
  （历史：OSMesa 软件光栅化线曾在 8763 上打通步骤①②③，后被 gl4es 取代并**退役**。）
  见 `build/113/GRAPHICS-BRANCH.md`、`build/113/NOTES-webgl.md`。

> **一手记录**：`build/CLIBS.md`（每批配方与坑）、`build/BENCH.md`（O 级矩阵）、
> `HANDOFF.md`（接续说明与架构要点）、`build/GAPS.md` + `GAPS-2.md`（两轮缺口审计）。

## 目录

<!-- AUTO:FILES -->
- `.githooks/check-consistency.py` (7950 bytes)
- `.githooks/check-handoff.py` (8211 bytes)
- `.githooks/check-wants.py` (8921 bytes)
- `.githooks/check-whitelist.py` (1251 bytes)
- `.githooks/handoff-context.py` (2986 bytes)
- `.githooks/handoff_facts.py` (7496 bytes)
- `.githooks/install.sh` (388 bytes)
- `.githooks/pre-commit` (694 bytes)
- `.githooks/pre-push` (755 bytes)
- `.githooks/update-handoff.py` (4836 bytes)
- `.githooks/update-readme.py` (2270 bytes)
- `.github/workflows/deploy-heart.yml` (7352 bytes)
- `.gitignore` (2663 bytes)
- `.zcode/config.json` (791 bytes)
- `AGENTS.md` (8528 bytes)
- `HANDOFF.md` (99725 bytes)
- `HISTORY.md` (215830 bytes)
- `LICENSE` (34523 bytes)
- `THIRD-PARTY-NOTICES.md` (4285 bytes)
- `bridge/assets-loader.js` (15944 bytes)
- `bridge/index.html` (33108 bytes)
- `bridge/queue.js` (3103 bytes)
- `bridge/webaudio.js` (7303 bytes)
- `bridge/webaudiorec.js` (11861 bytes)
- `bridge/webfilepick.js` (6151 bytes)
- `bridge/webnet.js` (4146 bytes)
- `build/113/GATE3-QUESTION.md` (8148 bytes)
- `build/113/GPT-REVIEW-3-bridge-reply.md` (18378 bytes)
- `build/113/GPT-REVIEW-3-bridge.md` (8131 bytes)
- `build/113/GRAPHICS-BRANCH.md` (7731 bytes)
- `build/113/NOTES-archive.md` (4688 bytes)
- `build/113/NOTES-asyncify.md` (4664 bytes)
- `build/113/NOTES-coverage-100.md` (8206 bytes)
- `build/113/NOTES-jspi.md` (27667 bytes)
- `build/113/NOTES-lsode.md` (12160 bytes)
- `build/113/NOTES-main-module-2.md` (6400 bytes)
- `build/113/NOTES-p5-osmesa.md` (33080 bytes)
- `build/113/NOTES-slicot.md` (19273 bytes)
- `build/113/NOTES-t2-graphics.md` (7241 bytes)
- `build/113/NOTES-t6-t7-hostlayer.md` (9825 bytes)
- `build/113/NOTES-umfpack.md` (7445 bytes)
- `build/113/NOTES-webgl.md` (59320 bytes)
- `build/113/PLAN-jspi.md` (21638 bytes)
- `build/113/PLAN-next.md` (16370 bytes)
- `build/113/PROMOTION.md` (6444 bytes)
- `build/113/REVIEW-QUESTIONS.md` (5820 bytes)
- `build/113/STATUS.md` (8407 bytes)
- `build/113/apply-platform-patches.sh` (9710 bytes)
- `build/113/build-deps.sh` (9359 bytes)
- `build/113/build-fontconfig.sh` (11867 bytes)
- `build/113/build-freetype.sh` (8169 bytes)
- `build/113/build-gl2ps.sh` (4092 bytes)
- `build/113/build-glu-webgl.sh` (5242 bytes)
- `build/113/build-libs.sh` (22343 bytes)
- `build/113/build-oct.sh` (5647 bytes)
- `build/113/build-ode15.sh` (4855 bytes)
- `build/113/build-pkg-oct.sh` (9351 bytes)
- `build/113/build-sundials.sh` (6516 bytes)
- `build/113/check-dylink-signatures.py` (7526 bytes)
- `build/113/check-oct-imports.py` (10902 bytes)
- `build/113/configure-113-full.sh` (17881 bytes)
- `build/113/configure-113.sh` (12415 bytes)
- `build/113/dldprobe.cc` (1773 bytes)
- `build/113/emf77` (4503 bytes)
- `build/113/emscripten-cross.ini` (1190 bytes)
- `build/113/f2c-io-shim.c` (2398 bytes)
- `build/113/fix-rapidjson.py` (1906 bytes)
- `build/113/fix-slicot-abi.py` (13091 bytes)
- `build/113/gen-keep-list.sh` (3912 bytes)
- `build/113/gl-headers-webgl.sh` (5528 bytes)
- `build/113/gl4es-smoke.c` (8634 bytes)
- `build/113/gl4es-smoke.sh` (3808 bytes)
- `build/113/gl4es-unmangled-shim.c` (3188 bytes)
- `build/113/link-web.sh` (43576 bytes)
- `build/113/minioct.cc` (2409 bytes)
- `build/113/patch-ax-pthread.sh` (5298 bytes)
- `build/113/patch-gl4es.sh` (7469 bytes)
- `build/113/patch-odepack-callback-arity.sh` (5006 bytes)
- `build/113/probe-fontconfig.c` (4476 bytes)
- `build/113/probe-fontconfig.sh` (2848 bytes)
- `build/113/probe-jspi-b.sh` (2106 bytes)
- `build/113/probe-jspi.sh` (5404 bytes)
- `build/113/probe-jspi/jslib.js` (1069 bytes)
- `build/113/probe-jspi/main.c` (7318 bytes)
- `build/113/probe-jspi/run-b.html` (1354 bytes)
- `build/113/probe-jspi/run.html` (497 bytes)
- `build/113/probe-jspi/runner-a2.mjs` (7989 bytes)
- `build/113/probe-jspi/side.c` (700 bytes)
- `build/113/probe-jspi/side_ctor.c` (801 bytes)
- `build/113/probe-side-module.sh` (3339 bytes)
- `build/113/rebuild-pic-blas.sh` (6713 bytes)
- `build/113/ss-long64.h` (1265 bytes)
- `build/113/web_graphics_toolkit.cc` (8546 bytes)
- `build/113/webgl_toolkit.cc` (23990 bytes)
- `build/BASELINE-10.3.md` (8216 bytes)
- `build/BASELINE-11.3.md` (17814 bytes)
- `build/BENCH.md` (5886 bytes)
- `build/CLIBS.md` (90555 bytes)
- `build/GAPS-2.md` (28532 bytes)
- `build/GAPS.md` (17674 bytes)
- `build/GPT-REVIEW-2.md` (24185 bytes)
- `build/Makefile` (9811 bytes)
- `build/NOTES.md` (1657 bytes)
- `build/assets-meta.json` (7457 bytes)
- `build/assets.py` (16114 bytes)
- `build/build_dldfcn.sh` (1448 bytes)
- `build/build_oct.sh` (2441 bytes)
- `build/build_pkg_oct.sh` (11790 bytes)
- `build/check-boot.sh` (3736 bytes)
- `build/check-deploy-sha.sh` (2141 bytes)
- `build/check-site-parity.sh` (5395 bytes)
- `build/check_m.py` (4166 bytes)
- `build/fftw_threads_stub.c` (553 bytes)
- `build/forge-build.sh` (2117 bytes)
- `build/forge-fetch.py` (5109 bytes)
- `build/forge-preload/asciiplot.m` (940 bytes)
- `build/forge-preload/betacdf.m` (7159 bytes)
- `build/forge-preload/betainv.m` (6572 bytes)
- `build/forge-preload/betapdf.m` (6641 bytes)
- `build/forge-preload/chi2cdf.m` (5463 bytes)
- `build/forge-preload/fcdf.m` (7449 bytes)
- `build/forge-preload/fft.m` (1736 bytes)
- `build/forge-preload/fpdf.m` (7974 bytes)
- `build/forge-preload/gamcdf.m` (13475 bytes)
- `build/forge-preload/gaminv.m` (7365 bytes)
- `build/forge-preload/gampdf.m` (6795 bytes)
- `build/forge-preload/ifft.m` (881 bytes)
- `build/forge-preload/normcdf.m` (10379 bytes)
- `build/forge-preload/norminv.m` (6120 bytes)
- `build/forge-preload/normpdf.m` (5930 bytes)
- `build/forge-preload/regress.m` (7261 bytes)
- `build/forge-preload/tcdf.m` (9315 bytes)
- `build/forge-preload/tinv.m` (5467 bytes)
- `build/forge-preload/tpdf.m` (4730 bytes)
- `build/forge-preload/ttest.m` (3147 bytes)
- `build/glue-selftest.m` (4444 bytes)
- `build/glue-selftest.sh` (1953 bytes)
- `build/main.cc` (23622 bytes)
- `build/make-dist.sh` (3226 bytes)
- `build/normalize_arpack.py` (1861 bytes)
- `build/pkgfix/__pkgfix_basename__.m` (1962 bytes)
- `build/pkgfix/__pkgfix_forge_root__.m` (893 bytes)
- `build/pkgfix/__pkgfix_local_list__.m` (1388 bytes)
- `build/pkgfix/__pkgfix_make_packinfo__.m` (3272 bytes)
- `build/pkgfix/__pkgfix_sync_db__.m` (4071 bytes)
- `build/pkgfix/__webassets_available__.m` (1301 bytes)
- `build/pkgfix/__webassets_info__.m` (4131 bytes)
- `build/pkgfix/__webassets_pending__.m` (1662 bytes)
- `build/pkgrestore/installed_packages.m` (5603 bytes)
- `build/plotbridge/__pb_add__.m` (2733 bytes)
- `build/plotbridge/__pb_apply_panel__.m` (549 bytes)
- `build/plotbridge/__pb_axes_arg__.m` (3033 bytes)
- `build/plotbridge/__pb_bar_args__.m` (2499 bytes)
- `build/plotbridge/__pb_check_parent__.m` (2868 bytes)
- `build/plotbridge/__pb_clear_series__.m` (853 bytes)
- `build/plotbridge/__pb_core__.m` (7729 bytes)
- `build/plotbridge/__pb_errbars__.m` (635 bytes)
- `build/plotbridge/__pb_fields__.m` (5028 bytes)
- `build/plotbridge/__pb_in_core__.m` (845 bytes)
- `build/plotbridge/__pb_integerhandle_off__.m` (2724 bytes)
- `build/plotbridge/__pb_is_linespec__.m` (2439 bytes)
- `build/plotbridge/__pb_legend_args__.m` (3142 bytes)
- `build/plotbridge/__pb_load_fig__.m` (749 bytes)
- `build/plotbridge/__pb_mirror__.m` (4852 bytes)
- `build/plotbridge/__pb_mirror_text__.m` (795 bytes)
- `build/plotbridge/__pb_new_panel__.m` (508 bytes)
- `build/plotbridge/__pb_palette__.m` (2700 bytes)
- `build/plotbridge/__pb_panel_fields__.m` (718 bytes)
- `build/plotbridge/__pb_parse_series__.m` (1554 bytes)
- `build/plotbridge/__pb_project3__.m` (1298 bytes)
- `build/plotbridge/__pb_publish__.m` (6445 bytes)
- `build/plotbridge/__pb_real_renderer__.m` (3651 bytes)
- `build/plotbridge/__pb_save_fig__.m` (1041 bytes)
- `build/plotbridge/__pb_stash_panel__.m` (893 bytes)
- `build/plotbridge/__pb_strip_axes__.m` (3095 bytes)
- `build/plotbridge/__pb_strip_props__.m` (5528 bytes)
- `build/plotbridge/__pb_surf_args__.m` (4766 bytes)
- `build/plotbridge/__pb_surface__.m` (3504 bytes)
- `build/plotbridge/__pstate__.m` (2132 bytes)
- `build/plotbridge/__svg_panel_boxes__.m` (1569 bytes)
- `build/plotbridge/__svg_render__.m` (24370 bytes)
- `build/plotbridge/area.m` (2467 bytes)
- `build/plotbridge/axis.m` (3720 bytes)
- `build/plotbridge/bar.m` (1667 bytes)
- `build/plotbridge/barh.m` (2205 bytes)
- `build/plotbridge/clf.m` (1467 bytes)
- `build/plotbridge/contour.m` (4996 bytes)
- `build/plotbridge/errorbar.m` (3318 bytes)
- `build/plotbridge/figure.m` (5663 bytes)
- `build/plotbridge/grid.m` (1202 bytes)
- `build/plotbridge/hold.m` (1291 bytes)
- `build/plotbridge/insert-core-forward.py` (10940 bytes)
- `build/plotbridge/legend.m` (1762 bytes)
- `build/plotbridge/loglog.m` (1664 bytes)
- `build/plotbridge/mesh.m` (1575 bytes)
- `build/plotbridge/pie.m` (3055 bytes)
- `build/plotbridge/plot.m` (2772 bytes)
- `build/plotbridge/plot3.m` (3988 bytes)
- `build/plotbridge/print.m` (7344 bytes)
- `build/plotbridge/saveas.m` (1530 bytes)
- `build/plotbridge/scatter.m` (1751 bytes)
- `build/plotbridge/scatter3.m` (2324 bytes)
- `build/plotbridge/semilogx.m` (1677 bytes)
- `build/plotbridge/semilogy.m` (1677 bytes)
- `build/plotbridge/stairs.m` (2295 bytes)
- `build/plotbridge/stem.m` (1624 bytes)
- `build/plotbridge/subplot.m` (3170 bytes)
- `build/plotbridge/surf.m` (1558 bytes)
- `build/plotbridge/title.m` (1703 bytes)
- `build/plotbridge/xlabel.m` (1706 bytes)
- `build/plotbridge/xlim.m` (2307 bytes)
- `build/plotbridge/ylabel.m` (1489 bytes)
- `build/plotbridge/ylim.m` (1976 bytes)
- `build/post.js` (1885 bytes)
- `build/prerender-m-docstrings.py` (16068 bytes)
- `build/promote-webgl.sh` (8562 bytes)
- `build/rebuild-pic-libs.sh` (3672 bytes)
- `build/reconf-batch1.sh` (2160 bytes)
- `build/reconf-batch1b.sh` (2101 bytes)
- `build/reconf-bench.sh` (3857 bytes)
- `build/reconf-pic.sh` (2810 bytes)
- `build/reconf.sh` (3004 bytes)
- `build/recover-113.sh` (5363 bytes)
- `build/recover.sh` (7771 bytes)
- `build/render-docstrings.py` (8474 bytes)
- `build/render_docstring_batch.m` (2443 bytes)
- `build/second_stub.f` (358 bytes)
- `build/webaudio/__pba_enqueue__.m` (1289 bytes)
- `build/webaudio/__pba_get__.m` (606 bytes)
- `build/webaudio/__pba_id__.m` (1020 bytes)
- `build/webaudio/__pba_init__.m` (1199 bytes)
- `build/webaudio/__pba_new__.m` (398 bytes)
- `build/webaudio/__pba_now__.m` (644 bytes)
- `build/webaudio/__pba_put__.m` (390 bytes)
- `build/webaudio/__pba_transition__.m` (10133 bytes)
- `build/webaudio/__pba_write_samples__.m` (821 bytes)
- `build/webaudio/__player_audioplayer__.m` (2551 bytes)
- `build/webaudio/__player_get_channels__.m` (377 bytes)
- `build/webaudio/__player_get_fs__.m` (359 bytes)
- `build/webaudio/__player_get_id__.m` (357 bytes)
- `build/webaudio/__player_get_nbits__.m` (368 bytes)
- `build/webaudio/__player_get_sample_number__.m` (384 bytes)
- `build/webaudio/__player_get_tag__.m` (354 bytes)
- `build/webaudio/__player_get_total_samples__.m` (383 bytes)
- `build/webaudio/__player_get_userdata__.m` (369 bytes)
- `build/webaudio/__player_isplaying__.m` (965 bytes)
- `build/webaudio/__player_pause__.m` (818 bytes)
- `build/webaudio/__player_play__.m` (1859 bytes)
- `build/webaudio/__player_playblocking__.m` (1359 bytes)
- `build/webaudio/__player_resume__.m` (1456 bytes)
- `build/webaudio/__player_set_fs__.m` (463 bytes)
- `build/webaudio/__player_set_tag__.m` (458 bytes)
- `build/webaudio/__player_set_userdata__.m` (473 bytes)
- `build/webaudio/__player_stop__.m` (394 bytes)
- `build/webaudio/audiodevinfo.m` (5793 bytes)
- `build/webaudiorec/__pra_enqueue__.m` (840 bytes)
- `build/webaudiorec/__pra_get__.m` (557 bytes)
- `build/webaudiorec/__pra_id__.m` (987 bytes)
- `build/webaudiorec/__pra_init__.m` (2771 bytes)
- `build/webaudiorec/__pra_new__.m` (264 bytes)
- `build/webaudiorec/__pra_progress__.m` (1740 bytes)
- `build/webaudiorec/__pra_put__.m` (392 bytes)
- `build/webaudiorec/__recorder_audiorecorder__.m` (1724 bytes)
- `build/webaudiorec/__recorder_get_channels__.m` (184 bytes)
- `build/webaudiorec/__recorder_get_fs__.m` (170 bytes)
- `build/webaudiorec/__recorder_get_id__.m` (306 bytes)
- `build/webaudiorec/__recorder_get_nbits__.m` (180 bytes)
- `build/webaudiorec/__recorder_get_sample_number__.m` (430 bytes)
- `build/webaudiorec/__recorder_get_tag__.m` (203 bytes)
- `build/webaudiorec/__recorder_get_total_samples__.m` (200 bytes)
- `build/webaudiorec/__recorder_get_userdata__.m` (189 bytes)
- `build/webaudiorec/__recorder_getaudiodata__.m` (2982 bytes)
- `build/webaudiorec/__recorder_isrecording__.m` (807 bytes)
- `build/webaudiorec/__recorder_pause__.m` (344 bytes)
- `build/webaudiorec/__recorder_record__.m` (913 bytes)
- `build/webaudiorec/__recorder_recordblocking__.m` (1973 bytes)
- `build/webaudiorec/__recorder_resume__.m` (259 bytes)
- `build/webaudiorec/__recorder_set_fs__.m` (535 bytes)
- `build/webaudiorec/__recorder_set_tag__.m` (175 bytes)
- `build/webaudiorec/__recorder_set_userdata__.m` (185 bytes)
- `build/webaudiorec/__recorder_stop__.m` (285 bytes)
- `build/webdoc/doc.m` (2618 bytes)
- `build/webfile/__wf_basename__.m` (2138 bytes)
- `build/webfile/__wf_copy_dir__.m` (2672 bytes)
- `build/webfile/__wf_copy_file__.m` (2282 bytes)
- `build/webfile/__wf_fail__.m` (854 bytes)
- `build/webfile/__wf_list_dir__.m` (1212 bytes)
- `build/webfile/__wf_rmtree__.m` (2362 bytes)
- `build/webfile/__wf_try_rename__.m` (1437 bytes)
- `build/webfile/copyfile.m` (6270 bytes)
- `build/webfile/ls.m` (5013 bytes)
- `build/webfile/movefile.m` (5640 bytes)
- `build/webfilepick.cc` (9043 bytes)
- `build/webgraphics/PKG_ADD` (2022 bytes)
- `build/webgraphics/__webgl_ginput__.m` (2736 bytes)
- `build/webimage.cc` (7177 bytes)
- `build/webio.cc` (18583 bytes)
- `build/webjslib.js` (2307 bytes)
- `build/webnet.cc` (7341 bytes)
- `build/webnet/__web_decode__.m` (1208 bytes)
- `build/webnet/__web_query__.m` (717 bytes)
- `build/webnet/__web_read_last__.m` (784 bytes)
- `build/webnet/__web_read_text__.m` (319 bytes)
- `build/webnet/__web_urlenc__.m` (646 bytes)
- `build/webnet/urlread.m` (2341 bytes)
- `build/webnet/urlwrite.m` (2168 bytes)
- `build/webnet/webread.m` (1573 bytes)
- `build/webnet/websave.m` (1366 bytes)
- `build/webshell/bunzip2.m` (363 bytes)
- `build/webshell/gunzip.m` (359 bytes)
- `build/webshell/tar.m` (314 bytes)
- `build/webshell/untar.m` (256 bytes)
- `build/webshell/unzip.m` (313 bytes)
- `build/webshell/zip.m` (314 bytes)
- `build/webshims/keyboard.m` (1055 bytes)
- `build/webshims/pause.m` (1873 bytes)
- `build/webshims/pkg.m` (2859 bytes)
- `build/webshims/popen.m` (1608 bytes)
- `build/webshims/system.m` (2024 bytes)
- `build/webshims/uisetfont.m` (1039 bytes)
- `build/webshims/uiwait.m` (907 bytes)
- `build/webshims/waitfor.m` (1090 bytes)
- `build/webshims/webpause.cc` (5202 bytes)
- `dist/DEPLOY.md` (20510 bytes)
- `dist/serve.py` (2668 bytes)
- `site/VERSION` (14 bytes)
- `site/assets-loader.js` (15944 bytes)
- `site/assets/data/built-in-docstrings` (656052 bytes)
- `site/assets/data/doc-cache` (2219997 bytes)
- `site/assets/data/installed_packages.m` (5603 bytes)
- `site/assets/data/macros.texi` (3369 bytes)
- `site/assets/m/lanetest.js` (380 bytes)
- `site/assets/m/pkgfix.js` (20084 bytes)
- `site/assets/m/plotbridge.js` (192641 bytes)
- `site/assets/m/webaudio.js` (39138 bytes)
- `site/assets/m/webaudiorec.js` (21985 bytes)
- `site/assets/m/webdoc.js` (2935 bytes)
- `site/assets/m/webfile.js` (31984 bytes)
- `site/assets/m/webgraphics.js` (5220 bytes)
- `site/assets/m/webimage.js` (2018 bytes)
- `site/assets/m/webnet.js` (12305 bytes)
- `site/assets/m/webshell.js` (2442 bytes)
- `site/assets/m/webshims.js` (13389 bytes)
- `site/assets/manifest.json` (21010 bytes)
- `site/assets/meta.json` (7139 bytes)
- `site/assets/oct/__delaunayn__.oct` (14299 bytes)
- `site/assets/oct/__fltk_uigetfile__.oct` (17567 bytes)
- `site/assets/oct/__glpk__.oct` (28259 bytes)
- `site/assets/oct/__init_fltk__.oct` (2545 bytes)
- `site/assets/oct/__init_gnuplot__.oct` (33739 bytes)
- `site/assets/oct/__init_web__.oct` (19262 bytes)
- `site/assets/oct/__ode15__.oct` (250195 bytes)
- `site/assets/oct/__voronoi__.oct` (17082 bytes)
- `site/assets/oct/__web_pause_ms__.oct` (10834 bytes)
- `site/assets/oct/audioread.oct` (46953 bytes)
- `site/assets/oct/convhulln.oct` (12900 bytes)
- `site/assets/oct/fftw.oct` (9747 bytes)
- `site/assets/oct/gzip.oct` (45429 bytes)
- `site/assets/oct/webimage-oct.oct` (141398 bytes)
- `site/assets/oct/webio.oct` (42199 bytes)
- `site/assets/oct/webnet-oct.oct` (7430 bytes)
- `site/assets/octdir/control/__control_helper_functions__.oct` (17502 bytes)
- `site/assets/octdir/control/__control_slicot_functions__.oct` (8115591 bytes)
- `site/assets/octdir/control/is_matrix.oct` (3133 bytes)
- `site/assets/octdir/control/is_real_matrix.oct` (3191 bytes)
- `site/assets/octdir/control/is_real_scalar.oct` (3199 bytes)
- `site/assets/octdir/control/is_real_square_matrix.oct` (3353 bytes)
- `site/assets/octdir/control/is_real_vector.oct` (3301 bytes)
- `site/assets/octdir/control/is_zp_vector.oct` (3340 bytes)
- `site/assets/octdir/control/lti_input_idx.oct` (6664 bytes)
- `site/assets/octdir/geometry/polybool_mrf.oct` (55192 bytes)
- `site/assets/octdir/miscellaneous/cell2cell.oct` (8134 bytes)
- `site/assets/octdir/miscellaneous/partint.oct` (10541 bytes)
- `site/assets/octdir/optim/__bfgsmin.oct` (58025 bytes)
- `site/assets/octdir/optim/__disna_optim__.oct` (12801 bytes)
- `site/assets/octdir/optim/__max_nargin_optim__.oct` (8301 bytes)
- `site/assets/octdir/optim/numgradient.oct` (17555 bytes)
- `site/assets/octdir/optim/numhessian.oct` (18220 bytes)
- `site/assets/octdir/statistics/editDistance.oct` (35302 bytes)
- `site/assets/octdir/statistics/fcnnpredict.oct` (38896 bytes)
- `site/assets/octdir/statistics/fcnntrain.oct` (46914 bytes)
- `site/assets/octdir/statistics/libsvmread.oct` (13250 bytes)
- `site/assets/octdir/statistics/libsvmwrite.oct` (8541 bytes)
- `site/assets/octdir/statistics/svmpredict.oct` (88664 bytes)
- `site/assets/octdir/statistics/svmtrain.oct` (86490 bytes)
- `site/assets/octdir/struct/cell2fields.oct` (16594 bytes)
- `site/assets/octdir/struct/fieldempty.oct` (11817 bytes)
- `site/assets/octdir/struct/fields2cell.oct` (13730 bytes)
- `site/assets/octdir/struct/structcat.oct` (15854 bytes)
- `site/assets/pkg/control.js` (1366564 bytes)
- `site/assets/pkg/geometry.js` (236832 bytes)
- `site/assets/pkg/matgeom.js` (2382316 bytes)
- `site/assets/pkg/miscellaneous.js` (271364 bytes)
- `site/assets/pkg/nan.js` (441285 bytes)
- `site/assets/pkg/optim.js` (672909 bytes)
- `site/assets/pkg/quaternion.js` (198789 bytes)
- `site/assets/pkg/signal.js` (913704 bytes)
- `site/assets/pkg/splines.js` (118077 bytes)
- `site/assets/pkg/statistics.js` (5351017 bytes)
- `site/assets/pkg/struct.js` (44263 bytes)
- `site/assets/pkg/tsa.js` (254427 bytes)
- `site/dldprobe.oct` (2764 bytes)
- `site/index.html` (33108 bytes)
- `site/matrix-android.html` (33947 bytes)
- `site/minioct.oct` (5694 bytes)
- `site/octave.data` (9712174 bytes)
- `site/octave.js` (462821 bytes)
- `site/octave.wasm` (29464307 bytes)
- `site/p5canvas.js` (8343 bytes)
- `site/queue.js` (3103 bytes)
- `site/vendor/asciiplot.m` (940 bytes)
- `site/vendor/betacdf.m` (7159 bytes)
- `site/vendor/betainv.m` (6572 bytes)
- `site/vendor/betapdf.m` (6641 bytes)
- `site/vendor/chi2cdf.m` (5463 bytes)
- `site/vendor/fcdf.m` (7449 bytes)
- `site/vendor/fft.m` (1736 bytes)
- `site/vendor/fpdf.m` (7974 bytes)
- `site/vendor/gamcdf.m` (13475 bytes)
- `site/vendor/gaminv.m` (7365 bytes)
- `site/vendor/gampdf.m` (6795 bytes)
- `site/vendor/ifft.m` (881 bytes)
- `site/vendor/normcdf.m` (10379 bytes)
- `site/vendor/norminv.m` (6120 bytes)
- `site/vendor/normpdf.m` (5930 bytes)
- `site/vendor/regress.m` (7261 bytes)
- `site/vendor/tcdf.m` (9315 bytes)
- `site/vendor/tinv.m` (5467 bytes)
- `site/vendor/tpdf.m` (4730 bytes)
- `site/vendor/ttest.m` (3147 bytes)
- `site/webaudio.js` (7303 bytes)
- `site/webaudiorec.js` (11861 bytes)
- `site/webfilepick.js` (6151 bytes)
- `site/webnet.js` (4146 bytes)
- `test/browser/accept-113-assets.mjs` (7452 bytes)
- `test/browser/accept-113-boot.mjs` (6814 bytes)
- `test/browser/accept-113-libs.mjs` (7677 bytes)
- `test/browser/accept-113-oct.mjs` (7154 bytes)
- `test/browser/accept-113-ode15.mjs` (16795 bytes)
- `test/browser/accept-113-pkgoct.mjs` (9923 bytes)
- `test/browser/accept-archive.mjs` (7447 bytes)
- `test/browser/accept-audio.mjs` (15562 bytes)
- `test/browser/accept-dldfcn.mjs` (13850 bytes)
- `test/browser/accept-fileops.mjs` (8223 bytes)
- `test/browser/accept-forge-oct.mjs` (6255 bytes)
- `test/browser/accept-forge.mjs` (7943 bytes)
- `test/browser/accept-forge2.mjs` (10518 bytes)
- `test/browser/accept-full.mjs` (7516 bytes)
- `test/browser/accept-ginput.mjs` (10054 bytes)
- `test/browser/accept-hdf5.mjs` (6979 bytes)
- `test/browser/accept-help.mjs` (3589 bytes)
- `test/browser/accept-idbfs.mjs` (6249 bytes)
- `test/browser/accept-image.mjs` (5880 bytes)
- `test/browser/accept-input.mjs` (6644 bytes)
- `test/browser/accept-interactive.mjs` (10465 bytes)
- `test/browser/accept-jspi-stress.mjs` (9384 bytes)
- `test/browser/accept-net.mjs` (11086 bytes)
- `test/browser/accept-ode15.mjs` (7231 bytes)
- `test/browser/accept-p5-fallback.mjs` (9597 bytes)
- `test/browser/accept-p5-graphics.mjs` (18194 bytes)
- `test/browser/accept-pkg.mjs` (5619 bytes)
- `test/browser/accept-pkgview.mjs` (6716 bytes)
- `test/browser/accept-plot3d.mjs` (11570 bytes)
- `test/browser/accept-plotv2.mjs` (20958 bytes)
- `test/browser/accept-print.mjs` (14128 bytes)
- `test/browser/accept-queue-drift.mjs` (9231 bytes)
- `test/browser/accept-requirements.mjs` (6314 bytes)
- `test/browser/accept-selftest.mjs` (6178 bytes)
- `test/browser/accept-shellerr.mjs` (7001 bytes)
- `test/browser/accept-slicot.mjs` (8857 bytes)
- `test/browser/accept-t2-graphics.mjs` (10415 bytes)
- `test/browser/accept-t6-audio-doc.mjs` (9785 bytes)
- `test/browser/accept-t7-recorder.mjs` (13926 bytes)
- `test/browser/accept-t8-uigetfile.mjs` (11441 bytes)
- `test/browser/accept-t9-helpm.mjs` (9042 bytes)
- `test/browser/bench-core.mjs` (5350 bytes)
- `test/browser/fixtures/internal-props-probe.m` (3762 bytes)
- `test/browser/fixtures/p5-graphics-probe.m` (3048 bytes)
- `test/browser/fixtures/t2-graphics-probe.m` (2587 bytes)
- `test/browser/probe-artifact-sha.mjs` (2618 bytes)
- `test/browser/probe-bridge-cost.mjs` (2853 bytes)
- `test/browser/probe-bridge-cost2.mjs` (1789 bytes)
- `test/browser/probe-bridge-mirror-cost.mjs` (5323 bytes)
- `test/browser/probe-bridge-svg-out.mjs` (2214 bytes)
- `test/browser/probe-browser-matrix.mjs` (4300 bytes)
- `test/browser/probe-cold-start.mjs` (4572 bytes)
- `test/browser/probe-core-names.mjs` (9505 bytes)
- `test/browser/probe-fontname.mjs` (10774 bytes)
- `test/browser/probe-gfx-bench.mjs` (4496 bytes)
- `test/browser/probe-gfx-e2e-breakdown.mjs` (2714 bytes)
- `test/browser/probe-gfx-resolution.mjs` (2443 bytes)
- `test/browser/probe-gfx-surf-cost.mjs` (2358 bytes)
- `test/browser/probe-gl4es-smoke.mjs` (4306 bytes)
- `test/browser/probe-gpu-backend.mjs` (2037 bytes)
- `test/browser/probe-idbfs-bounds.mjs` (4741 bytes)
- `test/browser/probe-internal-props.mjs` (9154 bytes)
- `test/browser/probe-jspi-b.mjs` (8622 bytes)
- `test/browser/probe-jspi-eval.mjs` (5733 bytes)
- `test/browser/probe-jspi-gate.mjs` (7889 bytes)
- `test/browser/probe-jspi.mjs` (8112 bytes)
- `test/browser/probe-m2-lazyload.mjs` (4379 bytes)
- `test/browser/probe-nogl-flag.mjs` (2385 bytes)
- `test/browser/probe-p5-run.mjs` (2255 bytes)
- `test/browser/probe-pkg-d6.mjs` (3390 bytes)
- `test/browser/probe-t2-graphics.mjs` (4979 bytes)
- `test/browser/probe-t2-run.mjs` (2246 bytes)
- `test/browser/probe-text-render.mjs` (5372 bytes)
- `test/browser/probe-toolkit-print.mjs` (2474 bytes)
- `test/browser/probe-want-matcher.mjs` (4827 bytes)
- `vendor/MANIFEST.md` (1676 bytes)
- `vendor/extra/asciiplot.m` (940 bytes)
- `vendor/extra/fft.m` (1736 bytes)
- `vendor/extra/ifft.m` (881 bytes)
- `vendor/extra/ttest.m` (3147 bytes)
- `vendor/forge/betacdf.m` (7159 bytes)
- `vendor/forge/betainv.m` (6572 bytes)
- `vendor/forge/betapdf.m` (6641 bytes)
- `vendor/forge/chi2cdf.m` (5463 bytes)
- `vendor/forge/fcdf.m` (7449 bytes)
- `vendor/forge/fpdf.m` (7974 bytes)
- `vendor/forge/gamcdf.m` (13475 bytes)
- `vendor/forge/gaminv.m` (7365 bytes)
- `vendor/forge/gampdf.m` (6795 bytes)
- `vendor/forge/normcdf.m` (10379 bytes)
- `vendor/forge/norminv.m` (6120 bytes)
- `vendor/forge/normpdf.m` (5930 bytes)
- `vendor/forge/regress.m` (7261 bytes)
- `vendor/forge/tcdf.m` (9315 bytes)
- `vendor/forge/tinv.m` (5467 bytes)
- `vendor/forge/tpdf.m` (4730 bytes)
<!-- /AUTO -->



## 钩子

本仓用白名单 `.gitignore`（默认拒绝，逐项放行）+ git hooks：

- `pre-commit`：重算 README 的 AUTO 区块并 `git add`，再校验白名单覆盖。
- `pre-push`：校验 README 是新鲜的，不新鲜直接拒推（先提交再推）。
- 安装：`bash .githooks/install.sh`（设 `core.hooksPath`）。

## 许可

**AGPL-3.0-or-later**（全文见 [`LICENSE`](LICENSE)）。本仓对外分发的是一个 wasm
二进制，它静态链接了 GPLv3 的 Octave、GPLv2+ 的 FFTW、LGPL 的 libsndfile，
以及 BSD/permissive 的若干件——这种混合**没有 AGPL-3.0 以外的选择**。

本程序是自由软件：你可以按自由软件基金会发布的 GNU Affero 通用公共许可证
（第 3 版，或你选择的任何更新版本）的条款再分发和/或修改它。本程序分发时
希望它有用，但**不提供任何担保**，也不提供适销性或特定用途适用性的默示担保。

按 AGPL-3.0 第 13 条（网络交互条款），通过计算机网络使用本程序的用户有权
获得对应源码：**本仓即该源码**，构建可在 `obuild` 容器内完整复现
（配方见 `build/CLIBS.md` 与 `HANDOFF.md`）。

逐组件的许可与版权声明见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)：
Octave 与 C 库长尾的版本/许可逐条列在那边，`build/` 的构建骨架源自
rwl/octave-wasm（BSD-3-Clause，见 build/NOTES.md）；vendored `.m` 的来源见
`vendor/MANIFEST.md`，其文件头均保留原许可声明；本仓自研文件带
`SPDX-License-Identifier: AGPL-3.0-or-later` 头。
