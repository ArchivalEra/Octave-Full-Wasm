## xlabel/ylabel/title for the plot bridge (own code, repo license).
function xlabel (t)
  s = __pstate__ (); s.xlabel = t; __pstate__ (s);
endfunction
