## Pull the integer id out of an audiorecorder handle (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## @audiorecorder passes `struct (recorder).recorder` to every __recorder_*
## builtin, so the handle is a struct with an Id field.  Accepting a bare id and
## the classdef object too keeps these .m files callable directly (which the
## acceptance suite does) — same forgiving contract as __pba_id__.

function id = __pra_id__ (handle)

  id = 0;

  if (isnumeric (handle) && isscalar (handle))
    id = handle;
    return;
  endif

  if (isstruct (handle))
    if (isfield (handle, "Id"))
      id = handle.Id;
    elseif (isfield (handle, "recorder") && isstruct (handle.recorder) ...
            && isfield (handle.recorder, "Id"))
      id = handle.recorder.Id;
    endif
    return;
  endif

  try
    r = struct (handle).recorder;
    if (isstruct (r) && isfield (r, "Id"))
      id = r.Id;
    endif
  catch
    id = 0;
  end_try_catch

endfunction
