## 内部属性对照脚本（**宿主与浏览器共用同一份**）
##
## 为什么需要它：2026-09-24 的工作令（build/113/PLAN-next.md §3.1）曾把
## 「`isprop (gca, '__legend_handle__')` == 0」当成**我们的 toolkit 缺属性**。
## 一量就翻案：宿主**真** Octave 11.3.0（qt / fltk / gnuplot 三个 toolkit 各跑一遍）
## 的表与我们的 wasm **逐格相同**（67 个候选名 × 2 个生命周期阶段，0 处差异）。
## 原因是核心自己的机制，不是 toolkit 的：
##   · `__legend_handle__` / `__plotyy_axes__` / `__colorbar_handle__` 这些名字是
##     核心在**用它们的那一刻**由 `addproperty` 现加的（legend.m:286、plotyy.m、
##     colorbar.m）—— 没建过 legend 的 axes 上它们本就不存在；
##   · 所有读它们的核心代码都包了 `try/catch`（`__plt__.m:48`、`axes.m:147`、
##     `hdl2struct.m:96`、`__errplot__.m:263`），所以"读不到"是**预期路径**。
## 于是本脚本的作用变成**防腐**：把"我们的属性表 == 宿主的属性表"钉死，
## 将来谁动了 toolkit / reconfigure 把某个属性弄丢，这里当场红。
##
## 用法（两边都是它）：
##   宿主：  octave --no-gui --quiet --eval "graphics_toolkit('qt'); run('本文件')"
##   浏览器：test/browser/probe-internal-props.mjs 会写进 FS 再 run，并做差分
##
## 输出格式（一行一格，便于 diff）：
##   OCTVER <version()>
##   <阶段> <名字> fig=<0|1> ax=<0|1> line=<0|1> root=<0|1>
## 阶段 P1fresh = 新建图后的干净状态；P2after = 建过 legend/plotyy/colorbar 之后。

printf ('OCTVER %s\n', version ());

names = {'__appdata__', '__autopos_tag__', '__axes_handle__', '__colorbar_handle__', '__contour__', '__countour__', '__creator__', '__default_button_pan__', '__default_button_rotate__', '__default_button_text__', '__default_button_zoomin__', '__default_button_zoomout__', '__default_menu_', '__default_menu__Edit', '__default_menu__File', '__default_menu__Tools', '__default_toolbar__', '__default_toolbar_menu_', '__device_pixel_ratio__', '__dialog__', '__do_errplot__', '__errplot__', '__fltk_uigetfile__', '__focus__', '__foobar__', '__format__', '__former_units__', '__gl_extensions__', '__gl_renderer__', '__gl_vendor__', '__gl_version__', '__graphics_toolkit__', '__guidata__', '__init_', '__item_bouding_box__', '__legend_handle__', '__legend_watcher__', '__listeners__', '__modified__', '__mouse_mode__', '__movie_frame__', '__named_icon__', '__next_label_index__', '__next_line_style__', '__ok_cancel_btn__', '__orig_data__', '__original_looseinset__', '__original_units__', '__pan_mode__', '__peer_axes_position__', '__peer_objects__', '__plot_stream__', '__plotyy_axes__', '__printing__', '__quiver__', '__rotate_mode__', '__scatter__', '__stem__', '__subplotouterposition__', '__subplotposition__', '__subplotrcn__', '__total_num_children__', '__uisetfont_struct__', '__uiwait_state__', '__updating_layout__', '__vertical__', '__zoom_mode__'};

phases = {'P1fresh', 'P2after'};

for p = 1:2
  if (p == 2)
    ## 每个都单独 try：某个 toolkit 上没有某个对象时只记一行 ERR，不中断对照
    try, legend ('a'); catch e, printf ('ACTION_ERR legend %s\n', e.message); end_try_catch
    try, plotyy (1:3, 1:3, 1:3, 2*(1:3)); catch e, printf ('ACTION_ERR plotyy %s\n', e.message); end_try_catch
    try, colorbar (); catch e, printf ('ACTION_ERR colorbar %s\n', e.message); end_try_catch
  endif

  f = gcf ();
  a = gca ();
  h = plot (1:3);
  h = h(1);

  for k = 1:numel (names)
    printf ('%s %s fig=%d ax=%d line=%d root=%d\n', phases{p}, names{k}, ...
            isprop (f, names{k}), isprop (a, names{k}), isprop (h, names{k}), isprop (0, names{k}));
  endfor
endfor
