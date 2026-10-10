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
