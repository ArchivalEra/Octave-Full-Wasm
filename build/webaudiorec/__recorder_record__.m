## Start recording without blocking (T7).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## `record (r)` records until stopped; `record (r, len)` records for len seconds.
## This is the **non-blocking** form (MATLAB semantics): it returns immediately,
## the page does the actual capture.  Use __recorder_recordblocking__ to wait.
##
## len = 0 encodes "until stop" in the queue.

function __recorder_record__ (h, len)

  id = __pra_id__ (h);
  if (id < 1)
    error ("audiorecorder: invalid recorder handle");
  endif

  if (nargin < 2 || isempty (len))
    len = 0;
  elseif (! (isscalar (len) && len >= 0))
    error ("audiorecorder: length must be a non-negative number of seconds");
  endif

  fs = __pra_get__ (id, "Fs");
  nbits = __pra_get__ (id, "Nbits");
  nch = __pra_get__ (id, "Channels");

  __pra_put__ (id, "Recording", true);
  __pra_enqueue__ (id, "record", fs, nbits, nch, len);

endfunction
