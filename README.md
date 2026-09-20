# Octave-Full-Wasm

目标：**浏览器里跑满功能 Octave 7.2**——官方 `rwl/octave-wasm` 只预装 16 个 `.m` 目录，
本仓库把剩下能补的全部补上：全量核心脚本、forge 统计、纯 `.m` 后备 FFT、
自研 `ttest`、plot 翻译桥（Octave 算 + gnuplot-wasm 画）。

上游：`rwl/octave-wasm`（BSD）+ Emscripten 3.1.24。构建产物（wasm/data/js）
体积大，走 Release 分发，不进 git。

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
| C 库 5 件（qrupdate/arpack/fftw双单/qhull/glpk） | ✅ 库编过符号全，Octave 重编中断待续（见 build/CLIBS.md） |
| 绘图显示 | 经 gnuplot-wasm 出 SVG（静态，无交互） |
| C 库长尾（FFTW/ARPACK/QHull/…） | ⬜ 待 GPT 回复后排期 |

## 目录

<!-- AUTO:FILES -->
- `.githooks/check-whitelist.py` (1076 bytes)
- `.githooks/install.sh` (239 bytes)
- `.githooks/pre-commit` (215 bytes)
- `.githooks/pre-push` (182 bytes)
- `.githooks/update-readme.py` (2110 bytes)
- `.gitignore` (538 bytes)
- `LICENSE` (34523 bytes)
- `build/CLIBS.md` (2878 bytes)
- `build/Makefile` (7331 bytes)
- `build/NOTES.md` (1657 bytes)
- `build/main.cc` (14258 bytes)
- `build/plotbridge/__pb_add__.m` (2731 bytes)
- `build/plotbridge/__pb_emit__.m` (1966 bytes)
- `build/plotbridge/__pstate__.m` (589 bytes)
- `build/plotbridge/bar.m` (636 bytes)
- `build/plotbridge/clf.m` (328 bytes)
- `build/plotbridge/figure.m` (122 bytes)
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
- `build/reconf.sh` (2843 bytes)
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
