## __player_get_fs__ — property getter for the pure-.m audioplayer (own code).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Replaces the dldfcn builtin; see __pba_init__.m for why these are .m.

function v = __player_get_fs__ (handle)

  if (nargin < 1)
    print_usage ();
  endif
  v = __pba_get__ (__pba_id__ (handle), "SampleRate");

endfunction
