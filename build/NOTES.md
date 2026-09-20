# 构建补丁说明（相对上游 rwl/octave-wasm，Octave 7.2.0 + Emscripten 3.1.24）

`build/Makefile` 与 `build/main.cc` 是上游 `src/` 的修改版。
上游 BSD-3-Clause，本仓修改部分随仓许可（待定，倾向 AGPL-3.0）。

## Makefile（只改 `web/octave.js` 目标；worker/node 目标原样）

1. `--preload-file` 从 16 个目录补到全量核心脚本目录，外加：
   - `forge@/usr/src/octave/m/forge`（forge 统计 + 自研 fft/ttest，见 vendor/MANIFEST.md）
   - `plotbridge@/usr/src/octave/m/plotbridge`（自研 plot 翻译桥垫片）
   - `etc/macros.texi`（修报错信息显示；缺它时参数报错裸奔）
2. 删除 `@ftp` 那行：`SRC@DST` 按首个 `@` 切分，`@ftp` 会把整个 `m/` 打包进垃圾路径
   （包从 1051 文件膨胀到 2117，启动从 0.7s 恶化到 180s）。
3. `EM_SFLAGS` 里 `FS_DEBUG=1 → 0`（每文件操作的 FS 日志刷屏是慢启动元凶之一）。

## main.cc（只改 `execute_interp` 的 addpath 段）

- 原 16 目录一次加（保底， proven good）。
- 新目录逐个 try/catch 加：单个坏 PKG_ADD 只跳过自己。
  背景：`optimization/PKG_ADD` 执行时 `unique`（set/）还没上 path，
  单次 Faddpath 会整体抛异常中止，只剩一半 path（`cond/roots/version` 全丢）。
- 去掉 `@ftp`、`+containers`、`+matlab` 的 addpath（包目录由父目录解析；`+` 包靠最后加的
  `/usr/src/octave/m` 父目录生效）。
- 新增 `forge`、`plotbridge`。

## 已知构建警告（上游遗留，无害）

`cgejsv_` / `zgejsv_` 未定义符号警告（LAPACK 相关，ERROR_ON_UNDEFINED_SYMBOLS=0 容忍）。
