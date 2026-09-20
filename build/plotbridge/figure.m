## figure(n) for the plot bridge: single figure, reset state (own code).
## Returns a fake handle (1) so callers like `hf = figure ()` keep working.
function h = figure (varargin)
  clf ();
  h = 1;
endfunction
