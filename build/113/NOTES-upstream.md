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

## 四·六、emsdk 6.0.12 供给 + 软链切换（2026-10-10）

**背景**：`emsdk` **已在 pin 管线里**（`upstream-pins.json` 的 `kind:"toolchain"`，
`witness-upstream-pin.py` 每提交断言「容器 emcc == expect_version」），
**但只到"版本串断言"** —— 容器那份 1.8 GB SDK 是**手工解包装**的，`provision-upstream.sh`
明确不管它 ⇒ **「紧随最新版」没有受管辖入口**（只能手敲 = 不可复现）。

**新增 `build/113/provision-emsdk.sh`**（形状同 provision-upstream.sh 家族）：

| 子命令 | 做什么 |
|---|---|
| `install <版本>` | 装到 `/opt/emsdk-<版本>`（**多版本并存**，不覆盖）；装完 fail-closed 核对读出的版本串 == 请求的版本 |
| `use <版本>` | 切 `/emsdk` 软链；若 `/emsdk` 是真目录**先改名为备份**（不删） |
| `status` | 打印 `/emsdk` 指向 / 容器 emcc / 已装版本 / pins 期望 |

★ **为什么用软链而不是改脚本**：`/emsdk/...` **硬编码 36 处、散在 25 个 build 脚本**里
（`grep -rn '/emsdk' build/**/*.sh | wc -l`）。让 `/emsdk` 保持稳定路径 ⇒ 切版本时
**那 36 处一个都不用改**（否则就是"两处口径漂移"的老形状）。

**实测（本批已做）**：

| 项 | 结果 |
|---|---|
| `install 6.0.12` | ✅ 装到 `/opt/emsdk-6.0.12`（clang/LLD **24.0.0**，sysroot 就位） |
| 6.0.12 编现役 `.oct` 源（w64，`-sSIDE_MODULE=1 -sMEMORY64=1 -pthread -fwasm-exceptions`） | ✅ 出 **5398 B** |
| **该产物在现役（5.0.7 构建的）wasm64 Octave 上 dlopen + 调用** | ✅ `exist=3` / `det=5` / `det2=-2` |

⇒ **结论 1**：`.oct` 侧可以**先走 6.x**，不必等整树/farm 重编 —— 这是可分段推进的第一个证据。

**升级时要适配的一处（实测）**：`-sMEMORY64=1` 在 6.0.12 报
`warning: MEMORY64 is deprecated (prefer the standard -m64 or --target=wasm64 flags)`。
⇒ `build/113/*.sh` 里的 `-sMEMORY64=1` 迟早要换 `-m64`（本批未改：断言面不够，
先记录；等真做全树升级时一并换）。

**`expect_version` 是数据不是代码**：`upstream-pins.json` 里一个字段，切版本 = 改数据 +
bump `upstream/emsdk` submodule pin（6.0.12 的 tag commit = `35ff8a6d15`）。
**两条要同批改**，否则 witness 当场红（这正是它该干的事）。

## 四·七、emsdk 升级的**机械性缺口**（2026-10-10，试点实测发现）

试点（6.0.12 编 zlib）跑通了，但过程中发现**两个会让升级"看起来成功、实则混版"的缺口**——
它们是升级必须先补的，不是可选的清理项。

### 缺口 1：源码树指纹**只记旗标、不记工具链版本** ⇒ 换 emcc 会静默复用旧树

`build-libs.sh` 的 `clear_if_flags_changed()`（第 55 行）把 `LANE_FLAGS` 写进
`$WORK/<dir>/.lane-flags`，指纹不符就清树重解包。机制本身是对的（glpk 悬案结案时加），
**但指纹里没有 emcc 版本** ⇒ 从 5.0.7 切到 6.0.12 时：

- 树已存在、`LANE_FLAGS` 没变 ⇒ **指纹相同 ⇒ 不清树** ⇒ `make` 按 mtime 判"全部最新"
  ⇒ **零重编** ⇒ 产物仍是 5.0.7 编的，而你以为升级了。

这与文档里记过的"旗标指纹"事故**同形**（"换旗标不清树 ⇒ 静默保持旧指针宽度"，NOTES-wasm64
「glpk 悬案结案」）：**同一个坑，换了个变量（工具链版本）再踩一次**。

**修法（本批未改，留作升级第一批）**：指纹串里并入 `emcc --version` 的版本串
（或 `$(emcc --version | head -1)` 的行哈希）。改一行 `stamp_dir`/比对即可，
但**必须同时配反向断言**：故意用两个版本编同一个库，断言第二次**真的**重编了
（否则就是"赋值了但没被引用"那类静默失效）。

### 缺口 2：`need_arch()` 里 `llvm-readobj` 的路径**硬编码 `/emsdk/upstream/bin`**

第 69 行：`local ro="/emsdk/upstream/bin/llvm-readobj"`，取不到才退回 PATH 上的
`llvm-readobj`。软链方案下这行**仍然可用**（`/emsdk` 始终有效），但：
- 若哪天 `/emsdk` 指向的版本里没有这个路径（或切换中途），架构断言会静默退到
  "PATH 上随便一个 llvm-readobj" ⇒ **可能用错版本的 readobj 去读 wasm64**（判别力下降）。
- 这是"路径硬编码 36 处"的一个**承重**实例（其余 35 处只是找编译器，这处是**判据**）。

### 试点实测数据（有正面结论）

| 项 | 结果 |
|---|---|
| 6.0.12 编 `zlibbz2`（隔离 prefix `/src/deps-6012`） | ✅ 5 秒；`libz.a` **103336 B**（5.0.7 版 103546 B） |
| 架构断言（`need_arch`） | ✅ `Format: WASM` / `Arch: wasm32` |
| 逐库符号自检（`emnm` 验 `deflate`/`inflate`/`gzopen`） | ✅ 3/3 |
| 6.0.12 编 `.oct`（w64 源，现役头树） | ✅ 5398 B |
| 该 `.oct` 在 **5.0.7 构建的**现役 wasm64 Octave 上 dlopen + 调用 | ✅ `exist=3` / `det=5` / `det2=-2` |

⇒ **两个正面结论**：① 6.0.12 编 zlib 这类 C 库**零改动**可用（`build-libs.sh` 一行没改）；
② `.oct` 侧**跨版本兼容**（6.0.12 编的能装进 5.0.7 的宿主）⇒ 升级可**分段推进**，
不必"三条线一次性全切"。

### 缺口 1 的**验证手段**（已实测可用）

怎么证明"这个 `.a` 到底是哪个 emcc 编的"？—— 读 **`producers` 自定义段**：

```bash
node -e 'const b=require("fs").readFileSync("libglpk.a"); 
  console.log([...new Set((b.toString("latin1").match(/clang version [0-9.]+/)||[]))])'
# 6.0.12 编的 → "clang version 24.0.0"（LLVM 24）
# 5.0.7 编的  → clang 23.x
```

实测：`/src/deps-6012/glpk/lib/libglpk.a` 的 producers 段含 **`24.0.0`** ⇒ 确证是 6.0.12
编的（不是复用旧树）。**这条断言应当成为"工具链指纹"缺口的反向测试**：升级后随机抽一个
`.a` 读 producers，版本串必须是新版的 —— 否则就是"静默复用旧树"（缺口 1 的失败形态）。

### 缺口 3（**试点抓到的最重要一条**）：PATH 换版本**不够** —— CMake 类库会"两个 emsdk 混用"

**实测现象**（6.0.12 编 `build-libs.sh all`，前面 zlib/glpk/fftw 都过，到 **qhull 挂**）：

```
CMake Error at /emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake:96:
  Process returned with error code 1.
  emcc: error: ''$CFGDIR/upstream/bin/clang' -v -target wasm32-unknown-emscripten'
  failed: [Errno 2] No such file or directory
```

**根因（机制，不是巧合）**：那次试点我的做法是**只把 6.0.12 放进 PATH 首位**（`/emsdk` 软链**没动**，
仍指 5.0.7）。于是：

- `emcmake`（PATH 里的 6.0.12 那份）按**自己所在目录**推出 toolchain 文件 —— 但
  `build-libs.sh` 里 qhull 那支用的是**写死的** `/emsdk/upstream/emscripten/cmake/...`（5.0.7 的）；
- 5.0.7 的 `Emscripten.cmake` 展开 `$CFGDIR` 用的是**当时的 EM_CONFIG**，而 EM_CONFIG 落在
  `/emsdk`（5.0.7）⇒ **clang 路径与编译器版本错位** ⇒ cmake 的编译探测失败。

⇒ **PATH 级切换对 CMake 类库不够**：`emcc`/`emcmake`/`EM_CONFIG`/`cmake toolchain 文件`
**四者必须来自同一份 emsdk**。这正是 `/emsdk` **软链方案**（`provision-emsdk.sh use`）要
解决的问题 —— 它让四者天然一致（全在 `/emsdk` 下）。**PATH 方案只适合纯 configure/make 的库**
（zlib/glpk/fftw 过了就是证据）。

**对升级流程的硬要求**（写进推广方案）：

1. 升级**必须用 `provision-emsdk.sh use <版本>` 切软链**，不能只改 PATH。
2. 切软链前**必须**先把现役树/产物隔离（`DEPS`/`WORK`/`PREFIX` 指向新目录），
   否则 `need_arch`/别的脚本读到的 `/emsdk` 变了、而 ccache 里还是旧版对象 ⇒ 混版。
3. **`EM_CONFIG` 必须跟着版本走**（软链方案下自动成立；手改 PATH 时必须显式设）。

**这一条也解释了为什么"三条线一起切"是错的**：三条线共用一个容器、一个 `/emsdk`
⇒ **软链是全局状态** ⇒ 同一时刻只能有一条线的构建在正确版本下跑。
⇒ 升级只能**串行逐线**，且每条线切版本时，**其余两条线的产物必须已经落盘（不依赖容器现行状态）**。
