## Octave-Full-Wasm — 同步 pkg 数据库（纯 .m）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal function for the wasm pkg integration.

## Regenerate the `octave_packages` database from the packages mounted on disk,
## so `pkg list` / `pkg load` / `pkg describe` see them.
##
## Why this file lives in `m/pkg/` and not beside its helpers
## ---------------------------------------------------------
## It calls `get_description`, which is a **private** function of `m/pkg/private/`.
## Octave resolves private functions relative to the *caller's* directory, so this
## function must sit in `m/pkg/` itself for that call to resolve.
##
## Why reuse `get_description` at all
## ----------------------------------
## It is Octave's own DESCRIPTION parser and it produces exactly the struct
## `pkg` consumes -- `name`, `version`, the fields `describe.m` prints, and
## importantly `depends` already normalized by `fix_depends` into the cell-of-
## structs form that `get_inverse_dependencies` indexes.  Hand-rolling a parser
## produced a struct missing `depends`, which made `pkg describe` fail with
## "structure has no member 'depends'".  Reusing the official parser is both
## less code and correct by construction.
##
## Struct shape matches `install.m`: `get_description (DESCRIPTION)` followed by
## setting `dir` (and `archprefix`) to the install location.  We set both to the
## mount directory because this build does not separate arch-dependent files.
##
## Returns the number of packages written.  A package whose DESCRIPTION cannot be
## parsed is skipped with a warning rather than aborting the whole sync: one
## malformed package must not make the other ten invisible.

function n = __pkgfix_sync_db__ (root, outfile)

  if (nargin < 1)
    root = __pkgfix_forge_root__ ();
  endif
  if (nargin < 2)
    outfile = __pkgfix_local_list__ ();
  endif

  local_packages = {};

  if (isfolder (root))
    entries = dir (root);
    for k = 1:numel (entries)
      e = entries(k);
      if (! e.isdir || strcmp (e.name, ".") || strcmp (e.name, ".."))
        continue;
      endif
      pkgdir = fullfile (root, e.name);
      desc = fullfile (pkgdir, "DESCRIPTION");
      if (! exist (desc, "file"))
        ## No DESCRIPTION means `pkg` could not load it either (upstream's
        ## get_description errors), so listing it would advertise a package that
        ## cannot be loaded.
        continue;
      endif
      try
        d = get_description (desc);
        d.dir = pkgdir;
        d.archprefix = pkgdir;
      catch err
        warning ("pkgfix: skipping %s: %s", e.name, err.message);
        continue;
      end_try_catch
      ## Materialize the `packinfo/` layout that `pkg install` creates.
      ##
      ## Upstream copies DESCRIPTION/COPYING/INDEX/NEWS/... into a `packinfo`
      ## subdirectory of the install dir, and `describe.m`'s `parse_pkg_idx`
      ## looks specifically for `<dir>/packinfo/INDEX`.  The asset bundles ship
      ## those files at the package root instead (they emulate the `inst/`
      ## up-lift, not the packinfo step), so without this `pkg describe` fails
      ## with "could not find any INDEX file".
      ##
      ## Copying rather than symlinking: a MEMFS symlink would resolve for reads
      ## but `pkg rebuild`/`uninstall` later walk these paths expecting regular
      ## files, and the cost here is a few KB.
      __pkgfix_make_packinfo__ (pkgdir);
      local_packages{end+1} = d;
    endfor
  endif

  ## Create the containing directory: `save` will not, and the default location
  ## is under the user config dir which does not exist in a fresh browser FS.
  odir = fileparts (outfile);
  if (! isempty (odir) && ! isfolder (odir))
    mkdir (odir);
  endif

  save (outfile, "local_packages");
  n = numel (local_packages);

endfunction


## 注：本文件的 %!test 需要 `get_description`（私有），只能在 pkg 目录下运行，
## 因此随 `accept-pkg.mjs` 在浏览器里覆盖——那里能真实调用到它。
