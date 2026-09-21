## Octave-Full-Wasm — pkg 数据库路径（纯 .m）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal function for the wasm pkg integration.

## Return the path `pkg` uses for the *local* package database.
##
## This must match `pkg.m`'s own computation exactly, or the database lands in a
## file `pkg` never reads and the whole exercise is silent.  Upstream `pkg.m`
## (lines 420-422) builds it as:
##
##     fullfile (user_config_dir (), "octave", ...
##               __octave_config_info__ ("api_version"), "octave_packages")
##
## Note there is **no leading dot** on the filename in 7.2 (the `~/.octave_packages`
## spelling appears only in `pkg`'s own documentation example for the
## `local_list` setter).  Recomputing it here rather than hardcoding means a
## future Octave version that changes either component still writes the right
## file.

function p = __pkgfix_local_list__ ()

  p = fullfile (user_config_dir (), "octave", ...
                __octave_config_info__ ("api_version"), "octave_packages");

endfunction


%!test
%! ## The path must be absolute and end in octave_packages, under user_config_dir.
%! p = __pkgfix_local_list__ ();
%! assert (ischar (p));
%! assert (p(1), "/");
%! assert (! isempty (strfind (p, user_config_dir ())));
%! assert (strcmp (__pkgfix_basename__ (p), "octave_packages"));
