## Forge 源码取件 — **解包 tarball 到工作目录 + 列出文件清单**（own code, repo license）。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 它在哪条链上 ─────────────────────────────────────────────────────────────
## B 线（浏览器内自编 .oct）：assets-loader.js 的 `compileExtension(name)`
##   └ fetch 源码 tarball（同源，sha 已在 JS 侧核过）→ 写 MEMFS
##      └ **本函数**（引擎侧）：gunzip+untar 解包 + 写文件清单
##         → JS 侧读回清单，把 src/*.cc 逐个读出喂编译 Worker
##
## 与 `__forge_install__.m` 的分工：那边做**安装布局**（pkg install 复现）；
## 这边只做**取件**（解到工作目录 + 列名字），不做任何安装动作。
##
## 用法（JS 侧，见 compileExtension）：
##   rc = eval_string("__forge_src_list__('<tar.gz>', '<destdir>'[, flat])")
##   rc == 0 ⇒ 清单在 `<destdir>.files`（相对路径一行一个）
##   flat == true ⇒ 解包后把**顶层目录剥掉一层**（头 tar 的 ./include/... → include/...），
##   让 `-I/src/octinc` 直接指到头根（供给脚本打头 tar 时就剥好了，此处保持对称可选）。
##
## 返回：0 = 成功；非 0 = 失败（错误已 error()，JS 侧读 last_error_message）。

function rc = __forge_src_list__ (src, destdir, flat)
  if (nargin < 3)
    flat = false;
  endif
  if (! exist (src, "file"))
    error ("__forge_src_list__: tarball 不在：%s", src);
  endif
  stage = fileparts (destdir);
  if (isempty (stage))
    stage = ".";
  endif
  if (! exist (destdir, "dir"))
    mkdir (destdir);
  endif

  ## gunzip → .tar（引擎内建 zlib；与 __forge_install__ 同款）
  gz = gunzip (src, stage);
  if (isempty (gz) || ! exist (gz{1}, "file"))
    error ("__forge_src_list__: gunzip 没产出（%s）", src);
  endif

  ## untar → destdir（引擎内建 ustar）
  untar (gz{1}, destdir);

  ## flat：剥顶层目录（把唯一子目录的内容上提一层）
  if (flat)
    d = dir (destdir);
    subs = {};
    for i = 1:numel (d)
      if (d(i).isdir && ! any (strcmp (d(i).name, {".", ".."})))
        subs{end + 1} = d(i).name;
      endif
    endfor
    if (numel (subs) == 1)
      inner = fullfile (destdir, subs{1});
      [st, msg] = movefile (fullfile (inner, "*"), destdir);
      if (st)
        rmdir (inner, "s");
      endif
    endif
  endif

  ## 清单：destdir 下所有文件（相对路径，一行一个）
  lst = "";
  files = __recursive_list__ (destdir, destdir);
  for i = 1:numel (files)
    lst = [lst, files{i}, "\n"];
  endfor
  fid = fopen ([destdir, ".files"], "w");
  if (fid < 0)
    error ("__forge_src_list__: 写不了清单 %s.files", destdir);
  endif
  fputs (fid, lst);
  fclose (fid);
  rc = 0;
endfunction

## 递归列文件（相对 root 的路径）—— pkg 树里没有现成的，最小实现。
function files = __recursive_list__ (root, base)
  files = {};
  d = dir (base);
  for i = 1:numel (d)
    nm = d(i).name;
    if (any (strcmp (nm, {".", ".."})))
      continue;
    endif
    p = fullfile (base, nm);
    rel = p(length (root) + 2 : end);
    if (d(i).isdir)
      sub = __recursive_list__ (root, p);
      files = {files{:}, sub{:}};
    else
      files{end + 1} = rel;
    endif
  endfor
endfunction
