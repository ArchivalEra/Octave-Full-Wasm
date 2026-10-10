## Forge 按需安装 — **把已解包/已下载的包 tarball 装进包根**（own code, repo license）。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 它在哪条链上 ─────────────────────────────────────────────────────────────
## 客户端按需拉取的**安装步**（设计稿 `build/113/NOTES-forge-ondemand.md` §3）：
##
##   assets-loader.js 的 `install(name)`
##     └ fetch tarball（同源）→ sha256 校验 → 写 MEMFS
##        └ **本函数**（引擎侧）
##           ├ 引擎内建 `gunzip`（zlib）+ `untar`（ustar）解包   ← 不写 JS tar 解析器
##           ├ 按 **`pkg install` 的真实布局**落盘（见下）
##           └ `pkgfix` 重扫 → 核心 `pkg list/load` 看得见它
##
## ── 为什么是"布局复现"而不是"调核心 `pkg install`" ───────────────────────────
## T0 spike 实测（2026-10-09）：本构建下核心 `pkg('install', <tarball>)` **坏**
## （`dirlist(3): out of bound 2`，与 web `pkg.m` shim 的路径手术冲突）。
## 所以这一层必须自己把布局做对——**规则与 `build/assets.py bundle-pkg` 逐条一致**：
##   ① `inst/` 内容**上提**到包根（Octave 的 `install.m` copy_files 阶段就是这么干的）；
##   ② 元数据（`DESCRIPTION`/`INDEX`/`COPYING`/`NEWS`）落**包根**；
##   ③ `inst/` 里的 `PKG_ADD` 随之到包根（Octave 在 `addpath` 时会自己执行它）。
## ⇒ 两条实现（Python 打包 / 这里安装）**必须对拍**（验收套件里有断言）。
##
## ── 边界（如实）────────────────────────────────────────────────────────────
## · **纯 `.m` 包**：本函数全覆盖。
## · **带 `src/`**（可选加速件源码）：`.m` 部分照常装上；加速件要宿主预编 ⇒ 不在本函数范围。
## · **带预编译 `.oct`**（异架构）：拒绝安装（`error`），因为装上也是坏模块（设计稿 §6A）。
##
## 用法：`__forge_install__ (src, pkgname[, destroot])`
##   src      —— **两态**（依赖从外面来 ⇒ 可单测）：
##               · `.tar.gz` 路径 ⇒ 引擎内建 gunzip+untar 解包后装
##               · **已解开的目录** ⇒ 直接装（测试与"宿主预解包"两用）
##   pkgname  —— 包名（决定目标目录 <destroot>/<pkgname>）
##   destroot —— 包根（默认 /usr/src/octave/m/forge）
## 返回：装进去的文件数。

function n = __forge_install__ (src, pkgname, destroot)

  if (nargin < 2 || isempty (src) || isempty (pkgname))
    error ("__forge_install__: need (src, pkgname[, destroot])");
  endif
  if (nargin < 3 || isempty (destroot))
    destroot = "/usr/src/octave/m/forge";
  endif
  if (! ischar (src) || ( ! isfile (src) && ! isfolder (src)))
    error ("__forge_install__: src 既不是文件也不是目录: %s", src);
  endif

  stage = "";
  if (isfolder (src))
    root = src;                           ## 已解开的目录 ⇒ 直接当顶层用（测试/宿主预解包）
  else
    ## ── ① 解包：引擎内建 gunzip + untar（zlib / ustar；不写 JS 解析器）──────────
    stage = fullfile (tempdir (), ["forge-stage-" pkgname]);
    if (isfolder (stage))
      rmdir (stage, "s");
    endif
    mkdir (stage);
    gz = gunzip (src, stage);             ## → {<stage>/<base>.tar}
    if (isempty (gz))
      error ("__forge_install__: gunzip 没产出（%s）", src);
    endif
    xdir = fullfile (stage, "x");
    mkdir (xdir);
    untar (gz{1}, xdir);

    ## ── ② 找唯一的顶层目录（forge tarball 的形态：<name>-<version>/）─────────
    d = dir (xdir);
    tops = {};
    for k = 1:numel (d)
      if (d(k).isdir && d(k).name(1) != ".")
        tops{end+1} = fullfile (xdir, d(k).name);
      endif
    endfor
    if (isempty (tops))
      error ("__forge_install__: tarball 里没有顶层目录（不是包 tarball？）");
    endif
    if (numel (tops) > 1)
      ## 多顶层：优先选与包名同前缀的那个（statistics-release-1.7.3 这类也能选中）
      pick = "";
      for k = 1:numel (tops)
        [~, nm] = fileparts (tops{k});
        if (strncmpi (nm, pkgname, numel (pkgname)))
          pick = tops{k};
          break;
        endif
      endfor
      if (isempty (pick))
        error ("__forge_install__: tarball 有多个顶层目录且都与包名无关");
      endif
      root = pick;
    else
      root = tops{1};
    endif
  endif

  pkgdir = fullfile (destroot, pkgname);

  ## ── ③ 布局：`inst/` 上提（与 Octave install.m 的 copy_files 同规则）──────────
  if (isfolder (pkgdir))
    rmdir (pkgdir, "s");
  endif
  if (mkdir (pkgdir) == 0 && ! isfolder (pkgdir))
    error ("__forge_install__: 建不了包根 %s（destroot 在不在？）", pkgdir);
  endif
  inst = fullfile (root, "inst");
  srcdir = root;
  if (isfolder (inst))
    srcdir = inst;                          ## 「上提」：从 inst/ 内部拷到包根
  endif
  n = copy_tree (srcdir, pkgdir);

  ## 元数据永远从**顶层目录**取（它们不在 inst/ 里）
  for meta = {"DESCRIPTION", "INDEX", "COPYING", "NEWS"}
    f = fullfile (root, meta{1});
    if (isfile (f))
      copyfile (f, pkgdir, "f");
    endif
  endfor

  ## ── ④ 拒绝异架构预编译件（装上也是坏模块，宁可明确报）──────────────────────
  ## ⚠️ 用**显式递归**而不是 `dir(**/*.oct)`：recursive glob 在 wasm 构建里不可靠
  ##    （宿主有、浏览器里没有 —— 实测：同样调用返回 0 条 ⇒ 反向断言静默失效）。
  octs = find_oct (pkgdir);
  if (! isempty (octs))
    rmdir (pkgdir, "s");
    error (["__forge_install__: 包 %s 带预编译 .oct（异架构）——本构建里必须重编；"
            "按需安装只支持纯 .m 包（设计稿 §6A）。首个：%s"], pkgname, octs{1});
  endif

  if (! isempty (stage) && isfolder (stage))
    rmdir (stage, "s");
  endif
endfunction


## 递归找 *.oct（显式走树；recursive glob 在 wasm 里不可靠，见调用点注释）。
function out = find_oct (dir_)
  out = {};
  entries = dir (dir_);
  for k = 1:numel (entries)
    e = entries(k);
    if (strcmp (e.name, ".") || strcmp (e.name, ".."))
      continue;
    endif
    p = fullfile (dir_, e.name);
    if (e.isdir)
      out = [out, find_oct(p)];
    elseif (numel (e.name) > 4 && strcmpi (e.name(end-3:end), ".oct"))
      out{end+1} = p;
    endif
  endfor
endfunction


## 递归拷贝（copyfile 的目录形态在各版本行为不完全一致，这里显式走树）。
function n = copy_tree (src, dst)
  n = 0;
  entries = dir (src);
  for k = 1:numel (entries)
    e = entries(k);
    if (strcmp (e.name, ".") || strcmp (e.name, ".."))
      continue;
    endif
    s = fullfile (src, e.name);
    t = fullfile (dst, e.name);
    if (e.isdir)
      if (! isfolder (t))
        mkdir (t);
      endif
      n += copy_tree (s, t);
    else
      copyfile (s, t, "f");
      n += 1;
    endif
  endfor
endfunction


%!test
## 纯 .m 包：inst/ 上提 + 元数据落包根（对拍 bundle-pkg 的布局）
%! ## ⚠️ 用**目录形态**喂它（依赖从外面来 ⇒ 这个函数能单测；tarball 那一支在浏览器验收里跑）
%! src = tempname (); mkdir (src);
%! root = fullfile (src, "demo-1.0.0"); mkdir (root);
%! mkdir (fullfile (root, "inst"));
%! fid = fopen (fullfile (root, "inst", "demo_hello.m"), "w");
%! fputs (fid, "function y = demo_hello (x)\n  y = x;\nendfunction\n"); fclose (fid);
%! fid = fopen (fullfile (root, "DESCRIPTION"), "w"); fputs (fid, "Name: demo\n"); fclose (fid);
%! fid = fopen (fullfile (root, "inst", "PKG_ADD"), "w"); fputs (fid, "## x\n"); fclose (fid);
%! dest = fullfile (src, "dest"); mkdir (dest);
%! n = __forge_install__ (root, "demo", dest);
%! assert (n > 0);
%! assert (isfile (fullfile (dest, "demo", "demo_hello.m")));   ## inst/ 已上提
%! assert (isfile (fullfile (dest, "demo", "PKG_ADD")));
%! assert (isfile (fullfile (dest, "demo", "DESCRIPTION")));    ## 元数据落包根

%!error <need .tarball, pkgname> __forge_install__ ()
%!error <不是文件也不是目录> __forge_install__ ("/definitely/missing/path", "x", tempdir ())

%!test
## ★ 反向断言：带预编译 .oct 的包**必须被拒绝**（不是装上再说）
%! src = tempname (); mkdir (src);
%! root = fullfile (src, "bad-1.0"); mkdir (root); mkdir (fullfile (root, "inst"));
%! fid = fopen (fullfile (root, "inst", "m.oct"), "w"); fputs (fid, "junk"); fclose (fid);
%! dest = fullfile (src, "d2"); mkdir (dest);
%! caught = false;
%! try
%!   __forge_install__ (root, "bad", dest);
%! catch err
%!   caught = ! isempty (strfind (err.message, "预编译"));
%! end_try_catch
%! assert (caught, true);
%! ## 而且**不许留下半装的包根**（拒绝就要拒绝干净）
%! assert (! isfolder (fullfile (dest, "bad")));
