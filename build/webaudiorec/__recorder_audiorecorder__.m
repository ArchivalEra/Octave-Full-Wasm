## Construct a recorder record (T7). Official signature __recorder_audiorecorder__.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Mirrors the builtin's contract: 0–4 args, defaults 8000 Hz / 8 bits / 1 channel
## (MATLAB's defaults for `audiorecorder`).  DEVID is recorded but not used — the
## browser exposes exactly one device, see `audiodevinfo`'s static model.
##
## Returns the opaque handle: a struct with an Id, matching what @audiorecorder
## stores in its `.recorder` field and hands back to every other builtin.

function h = __recorder_audiorecorder__ (varargin)

  n = numel (varargin);
  if (n > 4)
    print_usage ();
  endif

  fs = 8000; nbits = 8; nchans = 1; devid = -1;
  if (n >= 1), fs     = varargin{1}; endif
  if (n >= 2), nbits  = varargin{2}; endif
  if (n >= 3), nchans = varargin{3}; endif
  if (n >= 4), devid  = varargin{4}; endif

  ## 官方那句 FIXME 说"内部 C++ 函数不做输入校验"，这里补一点：
  ## 明显不合理的参数宁可早点报错，也别让页面去做无意义的 getUserMedia。
  if (! (isscalar (fs) && fs > 0 && fs == fix (fs)))
    error ("audiorecorder: sample rate must be a positive integer");
  endif
  if (! (isscalar (nbits) && nbits > 0 && nbits == fix (nbits)))
    error ("audiorecorder: bits per sample must be a positive integer");
  endif
  if (! (isscalar (nchans) && nchans > 0 && nchans == fix (nchans)))
    error ("audiorecorder: channel count must be a positive integer");
  endif

  props = struct ("Fs", fs, "Nbits", nbits, "Channels", nchans, ...
                  "DevID", devid, "Tag", "", "UserData", [], ...
                  "Recording", false);

  id = __pra_new__ (props);

  h = struct ("Id", id);

endfunction
