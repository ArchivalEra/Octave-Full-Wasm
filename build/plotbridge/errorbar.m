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
## bar direction, and record the direction on the series itself.

function h = errorbar (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("errorbar", varargin{:});
    else
      __pb_core__ ("errorbar", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h = [];


  ## P5：镜像要用**原始**实参 —— 下面会把 varargin 改写（剥末尾 spec）
  orig = varargin;

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  ## 属性对从桥自己的解析里剥掉：核心接受 `errorbar(x,y,'parent',gca())`（宿主实测），
  ## 以前它会掉进下面的分支判断 ⇒ 报 "expected (Y,E), (X,Y,E), …"（**桥比核心严**）。
  ## 见 __pb_strip_props__.m。
  varargin = __pb_strip_props__ ("errorbar", varargin);

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

  h = __pb_mirror__ ("errorbar", orig{:});
endfunction