## __player_set_tag__ — property setter for the pure-.m audioplayer (own code).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Only the three properties Octave's @audioplayer/set.m exposes are settable
## (SampleRate, Tag, UserData); everything else is read-only, as in the
## original builtin.

function __player_set_tag__ (handle, value)

  if (nargin < 2)
    print_usage ();
  endif
  __pba_put__ (__pba_id__ (handle), "Tag", value);

endfunction
