## Default colour cycle for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## MATLAB's default 7-colour order.  Kept in one place because three shims used
## to hard-code it (__pb_add__ and, after v2, contour.m).

function c = __pb_cycle_color__ (k)

  order = {"#0072BD", "#D95319", "#EDB120", "#7E2F8E", ...
           "#77AC30", "#4DBEEE", "#A2142F"};
  c = order{mod (k - 1, numel (order)) + 1};

endfunction
