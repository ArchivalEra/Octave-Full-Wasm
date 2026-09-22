## Attach user data to a recorder (T7). SPDX-License-Identifier: AGPL-3.0-or-later

function __recorder_set_userdata__ (h, v)
  __pra_put__ (__pra_id__ (h), "UserData", v);
endfunction
