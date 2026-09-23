## Emit /tmp/pb_spec.json from global __pb__ (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Hand-rolled JSON (no jsonencode/RapidJSON in this build).
##
## Schema (v2):
##   { hold, title, xlabel, ylabel, xlim, ylim, grid, legloc, legend[],
##     logx, logy, axis, series[], panels?[] , active? }
##
## The flat fields always describe the *active* plot, so v1 consumers keep
## working unchanged.  When subplot() was used, `panels` additionally carries
## every panel (each an object of the same shape) and the renderer draws them
## as a multiplot grid.

function __pb_emit__ ()

  global __pb__;

  ## The active panel's live state lives in the flat fields, while panels{}
  ## only holds the ones stashed on a subplot switch — so panels{active} goes
  ## stale the moment anything draws.  Refresh it here, or the renderer would
  ## draw the active panel as it looked before its own plot() call.
  if (isfield (__pb__, "panels") && ! isempty (__pb__.panels) ...
      && isfield (__pb__, "active") && __pb__.active >= 1 ...
      && __pb__.active <= numel (__pb__.panels))
    __pb__.panels{__pb__.active} = __pb_panel_fields__ (__pb__);
  endif

  fid = fopen ("/tmp/pb_spec.json", "w");
  if (fid < 0)
    error ("__pb_emit__: cannot write /tmp/pb_spec.json");
  endif

  ## --- flat (active) spec, with the panels field appended when present ---
  ## ⚠️ 开头的 `{` 以前**从来没写过** —— 于是 /tmp/pb_spec.json 是一个**没有左花括号的
  ##    对象体**，不是合法 JSON。唯一的读者 `bridge/octplot.html:127` 直接
  ##    `JSON.parse(...)`，也就是说那个 PoC 页每次打开都在抛异常，而**没人发现**，
  ##    因为没有任何套件碰这条 seam（审计里的原话就是"spec 的形状只在注释里"）。
  ##    2026-09-23 接通 `%!test` 之后，本文件的覆盖面断言用 `jsondecode` 读回产物，
  ##    才把这条抓出来（报错是 `parse error at offset 7`）。
  fprintf (fid, '{');
  __pb_emit_body__ (fid, __pb__);

  if (isfield (__pb__, "panels") && numel (__pb__.panels) > 1)
    fprintf (fid, ',"panels":[');
    for k = 1:numel (__pb__.panels)
      if (k > 1), fprintf (fid, ","); endif
      fprintf (fid, '{');
      __pb_emit_body__ (fid, __pb__.panels{k});
      fprintf (fid, '}');
    endfor
    fprintf (fid, '],"active":%d', __pb__.active);
  endif

  fprintf (fid, '}');
  fclose (fid);

endfunction

## One spec object's *contents* (no surrounding braces, no leading comma).
function __pb_emit_body__ (fid, s)

  fprintf (fid, '"hold":%s,', __pb_bool__ (s.hold));
  fprintf (fid, '"title":%s,', __pb_str__ (s.title));
  fprintf (fid, '"xlabel":%s,', __pb_str__ (s.xlabel));
  fprintf (fid, '"ylabel":%s,', __pb_str__ (s.ylabel));
  fprintf (fid, '"xlim":%s,', __pb_vec__ (s.xlim));
  fprintf (fid, '"ylim":%s,', __pb_vec__ (s.ylim));
  fprintf (fid, '"grid":%s,', __pb_bool__ (s.grid));
  fprintf (fid, '"legloc":%s,', __pb_str__ (s.legloc));
  fprintf (fid, '"legend":[');
  for i = 1:numel (s.legend)
    if (i > 1), fprintf (fid, ","); endif
    fprintf (fid, "%s", __pb_str__ (s.legend{i}));
  endfor
  fprintf (fid, '],"logx":%s,', __pb_bool__ (s.logx));
  fprintf (fid, '"logy":%s,', __pb_bool__ (s.logy));
  if (isfield (s, "axis"))
    fprintf (fid, '"axis":%s,', __pb_str__ (s.axis));
  else
    fprintf (fid, '"axis":"",');
  endif
  if (isfield (s, "panel_pos") && numel (s.panel_pos) == 4)
    fprintf (fid, '"pos":%s,', __pb_vec__ (s.panel_pos));
  endif
  fprintf (fid, '"series":[');
  for i = 1:numel (s.series)
    sr = s.series{i};
    if (i > 1), fprintf (fid, ","); endif
    ## NOTE: "marker" must be emitted — the JS side reads sr.marker to pick the
    ## gnuplot pointtype, and a missing field silently degrades every marker to
    ## the default empty circle (pt 6).
    ebd = "";
    if (isfield (sr, "ebdir") && ischar (sr.ebdir) && ! isempty (sr.ebdir))
      ebd = sprintf (',"ebdir":%s', __pb_str__ (sr.ebdir));
    endif
    fprintf (fid, '{"file":%s,"style":%s,"color":%s,"dt":%d,"pt":%d,"ps":%g,"marker":%s,"title":%s%s}', ...
             __pb_str__ (sr.file), __pb_str__ (sr.style), __pb_str__ (sr.color), ...
             sr.dt, sr.pt, sr.ps, __pb_str__ (sr.marker), __pb_str__ (sr.title), ebd);
  endfor
  fprintf (fid, ']');

endfunction

function s = __pb_bool__ (b)
  if (b), s = "true"; else, s = "false"; endif
endfunction

function s = __pb_str__ (t)
  t = strrep (t, '\', '\\');
  t = strrep (t, '"', '\"');
  t = strrep (t, char (10), ' ');
  s = ['"' t '"'];
endfunction

function s = __pb_vec__ (v)
  if (isempty (v))
    s = "[]";
  else
    s = "[";
    for i = 1:numel (v)
      if (i > 1), s = [s ","]; endif
      s = [s num2str(v(i), "%.17g")];
    endfor
    s = [s "]"];
  endif
endfunction

%!test
## ★ 覆盖面断言：**表里每个 spec_key 都真的出现在 JSON 里**。
## 这是"字段表（__pb_fields__.m）与 emit 手写体"之间的唯一硬约束 —— 加字段时
## 忘了在 emit 里写一行，这条就红（审计里那句"漏一处是静默的状态泄漏"靠它兜住）。
%! global __pb__;
%! saved = __pb__;                      # 快照，别污染调用方的状态
%! unwind_protect
%!   f = __pb_fields__ ();
%!   st = struct ();
%!   for k = 1:numel (f.names)
%!     st.(f.names{k}) = f.defaults{k};
%!   endfor
%!   ## 给每个字段一个**可区分**的值（默认值很多是空串/空，验不出"有没有发"）
%!   st.title = "T";  st.xlabel = "X";  st.ylabel = "Y";
%!   st.xlim = [1 2];  st.ylim = [3 4];
%!   st.grid = true;  st.logx = true;  st.logy = true;
%!   st.hold = true;  st.legloc = "northeast";  st.axis = "equal";
%!   st.legend = {"a"};
%!   ## series 的每一项是 **struct**（见 __pb_add__.m 的 sr = struct(...)），不是键值 cell
%!   sr = struct ("file", "/tmp/x.dat", "style", "lines", "color", "#000000", ...
%!                "dt", 1, "pt", 6, "ps", 1, "marker", "", "title", "");
%!   st.series = {sr};
%!   st.panel_pos = [0.1 0.2 0.3 0.4];   # spec_key 是 "pos"（只有 4 元时才发）
%!   st.panel_tag = "tag";               # spec_key 为空 ⇒ 不该出现在 JSON 里
%!   st.n = 1;  st.panels = {};  st.active = 0;  st.figs = {};  st.fig_n = 1;
%!   __pb__ = st;
%!   __pb_emit__ ();
%!   j = jsondecode (fileread ("/tmp/pb_spec.json"));
%!   for k = 1:numel (f.names)
%!     key = f.spec_key{k};
%!     if (isempty (key)), continue; endif
%!     assert (isfield (j, key), sprintf ("字段 %s 的 spec 键 \"%s\" 没出现在 JSON 里", f.names{k}, key));
%!   endfor
%!   ## 反向：不该出现的字段别偷偷发出去（panel_tag 没有 spec 键）
%!   assert (! isfield (j, "panel_tag"));
%! unwind_protect_cleanup
%!   ## 先清掉全局再按需还原：不然"本来没有 __pb__"的情况会被 test 框架记成
%!   ## "leaked global variables"（实测会打警告）
%!   clear -g __pb__;
%!   if (isstruct (saved)), __pb__ = saved; endif
%! end_unwind_protect
