## Error-bar series appender for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Stores bars in triples: every three consecutive points are
## (x, y-low), (x, y), (x, y-high) — one vertical bar with a stem.  The
## renderers draw consecutive triples as a bar and the rest as a polyline.
##
## Keeping the grouping in the point order (rather than in extra JSON fields)
## means neither renderer needs new schema plumbing.

function s = __pb_errbars__ (s, x, y, dir)

  s = __pb_add__ (s, x, y, "", "ebars");
  if (numel (s.series) > 0)
    s.series{end}.ebdir = dir;
  endif

endfunction
