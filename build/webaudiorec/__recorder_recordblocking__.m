## recordblocking: **本构建不支持** —— 如实报错，不静默降级。 (T7)
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么做不到（**实测**，别推翻自己）────────────────────────────────────
## 这条一开始被记成"不需要 Asyncify"，依据是一次不可靠的测量：当时只看"定时器总共
## 跑了多少次"，把 eval **前后**的 tick 也算进去了，于是得出"pause() 会让出主线程"。
## 精确复测（记录每个 tick 的时刻，只数落在 eval 区间内的）结果是：
##
##     pause(1)                          → 区间内 tick = 0（理论上限 20）
##     pause(2)                          → 区间内 tick = 0（上限 40）
##     for k=1:10, pause(0.1), endfor    → 区间内 tick = 0（上限 20）
##
## ⇒ **`pause()` 期间浏览器事件循环完全停摆**（阻塞式睡眠）。
## 而 recordblocking 的语义就是"等页面把录音做完"——等待期间页面必须能跑，
## 这两件事直接冲突。真要做得给 wasm 加 Asyncify（HANDOFF 的 T10）。
##
## 反过来这也解释了两件已验证的事：
##   · `input()` 能用，是因为 `window.prompt` 是**同步**的浏览器 API；
##   · `uigetfile`（要等一个**异步**的文件选择框）与 recordblocking 同病。
##
## 报错里直接把替代用法写清楚，省得用户去猜。

function __recorder_recordblocking__ (h, len)

  error (["audiorecorder: recordblocking is not available in this build. " ...
          "It must wait for the page to finish recording, but Octave cannot " ...
          "yield to the browser while it waits (measured: the JS event loop " ...
          "gets 0 turns during pause()), so this needs Asyncify -- see T10. " ...
          "Use record (r, len) and read the samples with getaudiodata (r) " ...
          "once the recording has finished."]);

endfunction
