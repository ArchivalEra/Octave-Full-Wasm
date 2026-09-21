## barh for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## barh(Y) | barh(X,Y) — horizontal bars.  Octave's core barh needs real
## graphics handles (barh.m calls newplot/gca), which this build has none of,
## so we record the series ourselves like bar.m does.
##
## Rendering: gnuplot's SVG terminal can draw horizontal boxes with
## `with boxxyerrorbars`; the JS side emits that for style "hboxes".

function h = barh (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  if (numel (varargin) >= 2 && isnumeric (varargin{2}))
    x = varargin{1}; y = varargin{2};
  else
    x = []; y = varargin{1};
  endif

  ## barh swaps the roles: the category runs along y and the length along x.
  ## Store as (category, length) so both vectors are the same length, and let
  ## the renderer draw the box sideways.
  if (isempty (x))
    x = (1:numel (y)).';
  endif
  cat = x(:);
  val = y(:);
  if (numel (cat) != numel (val))
    error ("barh: X and Y must have the same number of elements");
  endif

  s = __pb_add__ (s, cat, val, "", "hboxes");
  __pstate__ (s);
  h = [];

endfunction
