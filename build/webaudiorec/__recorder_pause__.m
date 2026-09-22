## Pause an ongoing recording (T7). SPDX-License-Identifier: AGPL-3.0-or-later
##
## MediaRecorder has a real pause(), so this is not a no-op — the page calls it.

function __recorder_pause__ (h)

  id = __pra_id__ (h);
  if (id < 1)
    error ("audiorecorder: invalid recorder handle");
  endif
  __pra_enqueue__ (id, "pause");

endfunction
