## bar for the plot bridge (own code, repo license).
## bar(Y) | bar(X,Y).  Pair with core hist for histograms:
##   [nn, xx] = hist (data, nbins); bar (xx, nn)
function h = bar (varargin)
  s = __pstate__ ();
  if (! s.hold)
    s.series = {};
    s.title = ""; s.xlabel = ""; s.ylabel = "";
    s.xlim = []; s.ylim = []; s.grid = false;
    s.legend = {}; s.legloc = "";
    s.logx = false; s.logy = false;
  endif
  if (numel (varargin) >= 2 && isnumeric (varargin{2}))
    x = varargin{1}; y = varargin{2};
  else
    x = []; y = varargin{1};
  endif
  s = __pb_add__ (s, x, y, "", "boxes");
  __pstate__ (s);
  h = [];
endfunction
