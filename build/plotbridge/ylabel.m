## ylabel for the plot bridge (own code, repo license).
function ylabel (t)
  s = __pstate__ (); s.ylabel = t; __pstate__ (s);
  __pb_mirror_text__ ("ylabel", t);   ## T2：同步到真 axes 属性
endfunction
