## __player_playblocking__ — play and wait (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Known deviation, recorded in HANDOFF §7: a browser cannot block the wasm
## thread on audio — there is no audio clock to wait on and no threads to wait
## with, and busy-waiting would freeze the page.  So this starts playback and
## then *polls the estimated clock* (__pba_now__) until the scheduled range has
## elapsed.  The caller therefore does block for the right wall-clock duration,
## but the page stays responsive and `Ctrl-C` still works.
##
## `sound (y)` — whose whole body is `playblocking (audioplayer (y))` — thus
## behaves as expected in a script, which is what matters for teaching code.

function __player_playblocking__ (handle, varargin)

  __player_play__ (handle, varargin{:});

  id = __pba_id__ (handle);
  if (id < 1), return; endif

  fs = __pba_get__ (id, "SampleRate");
  s = __pba_get__ (id, "PlayingFrom");
  e = __pba_get__ (id, "PlayingTo");
  if (isempty (fs) || fs <= 0 || isempty (s) || isempty (e))
    return;
  endif

  dur = (e - s + 1) / fs;
  t0 = __pba_now__ ();

  ## Sleep in small slices so the estimated state stays current and an
  ## interrupted script stops promptly.
  while (__pba_now__ () - t0 < dur)
    pause (0.05);
  endwhile

  __pba_put__ (id, "Running", "off");
  __pba_put__ (id, "CurrentSample", e);

endfunction
