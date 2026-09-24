## popen: 无 shell 的构建里**起不了子进程** —— 本文件把静默的 `-1` 变成清晰报错。
## （用法与内建一致：`fid = popen (command, mode)`）
##
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么覆写（2026-09-24，外部审核的 R1 方案）：POSIX 的 `popen` 失败就是返回空指针，
## 而 Octave 的解释器层把它变形成 `fid = -1` ⇒ "起不了子进程"这件事**一声不响**，
## 与本项目"能做对就做对、做不了明确报错"的政策相悖（§5.24）。
##
## 关键性质：**覆写只影响解释器的名字解析**。Octave 自己的 C++ 代码直接调
## `octave::popen()`（`libinterp/corefcn/oct-prcstrm.cc`），不会被这个 `.m` 拦到 ——
## 所以这是"给用户一个清晰报错"，不是"全局禁掉 popen"。
##
## 实测（2026-09-24，8768）：load path 里的 `.m` **确实遮得住内建** ——
## `which("popen")` 指向本文件、调用落到本文件，启动时带一条
## `warning: function …/popen.m shadows a built-in function`（**有意保留**，
## 它如实说明了"这个内建被覆写了"）。
##
## 核内唯一的 `popen` 调用者是 `plot/util/private/__gnuplot_open_stream__.m`
## （gnuplot 那条路在本构建里不可达），覆写后它由"fid=-1 后继续"变成清晰报错。

function fid = popen (command, mode)

  if (nargin != 2)
    print_usage ();
  endif

  fid = builtin ("popen", command, mode);

  if (isequal (fid, -1))
    error ("popen: unable to start subprocess for '%s' (this build has no shell)",
           command);
  endif

endfunction
