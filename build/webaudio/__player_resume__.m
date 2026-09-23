## __player_resume__ — resume a paused player (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Resumes from where pause() froze the clock: the elapsed time is folded into
## a fresh StartTime so CurrentSample keeps counting from the right offset.

function __player_resume__ (handle)

  id = __pba_id__ (handle);
  if (id < 1), return; endif

  ## 状态迁移（"不是暂停态就 no-op"也在它里面）
  [tf] = __pba_transition__ (id, "resume");
  if (! tf), return; endif

  cur = __pba_get__ (id, "CurrentSample");
  if (isempty (cur)), cur = 0; endif
  ## ★ 采样率与通道数**必须一起入队**：页面侧重建播放时要按它们解交织
  ##   `/tmp/pba_<id>.f64`（JS 那边只能从这个文件读，别的信息一概没有）。
  ##   入队形状与 `__player_play__` 的 `[from, to, rate, nch]` 完全一致，页面侧因此
  ##   能走同一条代码路径（`to = 0` 表示"播到结尾"，见 bridge/webaudio.js 的 loadChannels）。
  ##   2026-09-23 之前这里只发了 `cur`，页面侧只能把采样率/通道数写死成 8000/单声道
  ##   —— 恢复一个 44100 的立体声播放器会变成 8k 单声道（胶水层审计候选 5 的实测 bug）。
  fs = __pba_get__ (id, "SampleRate");
  if (isempty (fs)), fs = 8000; endif
  nc = __pba_get__ (id, "NumberOfChannels");
  if (isempty (nc)), nc = 1; endif
  __pba_enqueue__ (id, "resume", cur, 0, fs, nc);

endfunction
