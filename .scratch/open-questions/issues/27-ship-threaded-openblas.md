# 27: 把 `USE_THREAD=1`（带 idle-exit 补丁）进车道流水线并发运

**What to build:** 工单 19 已把"`USE_THREAD=1` 的产物 dlopen 挂死"修好并**实测通过**
（补丁 `build/113/patch-openblas-idle-exit.py`；产物 sha `55b268ca…`；格 C 返回、
matmul 500² 中位数 0.006 s ⇒ ≈6.7× 收益保留）。本单 = 把这条修好的路**变成可发运的形态**：
补丁进 E2 车道的重建脚本（与 `build-w64-lane.sh` 同级）、跑全量回归、再决定是否上线。

**Blocked by:** None（19 的机制与补丁都已就绪）

**Status:** resolved（2026-10-02 用户拍板：**不发运** —— wasm32 线冻结于 `wasm32-final` 分支，主线专注 w64 极限版）

**Settling:** ①脚本形态已交付：`bash build/113/build-e2-lane.sh patch` 幂等接线（两条分支实测，见下）；
②`sh build/sweep.sh <新线程档产物站点>/` ⇒ rc=0 且全绿（**含 `accept-113-oct`**：
它正是当年在 `USE_THREAD=1` 上超时 600s 的那条）；且 `bench-core` 的
`矩阵乘 500x500` 中位数 ≤ 0.008 s（收益未丢）。
**反向断言**：把 `USE_THREAD` 退回 0 的对照产物上，同一 benchmark 必须明显**慢**
（否则说明这次"修好"其实是把线程关掉了）。

**Type:** task

## 现状（可复跑）

- 补丁脚本：`build/113/patch-openblas-idle-exit.py`（`--selftest` 4/0）
- 已打的树：`/src/work/OpenBLAS-e2`；重新打包的库：`/src/work/e2-openblas-lib-idleexit`
- 已链出的诊断档：`/src/websrc/e2-idleexit-out`（线程车道、`--diag`）⇒ `verdict=ok`
- 判据实测：格 C/D/H 全返回；matmul 500² = 0.006 s

## 第①步已交付（2026-09-30）：`build/113/build-e2-lane.sh`（幂等接线，两条分支都实测）

阶段：`src`（干净副本，带"抄完真有源码"的零值守卫）→ `patch` → `build`（`USE_THREAD=1`+SIMD，
`-j$(nproc)`；**容忍 utest 失败但要求库本体存在**）→ `pack`（`emar d c_abs.o` + 挂 f77 包装对象，
带"量得到符号"的零值守卫）；也可 `all`。宿主直跑会自动委托进容器。

**patch 阶段的核心（本单第①步要的那件事）**：四个补丁**逐个接线**，契约是
`patch-openblas-idle-exit.py --check` 的**退出码**：`0=已打 ⇒ 跳过`、`1=可打 ⇒ apply 后复查必须回 0`、
`3=不可打 ⇒ 点名 FATAL`；最后用 `OCTAVE-WASM-IDLE-EXIT` 标记 grep 自证"真的落地了"。

**踩到并修掉的两个真坑（都值得记）**：
1. **`--check` 的退出码原本不是契约**（idle-exit 在"可打"与"已打"两种状态下都返 0）
   ⇒ 驱动"rc=0 就跳过"会**漏打**；改成"一律 apply"又撞上 `f77-ret`（按需用，
   已打状态下 apply 会失败）。⇒ **把退出码做成真契约**（已改 `patch-openblas-idle-exit.py`
   + 自证升到 5/0），驱动只按它分支。这也解释了为什么"接线"不能靠解析各补丁的话术
   （四家各说各的：`待改 0 行` / `patched` / `0 处待改` / `已打`）。
2. **驱动第一版把话术当契约**（写死"已打/可打"两种词）⇒ 对 symbol-prefix 当场误报 FATAL。

**实测（两条分支）**：树已打 ⇒ 三个补丁 rc=0 跳过、idle-exit rc=0 跳过，阶段绿；
把 idle-exit `--revert` 后再跑 ⇒ 它 rc=1 ⇒ **自动 apply** ⇒ 复查 rc=0 ⇒ 标记 grep=2 ⇒ 阶段绿。

## 第②步进行中（2026-09-30）：正式（非 diag）产物已链出

- `bash build/113/build-e2-lane.sh all` ⇒ rc=0（库 3,153,970 B / 2515 符号；patch 阶段走通了
  "rc=1 可打 ⇒ apply ⇒ rc=0 已打"分支）；
- `E2_OPENBLAS=/src/work/e2-openblas-lib-idleexit bash /src/bin/relink.sh link threads --out /src/websrc/e2-ie-final-out`
  ⇒ **rc=0、verdict=ok**（声明 10 项全有实测背书），产物 sha **`f76db33dd5d36152…`**；
- 站点 `/tmp/e2-final-site`（8795，带 COI）已装好该产物 + `lanes.js`，**全量回归跑中**。

## 步骤（照 B6/E2 车道的既有形状）

1. 车道重建脚本里接上补丁（**幂等 + `--check`**，与另三个 `patch-openblas-*.py` 一致）；
2. 重建 E2 库 → 重链（**非 diag**，正式形态）→ 出厂核对 `verdict=ok`；
3. `accept-*` 全量 + `PROBES=1`（含 `accept-113-oct`）；
4. `bench-core` 的 6.7× 复测 + 与 `USE_THREAD=0` 的对照；
5. 走批次收尾（若决定上线）：8768 验绿 → promote → boot/SHA 三层 → `site/` → dist → parity → 闸门。
   **是否把 `USE_THREAD=1` 当交付形态** = 产品决定（现役交付是 `USE_THREAD=0` 的 ≈1.9×）。

## Answer（2026-09-30）：**技术判据三条全过**；只剩"是否上线"这个产品决定

**产物**：`E2_OPENBLAS=/src/work/e2-openblas-lib-idleexit bash relink.sh link threads --out /src/websrc/e2-ie-final2-out`
⇒ `verdict=ok`，sha **`39307910fc190019…`**，烘死路径实测 `/src/work/octave-install-threads`（工单 28 的修复生效）。

**判据实测（站点 8795 = site-e2diag 骨架 + 本产物 + 同步过的页面资产）**：

| 判据 | 结果 |
|---|---|
| ① 脚本形态（本单第①步） | `bash build/113/build-e2-lane.sh patch` 幂等接线，**两条分支都实测**（已打⇒跳过；被还原⇒自动 apply+复查）；`all` 端到端跑通（库 3,153,970 B / 2515 符号） |
| ② `sh build/sweep.sh <站点>/` | **43 套 / 1063 PASS / 0 FAIL / 0 超时**；`accept-113-oct`（当年超时 600s 的那条）**5 秒 8/0**；`accept-worker` 复跑 **21/0** |
| ③ 反向断言：收益未丢 | `bench-core` 矩阵乘 500² 中位数 **0.007 s**（现役车道 `lane_matmul500_s`≈0.04 ⇒ **≈5.7–6.7×**，与补丁前 `e2_threaded_matmul500_s`≈0.006 同量级） |

**对照（同骨架、未打补丁）**：6 套 420s 超时（archive/audio/dldfcn/fileops/ode15/pkgoct）——
⇒ 补丁把**挂死类**清零，且**没有**用"关掉线程"换绿灯（③）。

**⇒ 剩余唯一事项 = 产品决定**：是否把 `USE_THREAD=1` 作为**交付形态**（现役交付是 `USE_THREAD=0` 的 ≈1.9×）。
若决定上线，走标准批次收尾（8768 验绿 → promote → boot/SHA 三层 → `site/` → dist → parity → 六道闸门），
并把 `build/113/build-e2-lane.sh` 接进车道流水线（脚本已就位）。**这一步需要人拍板，故本单置 `ready-for-human`。**

## 与四格站点的关系（2026-10-01 补充，工单 30 上线之后）

四格上线后（`base`/`threads`/`w64`/`w64-base`），本单的"上线"**只换 `threads/` 那一档**，
其余三档**一字不动**。这不是推测，是逐档读身份证读出来的：

| 档 | 现役 BLAS（`inputs.blas.resolved_dir`） | 本单上线后 |
|---|---|---|
| `threads` | `/src/work/e2-openblas-lib-s`（OpenBLAS，**`USE_THREAD=0`**） | ⇒ 换成 `e2-openblas-lib-idleexit`（`USE_THREAD=1` + idle-exit 补丁） |
| `w64` | `/src/deps-w64/lapack-simd/lib`（**refblas/lapack SIMD**） | 不动 |
| `w64-base` | 同上（refblas SIMD） | 不动 |
| `base` | `/src/deps/lapack-simd/lib`（refblas SIMD） | 不动 |

⇒ **上线后的形态会是"只有 wasm32 线程档拿到 6.7×，64 位两档仍是 refblas"**。
要把 6.7× 也带给 `w64`/`w64-base`，得再做**一次 w64 车道的 OpenBLAS 重建**（`MEMORY64=1` + pthread
的 OpenBLAS 库 → 重链两档）—— 那是另一个批次，**不在本单范围内**，要就得先立单。

**候选产物**（已在容器里，`verdict=ok`，`declared.e2_openblas=true`）：
`/src/websrc/e2-ie-final2-out/octave.{wasm,js,data}` = sha `39307910…` / `62a1a4d0…` / `5c1433c4…`，
烘死路径 `/src/work/octave-install-threads`（工单 28 的修复生效）。

**若拍板上线，改动面与步骤**（都走既有受管辖入口，别手 `cp`）：
1. **8768 先验**：把 `threads/` 三件 + `octave.build.json` 换成候选产物（用同一个入口做：可给
   `build/promote-w64-lane.sh` 加一个 `--threads-artifact <目录>` 分支，或先手工落在 `siteWebGL/`），
   跑 `sh build/sweep.sh http://127.0.0.1:8768/` 全量 + `PROBES=1`；
2. **判据**：全绿（含 `accept-113-oct` 秒级、`accept-worker` 21/0）+ `bench-core` 的 500² 中位数 ≤0.008 s；
   **反向断言**：`USE_THREAD=0` 的对照产物上同一 benchmark 必须明显慢（否则"修好"其实是关了线程）；
3. promote 8761 → 开机自检 → SHA 三层（**`base`/`w64`/`w64-base` 三档 sha 必须不变**，只有 `threads/` 变）
   → `site/` → dist → parity → 六道闸门 → 推送；
4. **回滚**：把 `threads/` 三件换回现役 sha `e570905e…`（台账 `threads_wasm_sha`；容器里那份在
   `/src/websrc/e2-ie-*` 之外的产物目录，先 `cp -a` 留档）。
