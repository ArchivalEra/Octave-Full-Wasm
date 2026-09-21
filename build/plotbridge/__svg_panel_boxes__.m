## Panel rectangles for the SVG renderer (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Returns { {x, y, w, h}, ... } in canvas pixels.  Octave note: a subfunction
## of __svg_render__.m could not be called from there once that file grew a
## second entry point, so this lives in its own file (see CLIBS.md 批次 6 坑 3).

function boxes = __svg_panel_boxes__ (s, W, H)

  ## No helper calls: every function this needs is trivial and inlined, because
  ## subfunctions of __svg_render__.m are private to that file.

  n = numel (s.panels);
  boxes = cell (1, n);

  have_pos = true;
  for k = 1:n
    p = s.panels{k};
    if (! isfield (p, "panel_pos") || numel (p.panel_pos) != 4)
      have_pos = false;
    endif
  endfor

  ## NOTE: never write `{round (x), …}` — inside a [] or {} literal, `name (arg)`
  ## with a space is parsed as *indexing*, not a call, and it fails at run time
  ## (not parse time) with a misleading error.  Bind to temporaries first.
  for k = 1:n
    if (have_pos)
      p = s.panels{k}.panel_pos;
      bx = round (p(1) * W);
      by = round ((1 - p(2) - p(4)) * H);
      bw = round (p(3) * W);
      bh = round (p(4) * H);
      boxes{k} = {bx, by, bw, bh};
    else
      ## fall back to a near-square grid
      nc = ceil (sqrt (n));
      nr = ceil (n / nc);
      r = floor ((k - 1) / nc); c = rem (k - 1, nc);
      bx = round (c * W / nc);
      by = round (r * H / nr);
      bw = round (W / nc);
      bh = round (H / nr);
      boxes{k} = {bx, by, bw, bh};
    endif
  endfor

endfunction
