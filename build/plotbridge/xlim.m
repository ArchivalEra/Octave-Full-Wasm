## xlim for the plot bridge (own code, repo license).
function xlim (varargin)
  s = __pstate__ ();
  if (nargin == 0 || (ischar (varargin{1}) && strcmpi (varargin{1}, "auto")))
    s.xlim = [];
  else
    s.xlim = varargin{1}(:).';
  endif
  __pstate__ (s);
endfunction
