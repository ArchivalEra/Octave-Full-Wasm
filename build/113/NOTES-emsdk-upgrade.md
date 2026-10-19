# NOTES · emsdk 6.x 升级：试点结论与逐线推广方案（2026-10-10）

> 状态：**试点已做，全量未做**。本文把"升级要做什么、代价多大、卡在哪"按实测写清，
> 供下一步决策与逐线执行。**三条线一条都还没切**（容器 `/emsdk` 当前=6.0.12 是试点态，
> 收尾时会切回 5.0.7，见 §5）。

---

## §0 三条正面结论（都是实测，推翻/支持了什么）

| # | 结论 | 证据 |
|---|---|---|
| ① | **6.0.12 编 C 库零改动可用** | `build-libs.sh` 一行未改，zlib/glpk/fftw/qhull 用 6.0.12 编出 wasm32 `.a`（qhull 15s，含 `qh_new_qhull` 符号自检） |
| ② | **`.oct` 跨版本兼容** | 6.0.12 编的 `.oct` 在 **5.0.7 构建的**现役 wasm64 Octave 上 `dlopen` + 调用成功（`exist=3`/`det=5`/`det2=-2`）⇒ 升级**可分段**，不必三线齐切 |
| ③ | **`/emsdk` 软链是正确形态** | 切软链后 **PATH 完全不动**，36 处硬编码路径零改动，emcc/emcmake/EM_CONFIG/cmake-toolchain 四者自动同版本 |

**推翻的东西**：原先 `NOTES-upstream.md` §四·五 的结论是"emcc 6 升级**不值得立项**"
（codegen 红利 geomean 1.001）。那条**只算了性能红利，没算"紧随最新版"的战略价值**。
用户点令"之后一定紧随最新版"⇒ 那份判决的条件变了：**现在升级的理由不是性能，是保持与上游同步的能力**。
（性能结论本身仍然成立：升级**不会**带来提速，别指望。）

---

## §1 试点抓到的三个**机械缺口**（升级必须先补）

### 缺口 1：源码树指纹不记工具链版本 ✅ **已修**（`a92c732`）

`build-libs.sh` 的指纹只记 `LANE_FLAGS` ⇒ 换 emcc 时旗标没变 ⇒ 指纹相同 ⇒ 不清树 ⇒
make 判"全最新" ⇒ **零重编，产物静默保持旧版**。修法：指纹并入 emcc 版本串；
老格式指纹（无 `|`）**复用 + 警告**（不炸现役），升级时显式 `WIPE_TREES=1`。
配 6 条自证（三类用例齐），已登记 `gates-selftest.sh`。

### 缺口 2：`need_arch()` 里 `llvm-readobj` 路径硬编码 `/emsdk/upstream/bin` ⬜ **未修**

软链方案下仍可用（`/emsdk` 恒有效），但它是**判据**不是"找编译器"——若 `/emsdk` 中途
指向没有该路径的版本，架构断言会静默退到"PATH 上随便一个 llvm-readobj"，
**判别力下降**。建议：改成 `"$E,/emsdk/upstream/bin/llvm-readobj"` 取不到才退 PATH，
并显式打印用的是哪一份。

### 缺口 3：**PATH 换版本不够，CMake 类库会"两个 emsdk 混用"** ⚠️ **最重要**

实测：只把 6.0.12 放进 PATH（`/emsdk` 不动）⇒ zlib/glpk/fftw 过，**qhull 挂**：

```
CMake Error at /emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake:96:
  emcc: error: ''$CFGDIR/upstream/bin/clang' -v -target wasm32-unknown-emscripten'
  failed: [Errno 2] No such file or directory
```

机制：`emcc`/`emcmake`/`EM_CONFIG`/**cmake toolchain 文件** 四者**必须同版本**；
PATH 级切换只换了前两者。⇒ **升级必须用 `provision-emsdk.sh use <版本>` 切软链**。
（切软链后 qhull 15s 编过 —— 已验证。）

---

## §2 全量升级的真实代价（实测/估算分开）

| 层 | 规模 | 性质 |
|---|---|---|
| farm 依赖库 | 10 个 `build-libs.sh` 目标 + OpenBLAS/LAPACK/SLICOT/gl4es/freetype/fontconfig/gl2ps/expat… | **实测**：zlib 5s、qhull 15s、fftw ~2min；全套估 **30–60 min**（含 ccache miss） |
| Octave 树 | **1466 个 `.o`** | 未实测；按历史构建估 **40–90 min** |
| `.oct` 车道 | w64 19 + threads 19 = **38 个** | 未实测；估 **5–15 min** |
| **× 三条线** | wasm32-final / master / IllegalPerformance | 各一套 ⇒ **串行 3 倍** |

**关键约束（缺口 3 的直接推论）**：三条线**共用一个容器、一个 `/emsdk`** ⇒
**软链是全局状态** ⇒ 同一时刻只能有一条线在正确版本下构建 ⇒ **升级只能串行**，
且每条线切版本前，**其余线的产物必须已落盘**（不能依赖容器现行状态）。

---

## §3 逐线推广方案（建议顺序）

### 前置（一次性，已完成）
- ✅ `provision-emsdk.sh`（install/use/status，7 自证）
- ✅ 工具链指纹修复（缺口 1）
- ⬜ 缺口 2（`need_arch` 路径）—— 建议与第一次真升级同批做
- ⬜ pins 更新：`upstream-pins.json` 的 `expect_version` + `upstream/emsdk` submodule
  bump 到 6.0.12（tag commit `35ff8a6d15`）。**两条必须同批**，否则 witness 红。

### 每条线的升级流程（模板）
1. **隔离**：`DEPS=/src/deps-<ver>-<line>`、`WORK=/src/libwork-<ver>-<line>`、
   `PREFIX=...` —— 全部指新目录，**现役 prefix 一字不动**。
2. **切版本**：`bash build/113/provision-emsdk.sh use 6.0.12`（切软链 + 验版本）。
3. **重编三层**：farm（`WIPE_TREES=1`）→ Octave 树 → `.oct` 车道。
4. **验证**：数值四套 + 全量 `PROBES=1`（★ 这是铁律：换资源/线程/GL 的批次必须全量）。
5. **对拍**：新产物 sha / 体积 / 关键基准 vs 现役（**预期：性能≈持平，别期待提升**）。
6. **发运**：走各线的受管辖 promote 入口；8761 只由 `promote-*.sh` 改。
7. **收尾**：pins 更新 + witness 绿 + HISTORY 落档。

### 顺序建议
`master`（中庸线，非 8761 现役）**先做** ⇒ 验证全链无误 ⇒ 再做 `IllegalPerformance`
（8761 现役，风险最高，最后做）；`wasm32-final` 是冻结线，**按需再做**（或明确不升）。

---

## §4 未验与风险（诚实清单）

- **Octave 树用 6.x 能否编过**：**未验**。已知 6.0.0 破坏面（`-shared` 默认、`PThread.runningWorkers`
  移除、musl 1.2.6）在本仓**不适用**（我们显式 `-sSIDE_MODULE=1`），但**大树编译可能暴露新问题**。
  ⬜ 建议：先拿一次性小规模试编（如只编 `liboctave/array` 几个 TU）探路。
- **`-sMEMORY64=1` 弃用警告**（6.0.12 实测）：迟早要换 `-m64`/`--target=wasm64`。
  本批未改（断言面不够）。
- **ccache 全 miss**：版本变了必然 miss ⇒ 首次全编**没有缓存红利**，时间就是纯编译时间。
- **性能**：预期**持平**（geomean 1.001），升级**不带来提速**——别把它当优化项目。

---

## §5 收尾纪律（本批结束时必须做）

试点把容器 `/emsdk` 切到了 6.0.12 ⇒ **witness 会红**（版本漂移，它该红）。
**本批收尾时切回 5.0.7**，让仓库回到"声明 == 现实"：

```bash
bash build/113/provision-emsdk.sh use 5.0.7     # 回退（已归位为 /opt/emsdk-5.0.7）
python3 .githooks/witness-upstream-pin.py       # 必须 ok
```

**只有当某条线真升级时**，才同批改 `expect_version` + bump submodule + 改回 6.x。

---

## §6 试点实跑数据（2026-10-10 补，全部实测）

### 6.1 farm 逐个库耗时（6.0.12，隔离 prefix `/src/deps-6012`）

| 库 | 结果 | 备注 |
|---|---|---|
| zlibbz2 | ✅ ~5 s | |
| glpk | ✅ | `producers` 段 = `clang 24.0.0` ⇒ **确证是 6.0.12 编的**（版本核验手段见 §1 缺口1） |
| fftw（double+single） | ✅ | |
| qhull | ✅ 15 s | **切软链后才过**（PATH 姿势挂，见缺口 3） |
| rapidjson | ✅ | |
| sndfile | ✅ | |
| hdf5 | ✅ | |
| arpack | ✅ | 逐文件 `emf77` 编（Fortran） |
| qrupdate | ✅ | 同上 |
| suitesparse | ✅ | 8 个子库 |

**全部 10 个目标 6.0.12 编过**（wasm32 口径）。

### 6.2 试点踩到的两个**非升级问题**（记下来免得下次重踩）

1. **`emf77` 不在默认 PATH 里**：它是**仓库自己的** Fortran 包装（`/src/bin/emf77`，
   f2c + emcc），**不在 emsdk 里**。正常构建由**车道驱动**设好：
   `export PATH=/src/bin:$PATH`（见 `build-w64-lane.sh:38`）。
   我第一版试点漏了这行 ⇒ arpack/qrupdate 报 `emf77: command not found`。
   **与 emcc 版本无关**，是"没按车道驱动的方式起构建"。
2. **`LLVM ERROR: IO failure on output stream: Broken pipe`**：**无害**——是我把输出
   管给 `| tail -N` 造成的（tail 读完即关管道，LLVM 写到已关闭的 stdout）。
   不是构建失败；判据要看每库的 `✅` 行。

### 6.3 修正 §2 的耗时估

farm 全套在**有 ccache 部分命中**下约 **3 分钟**（10:29→10:39 含重试；纯编约 2–4 min）。
**冷编**（无 ccache）预计 **20–40 min**。Octave 树与 `.oct` 车道仍**未实测**。

---

## §7 深试：**w64 树 + 重链跑通**（2026-10-10，本批核心结论）

### 7.1 实测结果

| 步骤 | 结果 |
|---|---|
| w64 树 configure（6.0.12） | ✅ rc=0，3 分钟 |
| w64 树 make（1466 `.o`） | ✅ **1432 个对象**，**零真错误**（唯一报错 = 已知预期：`octave-cli` 缺 `zgejsv_`） |
| 树内库 | ✅ `liboctave.a` 25.5 MB / `liboctinterp.a` 36.5 MB / `libmex.a` 90 KB |
| **重链 web 产物** | ✅ **产出 28.1 MB `octave.wasm`**（现役 31.0 MB，**小 2.9 MB**），`wasm-opt` 校验通过 |
| 编译器确证 | ✅ `producers` 段 = **`clang 24.0.0git`** |

⇒ **`clang 24` / emcc 6.0.12 能编整棵 Octave 树并产出 web 产物。**

### 7.2 手拼环境变量的六个坑（**每个都是模式表里现成的，我漏传**）

> 教训：`link-web.sh` 有 30+ 个环境变量，而 `relink.sh` 的模式表存在的意义就是"**一个都不许手设**"。
> 我逐个手拼 ⇒ 逐个漏 ⇒ 每漏一个报一次错。**下次必须整份照 `relink.sh explain <模式>` 传。**

| # | 症状 | 补上什么 |
|---|---|---|
| 1 | `--shared-memory is disallowed by main.o` | **PATH 上车道影子**（`relink.sh:524` 记过） |
| 2 | Fortran 隐藏长度 i64/i32 混编（`wasm-opt: call param types must match`） | **`export F2C_PREFIX`**（`relink.sh:700` 记过：emf77 在 **make** 阶段被调） |
| 3 | 保活集报 55 条缺 | **`KEEP_LIST` 用现役那份**（别重生成：现役 1304 = `keep.txt ∪ w64扫描`，**可逐字节复现**，已验证）。⚠️ **此条只对"同版本重链"成立** —— 跨工具链升级必须重生成（§7.5 实测翻案），否则 clang 24 的 EH 新名字不在表里 ⇒ DCE 把整条 unwinder 删掉 |
| 4 | 4 个 JS 库符号报缺 | **`LIB_FUNCS`**（现役值：`emscripten_run_script,__assert_fail,abort,exit`） |
| 5 | 50 个 SLICOT LAPACK 符号报缺 | **`EXTRA_LDFLAGS` 的 `-L/src/deps-w64/lapack-simd/lib`**（SIMD 版 LAPACK；与编译器升级正交，直接复用现役那份） |
| 6 | 差分级仍报 55 条 | **`BASELINE_WASM`** —— 判据是**与基线差分**（"基线导得出、新构建导不出"才报），漏传 ⇒ 退化成"逐条报缺"，把基线也没有的符号也报出来 |

⇒ **修到第 6 条后：差异从 55 条收敛到 1 条。**

### 7.3 ★ 首个真实差异（**后来发现不是"唯一"** —— 见 §7.5 翻案）

`_Unwind_CallPersonality` —— 4 个 `.oct` 导入它（`__ode15__` / `__init_gnuplot__` /
`__bfgsmin` / `__disna_optim__`），而 6.0.12 的主模块**不再导出**它。

**根因（实测，非推断）**：

| | `_Unwind_CallPersonality` 引用数 |
|---|---|
| 现役树（5.0.7 / clang 23） | `liboctinterp.a` **63** + `liboctave.a` **15** |
| 新树（6.0.12 / clang 24） | **0 + 0** |

⇒ **clang 24 生成的异常处理表不再引用这个 personality 符号**（LLVM 24 改了 wasm EH 的实现）。
而现存 `.oct` 是 **clang 23 编的，仍导入它** ⇒ **ABI 演进造成的版本配对缺口**，不是 bug。

**修法（已验证可行）**：**把 `.oct` 也用 6.0.12 重编** —— 实测 6.0.12 编的 `__ode15__.oct`
**导入该符号数 = 0**。⇒ 整套同版本即消失。

**⇒ 这印证了 upgrade SOP 的一条硬要求**：升级**必须连 `.oct` 车道一起重编**，
不能只重编 farm + 树（否则就是这样一条"装得上、调用才炸"的缺口）。

### 7.4 `--export-if-defined` 对它是**无效**的（记录，免得后人重试）

试过 `EXPORT_IF_DEFINED="_Unwind_CallPersonality"` ⇒ 产物字节**一个都没变**。
原因：该符号在**我们的链接里未定义**，而 `--export-if-defined` 对"未定义"是**静默忽略**的。
⇒ 唯一正确修法是 §7.3 的"重编 `.oct`"（或把符号包装成主模块导出，那是额外工程量）。

### 7.5 ★★ §7.2-③ 与 §7.3 的结论**都不完整**（2026-10-10 深夜，实测翻案）

**§7.3 只查了 `_Unwind_CallPersonality` 一个名字，于是漏掉了真相**：重编 `.oct` **不是让
EH personality 符号消失，而是把它换成了 clang 24 的**新名字**。

用**完整 44 个 `.oct` 集**（core 16 + pkg 28，§8.1 那一批重编出来的）跑判据，实测：

| | 导入的 EH personality 符号 |
|---|---|
| 现役 `.oct`（5.0.7 / clang 23） | `_Unwind_CallPersonality` ×11 |
| 6.0.12 `.oct`（clang 24） | **`__gxx_wasm_personality_v0` ×11 + `_Unwind_GetWasmLPadContext` ×11** |

即 §7.3 那句"6.0.12 编的 `.oct` 导入该符号数 = 0"**只对旧名字成立** —— 名字换了，
缺口还在。**这正是"断言太窄"的经典形状**：单名匹配的断言在"符号被改名"时静默变绿。

**而主模块一侧**：试点产物 `out-6012-final` 这两个新名字**一个都没导出**（`719` 个导出里
没有；`wasm-dis` 全模块也搜不到 —— 不是"没导出"，是**根本没进模块**）。根因是
**§7.2-③ 那条建议在"跨工具链升级"下是错的**：

- §7.2-③ 说"KEEP_LIST 用现役那份（别重生成）" —— 那条**只对同版本重链成立**
  （同版本下 keep 集逐字节可复现，实测 1304 条）。
- **跨版本升级时**：keep-list 是从 `.oct` 的导入段扫出来的（`gen-keep-list.sh`），
  而新 `.oct` 导入的是**新名字** ⇒ 旧 keep-list 里没有它们 ⇒ `MAIN_MODULE=2` 的 DCE
  把整条 unwinder **删掉** ⇒ 运行期第一次抛异常/析构就 `resolved is not a function`。
- 这正是 §7.4 那个"静默忽略"的**放大版**：`--export-if-defined=_Unwind_CallPersonality`
  被忽略（旧名在新树里未定义），而新名**根本没被请求**（keep-list 里没有）。

**修法（已验证）**：升级后**必须用新一代 `.oct` 集重生成 keep-list**：
```sh
sh /src/bin/gen-keep-list.sh <新 core 目录> <新 pkg 目录> > <scan.txt>
cat /src/libwork/keep.txt <scan.txt> | LC_ALL=C sort -u > <新 keep.txt>
# 实测：1304 → 1329 条；两个新名字各 +1（keep.txt 那份是"所有车道共用的基础集"）
```
**决定性实验**（省一次瞎猜）：拿试点那条链接命令，只**追加**
`-Wl,--export-if-defined=__gxx_wasm_personality_v0 -Wl,--export-if-defined=_Unwind_GetWasmLPadContext`
重链 ⇒ 导出数 `719 → 721`、体积 `+390 B`，两个名字**都出现**（`exported=True`）；
再跑 M2 判据：**"新缺导出" 归零**，只剩 4 个 JS 库符号（**现役产物同样有**，非本批引入）。

⇒ **升级 SOP 补一条硬要求**：**keep-list 与 `.oct` 集必须同代**。跨版本时
"别重生成 keep-list"是**错的**（§7.2-③ 的条件没写出来）。已把这条写进 §8.3 的清单。

### 7.6 ★ emsdk 6.x 第二坑：**`<omp.h>` 有声明没实现** ⇒ 开机无限递归（实测）

独立站（8772）开机自检抓到的**第二个** 6.0.12 专属问题（症状与 §7.5 完全不同）：

```
[pageerror] RangeError: Maximum call stack size exceeded
    at Object._omp_get_num_threads (octave.js:1:244753)   ← 自己调自己，×∞
```

**机制（逐层实测）**：
1. emsdk 6.0.12 的 sysroot **带了 `<omp.h>`**（`sysroot/include/omp.h`）但**没有任何
   libomp 实现**（`sysroot/lib/wasm64-emscripten/` 里搜不到 libomp/gomp）。
2. Octave configure 的探测（`ac_cv_func_omp_get_num_threads`）在 emcc 的**宽松链接**
   （`ERROR_ON_UNDEFINED_SYMBOLS=0`）下"成功" ⇒ `config.h:1708` 得到
   `#define HAVE_OMP_GET_NUM_THREADS 1`（5.0.7 的 sysroot 没有 `<omp.h>` ⇒ 探测失败 ⇒
   `/* #undef */`，config.h 同行可对照）。
3. 于是 `libinterp/corefcn/sysdep.cc:449`（上游的 "force-load libgomp" 招数，bug #41699）
   真的发起调用 ⇒ 主模块引用一个**谁也不提供**的符号。
4. M2 胶水为它生成**自引用**包装：`_omp_get_num_threads(...){ return
   wasmImports["omp_get_num_threads"](...args) }`，而 import 表又把这个名字映射回
   同一个函数 ⇒ `sysdep_init()` 一跑就是无限递归 ⇒ **整页起不来**。
   （这是 `ERROR_ON_UNDEFINED_SYMBOLS=0` 家族的新形态：undefined 不再是
   "调用才炸"，而是**胶水自引用、开机就炸**。）

**定位链**：重链日志 `warning: undefined symbol: omp_get_num_threads (referenced by
root reference)` → 对 6.0.12 与 5.0.7 的 `liboctinterp.a` 做 `llvm-nm -u | grep omp_`
⇒ 只有 6.0.12 有（1 处，`libcorefcn_la-sysdep.o`）→ config.h 对照 ⇒ `<omp.h>` 有无。

**修法（已验证）**：`build/main.cc` 加一个真定义（wasm 没有 OpenMP ⇒ 语义就是 no-op）：
```c
extern "C" int omp_get_num_threads (void) { return 1; }
```
⚠️ 重链时**必须重编 main.o** —— 从链接日志里抠出来的那条 `em++` 命令**只含终链**，
`main.o` 是旧字节（第一跑就是这么白干的：stub 加了、产物没变）。

**树侧治本**（正式落地批再做，一次跨三 lane 生效）：configure 时传
`ac_cv_func_omp_get_num_threads=no`（恢复 5.0.7 的现实）。代价：动 config.h ⇒ 全树重编
（§2 估 40–90 min）。**别手改 config.h**（补丁不打在补丁上；改 configure 配方才是产地）。

---

## §8 升级落档：**容器已切 6.0.12 且不回退**（2026-10-10，用户点令）

**用户点令**："收尾别回 5.0.7，我们不会再回退了！"

⇒ 与"声明 == 现实"一致，本批**同批改了**：
- `upstream/emsdk` submodule pin：`41190c2`(5.0.7) → **`35ff8a6`(6.0.12)**
- `build/upstream-pins.json` 的 `expect_version`：`5.0.7` → **`6.0.12`**
- 容器 `/emsdk` 软链 → `/opt/emsdk-6.0.12`（**不再切回**）
- `witness-upstream-pin` 复绿：`ok（2 个 pin 全部一致）`

**⇒ 从此所有构建默认走 emcc 6.0.12。** 回退能力仍在（`provision-emsdk.sh use 5.0.7`，
`/opt/emsdk-5.0.7` 保留），但**不再作为默认**。

### 8.1 仍未做的（明确留单，不是"以为做了"）

| 项 | 状态 |
|---|---|
| **8761 实际发运 6.0.12 产物** | ⬜ **未做** —— 试点产物在 `/src/websrc/out-6012-final`，**8761 仍跑 5.0.7 的 31.0MB 产物**。发运须走 `promote-w64-lane.sh` + 全量回归 |
| 三条线各自重编 | ⬜ 未做（本次只验了 IP 线口径的 w64 树） |
| `__ode15__` 在 6.0.12 下重编 | ⬜ 未过 —— 它链的是 **wasm32 版 sundials**（`/src/deps-threads/sundials`）；需用 w64 版（`build-ode15.sh` 的 `SUNDIALS_PREFIX` 指向 6.0.12 的 w64 prefix） |
| 完整 `.oct` 集重编 | 🔶 15/19 core 已过（6.0.12）；剩 `__ode15__` 与包集 |
| 独立站实测（boot + 数值四套） | ⬜ 未做（需先把站点装配起来） |
| 与现役对拍（体积/sha/基准） | 🔶 体积已有：**28.1 MB vs 31.0 MB**（小 2.9 MB）；基准未测 |

**2026-10-10 深夜推进（本批续做，逐条对上面那张表）**：
- ✅ **`__ode15__` 已重编**（用 6.0.12 的 **w64** sundials，`SUNDIALS_PREFIX=/src/deps-6012-w64/sundials`）——
  旧失败原文是 `ida.c.o: wasm32 object file can't be linked in wasm64 mode`（试点把
  `SUNDIALS_PREFIX` 留空 ⇒ 回落到 wasm32 的 `/src/deps-threads/sundials`）。
  现在 core **16/16**，产物 184696 B、wasm64、自包含（SUNDIALS 入口 `defined` 在模块内）。
- ✅ **完整 44 个 `.oct` 编齐**（core 16 + pkg 27 + slicot 调度 1）。补齐了两处车道缺口：
  ① `libf2c-subset.a`（w64 车道脚本里那步在"手拼环境"下没跑）；② slicot 调度模块
  （`__control_slicot_functions__.oct`，1.9 MB，静态链 PIC LAPACK）。
- ✅ **`check-oct-imports.py` 的 IndexError 已修**（见 §8.2 —— 根因不是"待定位"，是
  **limits 旗标当布尔用**）。
- ⬜ **8761 仍未发运**（发运还差"用新一代 keep-list 重链"这一步，见 §7.5/§8.3）。
- ⬜ 独立站实测仍**未做**。

### 8.2 检查器 bug **已定位并修复**（`check-oct-imports.py`，2026-10-10）

**§8.2 原判"待定位"是错的 —— 根因在 `imports_of()` 的 `skip_descriptor()`**：

Wasm 的 limits 旗标是**位域**（bit0 = 有 max、bit1 = shared、bit2 = is64），而旧代码
把整个字节当布尔：`return leb(d, j)[1] if fl else j`。**5.0.7 的 side module 旗标恒为
`0x00`**（既无 max 也无 is64）⇒ 碰巧正确；**memory64 的 table 旗标是 `0x04`**（只置 is64、
**无 max**）⇒ 旧写法把 `0x04` 当"有 max" ⇒ 多吃一个 LEB ⇒ 后面**整段导入错位** ⇒
深处 `index out of range`。修法：判 `fl & 0x01`（bit0）。

**定位手段**（可复跑）：`exports_of`/`imports_of` 单文件扫容器 396 个 wasm/.oct ⇒
**只有 8 个 6.0.12 编的 `.oct` 崩**（5.0.7 的一个都不崩）—— 这把"待定位"直接钉到
"新工具链的产物形态不同"。再 dump 导入段前几条，`kind=66`（非法）紧跟 table 导入，
指向 limits 解析。

**自证从 1 条补到 3 条**（三类用例齐）：新增"memory64 limits 位域 ⇒ 必须恰好解析出
3 个导入"（修前必红）+ "空输入必须报"。修复后容器 396 文件**零崩**。

**影响（连带）**：该崩此前**掩盖了 M2 保活判据** —— 修好后立刻跑出真判据（§7.5）。

### 8.3 升级收尾清单（**改口径**：跨版本与同版本重链不同）

§7.2 那张"手拼环境变量的六个坑"里，**第 ③ 条在跨工具链升级下是错的**（§7.5 实测）：
"KEEP_LIST 用现役那份（别重生成）"只对**同版本重链**成立。跨版本升级必须：

1. **重编三层**：farm（`WIPE_TREES=1`）→ Octave 树 → **完整 `.oct` 集**（core + pkg + slicot）。
2. **★ 重生成 keep-list**（新一代 `.oct` 集 ⇒ 新符号名）：
   `gen-keep-list.sh <新core> <新pkg>` ∪ 基础 `keep.txt`，`LC_ALL=C sort -u`。
   **判据**：新 keep 集必须比旧的多出**至少**那几个 EH personality 新名
   （本批：1304 → 1329；`__gxx_wasm_personality_v0` / `_Unwind_GetWasmLPadContext` 各 +1）。
3. **重链主模块**，并跑 `check-oct-imports.py <新wasm> <新core> <新pkg> --baseline <现役>`
   —— **"新缺导出"必须归零**（只剩现役也有的 4 个 JS 库符号）。
4. **EH 名字是版本相关的**：断言**不许**只匹配 `_Unwind_CallPersonality` 一个名字
   （clang 24 换成了 `__gxx_wasm_personality_v0` + `_Unwind_GetWasmLPadContext`）。
   这是本批最贵的一课：**单名断言在符号被改名时静默变绿**。
5. **★ configure 探测在 emcc 宽松链接下会"谎报"**（§7.6）：跨到 emsdk 6.x 时
   `ac_cv_func_omp_get_num_threads` 会假阳 ⇒ configure 配方（`configure-113-full.sh`）
   要**显式传缓存变量** `ac_cv_func_omp_get_num_threads=no`（恢复 5.0.7 现实；
   试车道临时用 main.cc 的 no-op stub，正式落地批必须树侧修）。
   ⚠️ 新版 sysroot 新增的"有头文件没实现"的函数都要按这个形状过一遍。
6. **开机自检必须跑**（§7.6 是它抓到的；构建全绿 ≠ 页面起得来）。
7. 数值四套 + 全量 `PROBES=1`（铁律）→ 独立站 → promote → 对拍。

### 8.4 独立站实测（8772，2026-10-11）：**编译器升级线浏览器侧闭环**

站点 = 仓库 `site/` 整份拷贝 → `site-6012/`，只换 **w64 档三件**（§7.5/§7.6 修好的产物）+
按清单落新一代 `.oct` + **重生成 `manifest.w64.json`**；其余三档仍 5.0.7（车道隔离实测）。
服务 = `serve-coi.py --port 8772`（带头 ⇒ 页面选 w64）。

**结果（逐套实测，日志在 `sweep-logs/20261011-*`）**：

| 套件 | 结果 | 备注 |
|---|---|---|
| check-boot | **BOOT OK 1.0s**、`eval_string("2+2")` rc=0 | §7.6 修复的直接验证 |
| accept-113-assets/boot/libs/oct/pkgoct | 16/10/17/8/27 全 0 FAIL | |
| **accept-113-ode15** | **29/0** | w64 sundials 重编的 `__ode15__` 端到端 ✓ |
| accept-dldfcn | **68/3** | 3 失败见下（FreeType 配方缺口） |
| accept-hdf5 / accept-slicot / accept-forge2 / accept-pkg | 16/25/44/16 全 0 FAIL | slicot 调度模块 `step` 无 TypeError |

**唯一的 3 个失败 = `voronoi` 画图路径**：`render_text: support for rendering text
(FreeType) was unavailable or disabled`。**根因不是编译器** —— 试点树 configure 配方
带了 `--without-freetype --without-fontconfig --without-opengl`
（`octave-6012-w64/config.status` 可查；config.h 里 `HAVE_FREETYPE` undef，现役树同位置
`=1`）⇒ **落地批必须按 AGENTS 重配口径重建**（`WITH_OPENGL=1 WITH_GL2PS=1
WITH_FREETYPE=1 WITH_FONTCONFIG=1`，漏 `WITH_OPENGL=1` 会静默掉回 web toolkit）。

**踩到并证明其价值的：车道清单 sha 必须重生成**。第一跑 ode15 全线红：
`OctaveAssets.load(__ode15__) ⇒ 资产校验失败（期望 fc26… 实得 49ee…）`——
`stage-oct-by-manifest.py` 按**名字/结构**落件，但 `manifest.w64.json` 里的 sha256
还是 5.0.7 的 ⇒ 完整性校验**按设计拒绝装载** ⇒ `__ode15__` 一直 undefined，
套件挂到 425s 被 sweep SIGKILL（NO-SUMMARY 的形状）。重生成
（`make-lane-manifest.py <site>/assets --lane w64` + `--check`）后 29/0。
⇒ **换 `.oct` 代的批次，落件后必须重生成车道清单**（这同时证明了完整性校验真的在工作）。

### 8.5 全量 PROBES=1（8772）：79 套 ran / **1269 PASS / 17 BAD**，17 个失败**全部归因完毕**

对拍现役（同样的套件在 8761 跑）：`probe-pkg-d6` 现役 **4/0**、`probe-internal-props`
现役 **11/0**、`accept-requirements` 现役 **14/0** ⇒ 这三个是 6.0.12 站点真红；
`probe-octc-spike` 现役同样 **0/12**（spike 资产本就不在站点上，环境性）。

**归因（每个都有产物级证据）**：

| # | 失败 | 根因 | 证据 |
|---|---|---|---|
| 1 | **probe-pkg-d6**（`pkg load statistics` 抛 `TypeError: resolved is not a function`） | **试点终链漏了 `webgl_toolkit.o`**（§7.2 六坑之外的**第七坑**：手拼环境没传 `P5_TOOLKIT=1`）⇒ 主模块不再引用 `emscripten_run_script` ⇒ glue 只留函数体、**没接进 import 表**（LIVE 映射=1，NEW 映射=0，`grep -c 'emscripten_run_script:_emscripten_run_script'`）⇒ `__web_pause_ms__.oct` 的 `__web_run_js__` 解析不到 ⇒ `pkg.m` shim 第一步就炸 | LIVE 链接输入 = `main.o + webgl_toolkit.o`（`w64-logs/link.log`）；pilot 终链 = 只有 `main.o`（`link8.cmd`）；LIVE 主模块**导入** `emscripten_run_script`、NEW **不导入**（import 段实扫） |
| 2 | **图形簇**（print -dpng / getframe / engine-parity 出图 / p5-fallback 信号 / plotv2 句柄形态 / internal-props cells=0） | 两个配方缺口叠加：(a) **试点树 `--without-opengl`** ⇒ 树里没有 opengl_renderer ⇒ GL 栅格化整条不可用（SVG 回退在跑，所以还有 13/86 的 pass）；(b) 同 #1 工具包对象缺席 | `octave-6012-w64/config.status` 带 `--without-opengl`；"no working GL renderer (the SVG fallback is active)" 原文 |
| 3 | **FreeType 簇**（listfonts / render_text / voronoi 画图 / requirements 2 条） | **试点树 `--without-freetype --without-fontconfig`** ⇒ 文本渲染器是"报警告的桩" | config.h：`HAVE_FREETYPE` undef（现役树同位置 `=1`）；警告原文 "support for rendering text (FreeType) was unavailable" |
| 4 | probe-artifact-sha | 手工装配站点里 `octave.build.json` 是旧拷贝（治理化 relink 才会写新的） | page=04ce5c9f vs card=f6fec91f |
| 5 | probe-octc-spike | 环境性（现役同样 0/12） | — |

⇒ **没有一个是编译器升级本身的问题** —— 全部是试点配方缺口（树 configure + 终链对象集），
与 §7.5/§7.6 已修的两个真升级坑分开记账。

**重链验证踩到的新墙（如实记，别再撞）**：带全配方环境重跑 `link-web.sh` 会依次要
① `octave-install-6012-w64/share/octave/11.3.0/fonts`（字体从现役 install 树 cp 即可，
架构无关数据）② `/src/deps-6012-w64/freetype|fontconfig|gl2ps`（w64 farm 还没编这三个）
③ **树的 `opengl_renderer`**——`--without-opengl` 的树编不出可用的 GL 渲染器。
⇒ 这三件 + farm 补库 = **落地批的工作量**（树全配方重编 40–90 min），不该在手拼试点里继续补。

### 8.6 落地批清单（从试点结论直接抄出的工单）

1. **w64 farm 补库（6.0.12 影子）**：freetype / fontconfig(+expat) / gl2ps → `/src/deps-6012-w64/`。
2. **树全配方重配重编**：`WITH_OPENGL=1 WITH_GL2PS=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1`
   （AGENTS 重配铁律；漏 WITH_OPENGL=1 会静默掉回 web toolkit）+ §7.6 的
   configure 缓存变量 `ac_cv_func_omp_get_num_threads=no`。
3. **治理化重链**：`relink.sh` 的 w64 模式表指到 6012 prefix（或新增模式），
   `KEEP_LIST=keep-6012-w64.txt`，`P5_TOOLKIT=1` 由模式表带出（不许手设）；
   产物必须出 `octave.build.json` 且 `verdict=ok`。
4. **落件 + 重生成车道清单**（§8.4 的教训）→ 独立站全量 `PROBES=1` 应全绿
   → w64-base 档同流程 → 对拍（体积/sha/基准）→ `promote-w64-lane.sh`。

### 8.7 落地批执行完毕（2026-10-11）：**emsdk 6.0.12 已发运 8768+8761**

四步全过，途中又抓到**两个试点配方缺口**（连同修复一并记录）：

| # | 缺口 | 症状 | 修复 | 证据 |
|---|---|---|---|---|
| A | **落地链接缺 `E2_OPENBLAS`**（工单 31 旋钮） | bench：矩阵乘 0.047 vs 现役 0.006（8×）、lu 4.7× | 重链带 `E2_OPENBLAS=/src/work/e2-openblas-lib-w64`（现役同款 OpenBLAS 后端 refblas 兼容件）→ 矩阵乘 0.008 / lu 0.024（持平） | keep 集出现 `blas_*_x__`；两次 bench 对比 |
| B | **6012 树供错源**：试点从 `/src/work/octave-11.3.0`（tarball 死版本树）拷的，**缺 rust-sort seam**（pin f4bf15b 的 Array-base.cc 缝，权威供给树在 `/src/work/upstream/octave-11.3.0`） | sort 2e6 0.238 vs 现役 0.107（2.2×）；rust 库链了但**零调用点**（objdump=0） | 从 pin 管辖树回补 `liboctave/array/Array-base.cc` → `make liboctave/liboctave.la`（+112B）→ 重链 → sort 0.106 | 两树 diff 只有 configure（平台补丁）与该文件；seam 后 keep 不变 |

**离线供给技巧（记下，容器无外网）**：freetype port 6.0.12 缺 `.SUBDIR` ⇒
`EMCC_LOCAL_PORTS` 不可用；改**手工摆台**——git clone 到宿主 → `docker cp` 进
`cache/ports/freetype/freetype-VER-2-14-3/` 并写 `.emscripten_url`（内容 = 下载 URL +
换行）⇒ port 系统 `up_to_date()` 视为已装。mimalloc 是 emscripten **内置源码**
（`system/lib/mimalloc/src`），wasm64 变体随用随编，无离线问题。

**治理化重链的实际用法**（比预想多一个旋钮）：
```sh
LANE_TAG=-6012 \
OCT_TREE=/src/work/octave-6012-w64 OCT=/src/work/octave-6012-w64 \  # ⚠️ relink 的树校验读 OCT（line 62 既有旋钮），OCT_TREE 只透传给 link-web
E2_OPENBLAS=/src/work/e2-openblas-lib-w64 \
  bash /src/bin/relink.sh link w64 --out /src/websrc/out-6012-gov
# w64-base 同（不带 E2_OPENBLAS —— 模式表只在 w64 分支接它）
```

**发运验收（全绿）**：
- 独立站 8772（最终产物）：全量 `PROBES=1` **85 套 / 1440 PASS / 12 FAIL**（唯一红
  = probe-octc-spike，环境性，现役同红）；IEEE 双站逐位一致（剔除 url 字段后 data
  sha 同为 `27b57d8f…`）；体积 31.2MB vs 现役 31.0。
- **promote 8768**（promote-w64-lane 自检绿）→ BOOT 1.5s → probe-lane **33/0** →
  全量 **47 套 / 1132 PASS / 0 FAIL 全绿**。
- **promote 8761** → BOOT 1.4s → probe-lane **33/0** → 全量 `PROBES=1` **85 套 /
  1440 PASS / 12 FAIL**（唯一红同上）。
- 三层 SHA：磁盘（root base 未动 1ed3e528；w64 档 8c535553）/ HTTP ✓ / 页面实例化
  == 身份证 ✓（probe-artifact-sha 4 PASS）。
- 台账 7 条显式放行（w64/w64-base sha+bytes、导出 752→750（EH 改名）、v128
  6582→6295 与 relaxed_madd 81→6（clang 24 自动向量化差异，基准持平））。
- `make-dist` 包内 w64 wasm sha == 部署件（`8c535553…`）；`check-site-parity --strict`
  三处完全一致。

**遗留（如实留单）**：master 线（wasm64-NEXT）与 wasm32-final（冻结）未重编 ——
wasm32-final 按既定决定不再做 wasm32 车道活；master 线非 8761 面向，等它下次
需要重链时按同批配方走（本批的 LANE_TAG 旋钮 + §8.6 清单即配方）。

---

## §9 Einfacht 追平上游 C1–C5（2026-10-10，用户点令"他们真的用心重构了"）

**原 vendored 版 = 上游 `ae2b82a`（Phase 5 收尾）；现 = `0a0ff91`**（8 个新提交）。
升级法（**文件级**，不是整体覆盖）：从上游取 `zreflect/*.py` + `reflect-hooks/*` +
`gates-selftest.sh`，**但保留本仓数据层 `zreflect/measure_octave.py`** 与 `facts.py` 的
数据层接线（上游那份是占位实现，它自己注释写着"换掉它"）。

### 9.1 三条新纪律（已写进 AGENTS.md）

| 纪律 | 内容 | 本仓实测收益 |
|---|---|---|
| **C1 谓词=声明** | 执行面读 `registry --run <相位>`，**glob 退役**；频率是声明字段 `runs_at` | `doctor.py` 不再靠"没叫 check_"表达频率；"孤儿"概念消失 |
| **C2 off ≠ 通过** | `off` 打机器标记，执行面聚合 `ran/off/failed` | **一采纳就现形**：本仓原本 `check_locks.py` **从来没跑过**（规格在 `build/` 下、闸门只认仓库根默认名）—— 旧版看不见，新版 `OFF:` 明说 |
| **C4 必须一致的要配对账器** | `registry.problems()` 里四对 | 三语 README 配置表 ↔ 登记表、夹具改名集唯一产地等 |
| **C5 模块声明自己** | `MODULE = module_meta(名, 一句, selftest=True/False)`；未声明的 `.py` ⇒ 报 | 本仓数据层 `measure_octave.py` 已加（`selftest=False`：它是数据） |

### 9.2 采纳时暴露/修掉的三个真问题（**都是既存，不是升级引入**）

1. **`check_locks.py` 从未跑过**：规格在 `build/upstream-lock.json`，闸门只认仓库根默认名且
   **无旋钮** ⇒ 静默 OFF（旧机制下不可见）。修：给它加 `REFLECT_LOCKS` 旋钮（形状照
   `check_pins.py` 的 `REFLECT_PINS`）+ 在 `knobs.py` 登记 + 补一条旋钮自证。
   跑起来立刻报真缺口：7 条锁定件的字节**不在仓库里**（在持久盘 `/mnt/hdd/octave-wasm-build/`）
   ⇒ 按闸门自己的 `optional` 语义**如实标注**（"本机缺席 ⇒ SKIP 明说，不是通过"），
   现在 `OK（8 个锁定源全部一致）`。
2. **`REFLECT_DOCTOR` 全局配 ⇒ 夹具假红**：夹具没有 `doctor.json` ⇒ 报"名字写死在代码里"。
   这正是上游 C3 抓的形状。修：改内联传。同理 `REFLECT_LOCKS`（一样的原因，一样的内联修法）。
3. **`env` 行尾注释会被并进值**（实测踩到）：`export X="v"  # 注释` 里的文字进了值 ⇒
   闸门拿 `build/upstream-lock.json"   # 本仓…` 去找文件。sh 只在**单词开头**认 `#`。
   ⇒ 注释只能单独成行（已写进 `Einfacht.env` 的注释里）。

### 9.3 两份 pin 机制并存（**未合并，如实记录**）

本仓有**两个** pin 闸门，schema 不同源、各管一层，别混：

| 闸门 | schema | 管什么 | 状态 |
|---|---|---|---|
| `.githooks/witness-upstream-pin.py`（**本仓专属**） | `submodule_path` + `container_path` | **容器树 == submodule pin**（读容器里的 `.upstream-pin` stamp） | ✅ 跑（pre-commit ③） |
| `zreflect/check_pins.py`（**上游通用**） | `worktree`（宿主 git 工作树） | 派生树 ↔ worktree HEAD | ⬜ **OFF**（本仓规格是前者 schema ⇒ 指错会 `KeyError: 'worktree'`） |

⇒ **不让通用闸门跑**（配了就是互相打架）；要它真跑须另写一份 worktree-schema 规格。**待办。**

### 9.4 采纳后状态

- 平台闸门：**`ran 9 / off 4 / failed 0`**（采纳前是 `ran 2 / off 6 / failed 5` —— 那是 env 未加载的假象；
  采纳后 off 各自**明说**原因，不再混进"全绿"）。
- `gates-selftest.sh`：14 闸门 + 平台模块自证 + **跨仓可配置性 14/14**，全绿。
- `build/gates-selftest.sh`（本仓构建侧 39 个）：全绿。
- `pre-commit` 端到端 **rc=0**。
- 数据层：`measure_octave.py` 的 **139 键**原样保留（`measure_repo()` 分派验证过）。

### 9.5 两份 pin 机制**已对账**（2026-10-10，C4 落地；§9.3 的待办做完）

§9.3 记的"通用 pin 闸门 OFF"已解：新增 `build/pins.json`（**上游通用 schema**：
`kind=tree` 靠 `stamp_read` 命令 + `worktree` HEAD 对读；`kind=version` 靠 `version_read`
输出首行）—— 通用闸门**真跑**：`pin 闸门：OK（2 个 pin 全部一致）`。

**三条反向断言实测过**（这是"新事实系统的实力"的直接证据）：
| 反证 | 结果 |
|---|---|
| `expect_version` 改错（6.0.12→5.0.7） | ✅ 报 `版本漂移（期望 5.0.7，实测 emcc …）` rc=1 |
| 供给树被手改（stamp 的 dirty=3） | ✅ 报 `派生节点带本地改动（dirty=3）` rc=1 |
| 两份规格版本串不一致 | ✅ `crosscheck()` 报 `emsdk：版本串不一致 —— 通用 5.0.7 ≠ 本仓 6.0.12` |

**并存而不打架（C4 对账器）**：`.githooks/witness-upstream-pin.py` 新增 `crosscheck()` ——
两份规格的**同名 pin 版本串必须一致**，不一致就 `DRIFT` 并指点"改一份忘另一份？"。
自证 **11/11**（新增 5 条：一致不报 / 不一致必报 / 只有一边有必报 / 都没有则零值守卫报 / 规格读不了必报）。

**踩到并修掉的白名单缺口**（连带的真发现）：`build/pins.json` 被 `.gitignore` 忽略
（本仓是白名单制）⇒ **新克隆上这条闸门会 FATAL**。已补 `!build/pins.json`。
⇒ 这正是 `check-whitelist.py` 存在的理由（"新增文件必须同步放行"）。

**执行面**：pre-commit / pre-push 都内联传 `REFLECT_PINS=build/pins.json`；
采纳后 `ran 10 / off 3 / failed 0`（采纳前 ran 8 / off 5）。

### 8.8 三线 6.0.12 跑通推送（2026-10-12）——**唯一未完成动作：推 origin wasm32-final**

| 线 | 产物 sha | 浏览器侧验收 | origin | mirror |
|---|---|---|---|---|
| IllegalPerformance（8761 现役） | w64 `8c535553…` / w64-base `f7139099…` | 全量 `PROBES=1` 1440 PASS（唯一红 probe-octc-spike=环境性） | ✓ `187e344` | ✓ `5026ada` |
| master（wasm64-NEXT） | w64 `1ff6a111…` | 数值六套 107/0 + IEEE 排序逐位一致 | ✓ `36d1410` | ✓ |
| wasm32-final（冻结线） | product `f1c0d21b…` | 数值六套 16/10/17/8/29/27 全 0 FAIL + IEEE 排序 399981B 逐字节一致 | **✗ `039439c`（需推 `6f97172`）** | ✓ `6f97172` |

**阻塞原因（实测，不是推断）**：`~/.config/gh/hosts.yml` 的 `ArchivalEra:` 条目下**没有
`oauth_token:` 字段**（凭据已被移除）⇒ `gh auth git-credential` 拿不到 token；
SSH 22 与 443 两条出网路径都超时（`ConnectTimeout` 实测）。仓库本身公开可读
（匿名 `git ls-remote` rc=0、HEAD 可见）⇒ **只缺写凭据**。
⇒ 操作员一条命令：`git push origin wasm32-final`。

**§7.6 同族的第三例（本批新踩，口径已进代码）**：emcc 6.x 的 `<omp.h>` 有声明无实现
⇒ configure 探到 `-fopenmp` 可用 ⇒ **后续每个库探测都带它** ⇒ 要求 shared-memory ⇒
glpk（未编 atomics）链不过 ⇒ `HAVE_GLPK` 静默 undef ⇒ **`__glpk__.oct` 出厂即空桩**
（1494 B、0 个 `glp_` 符号）而构建/链接/自检全绿。修法固化进
`build/113/configure-113-full.sh`（`ac_cv_func_omp_get_num_threads=no`
`ax_cv_c_openmp=none` `ax_cv_cxx_openmp=none`）。
**⚠️ 教训（验收口径）**：该缺口第一次没被抓到，是因为我在**带 COI 头**的服务上跑验收
⇒ 页面按档选择器走了 `w64/`（IP 线产物）⇒ 验的不是本线产物。**验某一线必须让页面真跑它**：
单档站（删掉 `threads/` `w64/` `w64-base/` `lanes.js` + `--no-coi`）才可信。

### 8.9 wasm32-final 宽套件分诊（2026-10-12）

单档站（8775，`--no-coi` + 删四格目录）跑全量 `accept-*`：**45 套完成 / 1067 PASS**，
5 套有红，逐个归因后 **4 类修复、1 类既存**：

| 套件 | 症状 | 根因 | 处置 |
|---|---|---|---|
| `accept-help`（5/1→**12/0**）、`accept-t6-audio-doc`（29/4→**33/0**）、`accept-t9-helpm` | `failed to open docstrings file: /src/work/octave-install-6012-w32/share/...` | 站点 `manifest.json` 的 `mount` 还写**现役前缀** `octave-install/…`，而 wasm32 的 wasm **烘死的是** `octave-install-6012-w32/…` ⇒ 文件挂错路径。**这就是 `make-lane-manifest.py` 注释里记的同一类事故**，只是那次修的是车道清单（`manifest.<lane>.json`），基础档没覆盖 | 从 **wasm 里读**烘死前缀（不猜）→ 改口 3 条 file 资产的 `mount` ⇒ 三套转绿 |
| `accept-gfx-isolation`（C/C2 红 → **6/0 全绿**） | 守卫报告为空 | 站点 `octave-core.js` 是旧拷贝（分支里已有 `gfxGuard` 的修复） | 同步分支资产 ⇒ 全绿。**此前在四格站上这两条红，是"验了 w64 档"的假象** |
| `accept-forge-ondemand`（0/1） | `OctaveAssets.catalog()` 不在 | 该站 `octave-core.js`/assets-loader 是**旧版**（Forge 按需是 IP 线特性，wasm32 冻结线未移植） | 如实记：冻结线不含该特性 |
| `accept-gfx-render`（11/3） | `hist(x,4)` 报 `__pb_add__` 尺寸不匹配 | 绘图桥 `__pb_add__` 的 hist 分支（与 6.0.12 无关的既存形态；`accept-plotv2`/`accept-print` 在同站 86/0、46/0 全绿） | 如实记，留待查 |
| `accept-embed-api` / `accept-archive` | NO-SUMMARY / 20/0 | 环境性（embed 页依赖） | 如实记 |

**⇒ 三条线的验收结论都建立在"页面真的跑了本线产物"之上**（单档站判据）。这一条是本日
最贵的教训：四格站 + COI 头会让页面静默选 `w64/`，**在别的线的产物上跑本线的验收**。

### §7.7 工单 65 重链批的两处 relink 修正（2026-10-19）

判 A 落地重链（7 条 typeinfo 进 keep）时连环踩出两个机制问题，都已修：

1. **`rebuild` 的 install 前缀不跟 `LANE_TAG`**：`inst=/src/work/octave-install-w64`
   硬编码 ⇒ `-6012` 树 configure 出无 tag 前缀，而 link 侧前缀守卫要
   `octave-install-6012-w64` ⇒ **rebuild 完了 link 仍被拦**（白跑一次全树重建）。
   修法：`inst` 改 `octave-install${LANE_TAG:-}-w64`（与守卫同式子）。
   教训：**LANE_TAG 五路径（keep/octs/DEPS/DEPS_ROOT/GL4ES/GLU）之外还有第六处** ——
   rebuild 的 install 前缀。旋钮的"全部产地"清单没列全它。
2. **容器脚本漂移**：`/src/bin/relink.sh` 的容器拷贝是旧版（`LANE_TAG` 无 `-w64`
   新形状）⇒ `explain` 显示的路径与仓库版不一致。AGENTS 的"容器脚本是另一份拷贝"
   提醒了这一点；本批 docker cp 同步 relink.sh / link-web.sh / check-oct-imports.py
   三件，relink 自证 23/0。
3. **keep 的 typeinfo 追加漏了 `-6012` 系**：工单 65 当时只补 keep-w64.txt / keep.txt
   两个现役文件；`-6012` 那套（keep-6012-w64 / keep-6012-w32 / keep-6012m-w64）都缺
   ⇒ 本批补齐（各 +7）。教训：**keep 的产地有六个文件**，追加知识要按"全部产地"清单来。
