## __player_audioplayer__ — construct an audioplayer handle (own code).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Replaces the dldfcn builtin from libinterp/dldfcn/audiodevinfo.cc, which is
## disabled in this build (no PortAudio).  The device is the browser's
## AudioContext, and nothing is created until play() — both because a page may
## have no AudioContext before a user gesture and because Octave's own
## constructor would otherwise require a device count >= 1.
##
## Signatures accepted (as in Octave):
##   (y, fs)  (y, fs, nbits)  (y, fs, nbits, id)
##   (function_handle, fs, …) — callback players: recorded but not scheduled,
##                              matching the "no real threads" reality.
##
## The returned handle is a struct with one field so @audioplayer can wrap it
## with class() and pass it back to the other __player_* functions.

function handle = __player_audioplayer__ (varargin)

  if (nargin < 2)
    error ("audioplayer: not enough input arguments");
  endif

  y = varargin{1};
  fs = varargin{2};
  nbits = 16;
  devid = -1;
  if (nargin >= 3 && ! isempty (varargin{3})), nbits = varargin{3}; endif
  if (nargin >= 4 && ! isempty (varargin{4})), devid = varargin{4}; endif

  if (! (isscalar (fs) && fs > 0))
    error ("audioplayer: FS must be a positive number");
  endif

  ## callback players: accept and record, but there is nothing to schedule
  is_cb = is_function_handle (y) || ischar (y);
  if (is_cb)
    if (ischar (y)), y = str2func (y); endif
    nc = 2; ns = 0;
  else
    if (! isnumeric (y))
      error ("audioplayer: Y must be a numeric matrix");
    endif
    if (isvector (y))
      y = y(:);
    endif
    ns = rows (y);
    nc = columns (y);
  endif

  props = struct ();
  props.SampleRate = fs;
  props.BitsPerSample = nbits;
  props.NumberOfChannels = nc;
  props.TotalSamples = ns;
  props.CurrentSample = 0;
  props.DeviceID = devid;
  props.Running = "off";
  props.Tag = "";
  props.UserData = [];
  props.Type = "audioplayer";
  if (is_cb)
    props.Callback = 1;
    props.Y = [];
  else
    props.Callback = 0;
    props.Y = double (y);
  endif
  props.Id = 0;

  id = __pba_new__ (props);
  __pba_put__ (id, "Id", id);

  ## Samples go to disk now (once), so the page can fetch them without a
  ## second round-trip through Octave.  Column-major interleave matches what
  ## WebAudio's AudioBuffer.copyToChannel wants per channel.
  if (! is_cb)
    __pba_write_samples__ (id, double (y));
  endif

  handle = struct ("player", struct ("Id", id));

endfunction
