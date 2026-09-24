## __webassets_pending__ — **可加载但还没装载**的 Forge 包（小口子 4）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 用途：`pkg list` 末尾那段"本构建还能装哪些包"、以及 `pkg load` 的提示都问它。
## 与 `__webassets_available__` 的分工：
##   · `__webassets_available__()` —— 清单里的**全部**资产（含 plotbridge/doc-cache 这类基础设施）
##   · `__webassets_pending__()`   —— 其中**是包**且**尚未装载**的（用户真正关心的那句答案）
## 账本缺失时返回空 cell（`pkg.m` 会因此退回"什么都不说"的老行为，不报错）。

function names = __webassets_pending__ (path)

  if (nargin < 1 || isempty (path))
    path = "/tmp/webassets.json";
  endif

  info = __webassets_info__ (path);
  names = {};

  if (! info.ok)
    return;
  endif

  for k = 1:numel (info.pkg_available)
    nm = info.pkg_available{k};
    if (! any (strcmp (nm, info.pkg_loaded)))
      names{end + 1} = nm;
    endif
  endfor

  names = sort (names);

endfunction


%!test
## 没有账本 ⇒ 空（老行为），不报错
%! assert (isempty (__webassets_pending__ ("/tmp/definitely-not-here-9d3f.json")));

%!test
## 可用减已装：装载过的从待装名单里消失，顺序按字典序排
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"available":["plotbridge","statistics","optim","signal"],');
%! fputs (fid, '"loaded":["plotbridge","optim"],"pkg_available":["optim","signal","statistics"],');
%! fputs (fid, '"pkg_loaded":["optim"],"stamp":7}');
%! fclose (fid);
%! assert (__webassets_pending__ (p), {"signal", "statistics"});
%! unlink (p);
