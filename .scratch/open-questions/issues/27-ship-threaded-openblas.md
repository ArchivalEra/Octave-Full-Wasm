# 27: 把 `USE_THREAD=1`（带 idle-exit 补丁）进车道流水线并发运

**What to build:** 工单 19 已把"`USE_THREAD=1` 的产物 dlopen 挂死"修好并**实测通过**
（补丁 `build/113/patch-openblas-idle-exit.py`；产物 sha `55b268ca…`；格 C 返回、
matmul 500² 中位数 0.006 s ⇒ ≈6.7× 收益保留）。本单 = 把这条修好的路**变成可发运的形态**：
补丁进 E2 车道的重建脚本（与 `build-w64-lane.sh` 同级）、跑全量回归、再决定是否上线。

**Blocked by:** None（19 的机制与补丁都已就绪）

**Status:** ready-for-agent

**Settling:** `sh build/sweep.sh <新线程档产物站点>/` ⇒ rc=0 且全绿（**含 `accept-113-oct`**：
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

## 步骤（照 B6/E2 车道的既有形状）

1. 车道重建脚本里接上补丁（**幂等 + `--check`**，与另三个 `patch-openblas-*.py` 一致）；
2. 重建 E2 库 → 重链（**非 diag**，正式形态）→ 出厂核对 `verdict=ok`；
3. `accept-*` 全量 + `PROBES=1`（含 `accept-113-oct`）；
4. `bench-core` 的 6.7× 复测 + 与 `USE_THREAD=0` 的对照；
5. 走批次收尾（若决定上线）：8768 验绿 → promote → boot/SHA 三层 → `site/` → dist → parity → 闸门。
   **是否把 `USE_THREAD=1` 当交付形态** = 产品决定（现役交付是 `USE_THREAD=0` 的 ≈1.9×）。
