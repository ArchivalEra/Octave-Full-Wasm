## __player_play__ — start playback (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Octave cannot start an AudioContext itself (no JS calls, no threads), so this
## queues the request for the page and marks the player "on" immediately — the
## state Octave's own PortAudio path would report once the device started.
##
## play (player)            → whole buffer
## play (player, start)     → from sample START to the end
## play (player, [s, e])    → samples S..E
##
## If no page is listening (a bare eval_string session), nothing errors: the
## queue file simply grows.  That keeps `sound (y)` usable in scripts whose
## result is the computation, not the noise.

function __player_play__ (handle, varargin)

  id = __pba_id__ (handle);
  if (id < 1)
    error ("audioplayer: invalid player handle");
  endif

  total = __pba_get__ (id, "TotalSamples");
  fs = __pba_get__ (id, "SampleRate");

  s = 1; e = total;
  if (nargin >= 2 && ! isempty (varargin{1}))
    a = varargin{1};
    if (isscalar (a))
      s = max (1, round (a) + 1);          # Octave counts from 0
    elseif (numel (a) == 2)
      s = max (1, round (a(1)) + 1);
      e = min (total, round (a(2)));
    else
      error ("audioplayer: second argument must be a sample index or a range");
    endif
  endif
  if (e < s), e = s; endif

  ## 状态迁移交给唯一的拥有者（它负责把 Running/区间/StartTime/PausedAt 摆成互相一致的样子）
  __pba_transition__ (id, "play", s, e);

  ## The page needs the sample range, the rate AND the channel count to
  ## de-interleave /tmp/pba_<id>.f64 — it reads the raw file and has no other
  ## way to know how many values make up one frame.
  nc = __pba_get__ (id, "NumberOfChannels");
  if (isempty (nc)), nc = 1; endif
  __pba_enqueue__ (id, "play", s - 1, e, fs, nc);

endfunction
