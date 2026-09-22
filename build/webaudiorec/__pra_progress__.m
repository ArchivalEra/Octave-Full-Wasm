## Read the page's progress/error report for one recorder (own code).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## bridge/webaudiorec.js owns the real state machine (it is the only party that
## can await getUserMedia) and mirrors it into /tmp/pra_<id>.txt as `key<TAB>value`
## lines.  Recognised keys:
##
##   state   idle | recording | paused | decoding | done | denied | insecure | error
##   frames  frames known so far (an estimate while recording; exact after done)
##   err     message for denied/insecure/error
##
## A missing file means "the page has not looked at our request yet" and reports
## state = "idle" — that is the honest reading, and it matters: __recorder_record__
## returns immediately, so a caller that checks right away must not be told
## "stopped" or "done".
##
## ⚠️ 这里读的是**页面写下的**东西，所以 state 永远滞后于 Octave 侧刚入队的动作。
## 谁需要"等到真的结束"就用 __recorder_recordblocking__ 那种轮询，别假设即时。

function s = __pra_progress__ (id)

  s = struct ("state", "idle", "frames", 0, "err", "");

  fn = sprintf ("/tmp/pra_%d.txt", id);
  if (! exist (fn, "file"))
    return;
  endif

  try
    lines = strsplit (fileread (fn), "\n");
  catch
    return;
  end_try_catch

  for k = 1:numel (lines)
    line = lines{k};
    if (isempty (line)), continue; endif
    tab = find (line == "\t", 1);
    if (isempty (tab)), continue; endif
    key = line(1:tab-1);
    val = line(tab+1:end);
    switch (key)
      case "state"
        s.state = val;
      case "frames"
        s.frames = str2double (val);
      case "err"
        s.err = val;
    endswitch
  endfor

  if (isnan (s.frames))
    s.frames = 0;
  endif

endfunction
