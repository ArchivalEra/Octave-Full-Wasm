## WebAudio-player backing store for the wasm bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The 18 __player_* builtins that @audioplayer calls are implemented here in
## pure .m — no .oct, no PortAudio, no compile step.  Every one of them takes an
## opaque *handle* and reads or writes properties, so the handle can be a struct
## holding a single integer id into a global table:
##
##   __pba__.items{id}  the player's properties
##   __pba__.next       next free id
##
## Access is via __pba_new__ / __pba_get__ / __pba_put__, because a function
## that *returned* the global table would hand back a copy and every mutation
## would be silently lost.
##
## Playback is deferred to the page: `play` appends an action to
## /tmp/pba_queue.txt and the JS side (bridge/webaudio.js) drains it into an
## AudioContext + AudioBufferSourceNode.  Octave cannot await JS, so the page is
## the only party that can actually start playback — and browsers only allow
## that after a user gesture anyway.

function __pba_init__ ()

  global __pba__;
  if (isempty (__pba__))
    __pba__ = struct ();
    __pba__.items = {};
    __pba__.next = 1;
  endif

endfunction
