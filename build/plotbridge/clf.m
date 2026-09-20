## clf/figure for the plot bridge: single figure, reset state (own code).
function clf ()
  s = __pstate__ ();
  s.hold = false; s.title = ""; s.xlabel = ""; s.ylabel = "";
  s.xlim = []; s.ylim = []; s.grid = false;
  s.legend = {}; s.legloc = "";
  s.logx = false; s.logy = false; s.series = {};
  __pstate__ (s);
endfunction
