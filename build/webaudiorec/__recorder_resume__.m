## Resume a paused recording (T7). SPDX-License-Identifier: AGPL-3.0-or-later

function __recorder_resume__ (h)

  id = __pra_id__ (h);
  if (id < 1)
    error ("audiorecorder: invalid recorder handle");
  endif
  __pra_enqueue__ (id, "resume");

endfunction
