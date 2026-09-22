## Total frames in the recording (T7). SPDX-License-Identifier: AGPL-3.0-or-later

function v = __recorder_get_total_samples__ (h)
  s = __pra_progress__ (__pra_id__ (h));
  v = s.frames;
endfunction
