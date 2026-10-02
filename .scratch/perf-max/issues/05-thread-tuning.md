**Type:** task
**Status:** open
**Blocked by:** 01

## Question

**线程数与调度调优**（票 01 杠杆 **L6/L8/L9**）：NUM_THREADS 对 hardwareConcurrency 的匹配
（现状 MAX_CPU_NUMBER=4 + 池=4）、运行时旋钮 `set_num_threads` 的导出（L8）、
OpenBLAS 热自旋/空闲解散参数（L9，工单 19 的 `YIELDING` / `THREAD_TIMEOUT` 机制）在浏览器环境的
实测影响。逐配置 bench（同一套仪器、同一台机器），产出"线程数–性能"曲线与推荐配置（带复跑命令）。
