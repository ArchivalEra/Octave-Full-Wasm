## Pure-.m SVG renderer for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Reads the global __pb__ plot-bridge state (the same state the JS side
## consumes for gnuplot) and returns a complete standalone SVG document.
##
## Why a second renderer: `print` must work *inside* Octave, synchronously.
## The gnuplot bridge lives on the JS side and can only be driven after
## eval_string returns — there is no sync channel without Asyncify. So
## print -dsvg generates its own SVG here instead of round-tripping JS.
##
## Supported: lines / linespoints / points / stem / boxes, all eight colour
## letters + RGB triples, dashtype patterns, the full marker table, log axes,
## xlim/ylim, grid, legend (18 locations), title/xlabel/ylabel (CJK included —
## the browser supplies the font, we only name the family).
##
## Usage: svg = __svg_render__ ();  svg = __svg_render__ (width, height);

function svg = __svg_render__ (varargin)

  s = __pstate__ ();

  W = 640; H = 480;
  if (nargin >= 1 && isnumeric (varargin{1}) && ! isempty (varargin{1}))
    W = max (200, round (varargin{1}));
  endif
  if (nargin >= 2 && isnumeric (varargin{2}) && ! isempty (varargin{2}))
    H = max (150, round (varargin{2}));
  endif

  ML = 84; MR = 28; MT = 56; MB = 66;
  PW = W - ML - MR;
  PH = H - MT - MB;

  ## ---- load series data ----
  n = numel (s.series);
  D = cell (1, n);
  for i = 1:n
    fn = ["/tmp/" s.series{i}.file];
    d = zeros (0, 2);
    if (exist (fn, "file"))
      try
        raw = load ("-ascii", fn);
      catch
        raw = [];
      end_try_catch
      if (! isempty (raw) && columns (raw) >= 2)
        d = raw(:, 1:2);
      endif
    endif
    D{i} = d;
  endfor

  ## ---- data bounds (in transformed space) ----
  xlo = Inf; xhi = -Inf; ylo = Inf; yhi = -Inf;
  for i = 1:n
    d = D{i};
    if (isempty (d)), continue; endif
    keep = isfinite (d(:,1)) & isfinite (d(:,2));
    if (s.logx), keep = keep & (d(:,1) > 0); endif
    if (s.logy), keep = keep & (d(:,2) > 0); endif
    d = d(keep, :);
    if (isempty (d)), continue; endif
    xv = __svg_logt__ (d(:,1), s.logx);
    yv = __svg_logt__ (d(:,2), s.logy);
    xlo = min (xlo, min (xv)); xhi = max (xhi, max (xv));
    ylo = min (ylo, min (yv)); yhi = max (yhi, max (yv));
  endfor

  ## ---- explicit limits win over data bounds ----
  if (numel (s.xlim) == 2 && isfinite (s.xlim(1)) && isfinite (s.xlim(2)))
    a = __svg_logt__ (s.xlim(1), s.logx);
    b = __svg_logt__ (s.xlim(2), s.logx);
    if (isfinite (a) && isfinite (b) && b > a)
      xlo = a; xhi = b;
    endif
  endif
  if (numel (s.ylim) == 2 && isfinite (s.ylim(1)) && isfinite (s.ylim(2)))
    a = __svg_logt__ (s.ylim(1), s.logy);
    b = __svg_logt__ (s.ylim(2), s.logy);
    if (isfinite (a) && isfinite (b) && b > a)
      ylo = a; yhi = b;
    endif
  endif

  ## ---- degenerate ranges ----
  if (! (isfinite (xlo) && isfinite (xhi)) || xhi <= xlo)
    xlo = min (xlo, 0); xhi = xlo + 1;
    if (! isfinite (xlo)), xlo = 0; xhi = 1; endif
  endif
  if (! (isfinite (ylo) && isfinite (yhi)) || yhi <= ylo)
    ylo = min (ylo, 0); yhi = ylo + 1;
    if (! isfinite (ylo)), ylo = 0; yhi = 1; endif
  endif
  xlo = __svg_loose__ (xlo, xhi);  xhi = __svg_hiloose__ (xlo, xhi);
  ylo = __svg_loose__ (ylo, yhi);  yhi = __svg_hiloose__ (ylo, yhi);

  ## ---- ticks ----
  [xt, xtl] = __svg_ticks__ (xlo, xhi, s.logx, 7);
  [yt, ytl] = __svg_ticks__ (ylo, yhi, s.logy, 6);

  ## ---- header ----
  FONT = "Helvetica, Arial, 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
  out = {};
  out{end+1} = sprintf ('<?xml version="1.0" encoding="UTF-8"?>\n');
  out{end+1} = sprintf ('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="%d" height="%d" viewBox="0 0 %d %d">\n', W, H, W, H);
  out{end+1} = sprintf ('<defs><clipPath id="pa"><rect x="%.2f" y="%.2f" width="%.2f" height="%.2f"/></clipPath></defs>\n', ML, MT, PW, PH);
  out{end+1} = sprintf ('<rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>\n', W, H);

  ## ---- grid ----
  if (s.grid)
    g = {};
    for k = 1:numel (xt)
      xp = __svg_mapx__ (xt(k), s.logx, xlo, xhi, ML, PW);
      g{end+1} = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#d9d9d9" stroke-width="1"/>\n', xp, MT, xp, MT + PH);
    endfor
    for k = 1:numel (yt)
      yp = __svg_mapy__ (yt(k), s.logy, ylo, yhi, MT, PH);
      g{end+1} = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#d9d9d9" stroke-width="1"/>\n', ML, yp, ML + PW, yp);
    endfor
    out = [out, g];
  endif

  ## ---- series (clipped to the axes box) ----
  ## NOTE: never write `[out, f (args)]` with a space before the paren — inside
  ## brackets Octave parses `f (args)` as *indexing*, not a call, and a function
  ## name cannot be indexed, so the file fails to parse. Bind the result first.
  out{end+1} = sprintf ('<g clip-path="url(#pa)">\n');
  for i = 1:n
    frag = __svg_series__ (s, s.series{i}, D{i}, xlo, xhi, ylo, yhi, ML, MT, PW, PH);
    out = [out, frag];
  endfor
  out{end+1} = sprintf ('</g>\n');

  ## ---- axes frame ----
  out{end+1} = sprintf ('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="none" stroke="#333333" stroke-width="1.2"/>\n', ML, MT, PW, PH);

  ## ---- tick marks + labels ----
  for k = 1:numel (xt)
    xp = __svg_mapx__ (xt(k), s.logx, xlo, xhi, ML, PW);
    out{end+1} = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#333333" stroke-width="1.2"/>\n', xp, MT + PH, xp, MT + PH + 6);
    out{end+1} = sprintf ('<text x="%.2f" y="%.2f" font-family="%s" font-size="12" text-anchor="middle" fill="#222222">%s</text>\n', xp, MT + PH + 21, FONT, __svg_esc__ (xtl{k}));
  endfor
  for k = 1:numel (yt)
    yp = __svg_mapy__ (yt(k), s.logy, ylo, yhi, MT, PH);
    out{end+1} = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#333333" stroke-width="1.2"/>\n', ML - 6, yp, ML, yp);
    out{end+1} = sprintf ('<text x="%.2f" y="%.2f" font-family="%s" font-size="12" text-anchor="end" fill="#222222">%s</text>\n', ML - 10, yp + 4.2, FONT, __svg_esc__ (ytl{k}));
  endfor

  ## ---- title / axis labels ----
  if (! isempty (s.title))
    out{end+1} = sprintf ('<text x="%.2f" y="%.2f" font-family="%s" font-size="15" font-weight="bold" text-anchor="middle" fill="#111111">%s</text>\n', ML + PW/2, MT - 22, FONT, __svg_esc__ (s.title));
  endif
  if (! isempty (s.xlabel))
    out{end+1} = sprintf ('<text x="%.2f" y="%.2f" font-family="%s" font-size="13" text-anchor="middle" fill="#222222">%s</text>\n', ML + PW/2, MT + PH + 46, FONT, __svg_esc__ (s.xlabel));
  endif
  if (! isempty (s.ylabel))
    out{end+1} = sprintf ('<text x="%.2f" y="%.2f" font-family="%s" font-size="13" text-anchor="middle" fill="#222222" transform="rotate(-90 %.2f %.2f)">%s</text>\n', 20, MT + PH/2, FONT, 20, MT + PH/2, __svg_esc__ (s.ylabel));
  endif

  ## ---- legend ----
  if (! isempty (s.legend))
    lgfrag = __svg_legend__ (s, FONT, ML, MT, PW, PH);
    out = [out, lgfrag];
  endif

  out{end+1} = sprintf ('</svg>\n');
  svg = [out{:}];

endfunction


## ---------------------------------------------------------------- helpers

function t = __svg_logt__ (v, uselog)
  if (uselog)
    t = v;
    t(v <= 0) = NaN;
    t = log10 (t);
  else
    t = v;
  endif
endfunction

function lo = __svg_loose__ (lo, hi)
  d = hi - lo;
  if (d > 0 && isfinite (d)), lo = lo - 0.04 * d; endif
endfunction

function hi = __svg_hiloose__ (lo, hi)
  d = hi - lo;
  if (d > 0 && isfinite (d)), hi = hi + 0.04 * d; endif
endfunction

function xp = __svg_mapx__ (v, uselog, lo, hi, ML, PW)
  u = __svg_logt__ (v, uselog);
  u = min (max (u, lo), hi);
  xp = ML + (u - lo) / (hi - lo) * PW;
endfunction

function yp = __svg_mapy__ (v, uselog, lo, hi, MT, PH)
  u = __svg_logt__ (v, uselog);
  u = min (max (u, lo), hi);
  yp = MT + (hi - u) / (hi - lo) * PH;
endfunction

## Nice ticks: linear picks 1/2/5*10^k; log picks integer decades.
function [t, lab] = __svg_ticks__ (lo, hi, uselog, want)
  t = []; lab = {};
  if (! (isfinite (lo) && isfinite (hi) && hi > lo)), return; endif

  if (uselog)
    k0 = ceil (lo - 1e-9);
    k1 = floor (hi + 1e-9);
    if (k1 - k0 > 12)
      st = ceil ((k1 - k0) / 12);
      ks = k0:st:k1;
    else
      ks = k0:k1;
    endif
    for k = ks
      t(end+1) = k;
      lab{end+1} = __svg_num__ (10^k);
    endfor
    if (isempty (t))
      t = [lo hi];
      lab = {__svg_num__ (10^lo), __svg_num__ (10^hi)};
    endif
    return;
  endif

  raw = (hi - lo) / max (want, 1);
  e = floor (log10 (raw));
  f = raw / 10^e;
  if (f < 1.5)
    st = 1;
  elseif (f < 3)
    st = 2;
  elseif (f < 7)
    st = 5;
  else
    st = 10;
  endif
  st = st * 10^e;

  t0 = ceil (lo / st) * st;
  ks = t0:st:hi;
  for k = ks
    t(end+1) = k;
    lab{end+1} = __svg_num__ (k);
  endfor
  if (isempty (t))
    t = [lo hi];
    lab = {__svg_num__ (lo), __svg_num__ (hi)};
  endif
endfunction

## Human-readable number without trailing zeros / exponent noise.
function s = __svg_num__ (v)
  av = abs (v);
  if (av != 0 && (av >= 1e6 || av < 1e-4))
    s = strtrim (sprintf ("%.3g", v));
    s = strrep (s, "e+0", "e");
    s = strrep (s, "e+", "e");
    s = strrep (s, "e-0", "e-");
  else
    s = sprintf ("%.6g", v);
    if (index (s, ".") > 0)
      s = strrep (s, "0", "0");   # keep, only trim below
      while (numel (s) > 1 && s(end) == "0"), s(end) = []; endwhile
      if (numel (s) > 0 && s(end) == "."), s(end) = []; endif
    endif
  endif
endfunction

function s = __svg_esc__ (t)
  s = char (t);
  s = strrep (s, "&", "&amp;");
  s = strrep (s, "<", "&lt;");
  s = strrep (s, ">", "&gt;");
  s = strrep (s, '"', "&quot;");
  s = strrep (s, char (10), " ");
  s = strrep (s, char (13), " ");
endfunction

## dashtype -> stroke-dasharray
function da = __svg_dash__ (dt)
  switch (dt)
    case 1, da = "";
    case 2, da = ' stroke-dasharray="8,4"';
    case 3, da = ' stroke-dasharray="2,3"';
    case 4, da = ' stroke-dasharray="8,3,2,3"';
    otherwise, da = "";
  endswitch
endfunction

## Marker glyph at (x,y) with radius r in colour col.
function t = __svg_marker__ (mk, x, y, r, col)
  t = "";
  if (isempty (mk) || strcmp (mk, "none")), return; endif
  sw = 1.4;
  switch (mk)
    case "."
      t = sprintf ('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s" stroke="none"/>\n', x, y, max (1.4, r * 0.55), col);
    case "o"
      t = sprintf ('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#ffffff" stroke="%s" stroke-width="%.2f"/>\n', x, y, r, col, sw);
    case "s"
      t = sprintf ('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#ffffff" stroke="%s" stroke-width="%.2f"/>\n', x - r, y - r, 2*r, 2*r, col, sw);
    case "d"
      t = sprintf ('<polygon points="%.2f,%.2f %.2f,%.2f %.2f,%.2f %.2f,%.2f" fill="#ffffff" stroke="%s" stroke-width="%.2f"/>\n', x, y - r*1.3, x + r*1.3, y, x, y + r*1.3, x - r*1.3, y, col, sw);
    case "^"
      t = __svg_tri__ (x, y, r, 0, col, sw);
    case "v"
      t = __svg_tri__ (x, y, r, 2, col, sw);
    case ">"
      t = __svg_tri__ (x, y, r, 1, col, sw);
    case "<"
      t = __svg_tri__ (x, y, r, 3, col, sw);
    case "p"
      t = __svg_ngon__ (x, y, r * 1.15, 5, col, sw);
    case "h"
      t = __svg_ngon__ (x, y, r * 1.15, 6, col, sw);
    case "+"
      t = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%.2f"/>\n<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%.2f"/>\n', x - r, y, x + r, y, col, sw, x, y - r, x, y + r, col, sw);
    case "x"
      d = r * 0.72;
      t = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%.2f"/>\n<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%.2f"/>\n', x - d, y - d, x + d, y + d, col, sw, x - d, y + d, x + d, y - d, col, sw);
    case "*"
      d = r * 0.8;
      t = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%.2f"/>\n<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%.2f"/>\n<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%.2f"/>\n', x - d, y, x + d, y, col, sw, x, y - d, x, y + d, col, sw, x - d*0.7, y - d*0.7, x + d*0.7, y + d*0.7, col, sw);
    otherwise
      t = sprintf ('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#ffffff" stroke="%s" stroke-width="%.2f"/>\n', x, y, r, col, sw);
  endswitch
endfunction

## tri orientation: 0=up 1=right 2=down 3=left
function t = __svg_tri__ (x, y, r, o, col, sw)
  R = r * 1.25;
  switch (o)
    case 0, p = [x, y - R; x + R*0.92, y + R*0.66; x - R*0.92, y + R*0.66];
    case 1, p = [x + R, y; x - R*0.66, y - R*0.92; x - R*0.66, y + R*0.92];
    case 2, p = [x, y + R; x + R*0.92, y - R*0.66; x - R*0.92, y - R*0.66];
    case 3, p = [x - R, y; x + R*0.66, y - R*0.92; x + R*0.66, y + R*0.92];
  endswitch
  t = sprintf ('<polygon points="%.2f,%.2f %.2f,%.2f %.2f,%.2f" fill="#ffffff" stroke="%s" stroke-width="%.2f"/>\n', p(1,1), p(1,2), p(2,1), p(2,2), p(3,1), p(3,2), col, sw);
endfunction

function t = __svg_ngon__ (x, y, r, k, col, sw)
  pts = "";
  for i = 1:k
    a = -pi/2 + 2*pi*(i-1)/k;
    if (i > 1), pts = [pts " "]; endif
    pts = sprintf ("%s%.2f,%.2f", pts, x + r*cos (a), y + r*sin (a));
  endfor
  t = sprintf ('<polygon points="%s" fill="#ffffff" stroke="%s" stroke-width="%.2f"/>\n', pts, col, sw);
endfunction

## One series -> SVG fragment (already clipped by the caller's group).
function out = __svg_series__ (s, sr, d, xlo, xhi, ylo, yhi, ML, MT, PW, PH)

  out = {};
  if (isempty (d)), return; endif

  ## rows usable in the transformed space
  keep = isfinite (d(:,1)) & isfinite (d(:,2));
  if (s.logx), keep = keep & (d(:,1) > 0); endif
  if (s.logy), keep = keep & (d(:,2) > 0); endif
  d = d(keep, :);
  if (isempty (d)), return; endif

  col = sr.color;
  if (isempty (col)), col = "#0072BD"; endif
  dt = 0;
  if (isfield (sr, "dt") && ! isempty (sr.dt)), dt = sr.dt; endif
  mk = "none";
  if (isfield (sr, "marker") && ischar (sr.marker)), mk = sr.marker; endif
  st = sr.style;

  X = arrayfun (@(v) __svg_mapx__ (v, s.logx, xlo, xhi, ML, PW), d(:,1));
  Y = arrayfun (@(v) __svg_mapy__ (v, s.logy, ylo, yhi, MT, PH), d(:,2));

  da = __svg_dash__ (dt);

  if (strcmp (st, "lines") || strcmp (st, "linespoints"))
    pts = "";
    for k = 1:numel (X)
      if (k > 1), pts = [pts " "]; endif
      pts = sprintf ("%s%.2f,%.2f", pts, X(k), Y(k));
    endfor
    out{end+1} = sprintf ('<polyline points="%s" fill="none" stroke="%s" stroke-width="1.6"%s stroke-linejoin="round"/>\n', pts, col, da);
    if (strcmp (st, "linespoints"))
      for k = 1:numel (X)
        out{end+1} = __svg_marker__ (mk, X(k), Y(k), 3.2, col);
      endfor
    endif
  elseif (strcmp (st, "points"))
    mkp = mk;
    if (strcmp (mkp, "none")), mkp = "o"; endif
    for k = 1:numel (X)
      out{end+1} = __svg_marker__ (mkp, X(k), Y(k), 3.4, col);
    endfor
  elseif (strcmp (st, "stem"))
    if (s.logy)
      ybase = MT + PH;
    else
      ybase = __svg_mapy__ (0, false, ylo, yhi, MT, PH);
    endif
    mkp = mk;
    if (strcmp (mkp, "none")), mkp = "o"; endif
    for k = 1:numel (X)
      out{end+1} = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="1.2"%s/>\n', X(k), Y(k), X(k), ybase, col, da);
    endfor
    for k = 1:numel (X)
      out{end+1} = __svg_marker__ (mkp, X(k), Y(k), 3.2, col);
    endfor
  elseif (strcmp (st, "boxes"))
    xs = sort (d(:,1));
    if (numel (xs) > 1)
      dx = min (diff (xs));
      if (! (dx > 0)), dx = 1; endif
    else
      dx = 1;
    endif
    if (s.logy)
      ybase = MT + PH;
    else
      ybase = __svg_mapy__ (0, false, ylo, yhi, MT, PH);
    endif
    for k = 1:size (d, 1)
      xl = __svg_mapx__ (d(k,1) - 0.4*dx, s.logx, xlo, xhi, ML, PW);
      xr = __svg_mapx__ (d(k,1) + 0.4*dx, s.logx, xlo, xhi, ML, PW);
      yy = __svg_mapy__ (d(k,2), s.logy, ylo, yhi, MT, PH);
      top = min (yy, ybase);
      hh = abs (yy - ybase);
      out{end+1} = sprintf ('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s" fill-opacity="0.55" stroke="%s" stroke-width="1.1"/>\n', xl, top, max (0.6, xr - xl), max (0.6, hh), col, col);
    endfor
  endif

endfunction

function out = __svg_legend__ (s, FONT, ML, MT, PW, PH)

  out = {};
  labels = s.legend;
  n = numel (s.series);
  m = numel (labels);
  if (m == 0), return; endif

  sw = 26; sh = 20;
  fs = 12.5;
  maxlen = 0;
  for i = 1:m
    maxlen = max (maxlen, numel (labels{i}));
  endfor
  lw = 34 + max (maxlen * 7.2, 30);
  lh = m * sh + 10;

  loc = lower (strrep (s.legloc, " ", ""));
  outside = ! isempty (strfind (loc, "outside")) || ! isempty (strfind (loc, "eastoutside")) || ! isempty (strfind (loc, "westoutside"));
  if (outside)
    lh = m * sh + 10;   # drawn inside anyway (no canvas growth in v1)
    outside = false;
  endif

  ## anchors: default north-east inside
  if (isempty (loc))
    ax = ML + PW - lw - 10; ay = MT + 10;
  elseif (! isempty (strfind (loc, "northwest")) || strcmp (loc, "northwestoutside"))
    ax = ML + 10; ay = MT + 10;
  elseif (! isempty (strfind (loc, "north")) )
    ax = ML + (PW - lw)/2; ay = MT + 10;
  elseif (! isempty (strfind (loc, "southwest")))
    ax = ML + 10; ay = MT + PH - lh - 10;
  elseif (! isempty (strfind (loc, "southeast")))
    ax = ML + PW - lw - 10; ay = MT + PH - lh - 10;
  elseif (! isempty (strfind (loc, "south")))
    ax = ML + (PW - lw)/2; ay = MT + PH - lh - 10;
  elseif (! isempty (strfind (loc, "west")))
    ax = ML + 10; ay = MT + (PH - lh)/2;
  elseif (! isempty (strfind (loc, "east")))
    ax = ML + PW - lw - 10; ay = MT + (PH - lh)/2;
  else
    ax = ML + PW - lw - 10; ay = MT + 10;
  endif

  out{end+1} = sprintf ('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#ffffff" fill-opacity="0.88" stroke="#666666" stroke-width="1"/>\n', ax, ay, lw, lh);

  for i = 1:min (m, n)
    yy = ay + 5 + (i - 0.5) * sh;
    sr = s.series{i};
    col = sr.color;
    if (isempty (col)), col = "#0072BD"; endif
    mk = "none";
    if (isfield (sr, "marker") && ischar (sr.marker)), mk = sr.marker; endif
    st = sr.style;
    dt = 0;
    if (isfield (sr, "dt") && ! isempty (sr.dt)), dt = sr.dt; endif
    da = __svg_dash__ (dt);

    if (strcmp (st, "points"))
      out{end+1} = __svg_marker__ (mk, ax + 16, yy, 3.4, col);
    elseif (strcmp (st, "boxes"))
      out{end+1} = sprintf ('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s" fill-opacity="0.55" stroke="%s"/>\n', ax + 7, yy - 5, 18, 10, col, col);
    else
      out{end+1} = sprintf ('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="1.6"%s/>\n', ax + 7, yy, ax + 25, yy, col, da);
      if (strcmp (st, "linespoints") || strcmp (st, "stem"))
        out{end+1} = __svg_marker__ (mk, ax + 16, yy, 3.2, col);
      endif
    endif
    out{end+1} = sprintf ('<text x="%.2f" y="%.2f" font-family="%s" font-size="%.1f" fill="#111111">%s</text>\n', ax + 30, yy + 4.3, FONT, fs, __svg_esc__ (labels{i}));
  endfor

endfunction
