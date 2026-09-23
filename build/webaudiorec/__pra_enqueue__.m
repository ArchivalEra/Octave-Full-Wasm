## Append a recording action for the page to drain (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## One line per action, same shape as the playback queue:
##   <id>\t<action>\t<arg…>    读侧声明见 bridge/webaudiorec.js 的 parseLine
##     record  <rate> <bits> <channels> <seconds>（seconds=0 ⇒ 录到 stop）
## The page (bridge/webaudiorec.js) consumes the file, then writes progress and
## samples back to /tmp/pra_<id>.txt and /tmp/pra_<id>.f64.

function __pra_enqueue__ (id, action, varargin)

  fid = fopen ("/tmp/pra_queue.txt", "a");
  if (fid < 0)
    error ("audiorecorder: cannot write /tmp/pra_queue.txt");
  endif
  fprintf (fid, "%d\t%s", id, action);
  for k = 1:numel (varargin)
    fprintf (fid, "\t%.17g", varargin{k});
  endfor
  fprintf (fid, "\n");
  fclose (fid);

endfunction
