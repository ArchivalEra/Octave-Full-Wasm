## Octave-Full-Wasm — 取路径的最后一段（纯 .m，无 shell）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal helper for the wasm file-operation overrides.

## Return the final component of path @var{p}, ignoring a trailing separator.
##
## `fileparts` is not enough on its own: it treats a trailing separator as
## ending an empty component, so `fileparts("a/b/")` does not yield "b" the way
## a shell's `basename` would.  The file operations here need shell basename
## semantics because they are replacing shell commands.
##
## Returns the separator itself when @var{p} is nothing but separators
## (POSIX: `basename /` is `/`), and `""` only for an empty input.
##
## ⚠️ 2026-09-23：这两个边界以前是**自相矛盾**的 —— 文档说 `"/"` 返回 `""`，
##    而下面又有一段想返回 `"/"` 的分支，那段永远走不到（末尾分隔符在它之前就被
##    正则剥掉了）。是本文件的 `%!test` 一接进验收（`.githooks` 那套"文件自带断言"
##    终于有人跑）把它抓出来的。

function b = __wf_basename__ (p)

  if (! ischar (p))
    error ("__wf_basename__: P must be a string");
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

  ## Everything after the last separator.  NOTE: the Windows separator has to
  ## be written as "\\" -- a bare "\" is an unterminated string literal, and
  ## Octave reports that as a syntax error on this line.
  idx = find (q == "/" | q == "\\");
  if (isempty (idx))
    b = q;
  else
    b = q(idx(end) + 1:end);
  endif

endfunction


%!test
%! assert (__wf_basename__ ("a/b/c.txt"), "c.txt");
%! assert (__wf_basename__ ("a/b/"), "b");
%! assert (__wf_basename__ ("a/b///"), "b");
%! assert (__wf_basename__ ("plain"), "plain");
%! assert (__wf_basename__ ("/"), "/");
%! assert (__wf_basename__ (""), "");
