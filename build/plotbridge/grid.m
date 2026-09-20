## grid on/off for the plot bridge (own code, repo license).
function grid (varargin)
  s = __pstate__ ();
  if (nargin == 0)
    s.grid = ! s.grid;
  elseif (strcmpi (varargin{1}, "on"))
    s.grid = true;
  elseif (strcmpi (varargin{1}, "off"))
    s.grid = false;
  else
    error ("grid: expected 'on' or 'off'.");
  endif
  __pstate__ (s);
endfunction
