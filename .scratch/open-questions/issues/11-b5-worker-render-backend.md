# 11: B5 phase-2 —— worker 内的渲染后端

**What to build:** B5（解释器进 Worker）的第二阶段：让**渲染后端也在 Worker 里**跑通，
而不是只把解释器搬进去。

**Blocked by:** None（**但需要一次重链** —— 建议与 E2 上线同批，省一次 29MB 重链）

**Status:** resolved

**Settling:** `sh build/sweep.sh <站点>/` + 页面侧出图（`?worker=1` 与默认路径**都要**）—— rc=0 且两条路径都出图 ⇒ 过；rc≠0 或缺一条 ⇒ 未完成
反向断言：`?worker=1` 与默认路径**都**要能出图，缺一个即红。

**Type:** task

- [x] 先读 NOTES-threads 的 phase-2 边界段 —— 该段已更正：**不需要重链**（OffscreenCanvas 路线）
- [x] 画布契约：走的是**宿主 shim 交出真 OffscreenCanvas**（`bridge/octave-worker.js` 的 makeCanvas），未改 webgl_toolkit.cc
- [x] 结论回填 NOTES-threads（phase 2 段已更正确认），工单置 `resolved`

## Answer（2026-09-29，无人值守批次）：已达成，且**零重链**（工单里"需要一次重链"的前提是错的）

**机制**：Emscripten 的 toolkit 只需要一个"能 `getContext('webgl2')` 的对象"，而 `OffscreenCanvas`
在 worker 里可用 ⇒ 宿主 shim（`bridge/octave-worker.js` 的 `makeCanvas`）交出一个真 OffscreenCanvas
即可，**不需要改 `webgl_toolkit.cc`、也不需要重链**。

**Settling 实测**（`sh build/sweep.sh http://127.0.0.1:8768/`）：
- **rc=0，43 套 / 1084 PASS / 0 FAIL（全绿）**；
- `?worker=1` 出图：`accept-worker` **21 PASS / 0 FAIL**，其中 H 格断言
  `toolkit=webgl` + 无 GL 回落信号（`/tmp/p5_nogl.txt` 缺席）+ OffscreenCanvas 上真有 WebGL2 上下文
  + 图上屏；C3b 格断言重启的新实例**同样**拿到真渲染后端；
- 默认（非 worker）路径出图：`accept-p5-graphics` / `accept-t2-graphics` 在同一次回归里全绿。
⇒ 两条路径都出图，反向断言（缺一条即红）已由 H/C3b 承担。
