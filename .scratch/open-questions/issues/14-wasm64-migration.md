# 14: wasm64（memory64）迁移评估 —— 交给外部 agent 的独立车道

**What to build:** 一个**可证伪的可行性判决**：memory64 在本项目的浏览器目标上到底能不能跑、
`.oct`（side module + dylink + 主模块 pthread）还活不活、以及**可寻址上限实际能到多少**。
判决为"过"才谈迁移。完整需求书见 `build/113/PLAN-wasm64.md`（目标/约束/判据/已知实测都在里面）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Settling:** 不存在 —— 本工单**第一交付物**就是造它：`test/browser/probe-wasm64.mjs`（rc=0 ⇒ 浏览器能跑，继续 Q2/Q3；rc=7 ⇒ 引擎不支持，写否证并停）
（最小 memory64 页面：能否实例化 + `SharedArrayBuffer` 还在不在 + 引擎版本），
判据见 `build/113/PLAN-wasm64.md` §3 Q1 —— rc=0 ⇒ 浏览器能跑，继续 Q2/Q3；rc=7 ⇒ 引擎不支持，写否证并停。

**Type:** research

**已实测的前置事实**（复跑方式在需求书 §2）：emcc 5.0.7 **链得过**三种组合
（平凡 / `-pthread -sSHARED_MEMORY` / `SIDE_MODULE+MAIN_MODULE`）；
运行层挡的是**引擎版本**——容器内 node 22.16 报 `invalid table elements limits flags`，
宿主 node 26.8.1 跑得动，且 **memory64 + dlopen 与 wasm32 对照行为一致**。

- [ ] Q1 浏览器能跑吗（判据 + 复跑命令）
- [ ] Q2 `.oct` 三套套件 + `check-oct-lane.py` 在 memory64 产物上全绿
- [ ] Q3 可寻址上限是多少；`MEMORY64=2` 是否真的拿不到 >4 GiB（验证需求书里那条推断）
- [ ] 结论写进 `build/113/NOTES-wasm64.md`（实测/推断分开），`Status:` 置 `resolved`
- [ ] **不动 8761/8768、不 promote**，直到判决为"过"
