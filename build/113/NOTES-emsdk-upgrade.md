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
| 3 | 保活集报 55 条缺 | **`KEEP_LIST` 用现役那份**（别重生成：现役 1304 = `keep.txt ∪ w64扫描`，**可逐字节复现**，已验证） |
| 4 | 4 个 JS 库符号报缺 | **`LIB_FUNCS`**（现役值：`emscripten_run_script,__assert_fail,abort,exit`） |
| 5 | 50 个 SLICOT LAPACK 符号报缺 | **`EXTRA_LDFLAGS` 的 `-L/src/deps-w64/lapack-simd/lib`**（SIMD 版 LAPACK；与编译器升级正交，直接复用现役那份） |
| 6 | 差分级仍报 55 条 | **`BASELINE_WASM`** —— 判据是**与基线差分**（"基线导得出、新构建导不出"才报），漏传 ⇒ 退化成"逐条报缺"，把基线也没有的符号也报出来 |

⇒ **修到第 6 条后：差异从 55 条收敛到 1 条。**

### 7.3 ★ 唯一的真实差异（**升级必须处理的一条**）

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

### 8.2 踩到的检查器 bug（**既存，与升级无关**，待修）

`build/113/check-oct-imports.py` 在对**现役 8761 产物**（`baseline-w64.wasm`）跑时也崩
`IndexError: index out of range`（`leb()` 无边界检查，越界读）。

**已排除的怀疑**：
- 不是 export 段解析错位 —— 手工按规范解析 752 条导出**完全正确**（`leb(d, j+1)` 的写法是对的：`read_name` 返回的 j 指向 kind 字节）。
- 不是新产物特有 —— **现役产物同样崩**。
- 不是容器旧拷贝 —— 容器 `check-oct-imports.py` 与仓库 sha **一致**（`9dfd0745`）。
- `exports_of()` / `imports_of()` **单独调用都正常**（752 导出 / 401 导入）。

⇒ 崩点在 `main()` 后面的某段（`--baseline` 差分路径或 oct 扫描后的处理）；**待定位**。
**影响**：M2 保活自检在触发该路径时会崩，**掩盖真实判据**（本次前几轮就是被它误导：
把"检查器崩"当成"产物缺保活集"）。**这是本批暴露的第二处既存缺陷。**
