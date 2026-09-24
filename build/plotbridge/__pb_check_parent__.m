## __pb_check_parent__ — 校验 `'parent'` 属性对的值
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 核心的 `'parent'` 语义（宿主 11.3.0 实测）：值是**任意 axes 句柄**就画到那个 axes 上；
## 不是句柄就报 `plot: "parent" value must be an axes handle`。
##
## 桥的处境：只有**当前面板**一份状态（`__pstate__`），画到别的 axes 上它记不下来 ——
## 于是按既有政策（`plot(hax,…)`、`xlim(hax,…)` 那批）**明确报错**，而不是把这条序列
## 记进当前面板（那会让无 GL 设备的 SVG 回落**画到错的面板上**，属于"静默做错"）。
##
## 两句错误文本各管一件事，别合并：
##   · 值根本不是 axes 句柄 → 与核心**同一句**（用户看到的措辞与桌面一致）；
##   · 是 axes 但不是 `gca()` → 说清"桥只管当前 axes"（桥自己的限制，核心没有这条）。

function __pb_check_parent__ (fname, val)

  isax = (isscalar (val) && ishghandle (val) && val != 0 && ! isfigure (val));

  if (! isax)
    error ('%s: "parent" value must be an axes handle', fname);
  endif

  cur = [];
  try
    cur = gca ();          ## 没有 toolkit 或没有图时这里会报错 ⇒ 当作"不是当前 axes"
  catch
    cur = [];
  end_try_catch

  if (isempty (cur) || val != cur)
    error ("%s: the plot bridge only tracks the current axes; \"parent\" axes %g is not gca()",
           fname, val);
  endif

endfunction


%!test
## 不是句柄 / 是 0 / 是 figure 句柄：与核心同一句（值必须是 axes 句柄）
%! h = figure ("visible", "off");
%! caught = false;
%! try
%!   __pb_check_parent__ ("plot", 99);
%! catch err
%!   caught = ! isempty (strfind (err.message, 'value must be an axes handle'));
%! end_try_catch
%! assert (caught, true);
%! caught = false;
%! try
%!   __pb_check_parent__ ("plot", 0);
%! catch err
%!   caught = ! isempty (strfind (err.message, 'value must be an axes handle'));
%! end_try_catch
%! assert (caught, true);
%! caught = false;
%! try
%!   __pb_check_parent__ ("plot", h);          ## figure 句柄不是 axes
%! catch err
%!   caught = ! isempty (strfind (err.message, 'value must be an axes handle'));
%! end_try_catch
%! assert (caught, true);
%! close (h);

%!test
## 当前 axes：通过（不报错）
%! h = figure ("visible", "off");
%! __pb_check_parent__ ("plot", gca ());
%! close (h);

%!test
## 是 axes 但**不是**当前 axes：报"桥只管当前 axes"（与核心的分歧，明确记下来）
%! h1 = figure ("visible", "off");
%! a1 = gca ();
%! h2 = figure ("visible", "off");
%! a2 = gca ();
%! figure (h1);
%! caught = false;
%! try
%!   __pb_check_parent__ ("plot", a2);
%! catch err
%!   caught = ! isempty (strfind (err.message, "only tracks the current axes"));
%! end_try_catch
%! assert (caught, true);
%! close (h1);
%! close (h2);
