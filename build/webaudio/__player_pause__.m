## __player_pause__ — pause playback (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Like stop/play, the actual AudioBufferSourceNode is owned by the page, so the
## state here records intent and the page applies it (it can suspend the
## context, which is a genuine pause; a buffer source cannot resume after stop,
## so the page re-schedules from CurrentSample).

function __player_pause__ (handle)

  id = __pba_id__ (handle);
  if (id < 1), return; endif

  ## 状态迁移交给唯一的拥有者（"没在跑就不动"这条也在它里面，见 __pba_transition__.m）
  __pba_transition__ (id, "pause");
  if (! strcmp (__pba_get__ (id, "Running"), "paused"))
    return;                        # no-op：本来就没在跑
  endif
  __pba_enqueue__ (id, "pause");

endfunction
