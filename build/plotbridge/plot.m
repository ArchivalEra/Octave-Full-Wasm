## Headless plot() for the wasm bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## plot(Y) | plot(Y,SPEC) | plot(X,Y) | plot(X,Y,SPEC) | plot(X1,Y1,S1,X2,Y2,S2,…)
##
## Records series into the bridge state; rendering happens in JS (gnuplot-wasm)
## and/or in __svg_render__.m for print -dsvg.

function h = plot (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  ser = __pb_parse_series__ (varargin);
  for k = 1:numel (ser)
    t = ser{k};
    s = __pb_add__ (s, t{1}, t{2}, t{3}, "lines");
  endfor

  __pstate__ (s);
  h = [];

endfunction
