## __webpackage_source__ — 一个包**从哪来**、以及**装完了没有**（T4，2026-10-12）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 它解决的问题 ────────────────────────────────────────────────────────────
## `pkg load <名>` 的 shim（build/webshims/pkg.m）要给用户把包装上。但包有**两个来源**，
## 且**点火方式不同**（拿错就是明确报错，两条都实测过）：
##
##   来源          名单                      点火                      字节
##   ─────────────────────────────────────────────────────────────────────────
##   'shipped'    `pkg_available`（随站）     `OctaveAssets.load(名)`   **已随站**（<script> 注入）
##   'shelf'      `catalog_packs`（货架）     `OctaveAssets.install(名)` fetch 同源 tarball + sha256
##
## 老 shim 只认第一个来源 ⇒ **货架上的包**（如未随站发运的 optim）敲 `pkg load` 仍然拿到
## "package … is not installed"，而 `OctaveAssets.install('optim')` 明明是好的。
## 本函数把"该点哪个火"变成**一个纯函数**（读账本文件、出三个字符串），于是宿主可测：
## 写一个假账本 + 假目录即可覆盖全部分支，不需要页面、不需要真下载。
##
## ── 返回的两组值 ────────────────────────────────────────────────────────────
##   `src`   —— 'loaded' | 'shipped' | 'shelf' | 'miss' | 'unknown'
##              'loaded'  = 已装（pkg_loaded / 已 addpath）⇒ 调用方**什么都不用做**
##              'unknown' = **问不出来**（账本缺失/损坏/货架读失败）⇒ 调用方**不许**说
##                          "不存在"（"读不到" ≠ "没有" —— 这是本函数存在的头号理由）
##              'miss'    = 能问且问了，**确实不在任何名单上**
##   `why`   —— 一句话（给人看的；`pkg load` 在不认识包名时把它打出来）
##
## ── 第三个出参：装完了吗（轮询的**终态判据**）────────────────────────────────
##   `[src, why, state] = __webpackage_source__ (名, 账本路径)`
##     state ∈ 'idle'（还没动静，继续等）
##           | 'ok'（装好了 —— 调 core pkg 走官方路径）
##           | 'failed'（**明确失败**，why 里带原因 ⇒ 立刻停止轮询并报给用户）
##   ★ 为什么必须有 `failed` 这一态：老 shim 的 `while …tries < 600` 是"等 60 秒"——
##     安装失败时用户要**干等 60 秒**才看到结果；更糟的是期间**没有任何区分**。
##     （失败原因是加载器落账的 `install_error[name]`，见 bridge/assets-loader.js 的 publish()）
##
## ── 账本字段（由 bridge/assets-loader.js 的 publish() 落盘）──────────────────
##   pkg_available / pkg_loaded ← 随站清单视角（老字段）
##   catalog_state / catalog_packs / catalog_miss / install_error ← 货架视角（T4 新增）
##   ⚠️ 老页面（未升级）没有 catalog_* ⇒ catalog_state='unread' ⇒ 'shelf' 永不出现，
##      本函数对随站包的行为与老 shim **逐字节一致**（向后兼容是硬要求）。
##   ⚠️ `jsondecode` 会把字段名里的 `-` 改成 `_`（实测）：包名带 `-` 时 `isfield` 查不到。
##      ⇒ 查 `install_error` 时**两边都归一化**（`-`→`_`），别只查原样名。

function [src, why, state] = __webpackage_source__ (name, path)

  if (nargin < 2 || isempty (path))
    path = "/tmp/webassets.json";
  endif
  ## ★ 内部哨兵：`src = ""` 表示"**归属还没定**"（不是"unknown"）。
  ##   ⚠️ 第一版把初值写成 "unknown" ⇒ 下面"归属已定就返回"那道 `if (! isempty (src))`
  ##   恒真、函数在第③步就带着 idle 返回了 ⇒ **每一步的判定都被跳过**（`%!test` 第 6 条
  ##   当场抓住：'zzznope' 该是 miss 却回了 unknown/idle）。哨兵值必须与**真值**区分开。
  src = "";
  why = "";
  state = "idle";

  if (! (ischar (name) && ! isempty (name)))
    src = "unknown";
    why = "包名必须是字符串";
    state = "failed";
    return;
  endif

  info = __webassets_info__ (path);

  ## ── ① 账本都没有 ⇒ 问不出来（不是"不存在"）────────────────────────────────
  ##  state=failed 的意思是"**等下去也不会变**"（而不是"这个包不存在"）—— 调用方据此
  ##  退回老行为（委托核心 pkg），既不误报也不空等。
  if (! info.ok)
    src = "unknown";
    why = "页面还没有落资产账本（/tmp/webassets.json 缺席或损坏）";
    state = "failed";
    return;
  endif

  ## ── ② 已装（两种来源都算：随站的进 pkg_loaded；货架的以 'forge:<名>' 进 loaded）
  if (any (strcmp (name, info.pkg_loaded)) || any (strcmp (["forge:" name], info.loaded)))
    src = "loaded";
    why = "已经装好了";
    state = "ok";
    return;
  endif

  ## ── ③ **来源标签**先定（按名单归属），再定**终态**（按 install_error / catalog_miss）──
  ##   为什么分两步：装载**失败**的包也要能报出它本来的来源。老实现把两者混在一起，
  ##   一个装载失败的随站包会被报成"货架包"（标签错，用户按提示去找货架会再撞一次墙）。
  is_shipped = any (strcmp (name, info.pkg_available));
  is_shelf = strcmp (info.catalog_state, "ok") && any (strcmp (name, info.catalog_packs));
  if (is_shipped)
    src = "shipped";
    why = "随站资产（点火 = OctaveAssets.load）";
  elseif (is_shelf)
    src = "shelf";
    why = "货架包（点火 = OctaveAssets.install，fetch 同源 tarball + sha256）";
  endif

  ## 失败原因：加载器落账的 `install_error[name]`（T4 新增）。
  ## ⚠️ `jsondecode` 会把字段名里的 `-` 改成 `_`（实测）⇒ 两边都归一化再查，别只查原样名。
  ie_name = strrep (name, "-", "_");
  if (! isempty (fieldnames (info.install_error)) ...
      && (isfield (info.install_error, name) || isfield (info.install_error, ie_name)))
    if (isempty (src))
      src = "miss";                     # 失败且不在任何名单上（被删/改名）⇒ 只能这么标
    endif
    reason = "";
    if (isfield (info.install_error, name))
      reason = info.install_error.(name);
    elseif (isfield (info.install_error, ie_name))
      reason = info.install_error.(ie_name);
    endif
    why = ["装载**失败**：" char (reason)];
    state = "failed";
    return;
  endif

  ## 货架读到了而查无此包 ⇒ **终态**（再等也不会出现）
  if (any (strcmp (name, info.catalog_miss)))
    src = "miss";
    why = "货架读到了，但**上面没有这个包**";
    state = "failed";
    return;
  endif

  ## ── ④ 归属已定 ⇒ 停在 idle（调用方点火后回来轮询等终态）──────────────────
  if (! isempty (src))
    state = "idle";
    return;
  endif

  ## ── ⑤ 两个名单都没命中 ──────────────────────────────────────────────────────
  ##   ★ 这里必须把**三态**分开，它们对调用方意味着完全不同的动作：
  ##     `catalog_state == "unread"` —— 货架**还没人读过**（页面开机不读它，只有要用才读）。
  ##         ⇒ src=unknown + **state=idle**：这是"还没问"，不是"没有"！
  ##         调用方（pkg.m）据此**点火读货架**，等它落定后重判（T4 两段式）。
  ##         第一版把 unread 与 fail 一起归成 failed ⇒ 货架路径**从来没被执行过**
  ##         （验收套件 A0c 之后 B1 报 src=unknown 就是这个形状：site 上装的 10 个包
  ##          全在随站清单里，所以从来没人读过货架）。
  ##     `catalog_state == "fail"`   —— 读过且**失败**（网络/404）⇒ 等下去也不会变 = failed。
  ##         这时**不说"没有"**（那是假断言），退回核心 pkg 让官方路径去判。
  ##     `catalog_state == "ok"`     —— 读过且没有这个包 ⇒ **真正的 miss**。
  if (strcmp (info.catalog_state, "unread"))
    src = "unknown";
    why = "货架**还没读过**（catalog_state=unread）⇒ 还没问，不等于没有";
    state = "idle";                      # ★ idle = "可以等/可以点火去问"，不是终态
  elseif (strcmp (info.catalog_state, "ok"))
    src = "miss";
    why = "随站清单与货架上都查不到这个包";
    state = "failed";
  else
    src = "unknown";
    why = ["货架**读不到**（catalog_state=" info.catalog_state ...
           "）⇒ 无法判断这个包在不在货架上（这不等于'没有'）"];
    state = "failed";
  endif

endfunction


%!function p = __wps_write__ (json_text)
%!  p = tempname ();
%!  fid = fopen (p, "w");
%!  fputs (fid, json_text);
%!  fclose (fid);
%!endfunction

%!test
## 账本缺席 ⇒ unknown（**不是** miss；"读不到" ≠ "没有"）
%! [s, w, st] = __webpackage_source__ ("anything", "/tmp/definitely-not-here-9d3f.json");
%! assert (s, "unknown");
%! assert (st, "failed");
%! assert (! isempty (w));

%!test
## 随站包（老账本，没有 catalog_*）⇒ shipped ⇒ 与老 shim 行为一致
%! p = __wps_write__ ('{"available":["statistics"],"loaded":[],"pkg_available":["statistics"],"pkg_loaded":[],"stamp":1}');
%! [s, ~, st] = __webpackage_source__ ("statistics", p);
%! assert (s, "shipped");
%! assert (st, "idle");
%! unlink (p);

%!test
## 装完了 ⇒ loaded/ok（随站那条路：pkg_loaded）
%! p = __wps_write__ ('{"pkg_available":["statistics"],"pkg_loaded":["statistics"],"stamp":1}');
%! [s, ~, st] = __webpackage_source__ ("statistics", p);
%! assert (s, "loaded");
%! assert (st, "ok");
%! unlink (p);

%!test
## 货架包 ⇒ shelf（点火走 install）
%! p = __wps_write__ ('{"pkg_available":[],"pkg_loaded":[],"catalog_state":"ok","catalog_packs":["optim","splines"],"stamp":1}');
%! [s, w, st] = __webpackage_source__ ("optim", p);
%! assert (s, "shelf");
%! assert (st, "idle");
%! assert (! isempty (strfind (w, "install")));
%! unlink (p);

%!test
## ★ 货架包装好了（以 'forge:<名>' 出现）⇒ loaded/ok —— **别只看 pkg_loaded**
%! p = __wps_write__ ('{"pkg_available":[],"pkg_loaded":[],"loaded":["forge:splines"],"catalog_state":"ok","catalog_packs":["splines"],"stamp":1}');
%! [s, ~, st] = __webpackage_source__ ("splines", p);
%! assert (s, "loaded");
%! assert (st, "ok");
%! unlink (p);

%!test
## ★ 反向：安装**失败**是终态（带原因）⇒ 调用方立刻停，不许干等 60 秒
%! p = __wps_write__ ('{"catalog_state":"ok","catalog_packs":["tsa"],"install_error":{"tsa":"包校验失败"},"stamp":1}');
%! [s, w, st] = __webpackage_source__ ("tsa", p);
%! assert (s, "shelf");
%! assert (st, "failed");
%! assert (! isempty (strfind (w, "包校验失败")));
%! unlink (p);

%!test
## ★ 反向：**随站**包装载失败 ⇒ 标签仍是 shipped（不许被错标成 shelf）
%! p = __wps_write__ ('{"pkg_available":["statistics"],"pkg_loaded":[],"catalog_state":"ok","catalog_packs":["tsa"],"install_error":{"statistics":"<script> 404"},"stamp":1}');
%! [s, w, st] = __webpackage_source__ ("statistics", p);
%! assert (s, "shipped");
%! assert (st, "failed");
%! assert (! isempty (strfind (w, "404")));
%! unlink (p);

%!test
## ★ 反向：货架**读成功**而查无此包 ⇒ miss（明确"没有"）
%! p = __wps_write__ ('{"pkg_available":[],"pkg_loaded":[],"catalog_state":"ok","catalog_packs":["splines"],"stamp":1}');
%! [s, ~, st] = __webpackage_source__ ("zzznope", p);
%! assert (s, "miss");
%! assert (st, "failed");
%! unlink (p);

%!test
## ★ 反向：货架**读失败** ⇒ unknown（不许说"没有" —— 假断言会误导用户）
%! p = __wps_write__ ('{"pkg_available":[],"pkg_loaded":[],"catalog_state":"fail","catalog_packs":[],"stamp":1}');
%! [s, w, ~] = __webpackage_source__ ("zzznope", p);
%! assert (s, "unknown");
%! assert (! isempty (strfind (w, "读不到")));
%! unlink (p);

%!test
## ★ 反向：货架**还没读过**（unread）⇒ unknown + **idle**（"还没问" ≠ "没有"）
##   state 必须是 idle：调用方据此点火去读货架、再重判（T4 两段式）。
##   第一版把 unread 与 fail 一起归成 failed ⇒ 货架路径**从来没被执行过**（验收 B1 红就是它）。
%! p = __wps_write__ ('{"pkg_available":[],"pkg_loaded":[],"catalog_state":"unread","catalog_packs":[],"stamp":1}');
%! [s, w, st] = __webpackage_source__ ("zzznope", p);
%! assert (s, "unknown");
%! assert (st, "idle");
%! assert (! isempty (strfind (w, "还没读")));
%! unlink (p);

%!test
## 带 `-` 的包名：install_error 的字段名被 jsondecode 归一化成 `_`，也要查得到
%! p = __wps_write__ ('{"catalog_state":"ok","catalog_packs":["a-b"],"install_error":{"a_b":"炸了"},"stamp":1}');
%! [s, w, st] = __webpackage_source__ ("a-b", p);
%! assert (s, "shelf");
%! assert (st, "failed");
%! assert (! isempty (strfind (w, "炸了")));
%! unlink (p);

%!test
## 空包名 ⇒ unknown，不抛错（调用方传了个空串时不许把 pkg 弄坏）
%! [s, ~, ~] = __webpackage_source__ ("", "/tmp/definitely-not-here-9d3f.json");
%! assert (s, "unknown");
