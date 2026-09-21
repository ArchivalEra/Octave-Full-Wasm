## figure(n) for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## figure ()      → new figure, next number
## figure (n)     → switch to (creating if needed) figure n, contents intact
## figure (h)     → handle form, accepted for h==1
## figure ("Name", ...) → property pairs accepted and ignored
##
## Unlike v1 (which just cleared everything), each figure keeps its own
## panels, so `figure(1); plot(...); figure(2); plot(...); figure(1)` brings
## the first plot back.  See __pb_figure__.m.

function h = figure (varargin)

  s = __pstate__ ();

  n = [];
  for k = 1:numel (varargin)
    a = varargin{k};
    if (isnumeric (a) && isscalar (a) && a > 0 && a == fix (a))
      n = a;
      break;
    elseif (ischar (a))
      ## property name — skip it and its value
      k++;
    endif
  endfor

  ## stash the outgoing figure before switching
  s = __pb_save_fig__ (s);

  if (isempty (n))
    n = s.fig_n + 1;
  endif

  s = __pb_load_fig__ (s, n);
  __pstate__ (s);
  h = n;

endfunction
