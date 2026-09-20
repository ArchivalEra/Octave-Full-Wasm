## legend for the plot bridge (own code, repo license).
## legend('a','b',...) + optional 'Location',loc pair.
function legend (varargin)
  s = __pstate__ ();
  labels = {}; loc = "";
  i = 1;
  while (i <= numel (varargin))
    if (ischar (varargin{i}) && strcmpi (varargin{i}, "location") && i + 1 <= numel (varargin))
      loc = varargin{i+1}; i += 2;
    else
      labels{end+1} = varargin{i}; i += 1;
    endif
  endwhile
  s.legend = labels; s.legloc = loc;
  __pstate__ (s);
endfunction
