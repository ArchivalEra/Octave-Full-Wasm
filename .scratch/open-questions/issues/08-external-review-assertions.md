# 08: 外审 4 项补判据（MEMFS unlink / worker 崩溃快速失败 / 多 worker IDBFS）

**What to build:** 4 条外部复审提出的行为**功能已经实现、判据没写**。没判据 = 没人盯着，
所以本工单的交付物**不是功能，是断言**。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** 并入现有套件后 `sh build/sweep.sh <站点>/` —— rc=0 ⇒ 4 条判据都在且能绿；rc≠0 ⇒ 要么缺判据、要么行为已坏
反向断言必须有 —— 例：worker 崩溃时若不快速失败，断言必须红。

**Type:** task

- [x] 先读 `build/113/NOTES-threads.md:554-557`（原文是"尚未写判据"）核对这 4 条
- [x] 逐条写断言，并确认它是**能从产物/运行时读出来**的，不是"应该"
- [x] 结论回填 NOTES，工单置 `resolved`

## Answer（2026-09-29，无人值守批次）：四条判据全部并入 `accept-worker.mjs`，21 PASS / 0 FAIL

1. **I1 MEMFS unlink 循环**：5 次 `figure+plot+drawnow` 后 `numel(dir('/tmp/p5_fig*'))` 必须 == 1
   （固定路径覆盖，不累积）。实测 count=1 ✓
2. **I2 FIFO 单调**：每次 eval **返回时本张图已在 DOM**（图先于完成信号），img 恰好 +1 不丢不跳。
   实测 [8,9] / plots=9 ✓
3. **I3 多 worker IDBFS/MEMFS 隔离**：w3（home=/home/web_user/iso-w3）看不见 w1 的文件（exist=0）、
   看得见自己的（2）；w1 也看不见 w3 的（0）。实测 [0,2]/0 ✓
4. **I4 worker 崩溃快速失败**：`__crash_test` 判据通道（worker 里一切消息路径都有守卫 ⇒
   在 setTimeout 回调里抛，走与真实崩溃同一条 onerror）⇒ 挂起中的长待办在 **403ms** 以
   `WorkerCrashError` reject（反向：宿主若无 failAllPending，待办会在 pause 结束后正常 rc=0 ⇒ 红）。

**实现面**：`bridge/octave-worker.js` 加 `__crash_test` kind（唯一用途 = 判据通道）；
`bridge/index.html` 加 `API.__raw`（裸 worker，发不带 id 的判据消息用）。
**实测教训（记 HISTORY §5.68-2 的延伸）**：worker 里**小输出的 stdout 读回在无头下不可靠**
（合批 + rAF 时序 ⇒ 拿到 null）——判据读值改走 **error 消息通道**
（`error('P5COUNT %d', s)` ⇒ rc≠0 ⇒ `result.err` = last_error_message 带值），确定性。
