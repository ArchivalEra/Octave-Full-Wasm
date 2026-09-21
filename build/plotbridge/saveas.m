## saveas for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The core saveas.m requires a real graphics handle (it calls ancestor()):
## this build has none, so calling it errors out before reaching print.
## Here it simply forwards to the bridge's print, and infers the format from
## the filename extension like the core version does.
##
##   plot (1:10); saveas (gcf (), "/tmp/p.svg");
##   plot (1:10); saveas (1, "/tmp/p.svg");

function saveas (h, filename, fmt)

  if (nargin < 2)
    print_usage ();
  endif
  if (! (ischar (filename) && isrow (filename)))
    error ("saveas: FILENAME must be a string");
  endif

  if (nargin >= 3 && ! isempty (fmt))
    if (! ischar (fmt))
      error ("saveas: FMT must be a string");
    endif
    print (h, filename, ["-d" fmt]);
  else
    print (h, filename);
  endif

endfunction
