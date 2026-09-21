## Argument splitter for mesh/surf/contour (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Accepts the three shapes Octave's surface functions take:
##   f (Z)            → x, y default to grid indices
##   f (Z, SPEC)      → spec is a style string
##   f (X, Y, Z)      → full grid
##   f (X, Y, Z, SPEC)
## plus trailing property/value pairs, which are ignored.

function [x, y, z, spec] = __pb_surf_args__ (args)

  x = []; y = []; z = []; spec = "";

  ## drop trailing property/value pairs
  while (numel (args) >= 2 && ischar (args{end - 1}) && ischar (args{end}))
    args(end - 1:end) = [];
  endwhile

  if (numel (args) == 0)
    error ("surface: not enough input arguments");
  endif

  ## trailing spec
  if (ischar (args{end}))
    spec = args{end};
    args(end) = [];
  endif

  switch (numel (args))
    case 1
      z = args{1};
    case 2
      z = args{1};
      ## a lone numeric second argument has no meaning here; ignore it
    case 3
      x = args{1}; y = args{2}; z = args{3};
    otherwise
      error ("surface: expected (Z), (X,Y,Z), optionally followed by a style");
  endswitch

  if (! isnumeric (z) || isempty (z))
    error ("surface: Z must be a numeric matrix");
  endif
  if (isvector (z) && ! isempty (x))
    error ("surface: Z must be a matrix");
  endif

endfunction
