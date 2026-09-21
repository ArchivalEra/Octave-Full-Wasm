## Dump a player's samples for the page (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Writes /tmp/pba_<id>.f64: raw little-endian doubles, **interleaved by row**
## (one value per channel per sample), which is what AudioBuffer's channel data
## wants after a simple de-interleave on the JS side.
##
## Octave's raw binary write is column-major, so a stereo matrix would come out
## channel-major; transposing first gives the interleaved layout.

function __pba_write_samples__ (id, y)

  fn = sprintf ("/tmp/pba_%d.f64", id);
  fid = fopen (fn, "wb");
  if (fid < 0)
    error ("audioplayer: cannot write %s", fn);
  endif
  if (isvector (y))
    fwrite (fid, y(:), "double");
  else
    fwrite (fid, y.', "double");   # rows = samples after transpose
  endif
  fclose (fid);

endfunction
