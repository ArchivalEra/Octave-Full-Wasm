**Type:** grilling
**Status:** open
**Blocked by:** 03, 04, 05, 06

## Question

数据齐后的**载体与发运决策**（人工，HITL，agent 不代答）：

1. w64 单王还是双王 —— threads 档是否发运（= 工单 27 挂着的决）；
2. `bridge/lane.js` 选档排序是否改（速度优先 vs memory64 优先）——注意现状是
   memory64 优先 ⇒ 最快的 wasm32 线程档在现代浏览器上永远选不中；
3. 终局发运形态与档清单。

输入 = 03–06 的实测数字 + 02 的原生占比仪表盘。
