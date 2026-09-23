## Octave-Full-Wasm — 取路径末段（纯 .m）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal function for the wasm pkg integration.

## Final path component of @var{p}, ignoring a trailing separator.
##
## `fileparts` is not equivalent: it treats a trailing separator as ending an
## empty component, so it does not give shell `basename` semantics.  The pkg
## helpers compare against directory names that may or may not carry a trailing
## slash depending on who supplied them.
##
## ⚠️ 这份与 `build/webfile/__wf_basename__.m` 是**同型的两份**（不是共享实现：
##    `webfile` 与 `pkgfix` 是两个独立资产包，互相依赖会把装载顺序耦合起来）。
##    2026-09-23 两份在 `"/"` 这个边界上都自相矛盾（文档说返回 "" ，下面又有一段
##    想返回 "/" 的死分支），是 `__wf_basename__` 的 `%!test` 被真正跑起来后暴露的；
##    这里同步修正并补上那条断言，免得这对孪生再各走各的。

function b = __pkgfix_basename__ (p)

  if (! ischar (p))
    error ("__pkgfix_basename__: P must be a string");
  endif

  if (isempty (p))
    b = "";
    return;
  endif

  ## Strip trailing separators: "a/b/" → "a/b"，"///" → ""
  q = regexprep (p, '[\\/]+$', '');
  if (isempty (q))
    ## 只有分隔符 ⇒ 根：回那个分隔符本身（POSIX `basename /` = `/`）
    b = p(end);
    return;
  endif

  idx = find (q == "/" | q == "\\");
  if (isempty (idx))
    b = q;
  else
    b = q(idx(end) + 1:end);
  endif

endfunction


%!test
%! assert (__pkgfix_basename__ ("/usr/src/octave/m/forge/statistics"), "statistics");
%! assert (__pkgfix_basename__ ("/a/b/"), "b");
%! assert (__pkgfix_basename__ ("plain"), "plain");
%! ## 与 __wf_basename__ 保持同一边界语义（POSIX `basename /` = `/`）
%! assert (__pkgfix_basename__ ("/"), "/");
%! assert (__pkgfix_basename__ (""), "");

