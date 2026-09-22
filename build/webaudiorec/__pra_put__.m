## Write one property of a recorder record (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later

function __pra_put__ (id, field, value)

  __pra_init__ ();
  global __pra__;

  if (id < 1 || id > numel (__pra__.items)), return; endif
  rec = __pra__.items{id};
  if (! isstruct (rec)), rec = struct (); endif
  rec.(field) = value;
  __pra__.items{id} = rec;

endfunction
