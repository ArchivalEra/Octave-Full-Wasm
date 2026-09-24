## __webassets_info__ — 读页面加载器落的"资产账本"（小口子 4）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么需要它 ────────────────────────────────────────────────────────────
## 本构建的能力有一半在 `assets/` 里**按需装载**（Forge 包、`.oct`、`.m` 覆写…）。但 Octave
## 的解释器**看不见 JS 的加载器对象**，于是"有哪些东西可加载、哪些已经装了"这件事在 `.m` 侧
## 完全不可问 —— 后果是 `pkg load statistics` 只回一句
## **`package statistics is not installed`**（实测），而 statistics 明明就在 `assets/pkg/`
## 里等着被装。这句话会让人以为"这个构建没有 statistics"。
##
## 桥的做法：加载器在 **init 之后**与**每次装载成功之后**把账本写进 MEMFS
##（`bridge/assets-loader.js` 的 `publish()`）：
##     /tmp/webassets.json = { available:[…], loaded:[…], pkg_available:[…], pkg_loaded:[…], stamp }
## 本文件只是**读它**（`jsondecode` 本构建可用，见批次 1a）。
##
## ── 三种名字 ────────────────────────────────────────────────────────────────
##   · `available`     — 清单里的全部资产名（含 plotbridge/doc-cache 这类**基础设施**）
##   · `loaded`        — 已装载的
##   · `pkg_available` — 其中**是 Forge 包**的那些（`assets/pkg/*.js`）⇒ 给 `pkg list` 用
## 账本不存在（例如 `.m` 侧被单独调用、或页面还没 init）时**返回空结构**，不报错 ——
## 调用方（`pkg.m`）要能"没有账本就照旧干活"。
##
## 判据写在纯函数里是为了**宿主可测**（写一个假账本文件即可，不需要页面）。

function info = __webassets_info__ (path)

  if (nargin < 1 || isempty (path))
    path = "/tmp/webassets.json";
  endif

  info = struct ("available", {{}}, "loaded", {{}}, ...
                 "pkg_available", {{}}, "pkg_loaded", {{}}, "stamp", 0, "ok", false);

  if (! (ischar (path) && exist (path, "file")))
    return;                     ## 没有账本 ⇒ 空结构 + ok=false（调用方自己决定怎么办）
  endif

  try
    raw = jsondecode (fileread (path));
  catch
    return;                     ## 坏账本同上：不抛错，避免把 pkg 整个弄坏
  end_try_catch

  fn = {"available", "loaded", "pkg_available", "pkg_loaded"};
  for k = 1:numel (fn)
    if (isfield (raw, fn{k}))
      v = raw.(fn{k});
      if (ischar (v))
        v = {v};                ## 只有一条时 jsondecode 会给 char，不是 cell
      endif
      if (iscellstr (v))
        info.(fn{k}) = v(:).';
      endif
    endif
  endfor
  if (isfield (raw, "stamp") && isnumeric (raw.stamp))
    info.stamp = raw.stamp;
  endif
  info.ok = true;

endfunction


%!test
## 没有账本（或路径不存在）⇒ 空结构 + ok=false，**不报错**
%! i = __webassets_info__ ("/tmp/definitely-not-here-9d3f.json");
%! assert (i.ok, false);
%! assert (isempty (i.available));
%! assert (isempty (i.pkg_available));

%!test
## 正常账本：四条名单都读进来（含"只有一条 ⇒ char 不是 cell"的那条路径）
%! p = tempname ();
%! fid = fopen (p, "w");
%! fputs (fid, '{"available":["plotbridge","statistics","optim"],"loaded":["plotbridge"],');
%! fputs (fid, '"pkg_available":["statistics","optim"],"pkg_loaded":[],"stamp":123}');
%! fclose (fid);
%! i = __webassets_info__ (p);
%! assert (i.ok, true);
%! assert (numel (i.available), 3);
%! assert (i.loaded, {"plotbridge"});
%! assert (i.pkg_available, {"statistics", "optim"});
%! assert (isempty (i.pkg_loaded));
%! assert (i.stamp, 123);
%! unlink (p);

%!test
## 坏账本（不是合法 JSON）⇒ 同样不报错，只是 ok=false
%! p = tempname ();
%! fid = fopen (p, "w"); fputs (fid, "{not json at all"); fclose (fid);
%! i = __webassets_info__ (p);
%! assert (i.ok, false);
%! unlink (p);
