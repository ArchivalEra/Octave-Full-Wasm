## Stop recording (T7). SPDX-License-Identifier: AGPL-3.0-or-later

function __recorder_stop__ (h)

  id = __pra_id__ (h);
  if (id < 1)
    error ("audiorecorder: invalid recorder handle");
  endif

  __pra_put__ (id, "Recording", false);
  __pra_enqueue__ (id, "stop");

endfunction
