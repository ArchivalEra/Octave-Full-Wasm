## Octave-Full-Wasm — rename 的安全包装（纯 .m）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal helper for the wasm `movefile` override.

## Attempt @code{rename (src, dst)}, reporting failure as a value.
##
## `rename` is a real in-process primitive in this build, but it raises rather
## than returning a status, and movefile needs to try it and *decide* whether to
## fall back to copy+unlink.  An exception cannot be inspected for "was this a
## cross-device link or a missing directory?", so catching it and reporting a
## plain failure keeps the decision in the caller where the fallback lives.

function [ok, msg] = __wf_try_rename__ (src, dst)

  ok = false;
  msg = "";

  ddir = fileparts (dst);
  if (! isempty (ddir) && ! isfolder (ddir))
    mkdir (ddir);
  endif

  try
    rename (src, dst);
    ok = true;
  catch err
    ok = false;
    msg = err.message;
  end_try_catch

endfunction


%!test
%! d = tempname (); mkdir (d);
%! a = fullfile (d, "a.txt");
%! fid = fopen (a, "w"); fputs (fid, "x"); fclose (fid);
%! [ok, msg] = __wf_try_rename__ (a, fullfile (d, "b.txt"));
%! assert (ok, true);
%! assert (msg, "");

%!test
%! ## A rename that cannot work reports failure instead of raising, so the
%! ## caller can fall back.
%! [ok, msg] = __wf_try_rename__ ("/no/such/file", "/tmp/never.txt");
%! assert (ok, false);
%! assert (! isempty (msg));
