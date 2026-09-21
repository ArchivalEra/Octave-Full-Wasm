## errorbar for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## errorbar(Y,E) | errorbar(X,Y,E) | errorbar(X,Y,EX,EY) | errorbar(...,SPEC)
##
## The core errorbar.m needs real line/hggroup handles; here we record two
## series: the data as linespoints, plus the bars as a segment list drawn by
## style "ebars" (vertical line + caps at each point).
##
## The bars are stored as (x, ylo, yhi) triples in a separate file so the
## renderer can draw caps without re-deriving them: we emit one series per
## bar direction and let __pb_emit__ carry a "segments" hint.

function h = errorbar (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  n = numel (varargin);
  if (n < 2)
    print_usage ();
  endif

  ## peel a trailing style string
  spec = "";
  if (ischar (varargin{n}))
    spec = varargin{n};
    varargin(n) = [];
    n--;
  endif

  if (n == 2)
    ## errorbar(Y, E)
    y = varargin{1}; e = varargin{2};
    x = [];
    ey = e; ex = [];
  elseif (n >= 3 && isnumeric (varargin{3}))
    x = varargin{1}; y = varargin{2}; ey = varargin{3};
    ex = [];
    if (n >= 4 && isnumeric (varargin{4})), ex = varargin{4}; endif
  else
    error ("errorbar: expected (Y,E), (X,Y,E), or (X,Y,EX,EY)");
  endif

  y = y(:);
  if (isempty (x)), x = (1:numel (y)).'; endif
  x = x(:);
  if (isempty (ex)), ex = zeros (size (y)); endif
  ex = ex(:) + zeros (size (y));
  ey = ey(:) + zeros (size (y));

  ## the marker/line series
  s = __pb_add__ (s, x, y, spec, "linespoints");

  ## the bars: one point per (x, ylo, yhi) triple
  X = [x; x; x];
  Y = [y - ey; y; y + ey];
  s = __pb_errbars__ (s, X, Y, "ey");
  if (any (ex > 0))
    X2 = [x - ex; x; x + ex];
    Y2 = [y; y; y];
    s = __pb_errbars__ (s, X2, Y2, "ex");
  endif

  __pstate__ (s);
  h = [];

endfunction
