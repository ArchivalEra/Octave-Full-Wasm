## __webassets_pending__ — **可加载但还没装载**的 Forge 包（小口子 4；T4 起含货架）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 用途：`pkg list` 末尾那段"本构建还能装哪些包"、以及 `pkg load` 的提示都问它。
## 与 `__webassets_available__` 的分工：
##   · `__webassets_available__()` —— 清单里的**全部**资产（含 plotbridge/doc-cache 这类基础设施）
##   · `__webassets_pending__()`   —— 其中**是包**且**尚未装载**的（用户真正关心的那句答案）
## 账本缺失时返回空 cell（`pkg.m` 会因此退回"什么都不说"的老行为，不报错）。
##
## ── T4（2026-10-12）：两个来源**合流**在这里 ─────────────────────────────────
## 包有两个来源（见 `__webpackage_source__.m`）：**随站清单**与**货架**。
## "还能装哪些"这个问题的正确答案 = 两边的并集 —— 老版只报随站那半，于是货架上的包
## （如未随站发运的 optim）在 `pkg list` 的提示里**完全不出现**，用户根本不知道有它。
## ⇒ 现在返回 `随站待装 ∪ 货架未装`，**按名去重**（同名两边都有时只报一次）。
## 货架读不到（catalog_state≠ok）时只报随站那半 —— 报半个真话胜过报一个假话。

function names = __webassets_pending__ (path)

  if (nargin < 1 || isempty (path))
    path = "/tmp/webassets.json";
  endif

  info = __webassets_info__ (path);
  names = {};

  if (! info.ok)
    return;
  endif

  ## ── "已装"的合并名单 ───────────────────────────────────────────────────────
  ## 两来源装出来的账**不一样**：随站的进 `pkg_loaded`；货架的以 `forge:<名>` 进 `loaded`
  ## （`publish()` 里 `pkgs()` 只认真实清单里的 url ⇒ 货架包永远不会出现在 `pkg_loaded`）。
  ## ⇒ 判"装没装"必须看**并集**。只看 pkg_loaded 的后果：货架装过的包仍被列为"待装"，
  ## `pkg load` 于是被指去再装一次（幂等所以不炸，但提示是错的）。
  ## `%!test` 第 4 条正是抓这个（第一版就是这么错的）。
  inst = info.pkg_loaded;
  for k = 1:numel (info.loaded)
    nm = info.loaded{k};
    if (numel (nm) > 6 && strncmp (nm, "forge:", 6))
      inst{end + 1} = nm(7:end);
    endif
  endfor

  for k = 1:numel (info.pkg_available)
    nm = info.pkg_available{k};
    if (! any (strcmp (nm, inst)))
      names{end + 1} = nm;
    endif
  endfor

  shelf = __webshelf_names__ (path);      # 只求一次（它有文件 IO + jsondecode）
  for k = 1:numel (shelf)
    nm = shelf{k};
    if (! any (strcmp (nm, inst)) && ! any (strcmp (nm, names)))
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

%!test
## T4：货架上的包也算"还能装"（老版只报随站那半 —— 用户因此不知道货架上有啥）
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"pkg_available":["statistics"],"pkg_loaded":[],"loaded":[],');
%! fputs (fid, '"catalog_state":"ok","catalog_packs":["splines","quaternion"],"stamp":7}');
%! fclose (fid);
%! assert (__webassets_pending__ (p), {"quaternion", "splines", "statistics"});
%! unlink (p);

%!test
## T4：已装的货架包（loaded 里有 'forge:<名>'）从名单里消失；按名去重（同名两边都有只报一次）
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"pkg_available":["statistics","splines"],"pkg_loaded":[],');
%! fputs (fid, '"loaded":["forge:splines"],');
%! fputs (fid, '"catalog_state":"ok","catalog_packs":["splines","quaternion"],"stamp":7}');
%! fclose (fid);
%! assert (__webassets_pending__ (p), {"quaternion", "statistics"});
%! unlink (p);

%!test
## ★ 反向：货架**读不到** ⇒ 只报随站那半（报半个真话，胜过把货架当成空的）
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"pkg_available":["statistics"],"pkg_loaded":[],"catalog_state":"fail",');
%! fputs (fid, '"catalog_packs":["splines"],"stamp":7}');
%! fclose (fid);
%! assert (__webassets_pending__ (p), {"statistics"});
%! unlink (p);
