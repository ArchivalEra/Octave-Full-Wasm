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

  if (! strcmp (__pba_get__ (id, "Running"), "on"))
    tf = false;
    return;
  endif

  ## has the scheduled range run out?
  fs = __pba_get__ (id, "SampleRate");
  s = __pba_get__ (id, "PlayingFrom");
  e = __pba_get__ (id, "PlayingTo");
  t0 = __pba_get__ (id, "StartTime");
  paused_at = __pba_get__ (id, "PausedAt");

  if (! isempty (fs) && fs > 0 && ! isempty (s) && ! isempty (e) && ! isempty (t0))
    if (! isempty (paused_at))
      elapsed = paused_at - t0;          # frozen while paused
    else
      elapsed = __pba_now__ () - t0;
    endif
    dur = (e - s + 1) / fs;
    if (elapsed >= dur)
      __pba_put__ (id, "Running", "off");
      __pba_put__ (id, "CurrentSample", e);
      tf = false;
      return;
    endif
    __pba_put__ (id, "CurrentSample", s - 1 + round (elapsed * fs));
  endif

  tf = true;

endfunction
