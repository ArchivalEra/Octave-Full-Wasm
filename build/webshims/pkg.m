## Octave-Full-Wasm — `pkg` 网页版 shim：`pkg load <未装载的包>` 自动装载（D6，2026-09-25）
##
## 网页版的包管理器是**页面资产装载器**（OctaveAssets）——包文件由它 fetch + 写盘 + addpath，
## 核心 `pkg.m` 的数据库由 pkgfix 从磁盘现状生成。缺口只有一个：
## 用户敲 `pkg load <名>` 时，那个包可能**还没装载**（不在磁盘 ⇒ 数据库里没有 ⇒ 核心报
## "package not installed"）。
##
## 本 shim 只拦这一种情形：
##   · 包在清单里但未装载 ⇒ 触发页面装载（emscripten_run_script 起跑）+ `pause` 轮询等落盘，
##     然后委托核心 `pkg.m` 走官方路径（数据库此时已能看到它）；
##   · 其余一切 pkg 命令 ⇒ **路径手术委托核心**（把本 shim 目录临时摘掉，跑完恢复）。
##
## ⚠️ 轮询的 `__web_pause_ms__` 需要挂起能力 ⇒ `pkg load` 与 `pause` 同一架构规则：
##    **走 eval_async**。同步入口上碰到未装载包会以 SuspendError 拒绝（可挂起命令的信号）。
## SPDX-License-Identifier: AGPL-3.0-or-later

function varargout = pkg (varargin)

  if (nargin >= 2 && strcmpi (varargin{1}, 'load') && __web_suspend_ok__ ())
    pend = __webassets_pending__ ();
    for k = 2:nargin
      nm = '';
      if (ischar (varargin{k}))
        nm = varargin{k};
      elseif (iscell (varargin{k}) && ! isempty (varargin{k}) && ischar (varargin{k}{1}))
        nm = varargin{k}{1};     # pkg load {\"statistics\"} 这类 cell 形式
      endif
      if (! isempty (nm) && any (strcmp (nm, pend)))
        __web_run_js__ (sprintf ("OctaveAssets.load('%s');", nm));
        tries = 0;
        while (any (strcmp (nm, __webassets_pending__ ())) && tries < 600)
          __web_pause_ms__ (100);   # 让出等页面 fetch + 写盘（60 s 上限）
          tries += 1;
        endwhile
      endif
    endfor
  endif

  ## 委托核心 pkg.m：路径手术（摘掉本 shim 所在目录 ⇒ pkg 解析到核心实现）
  wdir = fileparts (mfilename ('fullpath'));
  oldp = path ();
  path (strrep (strrep (oldp, [wdir ':'], ''), [':' wdir], ''));
  newp = oldp;                          # ★ 核心抛错时 cleanup 也有值（实测踩过：undefined 吞掉原错误）
  unwind_protect
    if (nargout > 0)
      [varargout{1:nargout}] = pkg (varargin{:});
    else
      pkg (varargin{:});
    endif
    newp = path ();
  unwind_protect_cleanup
    path (oldp);                        # 恢复原路径（含本 shim）
    ## 核心新加进来的目录（如 pkg load 的包目录）按原顺序补回
    adddirs = setdiff (strsplit (newp, ':'), strsplit (oldp, ':'), 'stable');
    for k2 = numel (adddirs):-1:1       # addpath 前置 ⇒ 逆序遍历保持核心的顺序
      addpath (adddirs{k2});
    endfor
  end_unwind_protect

endfunction
