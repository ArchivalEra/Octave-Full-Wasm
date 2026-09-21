## Emit /tmp/pb_spec.json from global __pb__ (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Hand-rolled JSON (no jsonencode/RapidJSON in this build).
##
## Schema (v2):
##   { hold, title, xlabel, ylabel, xlim, ylim, grid, legloc, legend[],
##     logx, logy, axis, series[], panels?[] , active? }
##
## The flat fields always describe the *active* plot, so v1 consumers keep
## working unchanged.  When subplot() was used, `panels` additionally carries
## every panel (each an object of the same shape) and the renderer draws them
## as a multiplot grid.

function __pb_emit__ ()

  global __pb__;

  ## The active panel's live state lives in the flat fields, while panels{}
  ## only holds the ones stashed on a subplot switch — so panels{active} goes
  ## stale the moment anything draws.  Refresh it here, or the renderer would
  ## draw the active panel as it looked before its own plot() call.
  if (isfield (__pb__, "panels") && ! isempty (__pb__.panels) ...
      && isfield (__pb__, "active") && __pb__.active >= 1 ...
      && __pb__.active <= numel (__pb__.panels))
    __pb__.panels{__pb__.active} = __pb_panel_fields__ (__pb__);
  endif

  fid = fopen ("/tmp/pb_spec.json", "w");
  if (fid < 0)
    error ("__pb_emit__: cannot write /tmp/pb_spec.json");
  endif

  ## --- flat (active) spec, with the panels field appended when present ---
  __pb_emit_body__ (fid, __pb__);

  if (isfield (__pb__, "panels") && numel (__pb__.panels) > 1)
    fprintf (fid, ',"panels":[');
    for k = 1:numel (__pb__.panels)
      if (k > 1), fprintf (fid, ","); endif
      fprintf (fid, '{');
      __pb_emit_body__ (fid, __pb__.panels{k});
      fprintf (fid, '}');
    endfor
    fprintf (fid, '],"active":%d', __pb__.active);
  endif

  fprintf (fid, '}');
  fclose (fid);

endfunction

## One spec object's *contents* (no surrounding braces, no leading comma).
function __pb_emit_body__ (fid, s)

  fprintf (fid, '"hold":%s,', __pb_bool__ (s.hold));
  fprintf (fid, '"title":%s,', __pb_str__ (s.title));
  fprintf (fid, '"xlabel":%s,', __pb_str__ (s.xlabel));
  fprintf (fid, '"ylabel":%s,', __pb_str__ (s.ylabel));
  fprintf (fid, '"xlim":%s,', __pb_vec__ (s.xlim));
  fprintf (fid, '"ylim":%s,', __pb_vec__ (s.ylim));
  fprintf (fid, '"grid":%s,', __pb_bool__ (s.grid));
  fprintf (fid, '"legloc":%s,', __pb_str__ (s.legloc));
  fprintf (fid, '"legend":[');
  for i = 1:numel (s.legend)
    if (i > 1), fprintf (fid, ","); endif
    fprintf (fid, "%s", __pb_str__ (s.legend{i}));
  endfor
  fprintf (fid, '],"logx":%s,', __pb_bool__ (s.logx));
  fprintf (fid, '"logy":%s,', __pb_bool__ (s.logy));
  if (isfield (s, "axis"))
    fprintf (fid, '"axis":%s,', __pb_str__ (s.axis));
  else
    fprintf (fid, '"axis":"",');
  endif
  if (isfield (s, "panel_pos") && numel (s.panel_pos) == 4)
    fprintf (fid, '"pos":%s,', __pb_vec__ (s.panel_pos));
  endif
  fprintf (fid, '"series":[');
  for i = 1:numel (s.series)
    sr = s.series{i};
    if (i > 1), fprintf (fid, ","); endif
    ## NOTE: "marker" must be emitted — the JS side reads sr.marker to pick the
    ## gnuplot pointtype, and a missing field silently degrades every marker to
    ## the default empty circle (pt 6).
    ebd = "";
    if (isfield (sr, "ebdir") && ischar (sr.ebdir) && ! isempty (sr.ebdir))
      ebd = sprintf (',"ebdir":%s', __pb_str__ (sr.ebdir));
    endif
    fprintf (fid, '{"file":%s,"style":%s,"color":%s,"dt":%d,"pt":%d,"ps":%g,"marker":%s,"title":%s%s}', ...
             __pb_str__ (sr.file), __pb_str__ (sr.style), __pb_str__ (sr.color), ...
             sr.dt, sr.pt, sr.ps, __pb_str__ (sr.marker), __pb_str__ (sr.title), ebd);
  endfor
  fprintf (fid, ']');

endfunction

function s = __pb_bool__ (b)
  if (b), s = "true"; else, s = "false"; endif
endfunction

function s = __pb_str__ (t)
  t = strrep (t, '\', '\\');
  t = strrep (t, '"', '\"');
  t = strrep (t, char (10), ' ');
  s = ['"' t '"'];
endfunction

function s = __pb_vec__ (v)
  if (isempty (v))
    s = "[]";
  else
    s = "[";
    for i = 1:numel (v)
      if (i > 1), s = [s ","]; endif
      s = [s num2str(v(i), "%.17g")];
    endfor
    s = [s "]"];
  endif
endfunction
