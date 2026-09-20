## figure(n) for the plot bridge: single figure, reset state (own code).
## Own code, repo license (AGPL-3.0-or-later; see LICENSE).
## Returns a fake handle (1) so callers like `hf = figure ()` keep working.
function h = figure (varargin)
  clf ();
  h = 1;
endfunction
