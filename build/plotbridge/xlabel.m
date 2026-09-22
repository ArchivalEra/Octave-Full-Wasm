## xlabel/ylabel/title for the plot bridge (own code, repo license).
function xlabel (t)
  s = __pstate__ (); s.xlabel = t; __pstate__ (s);
  __pb_mirror_text__ ("xlabel", t);   ## T2：同步到真 axes 属性
endfunction
