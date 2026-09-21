## Append a playback action for the page to drain (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Octave cannot call into JS synchronously, so playback requests are queued in
## a file that bridge/webaudio.js polls after each eval.  One line per action:
##
##   <id>\t<action>[\t<start>\t<end>]
##
## The audio samples live next to it in /tmp/pba_<id>.f64 (raw little-endian
## doubles, interleaved by column for stereo), written by __player_play__.

function __pba_enqueue__ (id, action, varargin)

  fid = fopen ("/tmp/pba_queue.txt", "a");
  if (fid < 0)
    error ("audioplayer: cannot write /tmp/pba_queue.txt");
  endif
  fprintf (fid, "%d\t%s", id, action);
  for k = 1:numel (varargin)
    fprintf (fid, "\t%.17g", varargin{k});
  endfor
  fprintf (fid, "\n");
  fclose (fid);

endfunction
