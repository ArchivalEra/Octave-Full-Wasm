## Set the user tag of a recorder (T7). SPDX-License-Identifier: AGPL-3.0-or-later

function __recorder_set_tag__ (h, v)
  __pra_put__ (__pra_id__ (h), "Tag", v);
endfunction
