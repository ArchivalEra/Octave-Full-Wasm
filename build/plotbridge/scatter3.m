## scatter3 for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## scatter3(X,Y,Z) | scatter3(X,Y,Z,SIZE) | scatter3(X,Y,Z,SIZE,COLOR)
##
## Points are projected to 2D and drawn with the normal marker renderer;
## SIZE and COLOR vectors are accepted but only their first element is used
## (v1 of the bridge has one marker size per series).

function h = scatter3 (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  if (nargin < 3)
    error ("scatter3: needs at least X, Y and Z");
  endif

  x = varargin{1}(:); y = varargin{2}(:); z = varargin{3}(:);
  if (! (numel (x) == numel (y) && numel (y) == numel (z)))
    error ("scatter3: X, Y and Z must have the same number of elements");
  endif

  spec = "o";
  if (nargin >= 5 && ischar (varargin{5}))
    spec = varargin{5};
  endif

  [X, Y] = __pb_project3__ (x, y, z, [], []);
  s = __pb_add__ (s, X, Y, spec, "points");
  __pstate__ (s);
  h = [];

endfunction
