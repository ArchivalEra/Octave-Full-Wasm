## Octave-Full-Wasm — 网页版 `keyboard`：**一层**调试 REPL（G5 v1，实验性）
##
## 真正的 keyboard 需要"把控制权交给调试器、检查调用者帧"——网页版 v1 用
## input()（window.prompt）+ evalin("caller", …) 提供一层等价物：
##   · 能读/改调用者工作区的变量、画图、看 help；
##   · 输入 return / dbquit / quit / exit 返回；
## ## 不支持：递归 keyboard（红线）、dbstop/dbclear/dbstep、断点列表。
## SPDX-License-Identifier: AGPL-3.0-or-later

function keyboard (varargin)
  if (! __web_suspend_ok__ ())
    error ("keyboard: 本浏览器不支持 JSPI 的挂起能力（需要 Chromium 137+ 等）");
  endif

  disp ("keyboard: 进入一层调试（网页版实验实现）。输入 return / dbquit 退出。");
  while (true)
    line = input ("debug> ", "s");
    if (any (strcmpi (strtrim (line), {"return", "dbquit", "quit", "exit"})))
      return;
    endif
    if (! isempty (strtrim (line)))
      evalin ("caller", line);
    endif
  endwhile
endfunction
