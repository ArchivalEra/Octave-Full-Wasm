## Octave-Full-Wasm — 包挂载根目录（纯 .m）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal function for the wasm pkg integration.

## Return the directory under which the asset loader mounts Forge packages.
##
## Kept in one place because three things must agree on it: the loader
## (`bridge/assets-loader.js` writes bundles under `OCTAVE_M + "/forge/<name>"`),
## the database scanner, and the acceptance test.  A literal repeated in three
## languages is exactly how they drift apart.
##
## `/usr/src/octave/m` is the tree this build places all of Octave's m-files in;
## see build/assets.py (OCTAVE_M) and the `--preload-file` list in build/Makefile.

function root = __pkgfix_forge_root__ ()

  root = "/usr/src/octave/m/forge";

endfunction


%!test
%! assert (__pkgfix_forge_root__ (), "/usr/src/octave/m/forge");
