## Write one property of a player record (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later

function __pba_put__ (id, field, value)

  __pba_init__ ();
  global __pba__;

  if (id < 1 || id > numel (__pba__.items)), return; endif
  rec = __pba__.items{id};
  if (! isstruct (rec)), rec = struct (); endif
  rec.(field) = value;
  __pba__.items{id} = rec;

endfunction
