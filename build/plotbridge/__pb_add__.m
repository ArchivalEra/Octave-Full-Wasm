## Shared series appender for the plot bridge (own code, repo license).
## Called as s = __pb_add__ (s, x, y, spec, style).

function s = __pb_add__ (s, x, y, spec, style)

  if (isempty (x))
    x = (1:rows (y)).';
    if (columns (y) > 1 && rows (y) == 1)
      x = 1:columns (y);
    endif
  endif

  if (isempty (spec))
    ## 颜色来自唯一那份调色板（以前这张表在这里又抄了一遍，见 __pb_palette__.m）
    cc0 = __pb_palette__ (numel (s.series) + 1);
    [ls, ~, mk] = __pb_linespec__ ("b");
    cc = cc0;
  else
    [ls, cc, mk] = __pb_linespec__ (spec);
  endif

  if (isvector (x) && isvector (y))
    cols = {{x(:), y(:)}};
  elseif (isvector (x) && ismatrix (y) && rows (y) == numel (x))
    cols = {};
    for k = 1:columns (y)
      cols{end+1} = {x(:), y(:, k)};
    endfor
  elseif (isequal (size (x), size (y)))
    cols = {};
    for k = 1:columns (y)
      cols{end+1} = {x(:, k), y(:, k)};
    endfor
  else
    error ("plot bridge: X and Y sizes do not match.");
  endif

  for k = 1:numel (cols)
    s.n += 1;
    fn = sprintf ("/tmp/pb%d.dat", s.n);
    D = [cols{k}{1}, cols{k}{2}];
    save ("-ascii", fn, "D");
    st = style;
    if (strcmp (style, "lines"))
      if (strcmp (ls.name, "none"))
        st = "points";
      elseif (! strcmp (mk, "none"))
        st = "linespoints";
      endif
    endif
    sr = struct ("file", sprintf ("pb%d.dat", s.n), "style", st, ...
                 "color", cc, "dt", ls.dt, "pt", 0, "ps", 1.0, ...
                 "title", "", "marker", mk);
    if (strcmp (mk, "none") && strcmp (style, "points"))
      sr.style = "points";
    endif
    s.series{end+1} = sr;
  endfor

endfunction

function [ls, cc, mk] = __pb_linespec__ (spec)

  ls = struct ("name", "solid", "dt", 0);
  cc = "#0000FF";
  mk = "none";
  if (isempty (spec))
    return;
  endif
  [style, color, marker] = colstyle (spec);
  switch (style)
    case "--", ls = struct ("name", "dashed", "dt", 2);
    case ":",  ls = struct ("name", "dotted", "dt", 3);
    case "-.", ls = struct ("name", "dashdot", "dt", 4);
    case "none", ls = struct ("name", "none", "dt", 0);
  endswitch
  if (ischar (color))
    switch (color)
      case "b", cc = "#0000FF";
      case "g", cc = "#008000";
      case "r", cc = "#FF0000";
      case "c", cc = "#00FFFF";
      case "m", cc = "#FF00FF";
      case "y", cc = "#FFFF00";
      case "k", cc = "#000000";
      case "w", cc = "#FFFFFF";
    endswitch
  elseif (isnumeric (color) && numel (color) == 3)
    cc = sprintf ("#%02X%02X%02X", round (color(1) * 255), ...
                  round (color(2) * 255), round (color(3) * 255));
  endif
  if (ischar (marker) && ! strcmp (marker, "none"))
    mk = marker;
  endif

endfunction
