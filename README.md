# Octave-Full-Wasm

目标：**浏览器里跑满功能 Octave 7.2**——官方 `rwl/octave-wasm` 只预装 16 个 `.m` 目录，
本仓库把剩下能补的全部补上：全量核心脚本、forge 统计、纯 `.m` 后备 FFT、
自研 `ttest`、plot 翻译桥（Octave 算 + gnuplot-wasm 画）。

上游：`rwl/octave-wasm`（BSD）+ Emscripten 3.1.24。构建产物（wasm/data/js）
体积大，走 Release 分发，不进 git。

## 为什么是网页版

省磁盘空间只是它最不重要的一个意义。真正区分度在于：

1. **零安装零配置**——桌面 Octave 的使用链是：下载→安装→摸清路径→装包→配
   gnuplot/图形，每一步劝退一批人；网页版是**一个链接**。对"考前冲刺"场景，
   安装成本直接等于放弃率。
2. **手机能用**——桌面版永远做不到。通勤/课间用手机跑一段矩阵、看一眼图。
3. **可分享、可复现、版本钉死**——URL 即环境；Octave 7.2.0 + 具体 BLAS/包版本
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
代价也要认清：慢（-O0 + wasm）、无工具箱生态、无 GUI 工具链、内存受限——
它不是取代桌面版，是**另一个产品**。

## 架构

```text
Octave 7.2 wasm（build/Makefile + build/main.cc 补丁；-O1 编译）
├── 全量核心 .m（plot/ode/signal/special-matrix/…，两段式 addpath）
├── vendor/forge：forge statistics 纯 .m（normpdf/tcdf/ttest 依赖…）
├── 真 .oct 动态装载：主模块 -s MAIN_MODULE=1，模块编成 wasm side module
│   运行时 dlopen —— 与桌面版插件模型一致，加模块不必重链那 44MB 主 wasm。
│   连 dldfcn（convhulln/gzip/glpk/fftw/audioread/…）也走这条路。
├── 资产懒加载车道：站点 assets/ 下按需 fetch → 写 wasm FS → addpath
│   （Forge 包、SUNDIALS、图像、音频、网络、plot 桥覆写全在这里）
├── plot 桥 v2：Octave 算 → spec → gnuplot-wasm → SVG（2D + 3D）
└── print -dsvg：纯 .m SVG 生成器（不依赖 gnuplot，也不需 Asyncify）
```

构建命令里 `-s MAIN_MODULE=1` 与 `-fPIC` 是一对：主链带 MAIN_MODULE 时，
Octave 本体与 5 个静态库必须走 `build/reconf-pic.sh` + `build/rebuild-pic-libs.sh`
重编，否则 wasm-ld 报 `recompile with -fPIC`。换 O 级走 `build/reconf-bench.sh`。
配方与坑见 `build/CLIBS.md`。

## 状态（2026-09-21 实测）

**R1–R10 需求全部落地**（见 `build/GAPS.md` 的需求书与 `HANDOFF.md` §5 的结论表）。

| 项 | 结果 |
|---|---|
| 线代/微积分/优化/ODE45/多项式 | ✅ 全对 |
| 统计分布 + ttest/regress + fft 后备 | ✅ 全对 |
| R1 SUNDIALS → `ode15s`/`ode15i` | ✅ 刚性方程误差 9.2e-05（收紧容差 1.1e-08） |
| R2 Forge 包（statistics/optim/signal/control/…） | ✅ 懒加载，真数值验证 |
| R3 HDF5 → `save/load -hdf5` | ✅ 往返/压缩/`whos -file` 全通 |
| R4 图像 → `imread`/`imwrite`/`imfinfo` | ✅ PNG/BMP/TGA 像素级无损 |
| R5 网络 → `urlread`/`urlwrite`/`webread`/`websave` | ✅ **真同步**（同步 XHR，无需 Asyncify） |
| R6 压缩归档（6 个函数无 shell 化） | ✅ 二进制字节级往返 |
| R7 CXSparse | ✅ 已开（SPQR 未做，非阻塞） |
| R8 WebAudio → `audioplayer` | ✅ 18 个符号纯 `.m` 实现，真实 AudioContext 调度 |
| R9 图形导出 → `print -dsvg` | ✅ 2D + 3D 都能出，不依赖 gnuplot |
| R10 编译级别 | ✅ **采纳 `-O1`**：解释器密集代码快 5–10×，体积还小 7.5MB |
| plot 桥 | ✅ v2：2D（含 subplot/figure(n)/axis）+ 3D（plot3/mesh/surf/contour）+ 中文标签 |
| **官方 `.oct` 装载** | ✅ dldfcn 也走 dlopen，`exist=3` / `which()` 返回 `.oct` 路径 |
| 交付包（可静态托管） | ✅ `dist/octave-full-wasm-site-20260921`，首包 gzip ≈11.6MB |
| 验收 | ✅ **19 套 475 项全绿**（含需求级 `accept-requirements` + T 批次专项） |

### 已知偏差（如实）
- ~~**`help` 对非平凡输入报 `makeinfo` 子进程错误**（无 shell）~~ → **T1 已修（内建）**：
  构建期用**真 makeinfo 预渲染** `built-in-docstrings`（与 Octave 自己的
  `mk-doc-cache.pl` 同一技术），运行时零新代码。`help sin`/`help sqrt`/`help disp` 可用。
  **仍缺**：`help ode45` 这类 `.m` 的 docstring 走运行时路径，不吃该表，仍报 makeinfo 错误。
- `fftw('threads',N)` 静默 no-op（`fftw_init_threads` 桩须返回成功，否则核心 `fft` 崩）。
- `system`/`unix`/`popen` 清晰报错（有意保持）。
- **control 包的 SLICOT 编译件未发布**：side module 引用主模块 Fortran 符号时
  签名不匹配会整页崩，故 `ss`/`step`/`tf2ss` 不可用（`tf`/`dcgain`/`bode` 等正常）。
- `voronoi` 单输出形式（要画图）不可用；两输出形式正常。

## 下一步（第三轮，已排好序）

R1–R10 已全部落地，第三轮做的是**浏览器环境语义**——剩下的缺口不是数学能力，
而是"宿主 API 怎么换成浏览器原生"（`HANDOFF.md` §5.5 有完整计划）：

~~**T1** `help`~~ ✅ **已完成**（构建期 makeinfo 预渲染，`accept-help` 12/12 绿；
详见 `HANDOFF.md` §5.6 与 `build/CLIBS.md` 批次 T1）→
**T2** graphics 句柄半真化（写薄 toolkit，渲染仍走现有 plot 桥）→
~~**T3** `copyfile`/`movefile`/`ls`~~ ✅ **已完成**（进程内纯 `.m`，`accept-fileops` 20/20 绿，无 shell）
~~**T4** `pkg` 语义~~ ✅ **已完成**（还原被 fork 删掉的 `installed_packages.m` + 生成数据库，
`accept-pkg` 16/16 绿）→ ~~**T5** `input()`~~ ✅ **已完成**（本就可用，只需官方 `Module.stdin`
扩展点让验收可测，`accept-input` 9/9 绿）→ **T6** `audiodevinfo`/`doc` →
**T7** `audiorecorder` → **T8** `uigetfile` → **T9** `MAIN_MODULE=2`（体积优化）→
**T10** Asyncify 最小实验。

依据：`build/GAPS-2.md`（缺口清单，逐条实测证据）+ `build/GPT-REVIEW-2.md`
（外部审核：两处纠错——`spqr` 早已被 `qr` 取代、`record()` 本就不阻塞；
以及 A1 的核心建议——**不复活 gnuplot 后端，改写薄 toolkit 复用现有桥**）。

## 第四轮：换基线到 **Octave 11.3.0** + 重构图形线

已决定换到 **11.3.0**（决策与闸门见 `HANDOFF.md` §9，**事实依据
`build/BASELINE-11.3.md`**）。要点：

- **收益**：11.x 的卷积快 10%–150×、`randi` 4.5×、logical 求和最高 6×；MATLAB 兼容
  有一整节（稀疏/对角 broadcasting、一大批函数的 `"all"`/`vecdim`/`nanflag`、
  `qr` 单输出只返回 R…）。且**与本机参照版 Octave 同版**，验收可逐位对照。
- **代价比原估小得多**：原以为 19 个 patch 要全部重推，**实测 16/19 直接可用**
  （1 个已进上游该删、2 个局部重做，共 4 个文件）。
- **取法**：工具链 emsdk 5.0.7 + **f2c（`emf77` 那套，与我们现有路线同源）** +
  Edge-Tools 的 5 处平台补丁（实测 5/5 命中 11.3.0）；**链接模型与 C 库长尾用我们自己的**。
- **图形**：第三方已把「薄 toolkit」写成并在 11.1.0 上验证能跑，撞墙点与我们记录一致，
  同样推荐 **OSMesa** —— 这一轮把图形线真正做成官方实现。
- **纪律**：7.2 基线（`http://127.0.0.1:8761/`）在 11.3.0 通过等价验收前**不动**；
  11.3.0 全程在独立容器 `o113` 内做。

> **一手记录**：`build/CLIBS.md`（每批配方与坑）、`build/BENCH.md`（O 级矩阵）、
> `HANDOFF.md`（接续说明与架构要点）、`build/GAPS.md` + `GAPS-2.md`（两轮缺口审计）。

## 目录

<!-- AUTO:FILES -->
- `.githooks/check-whitelist.py` (1251 bytes)
- `.githooks/install.sh` (388 bytes)
- `.githooks/pre-commit` (378 bytes)
- `.githooks/pre-push` (337 bytes)
- `.githooks/update-readme.py` (2270 bytes)
- `.gitignore` (1439 bytes)
- `AGENTS.md` (1355 bytes)
- `HANDOFF.md` (64701 bytes)
- `LICENSE` (34523 bytes)
- `THIRD-PARTY-NOTICES.md` (4285 bytes)
- `bridge/assets-loader.js` (11190 bytes)
- `bridge/index.html` (7841 bytes)
- `bridge/octplot.html` (6162 bytes)
- `bridge/plotbridge.js` (6457 bytes)
- `bridge/webaudio.js` (6864 bytes)
- `bridge/webnet.js` (4066 bytes)
- `build/113/STATUS.md` (4297 bytes)
- `build/113/apply-platform-patches.sh` (9710 bytes)
- `build/113/build-deps.sh` (9359 bytes)
- `build/113/emf77` (4503 bytes)
- `build/BASELINE-10.3.md` (8216 bytes)
- `build/BASELINE-11.3.md` (17814 bytes)
- `build/BENCH.md` (5640 bytes)
- `build/CLIBS.md` (59960 bytes)
- `build/GAPS-2.md` (23986 bytes)
- `build/GAPS.md` (17674 bytes)
- `build/GPT-REVIEW-2.md` (24185 bytes)
- `build/Makefile` (9242 bytes)
- `build/NOTES.md` (1657 bytes)
- `build/assets.py` (11273 bytes)
- `build/build_dldfcn.sh` (1448 bytes)
- `build/build_oct.sh` (2441 bytes)
- `build/build_pkg_oct.sh` (11790 bytes)
- `build/check_m.py` (4166 bytes)
- `build/fftw_threads_stub.c` (553 bytes)
- `build/forge-build.sh` (2117 bytes)
- `build/forge-fetch.py` (5109 bytes)
- `build/main.cc` (15572 bytes)
- `build/make-dist.sh` (3226 bytes)
- `build/normalize_arpack.py` (1861 bytes)
- `build/pkgfix/__pkgfix_basename__.m` (1140 bytes)
- `build/pkgfix/__pkgfix_forge_root__.m` (893 bytes)
- `build/pkgfix/__pkgfix_local_list__.m` (1388 bytes)
- `build/pkgfix/__pkgfix_make_packinfo__.m` (3272 bytes)
- `build/pkgfix/__pkgfix_sync_db__.m` (4071 bytes)
- `build/pkgrestore/installed_packages.m` (5603 bytes)
- `build/plotbridge/__pb_add__.m` (2731 bytes)
- `build/plotbridge/__pb_apply_panel__.m` (598 bytes)
- `build/plotbridge/__pb_clear_series__.m` (710 bytes)
- `build/plotbridge/__pb_cycle_color__.m` (457 bytes)
- `build/plotbridge/__pb_emit__.m` (4169 bytes)
- `build/plotbridge/__pb_errbars__.m` (635 bytes)
- `build/plotbridge/__pb_load_fig__.m` (749 bytes)
- `build/plotbridge/__pb_new_panel__.m` (508 bytes)
- `build/plotbridge/__pb_panel_fields__.m` (881 bytes)
- `build/plotbridge/__pb_parse_series__.m` (1554 bytes)
- `build/plotbridge/__pb_project3__.m` (1298 bytes)
- `build/plotbridge/__pb_save_fig__.m` (1041 bytes)
- `build/plotbridge/__pb_stash_panel__.m` (893 bytes)
- `build/plotbridge/__pb_surf_args__.m` (1344 bytes)
- `build/plotbridge/__pb_surface__.m` (2029 bytes)
- `build/plotbridge/__pstate__.m` (1819 bytes)
- `build/plotbridge/__svg_panel_boxes__.m` (1569 bytes)
- `build/plotbridge/__svg_render__.m` (24352 bytes)
- `build/plotbridge/area.m` (1446 bytes)
- `build/plotbridge/axis.m` (1969 bytes)
- `build/plotbridge/bar.m` (486 bytes)
- `build/plotbridge/barh.m` (1172 bytes)
- `build/plotbridge/clf.m` (437 bytes)
- `build/plotbridge/contour.m` (3498 bytes)
- `build/plotbridge/errorbar.m` (1858 bytes)
- `build/plotbridge/figure.m` (1052 bytes)
- `build/plotbridge/grid.m` (357 bytes)
- `build/plotbridge/hold.m` (357 bytes)
- `build/plotbridge/legend.m` (496 bytes)
- `build/plotbridge/loglog.m` (488 bytes)
- `build/plotbridge/mesh.m` (546 bytes)
- `build/plotbridge/pie.m` (1409 bytes)
- `build/plotbridge/plot.m` (621 bytes)
- `build/plotbridge/plot3.m` (2759 bytes)
- `build/plotbridge/print.m` (3510 bytes)
- `build/plotbridge/saveas.m` (878 bytes)
- `build/plotbridge/scatter.m` (464 bytes)
- `build/plotbridge/scatter3.m` (1002 bytes)
- `build/plotbridge/semilogx.m` (493 bytes)
- `build/plotbridge/semilogy.m` (493 bytes)
- `build/plotbridge/stairs.m` (1236 bytes)
- `build/plotbridge/stem.m` (603 bytes)
- `build/plotbridge/subplot.m` (2101 bytes)
- `build/plotbridge/surf.m` (529 bytes)
- `build/plotbridge/title.m` (146 bytes)
- `build/plotbridge/xlabel.m` (152 bytes)
- `build/plotbridge/xlim.m` (271 bytes)
- `build/plotbridge/ylabel.m` (139 bytes)
- `build/plotbridge/ylim.m` (271 bytes)
- `build/rebuild-pic-libs.sh` (3672 bytes)
- `build/reconf-batch1.sh` (2160 bytes)
- `build/reconf-batch1b.sh` (2101 bytes)
- `build/reconf-bench.sh` (3857 bytes)
- `build/reconf-pic.sh` (2810 bytes)
- `build/reconf.sh` (3004 bytes)
- `build/recover.sh` (4930 bytes)
- `build/render-docstrings.py` (8474 bytes)
- `build/second_stub.f` (358 bytes)
- `build/webaudio/__pba_enqueue__.m` (828 bytes)
- `build/webaudio/__pba_get__.m` (606 bytes)
- `build/webaudio/__pba_id__.m` (1020 bytes)
- `build/webaudio/__pba_init__.m` (1199 bytes)
- `build/webaudio/__pba_new__.m` (398 bytes)
- `build/webaudio/__pba_now__.m` (644 bytes)
- `build/webaudio/__pba_put__.m` (390 bytes)
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
- `build/webaudio/__player_isplaying__.m` (1374 bytes)
- `build/webaudio/__player_pause__.m` (825 bytes)
- `build/webaudio/__player_play__.m` (1900 bytes)
- `build/webaudio/__player_playblocking__.m` (1405 bytes)
- `build/webaudio/__player_resume__.m` (905 bytes)
- `build/webaudio/__player_set_fs__.m` (463 bytes)
- `build/webaudio/__player_set_tag__.m` (458 bytes)
- `build/webaudio/__player_set_userdata__.m` (473 bytes)
- `build/webaudio/__player_stop__.m` (676 bytes)
- `build/webfile/__wf_basename__.m` (1758 bytes)
- `build/webfile/__wf_copy_dir__.m` (2672 bytes)
- `build/webfile/__wf_copy_file__.m` (2282 bytes)
- `build/webfile/__wf_fail__.m` (854 bytes)
- `build/webfile/__wf_list_dir__.m` (1212 bytes)
- `build/webfile/__wf_rmtree__.m` (2362 bytes)
- `build/webfile/__wf_try_rename__.m` (1437 bytes)
- `build/webfile/copyfile.m` (6270 bytes)
- `build/webfile/ls.m` (5013 bytes)
- `build/webfile/movefile.m` (5640 bytes)
- `build/webimage.cc` (7177 bytes)
- `build/webio.cc` (18583 bytes)
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
- `dist/DEPLOY.md` (6427 bytes)
- `dist/serve.py` (2668 bytes)
- `test/browser/accept-archive.mjs` (5665 bytes)
- `test/browser/accept-audio.mjs` (12365 bytes)
- `test/browser/accept-dldfcn.mjs` (11012 bytes)
- `test/browser/accept-fileops.mjs` (7453 bytes)
- `test/browser/accept-forge-oct.mjs` (4473 bytes)
- `test/browser/accept-forge.mjs` (6161 bytes)
- `test/browser/accept-forge2.mjs` (7666 bytes)
- `test/browser/accept-full.mjs` (5734 bytes)
- `test/browser/accept-hdf5.mjs` (4146 bytes)
- `test/browser/accept-help.mjs` (3589 bytes)
- `test/browser/accept-image.mjs` (4098 bytes)
- `test/browser/accept-input.mjs` (5874 bytes)
- `test/browser/accept-net.mjs` (7994 bytes)
- `test/browser/accept-ode15.mjs` (4890 bytes)
- `test/browser/accept-pkg.mjs` (5619 bytes)
- `test/browser/accept-plot3d.mjs` (6607 bytes)
- `test/browser/accept-plotv2.mjs` (9559 bytes)
- `test/browser/accept-print.mjs` (9809 bytes)
- `test/browser/accept-requirements.mjs` (4900 bytes)
- `test/browser/bench-core.mjs` (5350 bytes)
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
