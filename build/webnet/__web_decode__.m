## Decode a fetched body the way webread should (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The Content-Type header (written by the fetch bridge) decides: JSON is parsed
## into a struct/cell, everything else comes back as a char row.  When the
## header is missing, the URL's extension is the fallback hint, and failing
## that a leading '{' or '[' tips it off.

function r = __web_decode__ (url)

  ctype = lower (__web_read_text__ ("/tmp/webnet_ctype"));
  body = __web_read_last__ ();

  is_json = ! isempty (strfind (ctype, "json"));
  if (! is_json)
    ## fall back to the URL extension
    [~, ~, ext] = fileparts (url);
    is_json = any (strcmpi (ext, {".json"}));
  endif
  if (! is_json)
    ## last resort: does it look like JSON?
    t = strtrim (body);
    is_json = (! isempty (t) && any (t(1) == "[{"));
  endif

  if (! is_json)
    r = body;
    return;
  endif

  ## jsondecode is a builtin in this build (RapidJSON, batch 1a)
  try
    r = jsondecode (body);
  catch err
    ## a JSON-ish body that does not parse: hand back the raw text rather than
    ## failing the whole call — the caller can inspect it
    r = body;
  end_try_catch

endfunction
