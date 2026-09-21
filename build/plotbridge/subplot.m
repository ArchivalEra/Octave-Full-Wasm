## subplot for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## subplot(m,n,p) | subplot(mnp) | subplot("position",[l b w h])
##
## Real subplot needs axes objects.  Here the bridge state grows a `panels`
## cell: the *active* panel is what every existing shim already writes to
## (the top-level fields), and switching panels stashes/restores them, so no
## other shim needs to know subplot exists.
##
## The renderer receives `panels` as an array of ordinary plot specs.

function h = subplot (varargin)

  s = __pstate__ ();

  if (nargin < 1)
    print_usage ();
  endif

  if (ischar (varargin{1}))
    if (! strcmpi (varargin{1}, "position") || nargin < 2)
      error ("subplot: only the 'position' property is supported");
    endif
    pos = varargin{2}(:).';
    if (numel (pos) != 4)
      error ("subplot: position must be [left bottom width height]");
    endif
    s = __pb_stash_panel__ (s);
    s.panel_pos = pos;
    s = __pb_new_panel__ (s, pos, "");
    __pstate__ (s);
    h = 1;
    return;
  endif

  ## numeric form: subplot(2,2,1) or subplot(221)
  if (nargin == 1)
    v = varargin{1};
    if (! (isscalar (v) && v > 0 && v == fix (v)))
      error ("subplot: MNP must be a positive integer");
    endif
    if (v < 100)
      error ("subplot: MNP must encode rows, columns and index (e.g. 221)");
    endif
    p = rem (v, 10);
    n = rem (fix (v / 10), 10);
    m = fix (v / 100);
  elseif (nargin == 3)
    m = varargin{1}; n = varargin{2}; p = varargin{3};
  else
    print_usage ();
  endif

  if (! (isscalar (m) && isscalar (n) && isscalar (p) && m > 0 && n > 0 && p > 0 ...
         && m == fix (m) && n == fix (n) && p == fix (p) && p <= m * n))
    error ("subplot: invalid M, N, P");
  endif

  s = __pb_stash_panel__ (s);

  ## row-major index → grid position (Octave counts rows first)
  row = floor ((p - 1) / n);
  col = rem (p - 1, n);
  w = 1 / n; hh = 1 / m;
  pos = [col * w, 1 - (row + 1) * hh, w, hh];

  s = __pb_new_panel__ (s, pos, sprintf ("%dx%d#%d", m, n, p));
  __pstate__ (s);
  h = 1;

endfunction
