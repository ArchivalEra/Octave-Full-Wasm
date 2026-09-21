## Octave-Full-Wasm — 列目录（纯 .m，无 shell）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal helper for the wasm `ls` override.

## Return the names inside directory @var{d} as a cell array of strings.
##
## Wraps `dir` and drops the synthesized "." and ".." entries, which is what
## `ls` shows.  Names are returned bare (not full paths), matching both `ls`
## and `dir`.

function names = __wf_list_dir__ (d)

  names = {};
  if (! isfolder (d))
    return;
  endif

  entries = dir (d);
  for k = 1:numel (entries)
    n = entries(k).name;
    if (strcmp (n, ".") || strcmp (n, ".."))
      continue;
    endif
    names{end+1} = n;
  endfor

endfunction


%!test
%! d = tempname (); mkdir (d);
%! fid = fopen (fullfile (d, "a.txt"), "w"); fputs (fid, "a"); fclose (fid);
%! mkdir (fullfile (d, "sub"));
%! n = __wf_list_dir__ (d);
%! assert (any (strcmp (n, "a.txt")), true);
%! assert (any (strcmp (n, "sub")), true);
%! assert (any (strcmp (n, ".")), false);
%! assert (any (strcmp (n, "..")), false);

%!test
%! ## A path that is not a directory yields nothing instead of erroring.
%! assert (__wf_list_dir__ ("/no/such/dir"), {});
