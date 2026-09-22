## Device id of a recorder (T7). SPDX-License-Identifier: AGPL-3.0-or-later
##
## Recorded as given (default -1) but not used: the browser exposes exactly one
## capture device, see audiodevinfo's static model.

function v = __recorder_get_id__ (h)
  v = __pra_get__ (__pra_id__ (h), "DevID");
endfunction
