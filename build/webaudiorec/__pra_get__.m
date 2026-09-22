## Read one property of a recorder record (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Unknown names return [] rather than erroring: @audiorecorder's
## __get_properties__ asks for the whole set at once, and a hard failure there
## would break `disp (recorder)`.

function v = __pra_get__ (id, field)

  __pra_init__ ();
  global __pra__;

  v = [];
  if (id < 1 || id > numel (__pra__.items)), return; endif
  rec = __pra__.items{id};
  if (isstruct (rec) && isfield (rec, field))
    v = rec.(field);
  endif

endfunction
