## bar for the plot bridge (own code, repo license).
## bar(Y) | bar(X,Y).  Pair with core hist for histograms:
##   [nn, xx] = hist (data, nbins); bar (xx, nn)
function h = bar (varargin)
  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
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
