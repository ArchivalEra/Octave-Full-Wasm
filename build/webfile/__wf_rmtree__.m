## Octave-Full-Wasm — 递归删除（纯 .m，无 shell）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal helper for the wasm file-operation overrides.

## Remove @var{p}, recursing when it is a directory.
##
## Returns @code{[ok, msg]}.
##
## Octave's own `unlink` removes **files only** -- it fails on a directory with
## "operation failed: is a directory" even when the directory is empty, so
## emptying a tree needs `rmdir` for the directory nodes.  (This was the first
## version's bug: `unlink` everywhere meant every directory removal failed.)
##
## The recursion is depth-first: children are removed before their parent, which
## is the only order that works.
##
## A missing path is treated as success.  Every caller here uses this to clean
## up *after* confirming the new copy exists, and failing at that point would
## report an error for a move that actually succeeded.

function [ok, msg] = __wf_rmtree__ (p)

  ok = false;
  msg = "";

  if (! exist (p, "file") && ! isfolder (p))
    ok = true;
    return;
  endif

  if (! isfolder (p))
    try
      unlink (p);
      ok = true;
    catch err
      msg = err.message;
    end_try_catch
    return;
  endif

  entries = dir (p);
  for k = 1:numel (entries)
    name = entries(k).name;
    if (strcmp (name, ".") || strcmp (name, ".."))
      continue;
    endif
    [cok, cm] = __wf_rmtree__ (fullfile (p, name));
    if (! cok)
      msg = cm;
      return;
    endif
  endfor

  try
    rmdir (p);
    ok = true;
  catch err
    msg = err.message;
  end_try_catch

endfunction


%!test
%! d = tempname (); mkdir (fullfile (d, "t", "sub"));
%! fid = fopen (fullfile (d, "t", "a.txt"), "w"); fputs (fid, "a"); fclose (fid);
%! fid = fopen (fullfile (d, "t", "sub", "b.txt"), "w"); fputs (fid, "b"); fclose (fid);
%! [ok, msg] = __wf_rmtree__ (fullfile (d, "t"));
%! assert (ok, true);
%! assert (msg, "");
%! assert (isfolder (fullfile (d, "t")), false);

%!test
%! ## Single file.
%! p = tempname ();
%! fid = fopen (p, "w"); fputs (fid, "x"); fclose (fid);
%! [ok, ~] = __wf_rmtree__ (p);
%! assert (ok, true);
%! assert (exist (p, "file"), 0);

%!test
%! ## Already gone is success, not failure (callers clean up after the fact).
%! [ok, msg] = __wf_rmtree__ ("/definitely/not/here");
%! assert (ok, true);
%! assert (msg, "");
