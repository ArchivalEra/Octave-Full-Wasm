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
## Returns "" when @var{p} has no components (e.g. "/" or "").

function b = __wf_basename__ (p)

  if (! ischar (p))
    error ("__wf_basename__: P must be a string");
  endif

  ## Strip trailing separators, but keep a leading "/" from becoming empty.
  p = regexprep (p, '[\\/]+$', '');
  if (isempty (p))
    b = "";
    return;
  endif

  ## Everything after the last separator.  NOTE: the Windows separator has to
  ## be written as "\\" -- a bare "\" is an unterminated string literal, and
  ## Octave reports that as a syntax error on this line.
  idx = find (p == "/" | p == "\\");
  if (isempty (idx))
    b = p;
  else
    b = p(idx(end) + 1:end);
    ## A path that is nothing but a leading "/" leaves an empty tail; report
    ## the root as "/" rather than "" so callers can detect it.
    if (isempty (b) && numel (p) == 1)
      b = p;
    endif
  endif

endfunction


%!test
%! assert (__wf_basename__ ("a/b/c.txt"), "c.txt");
%! assert (__wf_basename__ ("a/b/"), "b");
%! assert (__wf_basename__ ("a/b///"), "b");
%! assert (__wf_basename__ ("plain"), "plain");
%! assert (__wf_basename__ ("/"), "/");
%! assert (__wf_basename__ (""), "");
