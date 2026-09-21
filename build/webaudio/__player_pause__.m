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

  if (! strcmp (__pba_get__ (id, "Running"), "on"))
    return;                        # pausing a stopped player is a no-op
  endif

  ## freeze the clock so isplaying/CurrentSample stop advancing
  __pba_put__ (id, "PausedAt", __pba_now__ ());
  __pba_put__ (id, "Running", "paused");
  __pba_enqueue__ (id, "pause");

endfunction
