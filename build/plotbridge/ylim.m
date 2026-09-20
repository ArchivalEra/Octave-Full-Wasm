## ylim for the plot bridge (own code, repo license).
function ylim (varargin)
  s = __pstate__ ();
  if (nargin == 0 || (ischar (varargin{1}) && strcmpi (varargin{1}, "auto")))
    s.ylim = [];
  else
    s.ylim = varargin{1}(:).';
  endif
  __pstate__ (s);
endfunction
