## axis for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## axis() | axis("equal") | axis("tight") | axis("off"|"on") | axis([x1 x2 y1 y2])
##
## The core axis.m operates on real axes objects, which this build has none
## of.  We record the request in the bridge state; the renderers honour the
## ones that make sense for a 2D line/bar chart:
##
##   equal  → square plot box (same units per pixel on both axes)
##   tight  → ranges follow the data exactly, no padding
##   off    → hide frame/ticks/labels
##   on     → undo "off"
##   [x1 x2 y1 y2] → both limits at once
##
## Anything else is accepted and ignored (rather than erroring), matching how
## the rest of the bridge degrades: a teaching plot should not fail because
## of one unsupported style flag.

function axis (varargin)

  s = __pstate__ ();

  if (nargin == 0)
    ## axis() with no args reports the current limits in Octave; there is
    ## nothing to report here, so it is a no-op.
    return;
  endif

  a = varargin{1};

  if (isnumeric (a))
    if (numel (a) == 4)
      s.xlim = [a(1) a(2)];
      s.ylim = [a(3) a(4)];
      __pstate__ (s);
      return;
    elseif (numel (a) == 2)
      s.xlim = a(:).';
      s.ylim = a(:).';
      __pstate__ (s);
      return;
    else
      error ("axis: limits must be a 2- or 4-element vector");
    endif
  endif

  if (! ischar (a))
    error ("axis: expected a string or a numeric vector");
  endif

  switch (lower (a))
    case "equal",   s.axis = "equal";
    case "tight",   s.axis = "tight";
    case "off",     s.axis = "off";
    case "on",      s.axis = "";
    case "normal",  s.axis = "";
    case "auto",    s.axis = ""; s.xlim = []; s.ylim = [];
    case {"square", "vis3d", "ij", "xy", "image", "fill", "padded", "tightxy"}
      ## accepted, no effect in v1 of the bridge
    otherwise
      error ("axis: unknown option '%s'", a);
  endswitch

  __pstate__ (s);

endfunction
