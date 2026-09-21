## scatter for the plot bridge (own code, repo license).
## scatter(X,Y) | scatter(X,Y,SPEC).  Size/color vectors: not in v1.
function h = scatter (varargin)
  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif
  x = varargin{1}; y = varargin{2};
  if (numel (varargin) >= 3 && ischar (varargin{3}))
    spec = varargin{3};
  else
    spec = "o";
  endif
  s = __pb_add__ (s, x, y, spec, "points");
  __pstate__ (s);
  h = [];
endfunction
