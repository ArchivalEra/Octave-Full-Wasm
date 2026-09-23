## xlabel/ylabel/title for the plot bridge (own code, repo license).
function h_out = xlabel (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h_out = __pb_core__ ("xlabel", varargin{:});
    else
      __pb_core__ ("xlabel", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h_out = [];

  ## 核心允许 `xlabel(hax, TEXT)`（句柄优先）。签名从 `(t)` 放宽到 `(varargin)` 就是为了
  ## 这条：以前 `xlabel(gca(), "abc")` 直接报 "called with too many inputs" —— 一个
  ## **核心完全合法**的调用在桥这里变成了一句难懂的错。见 `__pb_strip_axes__.m`。
  args = __pb_strip_axes__ ("xlabel", varargin);
  if (numel (args) < 1 || ! ischar (args{1}))
    error ("xlabel: TEXT must be a string");
  endif
  t = args{1};
  s = __pstate__ (); s.xlabel = t; __pstate__ (s);
  __pb_mirror_text__ ("xlabel", t);   ## T2：同步到真 axes 属性
endfunction
