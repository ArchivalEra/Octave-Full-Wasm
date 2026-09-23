// Octave-Full-Wasm — f2c/libf2c I/O 子系统的最小数据垫片
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么需要它（2026-09-23，修 control 包 SLICOT 编译件时查出来的）────────────
// `.oct` 里链的是**精简版 libf2c**（`build/113/rebuild-pic-blas.sh` 建的
// `libf2c-subset.a`：剔掉整个 I/O 子系统 open/close/fmt/fmtlib/dfe/due/dolio/
// lread/lwrite/rsfe/wsfe/…）。剔它的理由不是省体积，而是那批成员会在 side module 里
// 造出**模块自己的表条目**（`dylink.0` 的 `tableSize` 从 0 变成 13），而
// emscripten 5.0.7 的加载器在 `tableSize>0` 那条路上会崩（细节见 `NOTES-slicot.md` 第六节）。
//
// 但保留的 `err.pic.o`（`s_cat` 的错误路径要用）引用了 libf2c 的**数据**符号
// `f__r_mode` / `f__w_mode`（`err.c:211` 的 `extern char *f__r_mode[], *f__w_mode[];`），
// 它们的定义原本在 `endfile.c`（就是被剔掉的那批之一）。
//
// ⚠️ **数据符号的引用走 GOT.mem** ⇒ 在 side module 里成为"**必需**但未定义"的导入，
// 于是加载器的 `reportUndefinedSymbols()` 崩在一句读 `undefined.value` 上，
// 报出来的错是：
//     TypeError: Cannot read properties of undefined (reading 'value')
//     could not load dynamic lib: …/__sl_td04ad__.oct
// **完全看不出是"缺一个数据符号"** —— 这就是本项卡了很久的原因。
// （真正的符号名是靠给 staging 的 `octave.js` 打诊断补丁、在
//  `reportUndefinedSymbols` 里加一句日志才看到的：`P5DBG-undef: sym=f__w_mode required=true`。）
//
// ── 这个垫片给了什么 ────────────────────────────────────────────────────────
// 两张**空表**。`err.c` 只把它们当"WRITE/READ 的文件模式字符串"用
// （`f__w_mode[ufmt|2]`，ufmt ∈ {0,1} ⇒ 下标 0..3，所以 4 个元素够），
// 而且只在 **I/O 错误路径**（`FREOPEN` 恢复文件）上解引用 —— 本构建没有 I/O 子系统，
// 那条路径不会被执行。真被执行到时，`FREOPEN(NULL, NULL, fd)` 会失败，
// 不会静默给出错误结果。

char *f__r_mode[4] = { 0, 0, 0, 0 };
char *f__w_mode[4] = { 0, 0, 0, 0 };
