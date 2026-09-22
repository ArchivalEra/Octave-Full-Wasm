## Allocate a recorder record (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later

function id = __pra_new__ (props)

  __pra_init__ ();
  global __pra__;

  id = __pra__.next;
  __pra__.next = id + 1;
  __pra__.items{id} = props;

endfunction
