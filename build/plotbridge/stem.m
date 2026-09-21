## stem for the plot bridge (own code, repo license).
## stem(X,Y) | stem(Y) | stem(...,SPEC).  JS renders impulses+points.
function h = stem (varargin)
  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif
  if (numel (varargin) >= 2 && isnumeric (varargin{2}))
    x = varargin{1}; y = varargin{2};
    rest = varargin(3:end);
  else
    x = []; y = varargin{1};
    rest = varargin(2:end);
  endif
  spec = "";
  for k = 1:numel (rest)
    if (ischar (rest{k})), spec = rest{k}; endif
  endfor
  s = __pb_add__ (s, x, y, spec, "stem");
  __pstate__ (s);
  h = [];
endfunction
