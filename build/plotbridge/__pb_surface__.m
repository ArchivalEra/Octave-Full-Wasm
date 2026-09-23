## Surface/grid appender for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Shared by mesh/surfc/surf.  Projects an (X,Y,Z) grid to 2D and emits **one
## series per grid ROW** (not one per cell), ordered back-to-front so nearer
## rows are drawn over farther ones.
##
## MODE: "mesh"  — row polylines + column polylines (the classic wireframe)
##       "surf"  — one closed ribbon polygon per row strip, with a fill
##
## The polygons/polylines are ordinary series, so neither renderer needs 3D
## support (both consume them unchanged: JS uses `with filledcurves closed` /
## `with lines`, `__svg_render__.m` likewise).
##
## ── 为什么从"每单元一个多边形"改成"每行一条"（2026-09-23 实测）──────────────
## 原来 `nn = (nr-1)*(nc-1)` 个单元各发一条 series ⇒ `surf(peaks(40))` 就是
## **1521 条**，每条还要 `save -ascii` 写一个 `/tmp/pbN.dat`。实测总计 **1686 ms**：
##   · `__pb_surface__` 建 1521 条 series      1386 ms（其中写文件 306 ms）
##   · `__pstate__` 两次把 1521 条序列化成 JSON  ~390 ms
## 对照：核心 `surface()` 只要 52 ms，toolkit 真渲染只要 7–12 ms。
## ⇒ 瓶颈是**条数**，不是数据量（写 1 个含 1521 行的文件只要 1 ms）。
## 改成按行发（surf: nr-1 = 39 条；mesh: nr+nc = 80 条）后条数降 19–39 倍。
##
## 视觉上等价吗？`surf` 原来是**逐单元**四边填色、按单元深度排序；现在是
## **逐行**带状填色、按行深度排序。因为 `depth = sin(az)*X + cos(az)*Y` 对**行号单调**
## （Y 随行号递增，cos(az) > 0），按行排序与按单元排序的**前后关系一致** ⇒ 遮挡关系不变。
## （逐单元 vs 逐行的边缘差异只在斜视角度下可能看出极细的接缝，属可接受近似；
##   真要恢复逐单元，代价就是那 1.7 s。）

function s = __pb_surface__ (s, x, y, z, mode, spec)

  if (nargin < 6), spec = ""; endif

  [nr, nc] = size (z);
  if (nr < 2 || nc < 2)
    error ("%s: Z must be at least 2x2", mode);
  endif

  ## expand axis vectors to grids when needed
  if (isvector (x) && isvector (y) && numel (x) == nc && numel (y) == nr)
    [Xg, Yg] = meshgrid (x(:).', y(:));
  elseif (isequal (size (x), size (z)) && isequal (size (y), size (z)))
    Xg = x; Yg = y;
  else
    ## fall back to indices
    [Xg, Yg] = meshgrid (1:nc, 1:nr);
  endif

  ## project every grid node once
  [px, py] = __pb_project3__ (Xg, Yg, z, [], []);
  if (isempty (px))
    return;
  endif

  ## depth proxy along the view direction (对**行号单调**，见文件头)
  az = -37.5 * pi / 180;
  depth = sin (az) * Xg + cos (az) * Yg;

  if (strcmp (mode, "mesh"))
    ## 线框 = 行折线 + 列折线（原来靠逐单元闭合多边形才横竖都有，现在显式给两组）
    for i = 1:nr
      s = __pb_add__ (s, px(i,:).', py(i,:).', spec, "mesh");
    endfor
    for j = 1:nc
      s = __pb_add__ (s, px(:,j), py(:,j), spec, "mesh");
    endfor
  else
    ## 曲面 = 每条行带一个闭合多边形：上边正走、下边倒走、回到起点
    rowdepth = mean (depth, 2);
    [~, ord] = sort (rowdepth(1:nr-1), "descend");   # painter's: 远的先画
    for kk = 1:numel (ord)
      i = ord(kk);
      polyx = [px(i,:), fliplr(px(i+1,:)), px(i,1)].';
      polyy = [py(i,:), fliplr(py(i+1,:)), py(i,1)].';
      s = __pb_add__ (s, polyx, polyy, spec, mode);
    endfor
  endif

endfunction
