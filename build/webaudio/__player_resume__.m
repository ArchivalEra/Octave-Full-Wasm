## __player_resume__ — resume a paused player (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Resumes from where pause() froze the clock: the elapsed time is folded into
## a fresh StartTime so CurrentSample keeps counting from the right offset.

function __player_resume__ (handle)

  id = __pba_id__ (handle);
  if (id < 1), return; endif

  if (! strcmp (__pba_get__ (id, "Running"), "paused"))
    return;                        # resuming a running player is a no-op
  endif

  t0 = __pba_get__ (id, "StartTime");
  tp = __pba_get__ (id, "PausedAt");
  if (! isempty (t0) && ! isempty (tp))
    __pba_put__ (id, "StartTime", t0 + (__pba_now__ () - tp));
  endif

  cur = __pba_get__ (id, "CurrentSample");
  if (isempty (cur)), cur = 0; endif
  __pba_put__ (id, "PausedAt", []);
  __pba_put__ (id, "Running", "on");
  __pba_enqueue__ (id, "resume", cur);

endfunction
