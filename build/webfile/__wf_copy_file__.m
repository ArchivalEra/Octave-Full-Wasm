## Octave-Full-Wasm — 单文件复制（纯 .m，无 shell）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal helper for the wasm `copyfile` override.

## Copy one regular file from @var{src} to @var{dst}, byte-for-byte.
##
## Returns @code{[ok, msg]}.
##
## Reads and writes in binary mode deliberately: the whole point of this
## override is to work in a browser, where the files being copied are as likely
## to be PNGs or .oct side modules as they are text.  A text-mode copy would
## silently mangle those on any platform whose line endings differ.
##
## Streams in chunks rather than reading whole files: the assets this project
## moves around include a 45MB wasm module, and `fread(fid, Inf)` on that is a
## needless memory spike.

function [ok, msg] = __wf_copy_file__ (src, dst)

  ok = false;
  msg = "";

  fin = fopen (src, "rb");
  if (fin < 0)
    msg = sprintf ("unable to open %s for reading", src);
    return;
  endif

  ## Create the destination directory if the caller asked for a path that does
  ## not exist yet.  (copyfile's caller normally does this, but a recursive copy
  ## into a fresh tree relies on it here.)
  ddir = fileparts (dst);
  if (! isempty (ddir) && ! isfolder (ddir))
    mkdir (ddir);
  endif

  fout = fopen (dst, "wb");
  if (fout < 0)
    fclose (fin);
    msg = sprintf ("unable to open %s for writing", dst);
    return;
  endif

  ## 1 MiB.  Written as 2^20 -- Octave has no `<<` operator.
  chunk = 2 ^ 20;
  while (true)
    buf = fread (fin, chunk, "*uint8");
    if (isempty (buf))
      break;
    endif
    n = fwrite (fout, buf, "uint8");
    if (n != numel (buf))
      fclose (fin);
      fclose (fout);
      msg = sprintf ("short write on %s", dst);
      return;
    endif
  endwhile

  fclose (fin);
  fclose (fout);
  ok = true;

endfunction


%!test
%! ## Byte-for-byte round trip, including the values that a text-mode copy
%! ## would mangle.
%! p = tempname ();
%! fid = fopen (p, "wb"); fwrite (fid, uint8 (0:255), "uint8"); fclose (fid);
%! q = tempname ();
%! [ok, msg] = __wf_copy_file__ (p, q);
%! assert (ok, true);
%! assert (msg, "");
%! fid = fopen (q, "rb"); got = fread (fid, Inf, "*uint8"); fclose (fid);
%! assert (got, uint8 (0:255)');
