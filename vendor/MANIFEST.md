# vendor 清单：随包预装的第三方 .m（进 `octave.data`，经 `forge` 目录上 path）

## A. gnu-octave/statistics（GPL-3.0-or-later，共 16 个）

上游：https://github.com/gnu-octave/statistics（main 分支 2026-09-20 拉取）

分布：`normpdf normcdf norminv tpdf tcdf tinv betacdf betapdf betainv`
`gamcdf gampdf gaminv chi2cdf fpdf fcdf`
回归检验：`regress`

依赖闭包：全部落到核心 `betainc/gammainc/erfc/common_size`（逐个验过）。
`regress` 需 `tinv/fcdf`（在内）；`tinv/chi2cdf` 需 `betacdf/gamcdf`（在内）。
注意：新版 forge `ttest` 要核心 9.x 的 `mean/std(..., "omitnan")`，
7.2 跑不动——本仓用自研 `ttest.m`（见 C 组）代替，没有 vendor forge 的 ttest。

合规：GPL-3.0+ 文件合入 AGPL-3.0 作品允许（整体按 AGPL），文件头保留，
来源与拉取日期记在此。

## B. kyak/matlab-ascii-plot（BSD-3-Clause，1 个）

`asciiplot.m`（940 字节）：终端字符画降级，wasm 里 rc=0 直接跑。

## C. 自研（随仓许可，3 个）

`fft.m / ifft.m`：纯 `.m` 后备 FFT（radix-2 + 直接 DFT 兜底），`.m` 可压住
无 FFTW 后端的坏内建。教学量级毫秒级；大 N 加速备选 pocketfft（BSD，未集成）。
`ttest.m`：one-sample/paired 子集（alpha/tail/dim + 去 NaN），p 值与 R 一致。

## D. 渲染侧（不进包，另行托管，MIT 包装层）

`stereobooster/gnuplot-wasm`（gnuplot 6.0.2 wasm，`render(script,{data}) → SVG`）：
gnuplot 本体进 Debian main（DFSG-free），打包时带上其 Copyright 声明。
`MatlabJS/plotlib.js`（MIT）：只借 API 组织参考，未采用其 Canvas 渲染。
