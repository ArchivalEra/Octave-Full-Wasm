## __webshelf_names__ — **货架**（Forge catalog）上的包名（T4，2026-10-12）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 与 __webassets_pending__ 的分工（两者别混）────────────────────────────────
##   · `__webassets_pending__()` —— **随站清单**（`assets/pkg/*.js`）里可装但未装的。
##     这些包"点火即装"：`OctaveAssets.load(名)` 走 `<script>` 注入，无网络下载包字节
##     （字节已随站发布）。
##   · `__webshelf_names__()`   —— **货架**（`assets/forge-catalog.json`）上的包。
##     这些包**不随站**：装它们要走 `OctaveAssets.install(名)` —— fetch 同源 tarball
##     + sha256 校验 + 引擎内建 gunzip/untar 解包（设计稿 NOTES-forge-ondemand.md §3）。
##
## `pkg load <名>` 的 shim（build/webshims/pkg.m）就是按这两个名单决定**该点哪个火**。
## 拿错名单的后果是明确的：对货架包点 `load()` ⇒ "清单里没有资产"（加载器按名查随站清单）；
## 对随站包点 `install()` ⇒ "货架上没有包"（货架只列**未随站**的那些）。两条都实测过。
##
## ── 读谁 ───────────────────────────────────────────────────────────────────
## 账本 `/tmp/webassets.json` 里的 `catalog_packs` / `catalog_state`（由加载器
## `bridge/assets-loader.js` 的 `publish()` 落盘）。**只有货架**读成功时名单才有意义 ——
## 读失败时本函数返回空 cell（调用方据此说"货架读不到"，而不是"货架上没有"）。
## 账本缺失（`.m` 单独跑、页面还没 init）同样返回空 —— 老行为，不报错。

function names = __webshelf_names__ (path)

  if (nargin < 1 || isempty (path))
    path = "/tmp/webassets.json";
  endif

  info = __webassets_info__ (path);
  names = {};

  ## `catalog_state ~= ok` ⇒ 名单不可信（读失败/还没读）⇒ 空。三种状态必须可分辨:
  ##   空 + state=fail ⇒ "货架读不到"；空 + state=ok ⇒ "货架上真的没有"。
  if (! info.ok || ! strcmp (info.catalog_state, "ok"))
    return;
  endif

  names = sort (info.catalog_packs);

endfunction


%!test
## 没有账本 ⇒ 空，不报错
%! assert (isempty (__webshelf_names__ ("/tmp/definitely-not-here-9d3f.json")));

%!test
## 正常账本（货架已读）⇒ 出名单，字典序
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"available":[],"loaded":[],"pkg_available":[],"pkg_loaded":[],');
%! fputs (fid, '"catalog_state":"ok","catalog_packs":["splines","quaternion"],"stamp":5}');
%! fclose (fid);
%! assert (__webshelf_names__ (p), {"quaternion", "splines"});
%! unlink (p);

%!test
## ★ 反向：货架**读失败** ⇒ 空（不许把"读不到"当成"货架上没有"）
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"catalog_state":"fail","catalog_packs":[],"stamp":5}');
%! fclose (fid);
%! assert (isempty (__webshelf_names__ (p)));
%! unlink (p);

%!test
## ★ 反向：**老账本**（没有 catalog_* 字段，例如 7.2 车道/未升级页面）⇒ 空，不报错
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"available":["statistics"],"loaded":[],"pkg_available":["statistics"],');
%! fputs (fid, '"pkg_loaded":[],"stamp":1}');
%! fclose (fid);
%! assert (isempty (__webshelf_names__ (p)));
%! unlink (p);

%!test
## 只有一条 ⇒ jsondecode 给 char 不是 cell 的那条路径也要对
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"catalog_state":"ok","catalog_packs":["splines"],"stamp":9}');
%! fclose (fid);
%! assert (__webshelf_names__ (p), {"splines"});
%! unlink (p);
