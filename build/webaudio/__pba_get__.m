## Read one property of a player record (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## FIELD is the Octave-facing property name (e.g. "SampleRate"); unknown names
## return [] rather than erroring, because __get_properties__ asks for the full
## set in one go and a hard failure there would break `disp (player)`.

function v = __pba_get__ (id, field)

  __pba_init__ ();
  global __pba__;

  v = [];
  if (id < 1 || id > numel (__pba__.items)), return; endif
  rec = __pba__.items{id};
  if (isstruct (rec) && isfield (rec, field))
    v = rec.(field);
  endif

endfunction
