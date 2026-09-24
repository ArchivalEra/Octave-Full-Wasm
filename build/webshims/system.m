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
