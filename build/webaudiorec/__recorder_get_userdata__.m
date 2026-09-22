## User data attached to a recorder (T7). SPDX-License-Identifier: AGPL-3.0-or-later

function v = __recorder_get_userdata__ (h)
  v = __pra_get__ (__pra_id__ (h), "UserData");
endfunction
