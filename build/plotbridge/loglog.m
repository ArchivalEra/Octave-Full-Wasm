## loglog for the plot bridge (own code, repo license).
function h = loglog (varargin)
  s = __pstate__ ();
  if (! s.hold)
    s.series = {};
    s.title = ""; s.xlabel = ""; s.ylabel = "";
    s.xlim = []; s.ylim = []; s.grid = false;
    s.legend = {}; s.legloc = "";
    s.logx = false; s.logy = false;
  endif
  s.logx = true; s.logy = true;
  i = 1; n = numel (varargin);
  while (i <= n)
    if (i == n)
      x = []; y = varargin{i}; spec = ""; i += 1;
    elseif (i + 1 < n && ischar (varargin{i+2}))
      x = varargin{i}; y = varargin{i+1}; spec = varargin{i+2}; i += 3;
    else
      x = varargin{i}; y = varargin{i+1}; spec = ""; i += 2;
    endif
    s = __pb_add__ (s, x, y, spec, "lines");
  endwhile
  __pstate__ (s);
  h = [];
endfunction
