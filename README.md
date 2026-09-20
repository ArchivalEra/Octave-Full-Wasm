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
Octave 7.2 wasm（build/Makefile + build/main.cc 补丁）
├── 全量核心 .m（plot/ode/signal/special-matrix/…，两段式 addpath）
├── vendor/forge：forge statistics 纯 .m（normpdf/tcdf/ttest 依赖…）
├── vendor/plotbridge：自研 plot 翻译桥垫片（plot/hold/legend/…）
└── gnuplot-wasm（MIT）：render(script,{data}) → SVG（另见 PoC 页）
```

## 状态（2026-09-20 实测）

| 项 | 结果 |
|---|---|
| 线代/微积分/优化/ODE45/多项式 | ✅ 全对 |
| 统计分布 + ttest/regress + fft 后备 | ✅ 全对 |
| `plot/hold/scatter/stem/semilogx/bar` 翻译桥 v1 | ✅ SVG 通，marker 表待锁 |
| C 库 5 件（qrupdate/arpack/fftw双单/qhull/glpk） | ✅ 全部编入并验数 |
| 批次 0：dldfcn 静态注册表 + convhulln + fftw() | ✅ 表驱动注册，实测通过 |
| 批次 1a：zlib/bz2/RapidJSON/CCOLAMD + gzip/bzip2 | ✅ 实测通过 |
| 批次 1b：libsndfile → audioread/audiowrite/audioinfo/audioformats | ✅ wav 往返通过 |
| 待办：CXSparse/SPQR、SUNDIALS(ode15s)、HDF5、桥接 | ⬜ 见 build/CLIBS.md 与本文件"下一步" |

### 已装 dldfcn（`main.cc` 的 `STATIC_DLD_FCNS`，一行一模块）
`__delaunayn__ / __glpk__ / __voronoi__ / convhulln / fftw / gzip / bzip2
/ audioread / audiowrite / audioinfo / audioformats`

### 已知偏差
- `fftw('threads',N)` 静默 no-op（`fftw_init_threads` 桩须返回成功，否则核心 `fft` 崩）。
- `gunzip`/`bunzip2`（`.m` 包装）调 `system("gzip -d …")` → 无 shell，清晰报错。
  符合"宿主专属功能=明确报错"的口径。

## 下一步（待排期）

- **批次 1c**：CXSparse（`OCTAVE_CHECK_CXSPARSE_VERSION_OK` 的 `HAVE_CS_H` 头宏链坑）、
  SPQR（源码需从 `suitesparse-full-5.4.0.tar.gz` 单独取）。
- **批次 2**：SUNDIALS 5.8.x（IDA + serial NVector + dense + KLU）→ `ode15s`/`ode15i`。
- **批次 3**：HDF5（C-only 静态 + zlib）→ `save/load -hdf5`。
- **桥接**：fetch→`urlread`/`webread`；xls/xlsx→`xlsread`；Web Audio→`audioplayer`；image→`imread`。

## 目录

<!-- AUTO:FILES -->
- `.githooks/check-whitelist.py` (1076 bytes)
- `.githooks/install.sh` (239 bytes)
- `.githooks/pre-commit` (215 bytes)
- `.githooks/pre-push` (182 bytes)
- `.githooks/update-readme.py` (2110 bytes)
- `.gitignore` (728 bytes)
- `LICENSE` (34523 bytes)
- `bridge/octplot.html` (6162 bytes)
- `bridge/plotbridge.js` (4772 bytes)
- `build/CLIBS.md` (7722 bytes)
- `build/Makefile` (7798 bytes)
- `build/NOTES.md` (1657 bytes)
- `build/build_dldfcn.sh` (1256 bytes)
- `build/fftw_threads_stub.c` (377 bytes)
- `build/main.cc` (16520 bytes)
- `build/normalize_arpack.py` (1691 bytes)
- `build/plotbridge/__pb_add__.m` (2731 bytes)
- `build/plotbridge/__pb_emit__.m` (1966 bytes)
- `build/plotbridge/__pstate__.m` (589 bytes)
- `build/plotbridge/bar.m` (636 bytes)
- `build/plotbridge/clf.m` (328 bytes)
- `build/plotbridge/figure.m` (211 bytes)
- `build/plotbridge/grid.m` (357 bytes)
- `build/plotbridge/hold.m` (357 bytes)
- `build/plotbridge/legend.m` (496 bytes)
- `build/plotbridge/loglog.m` (758 bytes)
- `build/plotbridge/plot.m` (1072 bytes)
- `build/plotbridge/scatter.m` (614 bytes)
- `build/plotbridge/semilogx.m` (747 bytes)
- `build/plotbridge/semilogy.m` (747 bytes)
- `build/plotbridge/stem.m` (753 bytes)
- `build/plotbridge/title.m` (146 bytes)
- `build/plotbridge/xlabel.m` (152 bytes)
- `build/plotbridge/xlim.m` (271 bytes)
- `build/plotbridge/ylabel.m` (139 bytes)
- `build/plotbridge/ylim.m` (271 bytes)
- `build/reconf-batch1.sh` (1996 bytes)
- `build/reconf-batch1b.sh` (1931 bytes)
- `build/reconf.sh` (2843 bytes)
- `build/second_stub.f` (213 bytes)
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

AGPL-3.0（见 LICENSE）。这种混合（GPLv3 Octave + GPLv3 forge/
qrupdate + GPLv2+ FFTW + BSD/ permissive 件）没有 AGPL-3.0 以外的选择。
`build/` 补丁源自 rwl/octave-wasm（BSD），见 build/NOTES.md；
各 vendor 文件头保留原许可声明，来源见 vendor/MANIFEST.md。
