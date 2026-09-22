## Frames captured so far (T7). SPDX-License-Identifier: AGPL-3.0-or-later
##
## While recording this is the page's **estimate** (elapsed × rate), because
## MediaRecorder only yields the real sample count after it is stopped and the
## blob decoded — see the note in __pra_init__.  After "done" it is exact.

function v = __recorder_get_sample_number__ (h)
  s = __pra_progress__ (__pra_id__ (h));
  v = s.frames;
endfunction
