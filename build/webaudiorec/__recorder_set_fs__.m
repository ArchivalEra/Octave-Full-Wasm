## Change the sample rate of a recorder (T7). SPDX-License-Identifier: AGPL-3.0-or-later
##
## Written straight into the record: the page reads Fs from the `record` queue
## line, so a rate set before `record` takes effect (a rate set mid-recording
## does not — same as desktop, where the stream is already open).

function __recorder_set_fs__ (h, v)

  if (! (isscalar (v) && v > 0 && v == fix (v)))
    error ("audiorecorder: sample rate must be a positive integer");
  endif
  __pra_put__ (__pra_id__ (h), "Fs", v);

endfunction
