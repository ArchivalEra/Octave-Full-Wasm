# 14: wasm64（memory64）迁移评估 —— 交给外部 agent 的独立车道

**What to build:** **wasm64 是最终版本** —— 目标是「memory64 为主路径（含多线程）+ 单线程兼容回退
不退化」，而**不是一个可行性报告**。先过可行性门（Q1 浏览器 → Q2 `.oct` 两种配置 → Q3 收益上限），
过了就按最终版的验收做（选档机器扩到两条轴、wasm32 双档回退红线不许破）。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** 不存在 —— 本工单第一交付物就是造它：`build/113/NOTES-wasm64.md`
（rc=0 ⇒ Q1/Q2/Q3 都有实测结论；rc=7 ⇒ 至少 Q1 给出"引擎不支持"，写成否证）

**Type:** research

## 怎么开工（三步，别先读别的）

1. 读 `build/113/PLAN-wasm64.md` —— **那一份就够**（前 85 行即完整工作令，附录只按需翻）。
2. 跑基线：`bash build/113/probe-wasm64-baseline.sh` ⇒ 期望 `=== 基线 OK（8/8）===`。
   它证明的是「**工具链不挡**」（emcc 5.0.7 三种组合全链得过；宿主 node 26 上
   `memory64 + dlopen` 与 wasm32 对照行为一致）。**它不证明** `.oct` 在 memory64 下能用、
   也**不证明**内存上限能超 4 GiB —— 那两件是 Q2 / Q3 的事。
3. **第一个批次是工单 17**（memory64 全量重编 —— 第一面墙已实测出来：我们的对象不是 memory64）。重编绿了再按需求书 §3 走 **Q1（浏览器）→ Q2（`.oct` 命门）→ Q3（收益）**。
   任何一问不过 ⇒ **停下写否证**，别为了"做完"硬推（Q3 是 fail-closed 出口）。

## 已知的坑（详见需求书 §4）

- 运行时**不能**在容器里测：容器 node 是 **22**，装不进 memory64 模块（引擎版本事实）。
- `relink.sh verify --out <副本>` 会假红并污染 verdict ⇒ **验副本要在产物原位验**。
- 容器里的构建脚本是另一份拷贝 ⇒ 改完必须 `docker cp` 并比两侧 sha。
- 禁止 `sleep`（任何形式）；跑验收时别并行干重活。
- **不动 8761/8768、不 promote。**

- [ ] 基线脚本绿（不绿 ⇒ 写否证并停）
- [ ] Q1 浏览器判据；Q2 **线程 / 单线程两种配置各一遍**；Q3 可寻址上限的数字（**也分两种配置**）
- [ ] 判决"过" ⇒ 交付最终版：memory64 两配置产物 + **选档机器支持两条轴（§2 四格）** +
      **wasm32 双档回退不许退化**
- [ ] 结论写进 `build/113/NOTES-wasm64.md`（实测/推断分开，每条带复跑命令）
- [ ] `Status:` 置 `resolved`；不确定的另开新工单（挂 `Settling:` 行，
      格式见 `docs/agents/issue-tracker.md` 的 `Settling:` 一节）

## Answer（2026-09-28，主会话独立复核）

**判决：过。** Q1/Q2/Q3 三问全部有实测背书（主会话用自己的 chromium 复测了 Q1/Q3，用自己的
`llvm-readobj` 复测了 Q2 的 44 个 `.oct`）：

- **Q1**：本机 Chromium 153 默认支持 memory64（无须 experimental flags）；COI 下
  `SharedArrayBuffer` 正常。
- **Q2**：44/44 `.oct` = `Arch: wasm64`；最小 memory64 主模块 + side module 在浏览器里
  `dlopen OK, f()=42`。
- **Q3**：单线程 **5,242,880,000**（4.88 GiB）与 **8,589,934,592**（8 GiB）字节分配成功；
  **多线程共享**（COI 页）**5,242,880,000 字节且 `buffer instanceof SharedArrayBuffer === true`**。
  主会话用自己的 playwright 跑了单线程 5G/8G 与共享 5G，数字与交付一致。
- API 关键发现（写进 NOTES）：`address: "i64"`（旧写法 `index:` 会被 V8 忽略并退回 32 位检查）、
  `initial/maximum` 必须是 **BigInt**。

**但"最终版本"还没交付** —— 这份判决只覆盖了可行性门 + 全量重编。还差：
**两轴选档机器**（§2 四格，`lane.js` 还只判 COI 一条轴）、w64 产物的**完整数值回归**
（8768 上一轮全量）、以及 `.oct` 车道进站点的资产装配。⇒ **工单 18**。
