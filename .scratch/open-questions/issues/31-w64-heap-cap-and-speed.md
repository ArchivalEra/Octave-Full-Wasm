# 31: **w64 档既不更快、也没更大堆**（MAXIMUM_MEMORY 还是 2 GiB）—— 四档实测对照

**What to build:** 把"四档到底谁快、谁大"从**口号**变成**可复跑的判据与台账**（本单第一半已交付），
并给"让 64 位档真正吃到 >2 GiB"留一条可结算的路（第二半，需一次重链 + 产品决定）。

**Blocked by:** None（第一半已做；第二半要一次 w64 车道重链）

**Status:** resolved （2026-10-02：第二半已建成实测 —— MAXIMUM_MEMORY=8GB、存活 7.45 GiB、W64_BIG_HEAP=yes、数值回归全绿；**promote 走 perf-max 票 08 的人工确认点**）

**Settling:** `sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/` —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
⇒ 该探针结尾的 `W64_BIG_HEAP=yes`（当且仅当 `w64` 档量到 ≥4 GiB 存活上限）。
**反向断言（现状即反证）**：在未抬上限的产物上它必须 `no` —— 今天实测就是 `no`（1.49 GiB）。
速度那一半：`test/browser/bench-lanes.mjs` 四档各跑一遍（本单的"现状"表就是它的输出）。

**Type:** task

## 现状（2026-10-01 实测；用户点名"直接测"的那一轮）

**① 速度：`w64` 比 `base` 慢，不是快。** 同一台机器、同一站点（8761）、同一份工作、中位数取 3 次
（`test/browser/bench-lanes.mjs`，日志 `w64-logs/speed-*.log`）：

| 用例 | `base`（wasm32） | `threads`（wasm32+OpenBLAS） | `w64`（wasm64） | w64/base | threads/base |
|---|---|---|---|---|---|
| matmul 500 | 0.040 s | **0.020 s** | 0.048 s | 1.20× 慢 | **2.00× 快** |
| matmul 1000 | 0.323 s | **0.178 s** | 0.378 s | 1.17× 慢 | **1.81× 快** |
| lu 800 | 0.059 s | **0.035 s** | 0.079 s | 1.34× 慢 | **1.69× 快** |
| lu 1500 | 0.398 s | **0.208 s** | 0.470 s | 1.18× 慢 | **1.91× 快** |
| svd 400 | 0.195 s | **0.161 s** | 0.209 s | 1.07× 慢 | 1.21× 快 |
| sum 1e7 | 0.009 s | 0.008 s | 0.008 s | ≈ 平 | ≈ 平 |
| sort 2e6 | 0.214 s | 0.247 s | 0.245 s | 1.14× 慢 | 0.87×（慢）|
| loop 1e6（解释器循环） | 0.449 s | 0.609 s | **0.771 s** | **1.72× 慢** | 0.74×（慢）|

归因（不猜，四档设计上就能分开）：`w64` 与 `w64-base` 数值一致（1% 内）⇒ **pthread 没带来速度**；
`threads` 的 BLAS 领先来自 **OpenBLAS 内核**（台账 `threads_blas_dir`），不是来自位宽；
`w64` 那 1.17–1.34× 的落后与 `loop` 的 1.72× 一致地指向 **i64 指针/索引的代价**。

**② 容量：四档一样大 —— 都是 2 GiB 上限。** 逐块分配 0.75 GiB 的 `zeros(1,100e6)` 直到 OOM：
`base` / `threads` / `w64` 三档的**存活上限都是 1.49 GiB**（`w64-logs/heap-ceiling.log`）。
产物里的**声称上限**同样是 2 GiB：

- `octave.js`（根，wasm32）：内存段 `flags=1 initial=0.12GiB max=2.00GiB`；
- `threads/octave.js`：`new WebAssembly.Memory({initial:128MiB, maximum:32768, shared:true})` = 2 GiB；
- `w64/octave.js`：`new WebAssembly.Memory({initial:…, maximum:32768n, shared:true, address:"i64"})`
  —— **`maximum` 是 32768 页 = 2 GiB，与 32 位那档同一个数**；
- `w64-base/octave.js`：内存段 `flags=5(含 memory64 位) max=2.00GiB`。

⇒ 引擎级探针 `w64_mem_5g_bytes`（直接 `new WebAssembly.Memory({initial:80000n,address:'i64'})` 拿 5 GiB）
**证明的是引擎能力，不是产物配置** —— 产物从没申请超过 2 GiB。这条已登记为翻案 **R-013**。

## 复跑命令

```bash
# ① 速度（四档各一遍；纯计算，不碰懒加载资产）
for lane in base threads w64 w64-base; do
  HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh \
    test/browser/bench-lanes.mjs "http://127.0.0.1:8761/" "$lane" > w64-logs/speed-$lane.log
done

# ② 容量（三档；结尾的打分线 W64_BIG_HEAP）
HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh \
  test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ | tee w64-logs/heap-ceiling.log

# ③ 产物里的声称上限（不跑浏览器也能读）
grep -oE 'new WebAssembly\.Memory\(\{[^}]*\}' <站点>/w64/octave.js
#   → maximum:32768n, shared:true, address:"i64"  ⇒ 2 GiB
```

## 第二半（可选，需重链 + 拍板）：让 64 位档真的吃到 >2 GiB

要兑现 >4 GiB，得**同时**改两处（缺一不可）：

1. **链接侧**：`w64`/`w64-base` 重链时显式抬 `MAXIMUM_MEMORY`（Emscripten 默认 2 GiB），
   例如 `-sMAXIMUM_MEMORY=6GB`；
2. **共享内存那一档要额外注意**：`-pthread` ⇒ `shared:true` ⇒ 缓冲在**创建时**按上限预留
   （浏览器策略与内存占用都会变），所以 `w64` 与 `w64-base` 可能要**分开**定上限；
3. 之后 `probe-heap-ceiling.mjs` 的 `W64_BIG_HEAP` 必须翻成 `yes`（**这就是结算判据**），
   并顺带复测 `bench-lanes.mjs`（变大的内存会不会让某些用例改观）。

⚠️ 与工单 27 的关系：`w64` 那两档的 BLAS 是 **refblas SIMD**（`/src/deps-w64/lapack-simd`），
不是 OpenBLAS ⇒ 即使抬了上限，**数学仍不快**；要"又大又快"得把 OpenBLAS 也按 `MEMORY64=1` 重编一遍
（那是第三个批次）。
