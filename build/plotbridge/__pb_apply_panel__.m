## Panel bookkeeping for the plot bridge — restore one panel's fields.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Counterpart to __pb_panel_fields__: copies a saved panel record back onto
## the flat (active) state.

function s = __pb_apply_panel__ (s, p)

  ## __pb_panel_fields__ 的逆：按同一张表放回（两边不可能再对不上）
  f = __pb_fields__ ();
  for k = 1:numel (f.names)
    nm = f.names{k};
    if (isfield (p, nm))
      s.(nm) = p.(nm);
    else
      s.(nm) = f.defaults{k};
    endif
  endfor

endfunction
