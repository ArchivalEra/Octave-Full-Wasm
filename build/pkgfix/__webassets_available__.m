## __webassets_available__ — 清单里的**全部**可加载资产名（小口子 4）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 这是 `OctaveAssets.list()` 在 **Octave 侧**的对应物（页面侧的加载器对象解释器看不见，
## 所以加载器把账本落进 MEMFS，见 `__webassets_info__.m` 的文件头）。
## 想知道"哪些**包**还没装"用 `__webassets_pending__()`；这里给的是全量（含基础设施资产）。
## 账本缺失 ⇒ 空 cell（不报错）。

function names = __webassets_available__ (path)

  if (nargin < 1 || isempty (path))
    path = "/tmp/webassets.json";
  endif

  info = __webassets_info__ (path);
  if (info.ok)
    names = info.available;
  else
    names = {};
  endif
  names = sort (names);

endfunction


%!test
## 没有账本 ⇒ 空 cell（老行为）
%! assert (isempty (__webassets_available__ ("/tmp/definitely-not-here-9d3f.json")));

%!test
## 有账本 ⇒ 全量、字典序
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"available":["plotbridge","statistics","convhulln"],');
%! fputs (fid, '"loaded":["plotbridge"],"pkg_available":["statistics"],"pkg_loaded":[],"stamp":1}');
%! fclose (fid);
%! assert (__webassets_available__ (p), {"convhulln", "plotbridge", "statistics"});
%! unlink (p);
