## hold on/off for the plot bridge (own code, repo license).
function hold (varargin)
  s = __pstate__ ();
  if (nargin == 0)
    s.hold = ! s.hold;
  elseif (strcmpi (varargin{1}, "on"))
    s.hold = true;
  elseif (strcmpi (varargin{1}, "off"))
    s.hold = false;
  else
    error ("hold: expected 'on' or 'off'.");
  endif
  __pstate__ (s);
endfunction
