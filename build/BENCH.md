# R10 基准矩阵：Octave 本体的 O 级

**结论先行**：`-O1` 相对 `-O0` 是**全面胜出**——最慢的项快 6.8 倍，而且 `octave.js`
反而小了 10MB。**基线应当从 `-O0` 改为 `-O1`。**

**`-O2` 相对 `-O1` 没有可测收益**（全部落在噪声内，见下表），而编译代价更高
（内存翻倍、要降到 `-j12`）。所以取 **O1** 为采纳档。

---

## 测法与口径

- 套件：`test/browser/bench-core.mjs`（每项跑 3 次取**中位数**；首次调用含惰性
  初始化，只测一次会得到噪声极大的数）。
- 计时器：Octave 自己的 `tic`/`toc`（墙钟），不含 JS 侧开销。
- 机器：本机（24 线程 / 32G），容器 `obench`（从 `octave-build:b9-net` 起）。
- 体积：`Content-Length`（未压缩）。
- 每档都跑过 `accept-full` 等回归套件确认没坏（见每节）。

## 矩阵

| 项目 | O0（基线） | O1 | 倍率 | O2 | O2/O1 |
|---|---|---|---|---|---|
| 循环 1e6 | 3.516 s | **0.516 s** | **6.8×** | 0.510 s | 1.0× |
| classdef | 0.082 s | **0.008 s** | **10.3×** | 0.008 s | 1.0× |
| ODE45 摆 | 0.124 s | **0.023 s** | 5.4× | 0.021 s | 1.1× |
| ODE15s 刚性 | 0.116 s | **0.023 s** | 5.0× | 0.026 s | 0.9× |
| textscan | 0.009 s | **0.002 s** | 4.5× | 0.001 s | 2.0× |
| 稀疏求解 1e5 | 0.011 s | **0.003 s** | 3.7× | 0.003 s | 1.0× |
| sort 2e6 | 0.555 s | **0.228 s** | 2.4× | 0.226 s | 1.0× |
| FFT 1e6 | 0.059 s | **0.038 s** | 1.6× | 0.034 s | 1.1× |
| 矩阵乘 500² | 0.281 s | 0.279 s | 1.0× | 0.281 s | 1.0× |
| 矩阵分解 lu(800) | 0.428 s | 0.391 s | 1.1× | 0.391 s | 1.0× |
| **ready（首帧可用）** | 1.93 s | **1.44 s** | 1.3× | 1.44 s | 1.0× |

**O1 → O2：全部落在噪声内**（最大差异是 textscan 的 2ms，而该项三次采样本身就是
1–3ms）。`-O2` 额外付出的编译内存（必须从 `-j24` 降到 `-j12`）换不到可测收益。

体积：

| | O0 | O1 |
|---|---|---|
| octave.wasm | 45.05 MB | 46.81 MB（+1.8MB） |
| octave.js | 30.81 MB | **21.55 MB（−9.3MB）** |
| octave.data | 6.23 MB | 6.23 MB |
| **三大件合计** | 82.09 MB | **74.59 MB（−7.5MB）** |

**解读**：纯数值（BLAS/LAPACK/FFT 这类已经在库里做重的部分）几乎不动——那是
预编译 `.a` 的代码，与我们给 Octave 本体加的 O 级无关。真正提速的是 **Octave 自己
的解释器循环**（tree_walker、类型分派、索引、classdef 查表）——这正是 `-O0`
最吃亏的地方，也是"循环 1e6"这类**教学里最常写的代码**受益最大的原因。

`octave.js` 变小是反直觉但合理的：`-O1` 让内联与死代码消除生效，**JS 胶水里
那份巨大的 dylink 符号表**跟着缩水（`MAIN_MODULE=1` 不做 DCE 时，符号表大小
直接反映 C++ 侧的符号数量）。

## 回归证据

| O 级 | full | print | plotv2 | plot3d | 结论 |
|---|---|---|---|---|---|
| O1 | 19/19 | 43/43 | 54/54 | 34/34 | 未发现回归 |
| O2 | 19/19 | 43/43 | 54/54 | 34/34 | 未发现回归 |

（O0 是现行基线，全量 12 套 330 项已绿。）

**采纳 O1 时跑的是全量 12 套**（不是上表这 4 套）——见 §采纳决定。

## 采纳决定

**基线改为 `-O1`。** 依据：
1. 教学场景的主力是解释器密集代码（循环、classdef、ODE 回调），收益 5–10×；
2. 体积还小了 7.5MB，ready 也更快——**没有代价**；
3. 重编一次全树即可，`build/reconf-bench.sh 1` 是完整配方。

## 复现方法

```sh
# 在一次性容器里（不要动 odld —— 基线不该被实验污染）
docker run -d --name obench octave-build:b9-net sleep infinity
docker cp build/reconf-bench.sh obench:/root/
docker exec obench sh -c 'cd /usr/src/octave-wasm/third_party/octave-7.2.0 && sh /root/reconf-bench.sh 1'
# 取出 web/octave.{js,wasm,data} → 独立站点目录 → 独立端口 → 跑 bench-core.mjs
```

## 已论证不做

- **wasm64**（`-sMEMORY64`）：R10 需求书里明确不碰。Emscripten 3.1.24 的
  MEMORY64 仍是实验态，且本项目所有依赖库（SuiteSparse/ARPACK/GLPK/…）都要
  重编，收益（>4GB 内存）对教学场景没有意义。
- **`-O3`**：wasm 后端对 `-O3` 的额外收益历来很小，而编译时间与内存继续上升。
  在 O1 已经拿到 5–10× 的情况下不值得再花一轮全树重编去量。
- **`--closure 1`**：Emscripten 的 JS 压缩；本项目交付走 EdgeOne 的自动 gzip/brotli，
  不重复做压缩（用户已明确"完全不管 gzip"）。

## 坑（重编时踩到的）

### 坑 A：`-O1` 下 configure 的 Fortran 探测直接失败

```
emcc: error: conftest.c: No such file or directory
configure: error: cannot compute suffix of executables
```

`fort77` 收到 `-E`（预处理模式）后只做预处理、不产出 `.c`，随后仍去调 emcc 处理
`conftest.c` → 找不到 → configure 判编译器不可用，整个 configure 退出。

**基线 `reconf-pic.sh` 之所以没暴露这个问题**，是因为它依赖 `/tmp` 里上一次
configure 残留的 `conftest.f`；换一个干净容器（`obench`）就复现。

**解**：预置 `octave_cv_sizeof_fortran_integer=4`。configure 在
`cross_compiling=yes` 时本来就短路成 4（`configure:37604-37613`），预置等于替它
把答案写好，整段探测不用跑。同 `build_pkg_oct.sh` 里 `cross_compiling` 补丁的思路。
（`build/reconf-bench.sh` 已内建。）

### 坑 B：`-O2` 要降并行度

`-O2` 下 clang 的内存占用明显上升，`-j24` 在 32G 机器上会 OOM。
`build/reconf-bench.sh` 在 `-O2`/`-O3` 时自动降到 `-j12`。
