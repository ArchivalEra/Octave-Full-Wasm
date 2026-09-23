## plot 桥：现在是否**正处于核心调用中**（own code, repo license）。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## `__pb_core__` 在替核心实现跑那段期间会把深度 +1。**每一个挡住核心名字的桥 shim 开头**
## 都有一句 `if (__pb_in_core__ ())` → 转发给核心句柄，用来复现旧"把桥目录整条从 path
## 上摘掉"的语义（核心内部会按名字调被它挡住的函数：`__pie__`/`__contour__` 调 `axis(h,…)`、
## `__plt__`/`__errplot__` 调 `legend(gca(),…)`）。
##
## 细节与为什么必须这样，见 `__pb_core__.m` 的文件头。
##
## 用法（只在桥的 shim 里）：
##     if (__pb_in_core__ ())
##       …转发给 __pb_core__(…)，然后 return…
##     endif

function tf = __pb_in_core__ ()

  tf = __pb_core__ ("--depth") > 0;

endfunction
