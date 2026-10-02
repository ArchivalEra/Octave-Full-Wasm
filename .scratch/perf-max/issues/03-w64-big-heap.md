**Type:** task
**Status:** open
**Settling:** `test/browser/probe-heap-ceiling.mjs` —— `W64_BIG_HEAP=yes` ⇒ 兑现；`no` ⇒ 未兑现

## Question

抬 `MAXIMUM_MEMORY` 让 w64 档兑现 **>2 GiB 实际可用堆**（收编工单 31 的第二半；票 01 杠杆 **L11**，
顺带可试 L12 初始内存）：relink w64 走模式表（若 `MAXIMUM_MEMORY` 不在表内，先改表：`explain` 落口径 +
`--selfcheck`，**不许手设环境变量**）→ `probe-heap-ceiling` 实测存活上限 → 数值回归无回归
→ 产物 `verdict=ok` 才算数。本票只构建+实测；promote 是终局票（08）的人工确认点。
