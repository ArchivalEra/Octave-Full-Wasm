# 14: wasm64（memory64）迁移评估 —— 交给外部 agent 的独立车道

**What to build:** **wasm64 是最终版本** —— 目标是「memory64 为主路径（含多线程）+ 单线程兼容回退
不退化」，而**不是一个可行性报告**。先过可行性门（Q1 浏览器 → Q2 `.oct` 两种配置 → Q3 收益上限），
过了就按最终版的验收做（选档机器扩到两条轴、wasm32 双档回退红线不许破）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

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
