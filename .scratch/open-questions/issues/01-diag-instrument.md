# 01: 诊断仪器口子进 `relink.sh` 模式表

**What to build:** `build/113/relink.sh` 的 `--diag` 与"为诊断额外导出符号"这类口子，
从"用法注释里的隐藏开关"升格成模式表里的**一等条目**：`explain` 打得出来、`--selfcheck` 覆盖得到。
这是所有"不回去"类悬案（02、03）的**共用仪器** —— 没有它，每条都要临时改脚本并手工重链。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Settling:** `bash build/113/relink.sh explain product --diag` 必须把诊断旗标列出来；
反向断言：把 `--diag` 从模式表里删掉后 `bash build/113/relink.sh --selfcheck` 必须**红**。

**Type:** task

- [ ] `--diag` 进模式表，`explain` 渲染它（现在只在 `relink.sh:233-236` 与用法注释里）
- [ ] `--selfcheck` 的正则扫到了诊断相关的旗标（现在只扫 `link-web.sh` 的变量名）
- [ ] 反向断言：删掉 `--diag` ⇒ `--selfcheck` 红（能证明它不是装饰）
- [ ] 三向对比纳入 `threads` 模式（现在 `relink.sh:301-306` 只比 `product`/`scalar`/`m1`）
