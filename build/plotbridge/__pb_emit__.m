## Emit /tmp/pb_spec.json from global __pb__ (own code, repo license).
## Hand-rolled JSON (no jsonencode/RapidJSON in this build).

function __pb_emit__ ()

  global __pb__;

  fid = fopen ("/tmp/pb_spec.json", "w");
  if (fid < 0)
    error ("__pb_emit__: cannot write /tmp/pb_spec.json");
  endif

  fprintf (fid, '{"hold":%s,', __pb_bool__ (__pb__.hold));
  fprintf (fid, '"title":%s,', __pb_str__ (__pb__.title));
  fprintf (fid, '"xlabel":%s,', __pb_str__ (__pb__.xlabel));
  fprintf (fid, '"ylabel":%s,', __pb_str__ (__pb__.ylabel));
  fprintf (fid, '"xlim":%s,', __pb_vec__ (__pb__.xlim));
  fprintf (fid, '"ylim":%s,', __pb_vec__ (__pb__.ylim));
  fprintf (fid, '"grid":%s,', __pb_bool__ (__pb__.grid));
  fprintf (fid, '"legloc":%s,', __pb_str__ (__pb__.legloc));
  fprintf (fid, '"legend":[');
  for i = 1:numel (__pb__.legend)
    if (i > 1), fprintf (fid, ","); endif
    fprintf (fid, "%s", __pb_str__ (__pb__.legend{i}));
  endfor
  fprintf (fid, '],"logx":%s,', __pb_bool__ (__pb__.logx));
  fprintf (fid, '"logy":%s,', __pb_bool__ (__pb__.logy));
  fprintf (fid, '"series":[');
  for i = 1:numel (__pb__.series)
    sr = __pb__.series{i};
    if (i > 1), fprintf (fid, ","); endif
    ## NOTE: "marker" must be emitted — the JS side reads sr.marker to pick the
    ## gnuplot pointtype, and a missing field silently degrades every marker to
    ## the default empty circle (pt 6).
    fprintf (fid, '{"file":%s,"style":%s,"color":%s,"dt":%d,"pt":%d,"ps":%g,"marker":%s,"title":%s}', ...
             __pb_str__ (sr.file), __pb_str__ (sr.style), __pb_str__ (sr.color), ...
             sr.dt, sr.pt, sr.ps, __pb_str__ (sr.marker), __pb_str__ (sr.title));
  endfor
  fprintf (fid, ']}');
  fclose (fid);

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
