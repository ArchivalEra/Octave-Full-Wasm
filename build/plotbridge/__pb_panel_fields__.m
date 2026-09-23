## Panel bookkeeping for the plot bridge — extract one panel's fields.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The subset of bridge state that belongs to a single panel.  Everything a
## drawing primitive can set lives here, so stashing/restoring a panel is a
## field copy rather than a per-shim migration.

function p = __pb_panel_fields__ (s)

  ## 字段集合由 __pb_fields__.m 声明（加字段只改那一张表，不再改这里）
  f = __pb_fields__ ();
  p = struct ();
  for k = 1:numel (f.names)
    nm = f.names{k};
    if (isfield (s, nm))
      p.(nm) = s.(nm);
    else
      p.(nm) = f.defaults{k};   ## 老 shim 手工搭的 state 可能缺 v2 字段
    endif
  endfor

endfunction
