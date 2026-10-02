**Type:** task
**Status:** open
**Blocked by:** 01

## Question

**线程数与调度调优**：NUM_THREADS 对 hardwareConcurrency 的匹配、PTHREAD_POOL_SIZE、
OpenBLAS 热自旋参数（工单 19 的 `YIELDING` / `THREAD_TIMEOUT` 机制）在浏览器环境的实测影响。
逐配置 bench（同一套仪器、同一台机器），产出"线程数–性能"曲线与推荐配置（带复跑命令）。
