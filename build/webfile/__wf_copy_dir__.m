## Octave-Full-Wasm — 递归目录复制（纯 .m，无 shell）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal helper for the wasm `copyfile` override.

## Copy directory @var{src} into @var{dst} recursively.
##
## Returns @code{[ok, msg]} where @var{ok} is a logical scalar and @var{msg} is
## empty on success.
##
## Semantics follow `cp -r src dst`:
##   * if @var{dst} does not exist, it is created and receives *src's contents*
##   * if @var{dst} exists, a subdirectory named after @var{src}'s basename is
##     created inside it and receives the contents
##
## Implemented on top of `dir`/`mkdir`/`fopen`, all of which work in this build.

function [ok, msg] = __wf_copy_dir__ (src, dst)

  ok = true;
  msg = "";

  if (! isfolder (src))
    ok = false;
    msg = sprintf ("%s is not a directory", src);
    return;
  endif

  ## `cp -r a b` puts the *contents* of a into b when b is absent, but nests
  ## them under b/a when b exists.  Determine which this is before creating
  ## anything, or the decision gets made twice with different answers.
  if (isfolder (dst))
    target = fullfile (dst, __wf_basename__ (src));
  else
    target = dst;
  endif

  [mk_ok, mk_msg] = mkdir (target);
  if (! mk_ok && ! isfolder (target))
    ok = false;
    msg = mk_msg;
    return;
  endif

  entries = dir (src);
  for k = 1:numel (entries)
    name = entries(k).name;
    ## `.`/`..` are synthesized by dir(); recursing into them would loop
    ## forever (and `..` escapes the tree, which is worse).
    if (strcmp (name, ".") || strcmp (name, ".."))
      continue;
    endif
    s = fullfile (src, name);
    d = fullfile (target, name);
    if (isfolder (s))
      [ok, msg] = __wf_copy_dir__ (s, d);
      if (! ok)
        return;
      endif
    else
      [ok, msg] = __wf_copy_file__ (s, d);
      if (! ok)
        return;
      endif
    endif
  endfor

endfunction


%!test
%! ## Contents land in the new directory when the destination is absent...
%! base = tempname ();
%! mkdir (fullfile (base, "src", "sub"));
%! fid = fopen (fullfile (base, "src", "a.txt"), "w"); fputs (fid, "A"); fclose (fid);
%! fid = fopen (fullfile (base, "src", "sub", "b.txt"), "w"); fputs (fid, "B"); fclose (fid);
%! [ok, msg] = __wf_copy_dir__ (fullfile (base, "src"), fullfile (base, "dst"));
%! assert (ok, true);
%! assert (msg, "");
%! ## ...and nesting happens when it exists (cp -r behaviour).
%! [ok2, ~] = __wf_copy_dir__ (fullfile (base, "src"), fullfile (base, "dst2"));
%! assert (ok2, true);
%! [ok3, ~] = __wf_copy_dir__ (fullfile (base, "src"), fullfile (base, "dst2"));
%! assert (ok3, true);
