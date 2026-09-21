## Monotonic wall-clock seconds for playback bookkeeping (own code).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Used to estimate CurrentSample and to decide when a non-looping player has
## finished.  `time ()` has 1-second resolution in Octave; `tic`/`toc` are tied
## to their own timer state, so a plain process-start offset plus time() is the
## portable approximation.  CurrentSample is therefore coarse (±1 s), which is
## the honest limit of a build with no audio clock — the page's own
## AudioContext.currentTime is authoritative for anything that needs precision.

function t = __pba_now__ ()

  t = time ();

endfunction
