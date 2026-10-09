## pie for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## pie(X) | pie(X, EXPLODE) | pie(..., LABELS)
##
## The core pie.m needs patch handles; here we pre-compute the wedge polygons
## in Octave and hand them to the normal renderer as closed filled polygons —
## so the pure-.m SVG writer draws them with no new primitive, and gnuplot
## gets the same closed polylines.
##
## Wedges are emitted as (x,y) rings: centre -> arc points -> centre.
##
## ★ **已记录的降级（有意，不是遗漏）**：`EXPLODE` 与 `LABELS` 两个可选参数**被忽略** ——
##   饼本身照画（数据一个字不改），只是没有扇区标签、也没有被"炸开"的扇区。这与那几条
##   "静默做错"的契约不同：**没有任何输入被当成别的东西**，用户看到的就是一个正常的饼图。
##   边界由 `test/browser/accept-plotv2.mjs` 的"参数契约"节钉住（断言它不报错且出 3 个扇形）。
##   （另一半理由写在 `axis.m` 的文件头：教学脚本不该因为一个不支持的样式参数整张图挂掉。）

function h = pie (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("pie", varargin{:});
    else
      __pb_core__ ("pie", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h = [];


  ## 剥掉"首参是目标 axes 句柄"那一层（核心内部会这么调：`hist` 走
  ## `bar (hax, x, freq, "hist", …)`）。镜像那一步仍用**原样**实参（核心自己认得句柄形态）。
  ## ⚠️ 见 `__pb_strip_axes__.m`：桥只跟踪**当前 axes**；首参是别的 axes ⇒ 明确报错（不静默曲解）。
  orig = varargin;
  varargin = __pb_strip_axes__ ("pie", varargin);

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  if (nargin < 1)
    print_usage ();
  endif

  x = varargin{1}(:);
  if (any (x < 0))
    error ("pie: X must be non-negative");
  endif
  total = sum (x);
  if (total <= 0)
    error ("pie: X must have a positive sum");
  endif

  ## axis is forced to a square, label-free box
  s.axis = "equal";
  s.grid = false;
  s.logx = false; s.logy = false;

  n = numel (x);
  frac = x / total;
  ## 2 degrees per step, at least 8 points per wedge
  a0 = pi/2;                          # start at 12 o'clock, clockwise
  for k = 1:n
    sweep = 2*pi*frac(k);
    m = max (8, ceil (sweep / (2*pi) * 72));
    th = a0 - linspace (0, sweep, m).';
    xp = [0; cos(th); 0];
    yp = [0; sin(th); 0];
    s = __pb_add__ (s, xp, yp, "", "area");
    a0 = a0 - sweep;
  endfor

  __pstate__ (s);
  h = [];

  h = __pb_mirror__ ("pie", orig{:});
endfunction
