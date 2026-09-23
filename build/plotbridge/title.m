## title for the plot bridge (own code, repo license).
function h_out = title (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h_out = __pb_core__ ("title", varargin{:});
    else
      __pb_core__ ("title", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h_out = [];

  ## 核心允许 `title(hax, TEXT)`：首参是句柄时先剥掉（不是当前 axes 就明确报错）。
  ## ★ 以前这里 `s.title = t` 把**句柄**当成了标题文字（标题区显示一个数字），
  ##   而 `title(hax, "abc")` 那句里的 "abc" 根本没被读 —— 静默做错。见 `__pb_strip_axes__.m`。
  args = __pb_strip_axes__ ("title", varargin);
  if (numel (args) < 1 || ! ischar (args{1}))
    error ("title: TEXT must be a string");
  endif
  t = args{1};
  s = __pstate__ (); s.title = t; __pstate__ (s);
  __pb_mirror_text__ ("title", t);   ## T2：同步到真 axes 属性
endfunction
