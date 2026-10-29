# Octave-Full-Wasm — `wasm32-final`

[English](README.md) · **中文** · [Deutsch](README.de.md)

本分支是 **wasm32-final**：wasm32，单线程。它是**唯一不需要 COI 的线** —— 不需要
`SharedArrayBuffer`、不需要跨源隔离头，任何浏览器、任何静态托管都能服务它。

权威 README 在 `master` 分支，三语各一份：

- [English](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.md)
- [中文](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.zh.md)
- [Deutsch](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.de.md)

三条线的对比、性能表、数值正确性评估、架构说明与构建方法都在那里维护。本分支不保留
副本：三份副本已经漂移过一次，而访客实际看到的那份（GitHub 默认分支）恰恰是最旧的。

## 本线的具体事实

| | |
|---|---|
| 目标 | wasm32，单线程 |
| 要求 | 无 —— 不需要 COI 头 |
| 站点格 | `base` |
| 自由软件 | 是 |
| 最后提交 | 2026-10-12；产物冻结在该次 |

对照：`master`（wasm64 + 多线程，必须 COI）与 `IllegalPerformance`（wasm64 + 多线程 +
Rust 内核，non-free）。分档依据是用户可达性与许可线，与性能无关。

本线是否重启是产品决定，不是文档决定。