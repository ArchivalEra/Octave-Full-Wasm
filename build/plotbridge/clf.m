## clf for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## clf clears the current figure: all panels go, and the flat state resets.
## It does NOT change the figure number (matching Octave).

function h_out = clf (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h_out = __pb_core__ ("clf", varargin{:});
    else
      __pb_core__ ("clf", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h_out = [];


  s = __pstate__ ();
  s = __pb_clear_series__ (s);
  s.hold = false;
  s.panels = {};
  s.active = 0;
  s.panel_pos = [];
  s.panel_tag = "";
  __pstate__ (s);

  __pb_mirror__ ("clf", varargin{:});
endfunction
