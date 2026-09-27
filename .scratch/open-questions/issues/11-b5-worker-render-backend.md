# 11: B5 phase-2 —— worker 内的渲染后端

**What to build:** B5（解释器进 Worker）的第二阶段：让**渲染后端也在 Worker 里**跑通，
而不是只把解释器搬进去。

**Blocked by:** None（**但需要一次重链** —— 建议与 E2 上线同批，省一次 29MB 重链）

**Status:** ready-for-agent

**Settling:** `sh build/sweep.sh <站点>/` 相关套件全绿 + 页面侧实测出图（不是"能编过"）。
反向断言：`?worker=1` 与默认路径**都**要能出图，缺一个即红。

**Type:** task

- [ ] 先读 `build/113/NOTES-threads.md:414-419`（被声明为推迟到下一次重链）
- [ ] 画布契约的改动在 `webgl_toolkit.cc` —— 与本仓"嵌入契约"那条线相关
- [ ] 结论回填 NOTES，工单置 `resolved`
