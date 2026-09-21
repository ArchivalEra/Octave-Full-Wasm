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

function b = __pkgfix_basename__ (p)

  if (! ischar (p))
    error ("__pkgfix_basename__: P must be a string");
  endif

  p = regexprep (p, '[\\/]+$', '');
  if (isempty (p))
    b = "";
    return;
  endif

  idx = find (p == "/" | p == "\\");
  if (isempty (idx))
    b = p;
  else
    b = p(idx(end) + 1:end);
    if (isempty (b) && numel (p) == 1)
      b = p;
    endif
  endif

endfunction


%!test
%! assert (__pkgfix_basename__ ("/usr/src/octave/m/forge/statistics"), "statistics");
%! assert (__pkgfix_basename__ ("/a/b/"), "b");
%! assert (__pkgfix_basename__ ("plain"), "plain");
