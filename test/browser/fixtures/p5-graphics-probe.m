## P5 前置：**零重链现状探针** —— 量清当前"图形渲染栈"到底有什么、缺什么。
## 由 test/browser/probe-p5-run.mjs 写进 wasm FS 再 run。
##
## 为什么先量这个：P5 的方向是 **OSMesa**（Mesa 软件光栅化），目标是让 Octave 自己的
## `opengl_renderer` 原样跑起来。在动手建 Mesa 之前，先把"现在有没有 GL 相关的东西"
## 逐条问清楚，免得照着一个错误的前提开工。

printf ("build=%s\n", version ());

## --- 1) toolkit 面：现在能用哪些 ---
printf ("P1) available_toolkits={%s}\n", strjoin (available_graphics_toolkits (), ","));
printf ("P2) loaded_toolkits={%s}\n", strjoin (loaded_graphics_toolkits (), ","));
printf ("P3) default_toolkit=%s\n", graphics_toolkit ());

## --- 2) OpenGL 相关符号在不在（决定 opengl_renderer 这条路能不能走）---
printf ("P4) exist __opengl_plot__      = %d\n", exist ("__opengl_plot__"));
printf ("P5) exist __opengl_plot_intern__= %d\n", exist ("__opengl_plot_intern__"));
printf ("P6) exist __init_gl__          = %d\n", exist ("__init_gl__"));
printf ("P7) exist __gh_manager__       = %d\n", exist ("__gh_manager__"));
printf ("P8) exist __go_draw_axes__     = %d\n", exist ("__go_draw_axes__"));
printf ("P9) exist __gnuplot_drawnow__  = %d\n", exist ("__gnuplot_drawnow__"));
printf ("P10) exist __fltk_redraw__     = %d\n", exist ("__fltk_redraw__"));

## --- 3) 渲染出口：print / getframe / 屏幕 ---
try
  clf; plot (1:5); print ("/tmp/p5.svg", "-dsvg");
  d = dir ("/tmp/p5.svg");
  printf ("P11) print -dsvg  OK bytes=%d\n", d.bytes);
catch e
  printf ("P11) print -dsvg ERR: %s\n", e.message);
end_try_catch

try
  clf; plot (1:5); print ("/tmp/p5.png", "-dpng");
  printf ("P12) print -dpng OK\n");
catch e
  printf ("P12) print -dpng ERR: %s\n", e.message);
end_try_catch

try
  clf; plot (1:5); f = getframe ();
  printf ("P13) getframe OK size=[%d %d]\n", rows (f.cdata), columns (f.cdata));
catch e
  printf ("P13) getframe ERR: %s\n", e.message);
end_try_catch

try
  clf; plot (1:5); drawnow ();
  printf ("P14) drawnow OK\n");
catch e
  printf ("P14) drawnow ERR: %s\n", e.message);
end_try_catch

## --- 4) 现有渲染栈的"真实成分"：桥产出的 SVG 里有什么图元 ---
try
  hf = figure (); clf; plot (1:10, (1:10).^2);
  print ("/tmp/p5b.svg", "-dsvg");
  s = fileread ("/tmp/p5b.svg");
  printf ("P15) bridge SVG: polyline=%d text=%d bytes=%d\n", ...
          numel (strfind (s, "<polyline")), numel (strfind (s, "<text")), numel (s));
catch e
  printf ("P15) ERR: %s\n", e.message);
end_try_catch

## --- 5) OpenGL 是否编进构建（config 面）---
printf ("P16) exist gl_renderer       = %d\n", exist ("gl_renderer"));
try
  printf ("P17) __have_feature__ 探测: OPENGL=%d\n", __have_feature__ ("OPENGL"));
catch e
  printf ("P17) __have_feature__ ERR: %s\n", e.message);
end_try_catch
try
  feats = __have_feature__ ("all");
  printf ("P18) features: %s\n", strjoin (feats, ","));
catch e
  printf ("P18) ERR: %s\n", e.message);
end_try_catch
