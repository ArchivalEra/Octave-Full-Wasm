## title for the plot bridge (own code, repo license).
function title (t, varargin)
  s = __pstate__ (); s.title = t; __pstate__ (s);
endfunction
