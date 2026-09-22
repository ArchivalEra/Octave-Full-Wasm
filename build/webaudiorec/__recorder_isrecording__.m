## Is the recorder currently recording? (T7)
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The page is authoritative, but it is also **asynchronous**: right after
## `record (r)` the page may not have drained the queue yet, so its status file
## still says "idle".  Reporting false there would contradict what the user just
## asked for, so "idle" falls back to the flag __recorder_record__ set.
## Anything else (done/denied/insecure/error/paused) is honestly not recording.

function tf = __recorder_isrecording__ (h)

  id = __pra_id__ (h);
  if (id < 1)
    error ("audiorecorder: invalid recorder handle");
  endif

  s = __pra_progress__ (id);

  if (strcmp (s.state, "idle"))
    tf = logical (__pra_get__ (id, "Recording"));
  else
    tf = strcmp (s.state, "recording");
  endif

endfunction
