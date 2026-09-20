## Plot-bridge state holder (own code, repo license).
## Global struct __pb__ + emit spec file on every update.

function s = __pstate__ (varargin)

  global __pb__;
  if (isempty (__pb__))
    __pb__ = struct ("hold", false, "title", "", "xlabel", "", "ylabel", "", ...
                     "xlim", [], "ylim", [], "grid", false, ...
                     "legloc", "", ...
                     "logx", false, "logy", false, "n", 0);
    __pb__.legend = {};
    __pb__.series = {};
  endif
  if (nargin > 0)
    __pb__ = varargin{1};
    __pb_emit__ ();
  endif
  s = __pb__;

endfunction
