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

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("subplot", varargin{:});
    else
      __pb_core__ ("subplot", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h = [];


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
    __pb_mirror__ ("subplot", varargin{:});
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

  __pb_mirror__ ("subplot", varargin{:});
endfunction