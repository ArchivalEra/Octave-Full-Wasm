## Shared plot-argument parser for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Returns a cell array of {x, y, spec} triples, one per series, from the
## varargin of plot/semilogx/semilogy/loglog.
##
## Why a shared parser: four shims had the same hand-rolled loop, and that loop
## got the two-argument form wrong — `plot (y, "-r")` fell through to
## "x=y, y='-r'" and died with `horizontal dimensions mismatch (5x1 vs 2x1)`.
## A trailing string is a LINE SPEC for the series before it, never data.
##
## Handled forms (all the ones a teaching session actually writes):
##   plot (Y)                      plot (Y, SPEC)
##   plot (X, Y)                   plot (X, Y, SPEC)
##   plot (X1,Y1,S1, X2,Y2,S2, …)  plot (Y1,S1, Y2,S2, …)

function out = __pb_parse_series__ (args)

  out = {};
  n = numel (args);
  i = 1;
  while (i <= n)
    a = args{i};

    if (ischar (a))
      ## a spec with no series yet (e.g. plot ("-r")) — ignore it
      if (! isempty (out))
        s = out{end};
        if (isempty (s{3}))
          s{3} = a;
          out{end} = s;
        endif
      endif
      i += 1;
      continue;
    endif

    if (! isnumeric (a))
      error ("plot: arguments must be numeric data or a style string");
    endif

    ## (X, Y) when the next token is also numeric, else Y alone
    if (i + 1 <= n && isnumeric (args{i + 1}))
      out{end+1} = {args{i}, args{i + 1}, ""};
      i += 2;
    else
      out{end+1} = {[], a, ""};
      i += 1;
    endif
  endwhile

endfunction
