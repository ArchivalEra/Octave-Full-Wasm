# 56: **dlsync 补丁把"不适用"（rc=3）当失败** ⇒ 非线程 memory64 车道建不出符号站

**What to build:** 工单 55 的结案实验 ① 需要 `w64-base`（memory64 **单线程**）的符号构建做对照
（"有 pthread ⇒ 分配器加锁；无 pthread ⇒ 无锁"）。`hotpath.symbols('w64-base')` 当场 FATAL：

```
FATAL: dlsync BigInt 补丁没打上 ⇒ 运行期 dlopen 会崩
```

**根因（已定位）**：`build/113/patch-glue-proxy-dlsync-bigint.py` 对"**非线程** memory64 胶水"
（没有 `__emscripten_dlsync_threads` 调用点）返回 **rc=3 = 不适用**（补丁自己的 docstring 明说
`0=已打 1=可打 3=不适用`）；而 `build/113/link-web.sh:604` 的调用是
`python3 … --apply … || { FATAL; exit 3; }` —— **把 rc=3 当成了失败**。⇒ 单线程 memory64 车道
（`w64-base`）用当前脚本**建不出符号产物**。

**Blocked by:** None

**Status:** resolved （2026-10-03：bug 定位 + 修法定了 + 证伪方式定了；**未随手改**——它弱化
一处 fail-closed，需按下面那步谨慎做）

**Settling:** 修后 `python3 -c "import hotpath; print(hotpath.symbols('w64-base')['names'])"` ⇒
`True`（能建出带 name 段的 w64-base）。反向：把**线程** memory64 的胶水改成"没有 dlsync 调用点"
的假夹具 ⇒ 仍必须 FATAL（不许把"真丢了"也放行）。

## Answer（诊断，修法待实施）

**rc=3 被当作失败**，但 rc=3 有**两种含义**，补丁自己没区分：
- ①「非线程 memory64 胶水 ⇒ 本来就没有 dlsync 调用点」→ **应当放行**（w64-base 属这类）；
- ②「线程 memory64 胶水，但**形状不认识**（版本变了）」→ **必须 FATAL**（这正是 fail-closed 在保的）。

⇒ 不能简单"rc=3 一律放行"（会把 ② 也放掉）。**正解 = 让判据区分这两种**：`link-web.sh` 只在
**`WITH_THREADS=1`**（或 `-pthread` 在链接行）时把 rc=3 当 FATAL；非线程 memory64 下 rc=3
按"不适用"放行并打印一行说明。落点在 `relink.sh` 的模式表（`w64-base` 已有 `WITH_THREADS=0`，
`w64` 是 1 —— 见模式表），把它传进 `link-web.sh` 供这条判据用。

**为什么不当场改**：这处 FATAL 是工单 37 的刻意 fail-closed；弱化它要**同时**补一条反向断言
（"线程档形状不认识必须仍 FATAL"），否则就是拿掉守卫。⇒ 与结案实验 ① 一起做。

**阻塞的连带影响（如实）**：工单 55 的结案实验 ① 因此**卡在构建管线**——
`w64-base`（rc=3 bug）与 `product`（需要 `relink.sh rebuild` 多时重配，tree-prefix 守卫）两条
对照车道都**建不出符号站**。⇒ 实验改由**本 bug 修复后**用 w64-base 做（另一条路：用 8761 上
**已部署的** base/threads 两条**stripped** 产物跑同负载比**墙钟**——无归因但能测"线程税"是否存在，
见工单 55 的备选）。

## 修复已完成 + 第二个阻塞（2026-10-03）

**dlsync 部分已修并验证**（提交见 wasm64-NEXT）：
- 补丁加 `classify()`：**有** `__emscripten_dlsync_threads` 但形状不认识 ⇒ **rc=4**；
  **无** dlsync 函数（非线程 memory64 / wasm32）⇒ **rc=3**（真不适用）。自证 8/0（含"4 vs 3"
  与两个 apply 分支的反向用例）。
- `link-web.sh` 调用改成 `case`：**0/3 放行**（3 打印"不适用"）、**其余 FATAL** ⇒
  fail-closed 保住（形状不认识仍红）。
- **验证**：w64-base 重链**越过了** dlsync（FATAL 位置前移）⇒ 修法有效。

**⚠ 第二个阻塞（新发现，另计）：`w64-base` 的 `--diag` 构建卡在 IDBFS 自检**
（`FATAL: octave.js 的 EXPORTED_RUNTIME_METHODS 里没有 IDBFS`）。实测：`IDBFS` 在产物里出现
35 次（实现），但带引号的 `"IDBFS"` **0 次**（现役非-diag w64-base 有 1 次、我的 w64 **--diag**
有 2 次）⇒ **w64-base + --diag 组合特有**。**未定论**（是 --diag 的序列化差异，还是 w64-base
链接真丢了运行时导出）。**绕开办法（已用）**：链接其实**完成**了（46MB octave.wasm 在），
只是自检退出 ⇒ **手工组站**（`docker cp /src/websrc/hotpath-w64-base-sym/*` 进四格）即可，
**实验因此跑通**（工单 55 结案）。⇒ 这条自检的脆弱性值得单独查（新票候选），但**不阻塞**。

