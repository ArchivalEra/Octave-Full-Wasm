## plot 桥：**"当前有没有真渲染器在线"** 的唯一判定点（own code, repo license）。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 这个判断有两个用途，都从这里取（**只此一处**，别再各写一份）：
##
##   ① `__pb_mirror__` 用它决定"要不要把这次调用同时镜像成真图形对象"；
##   ② 桥自己的**数据管线**（`__pb_add__` 建 series + 写 `/tmp/pbN.dat`、
##      `__pb_surface__` 的逐单元循环、`__pb_emit__` 的 JSON 序列化）用它决定
##      "要不要跳过"。
##
## ── 为什么② 也要跳过（这是 2026-09-23 实测出来的）──────────────────────────
## 桥的数据管线是给**它自己的两个渲染器**吃的：页面上那颗 gnuplot-wasm
## （`bridge/plotbridge.js` 生成 gnuplot 脚本）与 `print -dsvg`（`__svg_render__.m`）。
## 可一旦真渲染器（`webgl`）在线，**页面显示的是 toolkit 渲出来的 PNG**，
## 而 `print -dsvg` 也由 toolkit 走官方 `gl2ps_print` —— 桥那份 series 就**没人看了**。
##
## 而它很贵。实测 `surf(peaks(40))`（8768，桌面，**逐单元发 series 那版**）：
##
##     桥的 surf 总计            ≈ 1686 ms
##       ├ __pb_surface__ 建 1521 条 series  1386 ms   ← 39×39 个单元各一条
##       │   └ 其中 save -ascii 写 1521 个文件   312 ms
##       └ __pstate__ 两次 emit（每次 ~200ms，与 series 数成正比）  ~390 ms
##     对照：核心 surface()（不过桥）              52 ms
##     纯渲染（toolkit 真画像素）                  7–12 ms
##
## （那 1386 ms 已经在 2026-09-23 用"按行发 series"消掉了 —— 39 条而不是 1521 条，
##  见 `__pb_surface__.m`；端到端那 ~2.1s 后来查明主要是**冷启动**，见 NOTES-webgl.md §4.6。）
##
## ⇒ 关掉真渲染器时桥必须原样工作（无 GL 的构建就靠它）；开着时它整条数据管线是纯浪费。
##
## 白名单：只有**真会渲染出像素**的 toolkit 才算。`web`（T2）不渲染，
## 它只提供句柄语义 —— 那种模式下桥仍然是唯一出图路径，绝不能跳过。
function tf = __pb_real_renderer__ ()

  tf = false;

  try
    tk = graphics_toolkit ();
  catch
    return;
  end_try_catch

  if (! (ischar (tk) && ! isempty (tk)))
    return;
  endif

  ## 加了新渲染器就往这里加名字。
  ## （`osmesa` 2026-09-23 已退役，从名单里去掉：后端没了，留着只会让"哪些站点会镜像"
  ##   这件事读起来含糊。历史后端见 git 的 graphics-osmesa 分支。）
  tf = any (strcmpi (tk, {"webgl"}));

endfunction
