## title for the plot bridge (own code, repo license).
function title (t, varargin)
  s = __pstate__ (); s.title = t; __pstate__ (s);
  __pb_mirror_text__ ("title", t);   ## T2：同步到真 axes 属性
endfunction
