# 01: 诊断仪器口子进 `relink.sh` 模式表

**What to build:** `build/113/relink.sh` 的 `--diag` 与"为诊断额外导出符号"这类口子，
从"用法注释里的隐藏开关"升格成模式表里的**一等条目**：`explain` 打得出来、`--selfcheck` 覆盖得到。
这是所有"不回去"类悬案（02、03）的**共用仪器** —— 没有它，每条都要临时改脚本并手工重链。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** `bash build/113/relink.sh explain product --diag` —— rc=0 且打出诊断旗标 ⇒ 过；rc≠0（报「未知选项」）⇒ 口子没进模式表（反向断言：把 `--diag` 从表里删掉后 `relink.sh --selfcheck` 必须红）
反向断言：把 `--diag` 从模式表里删掉后 `bash build/113/relink.sh --selfcheck` 必须**红**。

**Type:** task

- [x] `--diag` 进模式表，`explain` 渲染它（现在只在 `relink.sh:233-236` 与用法注释里）
- [x] `--selfcheck` 的正则扫到了诊断相关的旗标（现在只扫 `link-web.sh` 的变量名）
- [x] 反向断言：删掉 `--diag`（落地形状 = selftest ④ 的 on/off 对照） ⇒ `--selfcheck` 红（能证明它不是装饰）
- [x] 三向对比纳入 `threads` 模式（现在 `relink.sh:301-306` 只比 `product`/`scalar`/`m1`）

## Answer（2026-09-29，无人值守批次）

内容实际在上一批（ccf0dd7）已全部落地，本批补结算证据：
- `bash build/113/relink.sh explain product --diag` ⇒ **rc=0**，打出 `DIAG_NAMES` / `DIAG_ASSERT`
  （2026-09-29 实测）；
- 反向断言落地形状 = `relink.sh --selftest` 用例 ④：带 `--diag` 时 explain 必须打出
  `DIAG_EXPORTS.*openblas_set_num_threads`、不带时必须打不出（on/off 对照证非恒真）；
- `mode_declared` 已处理 `threads|w64`（三向对比覆盖，selftest ⑤⑦ 也点线程档/w64 的前置）。
