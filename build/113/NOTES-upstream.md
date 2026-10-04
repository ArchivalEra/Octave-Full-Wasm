# NOTES · 上游接入与升级 SOP（仓库架构批，2026-10-04）

> 用户目标：**"不属于我们的"以 fork 形式接入仓库**——Octave/emsdk/上游库更新时立刻能尝到。
> 本文 = 现行架构 + 升级 SOP。事实面：`.gitmodules`（18 submodule）、`build/upstream-lock.json`
> （7 个无 git 上游）、`build/upstream-pins.json`（活性断言面）。

## 一、现行架构（三形态）

| 形态 | 适用 | 清单 |
|---|---|---|
| **fork + 补丁分支** | 我们打过补丁的 | `ArchivalEra/{octave,OpenBLAS,gl4es,rapidjson}`（SuiteSparse 对 tag 零差异，直连） |
| **submodule 直连** | 没改过的 | emsdk 5.0.7、freetype VER-2-13-3、fontconfig 2.14.2、expat R_2_6_4、pcre2 10.45、hdf5 1_14_2、fftw 3.3.10、zlib 1.3.1、bzip2 1.0.8、qhull v8.0.2、arpack-ng 3.7.0、sundials v6.1.1、sndfile 1.2.2 |
| **lock-tarball** | 无官方 GitHub git | lapack 3.4.2、libf2c2、f2c、glu、gl2ps、qrupdate、glpk（URL+sha256，`build/upstream-lock.json`） |
| 退役/另行 | — | mesa（osmesa 已退役）不接入；forge 6 包保持 forge-fetch sha256 钉法 |

Octave 分支谱系（ArchivalEra/octave）：
`release-11-3-0`（官方镜像 tag）→ `tarball/11.3.0`（**release tarball 原样 commit**——含
bootstrap 生成件，这是 git 树与 tarball 树的桥）→ `wasm/11.3.0`（+ 平台补丁：apply-platform
4 sed、ax-pthread、odepack-arity、configure 运行时适配）。submodule 指向 `wasm/11.3.0`
（`37dd7409e6df`，台账键 `octave_pin`）。

## 二、供给（submodule → 容器）

```
sh build/provision-upstream.sh --only octave
#   upstream/<name> checkout → tar 流入容器 <container_path>（排除 .git）
#   容器树根写 .upstream-pin stamp：<name> <branch> <commit> <dirty>
python3 .githooks/witness-upstream-pin.py     # ⇒ ok / DRIFT / SKIP（读不到容器）
```

- 供给**不碰现役树**：新树进 `--into` 指定的独立路径（默认 `/src/work/upstream/`）；
- `link-web.sh` 的树路径可覆盖（`OCT_TREE`，模式表透传）；`relink.sh` 用 `OCT` 环境变量；
- witness 每提交核对：容器树 commit == submodule pin、dirty=0、emsdk 版本串——
  **指针 bump 而容器仍旧树/有人手改供给树 ⇒ DRIFT**。

## 三、上游更新 SOP（以 Octave 11.4.0 为例）

1. **fork 侧**：`ArchivalEra/octave` fetch 官方 tag `release-11-4-0`；
   `git switch -c tarball/11.4.0 release-11-4-0`；解包官方 11.4.0 tarball 覆盖树、
   `git add -A && git commit`（生成件 commit，同 11.3.0 形态）；
   `git switch -c wasm/11.4.0` → cherry-pick/rebase `wasm/11.3.0` 的补丁 commits（冲突手解）→ push。
2. **本仓**：`git submodule update --remote upstream/octave`（.gitmodules branch 改
   `wasm/11.4.0`）→ `git add upstream/octave`（指针 bump 是可见提交）。
3. **供给 + 等价性**：`sh build/provision-upstream.sh --only octave` →
   `OCT=<新树> OCT_TREE=<新树> relink.sh rebuild w64 --yes-rebuild`（数小时）→
   `relink.sh verify` → 实验站全量 `PROBES=1`（43 套含 dldfcn + 数值）→ 交错 bench。
4. **发运**：用户拍板 → `promote-w64-lane.sh`（8768 → 8761）→ 台账重测（pin 键更新）→
   旧产物备份。
5. emsdk 更新：bump submodule + `upstream-pins.json` 的 `expect_version` → 新容器装
   `emsdk install <新版>` → 全部车道依赖 farm 重编（大工程，单独立项）。
6. lock-tarball 库更新：换 URL/sha256 进 `upstream-lock.json` → 重编该库 → 验收。

## 四、闸门与事实（谁在看着）

- `octave_pin` / `upstream_submodule_count`（FACTS，replay 可跑）；
- `witness-upstream-pin.py`（pre-commit，容器树三断言）；
- 既有：`tool.emcc`（产物身份证）= emsdk 身份；`w64_build_tool_match` = 构建脚本来源；
  `check-build-manifest` = declared/measured fail-closed。
- 自证：`witness-upstream-pin.py --selftest`（6 用例）已登记 `build/gates-selftest.sh`（39 闸门）。

## 四·五、emcc 6.0.10 探针实测（IllegalPerformance 线，2026-10-04）

**问题**：emcc 5.0.7 → 6.0.10（clang 23 → 24，musl 1.2.5→1.2.6，mimalloc→3.5.1）
能白拿多少？

**实测**（`test/fixtures/emcc6-probe/`，6.0.10 并行装 `/opt/emsdk-6`，o113 车道 5.0.7 未动；
同源 dgemm-naive 384³ / qsort 2^20 / memcpy / byte-sum，交错 3 轮，两跑一致）：

- **codegen 红利 ≈ 0**：geomean 1.003 / 1.001（四面全在噪声内）。
  机制：两侧 clang 仅差一个主版本位（23/24 git-main），标量/向量 codegen 无实质演化。
- **旗标存活矩阵全绿**：`-sMEMORY64=1` / `-fwasm-exceptions` / `-sJSPI` / `-pthread` /
  `-mrelaxed-simd` / `-sMAIN_MODULE=2` 在 6.0.10 全部编译通过。
- **6.0.0 破坏面对照**（ChangeLog + 本仓 grep）：`-shared` 默认真动态库——本仓 .oct
  全部显式 `-sSIDE_MODULE=1` 不受影响；`PThread.runningWorkers` 移除——本仓无暴露；
  musl 1.2.6 / mimalloc 3.5.1——随全 farm 重编才有意义。

**结论**：emcc 6 升级**当前不值得立项**——编译器红利实测为零，而成本 = 全 farm 重编
（且被工单 62 的 ABI 分叉悬案阻断）。合理的重启时机 = 工单 62 结案之后（那时重编是
必经之路，顺路升级零边际成本）。探针永久可复跑（`emcc6_probe_geomean` 台账键），
6.0.x 后续版若有 codegen 演化会立刻显形。

## 五、诚实注记

- B5 等价性批次（供给树 rebuild w64 + 全量）是架构成立的**实测门槛**；结果记 HISTORY。
- gl4es 的 master 快照 commit（`a444cc9`）与当年 tarball 快照的对应对已不可考——
  等价性由 B5 重编 + 验收绑定，不由快照日期绑定（如实记）。
- suitesparse 对官方 v5.4.0 tag **零差异**（build-libs.sh 所记 3 处人工改动与该 tag
  不可分辨）⇒ 无补丁分支，tag 直连。
- QuantStack 19 件参考补丁存 `upstream-patches/octave-wasm-quantstack/`（谱系出处，
  非构建输入）。
