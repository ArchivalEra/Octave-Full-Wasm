## Pull the integer id out of an audioplayer handle (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## @audioplayer passes `struct (player).player` to every __player_* builtin, so
## the handle is a struct with an Id field.  Accepting the bare id and the
## classdef object too makes the .m implementations forgiving when called
## directly (which the acceptance suite does).

function id = __pba_id__ (handle)

  id = 0;

  if (isnumeric (handle) && isscalar (handle))
    id = handle;
    return;
  endif

  if (isstruct (handle))
    if (isfield (handle, "Id"))
      id = handle.Id;
    elseif (isfield (handle, "player") && isstruct (handle.player) ...
            && isfield (handle.player, "Id"))
      id = handle.player.Id;
    endif
    return;
  endif

  ## a classdef audioplayer object: the payload is in its .player field
  try
    p = struct (handle).player;
    if (isstruct (p) && isfield (p, "Id"))
      id = p.Id;
    endif
  catch
    id = 0;
  end_try_catch

endfunction
