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

function lim_out = axis (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      lim_out = __pb_core__ ("axis", varargin{:});
    else
      __pb_core__ ("axis", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  lim_out = [];


  s = __pstate__ ();

  ## P5：本函数有多处提前 return，所以镜像放在**开头**（nargin>0 时）。
  ## 核心 axis.m 会先做自己的校验，报错信息因此来自核心实现。
  if (nargin > 0)
    __pb_mirror__ ("axis", varargin{:});
  endif

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
