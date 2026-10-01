# 33: **`w64` + 线程版 OpenBLAS**（memory64 × `USE_THREAD=1`）—— 用户点名的目标形态

**What to build:** 四档里目前**没有**"又 64 位又用 OpenBLAS"的那一格：
`w64`/`w64-base` 的 BLAS 是 **refblas SIMD**（`/src/deps-w64/lapack-simd/lib`），
而 OpenBLAS 只在 **wasm32 线程档**（`/src/work/e2-openblas-lib-s`，且是 `USE_THREAD=0` 形态）。
用户 2026-10-01 明确点了这个组合（"当然是 w64+thread 啊"）⇒ 本单 = 把它**建出来、验出来**。

**Blocked by:** 工单 32（rebuild 的车道依赖，已修）；工单 19/27（idle-exit 补丁与 E2 车道脚本，已就绪）

**Status:** resolved（构建+链接+运行期+竞速全部完成；**发运**是产品决定 —— 与工单 27 同一面）

**Settling:** ②的判据（构建后）：
1. `bash /src/bin/build-e2-lane.sh --lane w64 …` 产出的库**逐成员**是 wasm64（自证写进脚本）；
2. `E2_OPENBLAS=<lib> bash relink.sh link w64 --out <目录>` ⇒ `verdict=ok`、烘死路径是 `-w64`；
3. 站点侧：开机自检 + `probe-lane`（该档必须仍是 `w64`）+ **`bench-lanes.mjs w64`**：
   `matmul 500` 中位数应显著优于 refblas 那份 `w64_matmul500_s`（台账），并接近 `e2_matmul500_s`
   （OpenBLAS 的收益）× 1.2（i64 指针的代价）；
4. **反向断言**：把同一份站点跑 `?lane=w64`（refblas 版）与 OpenBLAS 版对比，前者必须**明显慢**
   —— 否则说明"换库"没生效（本仓踩过"旗标赋了值却没人引用"）。

**Type:** task

## 现状（2026-10-01 进度）

- ✅ `build-e2-lane.sh` 加了 **`E2_LANE=w64`**：工作树 `OpenBLAS-e2-w64`、产出 `e2-openblas-lib-w64`、
  旗标 `-pthread -sMEMORY64=1`、包装对象 `e2-f77-wrappers-w64.o`，并加了**逐成员架构断言**
  （`llvm-readobj -h <归档>` 数 `Arch: wasm` vs `Arch: wasm64`，要求 wasm32=0 —— 与农场 `need_arch` 同判据）。
- ✅ **库已建成**：`libopenblas_wasm128p-r0.3.34.a`，**1557 个成员全是 wasm64**（0 个 wasm32）。
- ✅ `relink.sh` 加了 **w64 的 `E2_OPENBLAS` 钩子**：`EXTRA_LDFLAGS` 指 E2 目录，
  LAPACK **回落目录换成 `/src/deps-w64/lapack-simd/lib`**（照抄 threads 那条会把 wasm32 的 LAPACK
  链进 64 位主模块 —— 架构错配）；`declared` 多一条 `e2_openblas`；自证 13/0。
- ⏳ 树重编（`relink.sh rebuild w64`，工单 32 修完依赖后）→ 裸归档链一次收 mismatch →
  `gen-f77-wrappers.py --from-log` 生成 w64 包装（**编译也必须带 `-sMEMORY64=1`**）→
  `build-e2-lane.sh pack` → 重链。

## 已知代价（别当意外）

- `w64` 那条的 OpenBLAS 是 `USE_THREAD=1` + idle-exit 补丁的形态 ⇒ 它**要求 pthread**，
  所以**只有 `w64` 档**能用它；`w64-base`（单线程）链不进去（要它就得再建一份 `USE_THREAD=0` 的
  memory64 OpenBLAS —— 第三个变体）。
- 期望值要按实测口径给：OpenBLAS 相对 refblas 的收益见台账（`e2_matmul500_s` vs `lane_matmul500_s`），
  再乘上 memory64 的 i64 代价（`w64_matmul500_s` vs `lane_matmul500_s` 实测 1.2×）。

## 进度（2026-10-01 晚）：库 ✅ / 链接 ✅ / **运行期 ✗（收割口径问题，工单 36）**

- 库：`E2_LANE=w64` 建出 **1968 个成员全 wasm64**（`w64_ob_lib_*` 已上键），
  `blas_cpu_number` 等定义齐备（此前因 emscripten 补丁被跳过而缺 `blas_server.o`，见工单 35）。
- 链接：`E2_OPENBLAS=/src/work/e2-openblas-lib-w64 relink.sh link w64` ⇒ **`verdict=ok`**
  （`declared` 里 `threads` + `wasm64` + `e2_openblas` 三条同时成立，烘死路径 `-w64`）。
- **运行期**：页面报 `Import #4 "env" "zdrot_k": function import requires a callable` ——
  29 个未定义符号（`ddot_`/`dnrm2_`/`dasum_`/`idamax_`…）。根因与配方见**工单 36**：
  包装名单必须在"**未打前缀补丁**"的配置下收割（否则漏掉"本来签名一致、只需透传壳"的那批）。
  正在按该配方重跑（revert → build → pack-raw → 收割链 → gen 包装 → apply → build → pack → 重链）。
- 顺带记：**`verdict=ok` 不保证跑得起来** —— 本次两次都是"链过、自检绿、页面崩"
  （缺成员 / 未定义符号变导入）。⇒ 这条链的验收判据**必须**含装机开机自检。

## 结案（2026-10-01）：建成、跑起来、并更快

- 库：`E2_LANE=w64` ⇒ 1968 成员全 wasm64；
- 链接：`verdict=ok`、`declared` 三条齐（threads/wasm64/e2_openblas）、残留 mismatch **1**（与 wasm32 相同）、
  未定义符号 6（全是已知的 `cgejsv_`/`zgejsv_`/GL 那批）；
- **运行期**：装机（8849）开机自检 **1.3 s**、四格选档 `probe-lane` **33/0**；
- **竞速**（`bench-lanes.mjs`，同机同仪器，台账 `w64_ob_matmul500_s` / `w64_ob_lu800_s` /
  `w64_ob_matmul500_speedup`）：

| 用例 | 现役 `w64`（refblas） | 新 `w64`（线程版 OpenBLAS） | 倍数 |
|---|---|---|---|
| matmul 500² | 0.046 s | **0.007 s** | **6.6×** |
| lu(800) | 0.080 s | **0.019 s** | **4.2×** |

  且比 wasm32 的 OpenBLAS 档（`e2_matmul500_s`）还快 ⇒ **memory64 的 i64 代价远小于线程收益**。
- 堆上限**没变**（`mem_live_ceiling_gib` 1.49 GiB / `W64_BIG_HEAP=no`）—— "又大又快"里的"大"仍要工单 31 第二半。

## 发运（待拍板）

与工单 27 是同一个决定面：**是否把"线程版 OpenBLAS"作为交付形态**（现役交付是 `threads/` 的
`USE_THREAD=0` 形态）。若要发运，改动面 = `w64/` 一档（其余三档 sha 不变），走
`build/promote-w64-lane.sh` 那一套 + 全量回归 + 开机自检。
