## Allocate a player record (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Returns the integer id; the handle handed to Octave's @audioplayer class is
## a struct wrapping it (see __player_audioplayer__).

function id = __pba_new__ (props)

  __pba_init__ ();
  global __pba__;

  id = __pba__.next;
  __pba__.next = id + 1;
  __pba__.items{id} = props;

endfunction
