## __player_isplaying__ — is the player running? (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Running is "on" from play() until stop(), or until enough wall-clock time has
## passed for the scheduled sample range — the page cannot call back into
## Octave, so the estimate is time-based.  Precision is ±1 s (see __pba_now__);
## the page reports the exact state in its own UI.

function tf = __player_isplaying__ (handle)

  id = __pba_id__ (handle);
  if (id < 1), tf = false; return; endif

  ## ⚠️ 这个**谓词会推进状态**（tick）—— 因为本构建没有定时器，"播完了"只能被查出来
  ##    （Octave 侧 `pause()` 期间页面事件循环完全停摆，见 HISTORY §5.10）。
  ##    以前这里是谓词自己算时长、自己写 Running/CurrentSample；那套逻辑现在只属于
  ##    __pba_transition__.m，这里只问结果。
  tf = __pba_transition__ (id, "tick");

endfunction
