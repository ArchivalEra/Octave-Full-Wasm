## Octave-Full-Wasm — plot 桥的**唯一**调色板（own code, repo license）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么单独一个文件 ──────────────────────────────────────────────────────
## 2026-09-23 的胶水层审计查出：这条 7 色表**逐字节抄在三个地方** ——
##   `__pb_add__.m:14`（不给 spec 时按 series 数取色）、`__pb_cycle_color__.m:9`
##   （contour 每条等值线取一色）、以及 `__svg_render__.m` 里两处 `"#0072BD"` 兜底。
## 更糟的是 `__pb_cycle_color__` 自己的注释写着"kept in one place because three shims
## used to hard-code it" —— 而它的调用者 `__pb_add__` **至今仍在硬写**。注释说的意图
## 与代码相反，这就是典型的"知识说了几遍"。
##
## 现在：表只有这一份，取色只有这一条接口。
##
## 用法：
##     c  = __pb_palette__ ()    → 7 色 cell（给需要整表的调用方）
##     c  = __pb_palette__ (k)   → 第 k 个颜色，**从 1 起循环**（超出就绕回来）
##
## 取色语义（两份调用方都必须一致，写在这里免得各记各的）：
##     k = 1 是第一个颜色；`__pb_add__` 传"下一条 series 的序号"
##     （`numel(s.series) + 1`），contour 传它自己的等值线序号。

function c = __pb_palette__ (k)

  ## MATLAB 的默认 7 色顺序
  persistent ORDER
  if (isempty (ORDER))
    ORDER = {"#0072BD", "#D95319", "#EDB120", "#7E2F8E", ...
             "#77AC30", "#4DBEEE", "#A2142F"};
  endif

  if (nargin == 0)
    c = ORDER;
    return;
  endif

  if (! (isscalar (k) && isnumeric (k) && k == fix (k)))
    error ("__pb_palette__: K must be an integer");
  endif
  c = ORDER{mod (k - 1, numel (ORDER)) + 1};

endfunction


%!test
## 表本身：7 色、互不相同
%! p = __pb_palette__ ();
%! assert (numel (p), 7);
%! assert (numel (unique (p)), 7);
## 取色：1 起、循环
%! assert (__pb_palette__ (1), p{1});
%! assert (__pb_palette__ (7), p{7});
%! assert (__pb_palette__ (8), p{1});
%! assert (__pb_palette__ (0), p{7});
%! assert (__pb_palette__ (15), p{1});
## 非整数要明确报错（别静默取到别的颜色）
## ⚠️ `error <pattern> code` **不能写在 `%!test` 块里** —— 框架会把它当普通语句执行，
##    结果是"测试失败但看不出为什么"（实测：报 `!!!!! test failed` 后只印出 `<K`）。
##    错误用例要单独起 `%!error` 块。
%!error <K must be an integer> __pb_palette__ (1.5)
%!error <K must be an integer> __pb_palette__ ("x")
%!error <K must be an integer> __pb_palette__ ([1 2])
