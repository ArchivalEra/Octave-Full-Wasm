## system: 无 shell 的构建里**起不了子进程** —— 本文件把静默的 `-1` 变成清晰报错。
## （用法与内建一致：`[status, output] = system (command, [return_output, [type]])`）
##
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 上游语义（`libinterp/corefcn/toplev.cc` 的 `DEFUN (system)`，逐行核过）：
##   · `return_output = (nargin == 1 && nargout > 1)`（或第 2 参显式给 true）；
##     为真时走 `run_command_and_return_output()` ⇒ `popen` 起不来就
##     `error ("system: unable to start subprocess for '%s'")` —— **本来就清晰**；
##   · 为假时走 `sys::system()`，返回 waitpid 状态 —— 无 shell 的构建里是 **-1**，
##     于是 `st = system("ls")` 静默拿到 -1、`system("ls")`（无输出参数）静默通过。
##
## 本文件**只补后一种**：返回值是 -1 就抛错；其余形态（含 nargin/nargout 的怪组合、
## 显式 `false` 的第 2 参）一律原样透传给内建 —— 连"两输出但 return_output=false"会报
## `element number 2 undefined in return list` 这种上游怪癖都保持不变（宿主 11.3.0 实测同）。
##
## 有意**不**覆写 `unix`：核心的 `unix.m` 内部就是两输出调 `system` ⇒ 一向清晰报错
## （实测 `[st,out]=unix("pwd")` 报同一条信息）。`dos`/`perl`/`python` 那类包在 system
## 外面的 `.m` 也会因此拿到同一条清晰报错 —— 这正是要的效果。

function [status, output] = system (command, varargin)

  if (nargin < 1 || nargin > 3)
    print_usage ();
  endif

  ## ★ 浏览器 Python 桥（2026-10-15，symbolic 的 IPC 缝）——**零补丁接缝**。
  ##   为什么拦在这里：`python_ipc_system.m`（包内 private/）真跑时调的是**全局名**
  ##   `system`，而包的 private/ 里**没有** `system.m` ⇒ 那个调用落到本 shim（实测：
  ##   path 级函数遮不住 private/，但 private/ 里的**全局名调用**会被 path 级遮蔽拦到）。
  ##   ⇒ 包的 401 个 `.m` 一行不改，编组/错误/类型转换全留在上游。
  ##   ⚠️ nargout 几都要拦（上游调的是两输出形态 `[status,out] = system(...)`）。
  ##   ⚠️ 数据通道 = **MEMFS 文件**（源码进 / stdout 出）：`__web_run_js__` 只能传 JS 串、
  ##      拿不回返回值（`emscripten_run_script` 是 void）⇒ 输出必须落盘再读。
  ##      选它而不新增 `.oct`/JS 库函数的理由（删掉模块看看复杂度去哪）：本路径
  ##      **零重链、零重编**，复用的全是既有原语。
  [is_py, code] = __webshim_python_cmd__ (command);
  if (is_py)
    if (exist ("__web_run_js__") != 3)
      error ("system: 本构建没有 shell，也没有 Python 桥（__web_run_js__ 不在）");
    endif
    src = [tempname() '_octpy_src.py'];
    out = [tempname() '_octpy_out.txt'];
    unwind_protect
      fid = fopen (src, 'w');
      if (fid < 0)
        error ("system: 写不进 Python 源码临时文件 %s", src);
      endif
      fputs (fid, code);
      fclose (fid);
      ## 点火：页面侧读 src、跑 Pyodide、把 stdout 写进 out（**同步**，见 octave-core.js）
      __web_run_js__ (sprintf ("__octaveRunPython('%s', '%s');", src, out));
      fid = fopen (out, 'r');
      if (fid < 0)
        error (["system: Python 桥没有产出输出文件 ⇒ 运行时可能不在", ...
                "（先装载能力层：OctaveAssets.install('symbolic') 会连带拉起 Pyodide）"]);
      endif
      output = fread (fid, Inf, '*char')';
      fclose (fid);
      if (strcmp (output, '__OCTAVE_PY_NO_RUNTIME__'))
        error (["system: 符号计算需要 Python 运行时（Pyodide 未就绪）—— ", ...
                "先在页面里装载能力层（OctaveAssets.install('symbolic')）"]);
      endif
      status = 0;
    unwind_protect_cleanup
      ## 清理时不要因为文件不存在而报错（unlink 失败静默）
      try; unlink (src); catch; end_try_catch
      try; unlink (out); catch; end_try_catch
    end_unwind_protect
    return;
  endif

  if (nargout > 1)
    ## 两输出形态：内建自己会走 popen 那条路，失败时**已经**清晰报错 ⇒ 原样透传
    [status, output] = builtin ("system", command, varargin{:});
  else
    status = builtin ("system", command, varargin{:});
    if (isequal (status, -1))
      error ("system: unable to start subprocess for '%s' (this build has no shell)",
             command);
    endif
    output = "";
  endif

endfunction
