# 41: **NT=8 打破 dlopen（确定性回归）**：`accept-dldfcn` 71/0 → 44/27，回滚到 NT=4

**What to build:** 2026-10-02 用户拍板同意 NT=8 上站，发运后 8761 全量 `PROBES=1` 抓出
**确定性回归**：

- `accept-dldfcn`（全仓**唯一**大量压 `dlopen` 的套件）**71/0 → 44/27**。首个失败是
  `gunzip 还原`（`table index is out of bounds`，`wasm-function[34747]`），之后 wasm 实例
  被带死，级联 `memory access out of bounds` / `null function`（`wasm-function[34741]`），
  audioread / convhull / eigs / jsonencode 等一串全红。
- **隔离证实非资源竞争**：在独立实验站 8858（**同一 NT=8 产物** `a69170ec…`、另一端口）
  单跑，**逐条相同**（44/27）。⇒ 不是 sweep 窗口期竞争，是产物属性。
- 对照：NT=4 版（现役 `3b0d5e2f…`）在同一 8761 上 `accept-dldfcn` **71/0**、
  `accept-archive` **20/0**。⇒ 差异锁定在 NUM_THREADS 4→8。

**机制假设**（与工单 16 已记录形态吻合，待结案实验证实/证伪）：OpenBLAS 的**热自旋池线程**
（`YIELDING` 默认几乎不停；NT=8 池线程是 NT=4 的两倍）挡住了 Emscripten 共享内存/函数表
**增长所需的安全点**，而 `dlopen` 一个 side module 正需要增长主模块的表/内存 ⇒ 表增长失败
（`table index is out of bounds`），实例随之中毒。NT=4 从不暴露 ⇒ 存在一个 4 与 8 之间的阈值。

## ⚠ 根因已锁定（2026-10-02 深夜，**不是 NUM_THREADS**）

**真因 = 容器里的 `link-web.sh` 漂移（多了 `-flto`），污染了 NT=8 那次链接。**证据链：

| 产物 | `inputs.link_web_sh.sha256` | `measured.exported_functions` | `accept-dldfcn` |
|---|---|---|---|
| NT=4 现役（`w64-artifacts`） | `63d8e7d7…`（**仓库/HEAD 洁净版**） | **732** | **71/0 ✓** |
| `site-w64-lto/w64`（票 06 的 LTO 实验） | `2382ed34…`（**含 `-flto`**） | **733** | （待验，应为红） |
| **NT=8 候选** | `2382ed34…`（**含 `-flto`**） | **733** | **44/27 ✗** |

- NT=8 产物记录的脚本 sha 与 LTO 实验产物**逐字节同值**、导出数**同为 733**（现役是 732）。
- 容器 `/src/bin/link-web.sh` 与仓库 diff **只有一处**：
  `EXC_FLAGS=( -O2 -flto -fPIC … )` vs 仓库 `EXC_FLAGS=( -O2 -fPIC … )`。`EXC_FLAGS`
  **同时用于编 `main.cc`/`webgl_toolkit.cc` 和最终链接行**（`link-web.sh:477/491/588`）。
- `git log build/113/link-web.sh` 全史**从未含 `-flto`** ⇒ 它是票 06 LTO 杠杆实验
  （`-O2 -flto`）**残留在容器里**的（mtime 2026-10-02 06:17，正是那批实验时段）。
- 票 06 自己的结论就是 **LTO「边际不采纳」**（`-flto` 的 whole-program metadce 会剥掉
  只有 dlopen 才用到的 `.oct` 支撑符号）—— 与 `accept-dldfcn` 的崩溃面**完全吻合**。

⇒ **NT=8 无罪**：它是"被 `-flto` 链接的产物"，不是"NUМ_THREADS=8 的产物"。这也解释了为什么
它 dry 全绿（数值面不吃 dlopen）而 dldfcn 全红。

**修法与复验**：
1. `sudo docker cp <仓库>/build/113/link-web.sh o113:/src/bin/link-web.sh`（**已做**，
   容器 sha 回到 `63d8e7d7…`）；
2. 用洁净脚本重链 NT=8（`E2_NUM_THREADS=8` + `w64-ob-nt8` 的 E2_OPENBLAS），产物应记
   `link_web_sh=63d8e7d7…`、`exported_functions=732`；
3. 跑 `accept-dldfcn` ⇒ 期望 **71/0**。绿 ⇒ NT=8 洗清、可重新作为发运候选（性能 2.0–2.2×
   是真的）；红 ⇒ 才回到"池线程 × dlopen 安全点"的机制票。

**附带流程教训**：容器里的构建脚本是**另一份拷贝**（AGENTS 已写）⇒ 每次实验后必须
`docker cp` 回仓库版 / 或实验隔离脚本；否则下一个批次会吃到上批的残留（**本单就是实例**）。

## ✅ 判别实验已坐实（2026-10-02 深夜）

**独立判别件**：`site-w64-lto/w64`（票 06 的 `-flto` 产物，`2382ed34…`、733 导出、OpenBLAS-o3
库、**非 NT8**）起服务 8857 跑 `accept-dldfcn` ⇒ **`=== 44 PASS / 27 FAIL ===`**，与 NT8 产物
**逐条同形态**（同一 `table index is out of bounds` 起点）。⇒ **元凶 = `-flto`，与 NUM_THREADS
无关**，NT8 洗清。复跑：
```sh
cd /mnt/hdd/octave-wasm-build/site-w64-lto &&   setsid nohup python3 <仓库>/build/serve-coi.py --dir . --port 8857 &
HARNESS=/mnt/hdd/octave-wasm-build/harness   sh test/browser/run.sh test/browser/accept-dldfcn.mjs http://127.0.0.1:8857/
#   ⇒ 44 PASS / 27 FAIL（-flto 产物必红）
```

## 修复复验（进行中）

`docker cp` 洁净 `link-web.sh` 回容器（**已做**）→ 重链 NT8（`E2_OPENBLAS=…-nt8`,
**不带 `--diag`**）→ 期望 `inputs.link_web_sh=63d8e7d7…`、`exported_functions=732`、
`accept-dldfcn` **71/0** ⇒ NT=8 可重发运。

**⚠ 一个真陷阱（本次撞到）**：`relink.sh link w64 --diag` 下 `link-web.sh` 的 dlsync BigInt
补丁匹配不上（`--diag` 关掉压缩/postprocess，胶水形状不同）⇒ 补丁返 rc=3 ⇒ `link-web.sh`
**fail-closed FATAL 中止**（不是静默 —— 守卫是对的）。⇒ 补丁对的、守卫生效；只是**发运重链
不许带 `--diag`**（与原始 NT8 构建一致）。

**本单要做的：**
1. **定阈值**：NT=5/6/7 逐个建产物（`E2_NUM_THREADS=<n>`）跑 `accept-dldfcn`，画出
   "过/不过"的分界。
2. **验机制**：改 OpenBLAS 的 `YIELDING`（`build/113/build-e2-lane.sh` 的 `E2_CC_EXTRA`
   已有口子）/ `THREAD_TIMEOUT`，看能否让 NT=8 在**保性能**的前提下重新通过 dldfcn。
3. **可修则修**：若某组池参数（如 `THREAD_TIMEOUT` 调小让池线池在空闲时会话）
   让 NT=8 既过 dldfcn 又保住大部分 2.0–2.2× 收益 ⇒ 新发运候选。
4. **不可修则如实记**：结论 = "NT=4 是 dlopen 面允许的最大线程数"，性能票关闭。

**⚠ 教训（必须落进流程）**：NT=8 候选当初**只验了"数值四套"，漏了 dlopen 面** ⇒
"上站候选必须过**全量**（含 `accept-dldfcn`）才叫候选"这条要写进批次收尾。

**Blocked by:** None

**Status:** resolved （2026-10-02 深夜：**真因 = 容器 `link-web.sh` 漂移（`-flto`）**，
非线程数；洁净脚本重链后 dldfcn 71/0，NT=8 已重发运 8761）

**Settling:** 已结案 —— 见下「结案」节。判别件 = `site-w64-lto/w64`（`-flto`）跑 dldfcn —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
必红（44/27）；洁净重链的 NT8（`f2269106…`）必绿（71/0）。两条都能复跑，结论互斥可辨。

## 结案（2026-10-02 深夜）

- **真因**：容器 `/src/bin/link-web.sh` 的 `EXC_FLAGS` 多了 `-flto`（票 06 LTO 实验残留），
  污染了 NT=8 那次链接 ⇒ whole-program metadce 剥掉 dlopen 才用的 `.oct` 支撑符号。
- **判别实验**：`-flto` 产物（非 NT8）dldfcn = 44/27 ⇒ 元凶是 `-flto`、不是 NUM_THREADS。
- **修复**：还原洁净脚本 → 重链 NT8（`f2269106…`，`exported_functions` 从 733 回到 732）⇒
  dldfcn **71/0**、数值 79/0、大堆 7.45 GiB、bench 2.0–2.2× 收益保住。
- **重发运**：8761 `w64` = `f2269106…`（三档未动），开机 1.5 s、四格 33/0、SHA 三层、
  全量 `PROBES=1`（dldfcn 71/0）。
- **教训**：容器脚本是另一份拷贝（实验后必须还原）；上站候选必须过**全量**（含 dldfcn）。

**Type:** research
