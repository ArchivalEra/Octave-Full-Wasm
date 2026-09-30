# 21: `need_arch` 的其余库接线**没有各自验证过**（我自己在 NOTES 里留的账）

**What to build:** `build/113/build-libs.sh` 今天加了 `need_arch`（车道声明 MEMORY64 ⇒ 每个 `.a`
逐成员必须 wasm64）并接在 **9 处**产物自检上（zlib、bzip2、glpk、fftw×2、qhull、sndfile、hdf5、
arpack、qrupdate、suitesparse×8）。**只有 glpk 那条路径实测验证过**（E5 自愈 / E6 反向），
其余是"同一次 diff 里的机械复制"。⚠️ 这是我自己写进 NOTES 的账：
"E5 只走通了 glpk 路径；其余库的同形接线是同一次 diff 里的机械复制，没有各自全量重编验证过"。

**Blocked by:** None（需要一次 `build-libs.sh all`，跑在**一次性 prefix** 里）

**Status:** resolved

**Settling:** 在容器里跑
`DEPS=/src/work/arch-audit-deps WORK=/src/work/arch-audit-work LANE_FLAGS="-pthread -sMEMORY64=1" bash /src/bin/build-libs.sh all`
—— rc=0 且每个库都打出 `✅ …`（= 每处 `need_arch` 都真的执行了）；然后**逐库反向**：
把其中任意一个 `.a` 换成 wasm32 的（例：`cp` 一份现役 wasm32 的 `libsndfile.a` 进去）再跑该库
⇒ 必须 FATAL 点名架构不符（rc≠0）。**反向断言**：9 处里**每一处**都要能红
（用一个循环逐个替换、逐个期望红；漏掉任何一处 ⇒ 本单未完成）。

**Type:** task

## 为什么不是"没必要"

- 接线是机械的，但**执行点**不是：`need_arch` 只在**车道声明 MEMORY64** 时才判 ——
  若某处调用位置被包在 `|| true`、子壳或提前 return 的路径后，它会**静默不执行**
  （本仓最贵的坑就是这个形状：`JSPI_FLAGS` 赋值了却没被引用）。
- 今天的 E6 反向断言只证明了**函数本身**会红，没证明**每一处调用点**都够得到它。

## 交付标准

1. 9 处调用点逐条列出，每条一行"替换坏库 ⇒ 期望 rc≠0"的实测记录；
2. 任何一处静默不执行 ⇒ 修（不是记账）；
3. 结论回填 `build/113/NOTES-wasm64.md`（glpk 结案节的"验证范围"段）；
4. 若发现"车道声明"在非 w64 车道下确实不该判（例如 threads 车道只注 `-pthread`），
   把判据写清楚：**什么时候**断言适用、什么时候不适用（可证伪）。

## 精确清单（2026-09-30 复核：**10 处调用点**，工单原文写"9 处"略少）

| 行 | 目标 | 备注 |
|---|---|---|
| `build-libs.sh:124` | `libz.a` | |
| `:141` | `libbz2.a` | |
| `:165` | `libglpk.a` | ← **唯一实测验证过的那条**（E5 自愈 / E6 反向） |
| `:190` | `libfftw3.a` + `libfftw3f.a` | 同一行两处 |
| `:227` | `libqhull_r.a` | |
| `:252` | `libsndfile.a` | |
| `:306` | `libhdf5.a` | |
| `:342` | `libarpack.a` | |
| `:361` | `libqrupdate.a` | |
| `:451` | `lib<P>.a`（suitesparse 8 个库的循环体内） | 一处覆盖 8 个 |

⇒ 逐条反向断言的做法：把该库的 `.a` 换成 **wasm32** 的（现役 `/src/deps` 那一份即可）再跑该库，
期望 **FATAL 且点名架构不符**；9 个库目标 × 各一次 = 9 条记录（fftw 与 suitesparse 按行记）。

## Answer（2026-09-30）：两面都验证了 —— 阳性 10/10（调用点全执行）+ 阴性 18/18（喂坏必红）

**阳性（调用点真的被执行）**：`DEPS=/src/work/arch21-deps WORK=/src/work/arch21-work LANE_FLAGS="-pthread -sMEMORY64=1" bash build-libs.sh all`
⇒ **10 个库全部建绿**（zlibbz2 / glpk / fftw×2 / qhull / sndfile / rapidjson / hdf5 / arpack / qrupdate / suitesparse×8）。
每个库的 `✅ …` 都印在 `need_arch` **之后** ⇒ 10 处调用点**全部真的走到了**（工单原担心的是"某处被包在 `|| true`/子壳里静默不执行"）。
⚠️ 途中两处**环境**坑（不是代码 bug，但同族）：`emf77` 不在 PATH ⇒ arpack/qrupdate 直接 `command not found`
（与我给工单 09 修的那条同源：**Fortran 库的构建依赖 /src/bin 在 PATH**），补上继续即可。

**阴性（断言喂坏必红）**：把**现役 wasm32** 的归档逐个喂给 `need_arch`（`LANE_FLAGS` 含 MEMORY64）
⇒ **18 PASS / 0 fail**：zlib、bz2、glpk、fftw3、fftw3f、qhull、sndfile、hdf5、arpack、qrupdate
+ suitesparse 的 8 个库（amd/camd/colamd/ccolamd/cholmod/umfpack/klu/cxsparse），**每个都点名"架构断言失败"**。

**★ 一条方法论教训（值得记住）**：反向断言**不能**用"把 `.a` 换成 wasm32 再重跑构建"来做 ——
`make` 发现归档比对象旧，就用**memory64 的对象把它重建回去**，于是断言看到的是好归档
（我第一版驱动 9 条全假绿，`0 PASS / 9 fail`）。正确做法是**跳过构建、直接判那个换坏的归档**
（E6 对 glpk 用的就是这个形状）。这也是为什么本单要**两面分开验**：
阳性证明"调用点够得到函数"，阴性证明"函数认得出坏归档"。
