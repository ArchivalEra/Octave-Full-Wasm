## Read /tmp/webnet_last back as an Octave char row (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The body arrives as raw bytes (so binary payloads survive); Octave's own
## urlread returns a char row, and a row is what strsplit/regexp etc. expect.
## Reading via fopen/fread (not fileread) keeps it byte-exact and works for any
## length.

function s = __web_read_last__ ()

  s = "";
  fid = fopen ("/tmp/webnet_last", "rb");
  if (fid < 0)
    return;
  endif
  raw = fread (fid, Inf, "*uint8");
  fclose (fid);

  if (isempty (raw))
    return;
  endif

  ## Treat the payload as UTF-8 text (what a REST call returns).  Bytes above
  ## the ASCII range are preserved as-is — Octave strings carry them through.
  s = char (raw(:).');

endfunction
