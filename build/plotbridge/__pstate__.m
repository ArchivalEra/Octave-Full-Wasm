## Plot-bridge state holder (own code, repo license).
## Global struct __pb__ + emit spec file on every update.

function s = __pstate__ (varargin)

  global __pb__;
  if (isempty (__pb__))
    __pb__ = struct ("hold", false, "title", "", "xlabel", "", "ylabel", "",
                     "xlim", [], "ylim", [], "grid", false, ...
                     "legloc", "", ...
                     "logx", false, "logy", false, "n", 0);
    __pb__.legend = {};
    __pb__.series = {};
    ## v2 additions (kept out of the struct() call so older callers that
    ## rebuild state by hand stay compatible):
    ##   axis      — "" | "equal" | "tight" | "off"   (see axis.m)
    ##   panels    — subplot cell; the ACTIVE panel is mirrored in the flat
    ##               fields above, so no other shim needs to know (see
    ##               __pb_panel__.m)
    ##   active    — index of the panelled entry mirrored on top
    ##   panel_pos — [l b w h] of the active panel ([] when not panelled)
    ##   figs/fig_n— saved figures for figure(n) switching (see __pb_figure__.m)
    __pb__.axis = "";
    __pb__.panels = {};
    __pb__.active = 0;
    __pb__.panel_pos = [];
    __pb__.panel_tag = "";
    __pb__.figs = {};
    __pb__.fig_n = 1;
  endif
  if (nargin > 0)
    s2 = varargin{1};
    ## Fill v2 fields on states built by older shims.
    if (! isfield (s2, "axis")), s2.axis = ""; endif
    if (! isfield (s2, "panels")), s2.panels = {}; endif
    if (! isfield (s2, "active")), s2.active = 0; endif
    if (! isfield (s2, "panel_pos")), s2.panel_pos = []; endif
    if (! isfield (s2, "panel_tag")), s2.panel_tag = ""; endif
    if (! isfield (s2, "figs")), s2.figs = {}; endif
    if (! isfield (s2, "fig_n")), s2.fig_n = 1; endif
    __pb__ = s2;
    __pb_emit__ ();
  endif
  s = __pb__;

endfunction
