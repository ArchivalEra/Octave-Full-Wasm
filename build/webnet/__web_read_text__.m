## Read a small UTF-8 text file, "" when absent (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later

function s = __web_read_text__ (path)

  s = "";
  fid = fopen (path, "r");
  if (fid < 0)
    return;
  endif
  raw = fread (fid, Inf, "*char");
  fclose (fid);
  s = char (raw(:).');

endfunction
