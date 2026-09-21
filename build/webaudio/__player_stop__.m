## __player_stop__ — stop playback and rewind (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later

function __player_stop__ (handle)

  id = __pba_id__ (handle);
  if (id < 1), return; endif
  __pba_put__ (id, "Running", "off");
  __pba_put__ (id, "CurrentSample", 0);
  __pba_put__ (id, "PausedAt", []);
  ## Clear the scheduled range too: a later resume() would otherwise try to
  ## continue a range that no longer exists, and isplaying would compare the
  ## clock against a stale StartTime.
  __pba_put__ (id, "PlayingFrom", []);
  __pba_put__ (id, "PlayingTo", []);
  __pba_put__ (id, "StartTime", []);
  __pba_enqueue__ (id, "stop");

endfunction
