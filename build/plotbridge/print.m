## print/saveas for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Shadows the core scripts/plot/util/print.m (plotbridge is added last, so
## it sits at the front of the path).  The core version needs either a real
## graphics toolkit or an external command (`gs`, gnuplot via system()) —
## neither exists in this build.
##
## Supported: -dsvg (and a .svg filename).  Anything else fails loudly with
## an actionable message instead of a confusing "gs not available".
##
## Why SVG only: the SVG is generated *here*, in pure .m, from the plot-bridge
## state.  There is no synchronous channel to the JS-side gnuplot bridge, and
## no rasteriser in the wasm sandbox.  A page can still turn the SVG into PNG
## with canvas if it needs one.
##
## Usage:
##   plot (1:10); print ("/tmp/p.svg", "-dsvg");
##   plot (1:10); print -dsvg /tmp/p.svg;
##   plot (1:10); print ("/tmp/p.svg");          # extension picks the format
##   saveas (gcf (), "/tmp/p.svg");

function [out1, out2] = print (varargin)

  fname = "";
  fmt = "";
  h = [];

  for i = 1:numel (varargin)
    a = varargin{i};
    if (ischar (a))
      if (numel (a) > 2 && strncmp (a, "-d", 2))
        fmt = lower (a(3:end));
      elseif (numel (a) > 0 && a(1) == "-")
        ## -color/-mono/-landscape/… : accepted and ignored in v1
      else
        fname = a;
      endif
    elseif (isnumeric (a) || islogical (a))
      if (isscalar (a) && isfigure (a))
        h = a;
      endif
    elseif (isstruct (a) && isfield (a, "type"))
      if (strcmp (getfield (a, "type"), "figure"))
        h = 1;
      endif
    endif
  endfor

  if (isempty (fname))
    error ("print: no output file given (this build supports -dsvg only)");
  endif

  ## extension as the fallback format selector
  [~, ~, ext] = fileparts (fname);
  if (! isempty (ext))
    ext = lower (ext(2:end));
  endif

  if (isempty (fmt))
    if (! isempty (ext))
      fmt = ext;
    else
      fmt = "svg";
    endif
  endif

  switch (fmt)
    case {"svg", "svgz"}
      if (isempty (ext))
        fname = [fname ".svg"];
      endif
      svg = __svg_render__ ();
      fid = fopen (fname, "wb");
      if (fid < 0)
        error ("print: cannot open '%s' for writing", fname);
      endif
      fputs (fid, svg);
      fclose (fid);
      printf ("print: wrote %s (%d bytes, %d series)\n", fname, numel (svg), ...
              numel (__pstate__ ().series));

    case {"png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"}
      error (["print: raster output (-d%s) is not available in this build.\n" ...
              "  The sandbox has no rasteriser and no external commands.\n" ...
              "  Use -dsvg here, then convert in the page (canvas) if you need a bitmap."], fmt);

    case {"pdf", "eps", "epsc", "ps", "ps2", "psc", "psc2"}
      error (["print: vector output (-d%s) needs Ghostscript, which is not available in this build.\n" ...
              "  Use -dsvg instead: it is a vector format every browser renders natively."], fmt);

    case {"ofig", "fig", "m", "mfig"}
      error ("print: -d%s (Octave figure files) is not supported: this build has no real graphics handles.", fmt);

    otherwise
      error ("print: unknown output format '%s' (this build supports -dsvg).", fmt);
  endswitch

  out1 = h;
  out2 = fname;

endfunction


function tf = isfigure (v)
  ## No real graphics objects here; the bridge hands out the fake handle 1.
  tf = isscalar (v) && isnumeric (v) && v == 1;
endfunction
