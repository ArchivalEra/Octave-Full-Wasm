## T2 图形句柄探针（由 test/browser/probe-t2-run.mjs 写进 wasm 的 FS 再 run）
## 目的：逐条问清"图形对象到底建出来没有"——figure / axes / line / text 各自的情况。
## 注意：`a` 到 `h` 这些编号与探测脚本里的输出前缀一一对应，别改。

printf ("avail={%s} loaded={%s} def=%s\n", ...
        strjoin (available_graphics_toolkits (), ","), ...
        strjoin (loaded_graphics_toolkits (), ","), ...
        graphics_toolkit ());

try
  h = __go_figure__ (11);
  printf ("A) __go_figure__(11) -> h=%g ishandle=%d children=%d\n", ...
          h, ishandle (h), numel (get (0, "children")));
catch e
  printf ("A) ERR: %s\n", e.message);
end_try_catch

try
  printf ("B) get(h,'type') = %s\n", get (h, "type"));
catch e
  printf ("B) ERR: %s\n", e.message);
end_try_catch

try
  printf ("C) figure toolkit = [%s]\n", get (h, "__graphics_toolkit__"));
catch e
  printf ("C) ERR: %s\n", e.message);
end_try_catch

## axes 单独建（不经过 gca，避免 gca 内部把错误吞掉）
try
  hf2 = figure ();
  ha = axes ("parent", hf2);
  printf ("J) axes(parent,hf) -> ha=%g ishandle=%d children(hf)=%d\n", ...
          ha, ishandle (ha), numel (get (hf2, "children")));
catch e
  printf ("J) ERR: %s\n", e.message);
end_try_catch

try
  printf ("J2) get(ha,'type') = %s\n", get (ha, "type"));
catch e
  printf ("J2) ERR: %s\n", e.message);
end_try_catch

## line：直接往已有 axes 里画（plot 走 .m 桥，这条走原生 __go_line__ 路径）
try
  hl = line ("parent", ha, "xdata", [1 2 3], "ydata", [1 4 9]);
  printf ("K) line -> hl=%g ishandle=%d children(axes)=%d\n", ...
          hl, ishandle (hl), numel (get (ha, "children")));
catch e
  printf ("K) ERR: %s\n", e.message);
end_try_catch

## 属性读写：这才是 T2 真正要救活的语义
try
  set (ha, "xlim", [0 5]);
  xl = get (ha, "xlim");
  printf ("I) set/get xlim -> [%g %g]\n", xl(1), xl(2));
catch e
  printf ("I) ERR: %s\n", e.message);
end_try_catch

try
  title ("hello");   ## plotbridge 的 title 只吃文本（不吃句柄）
  printf ("H) title = [%s]\n", get (get (ha, "title"), "string"));
catch e
  printf ("H) ERR: %s\n", e.message);
end_try_catch

## gca/gcf 路线（用户最常走的）
try
  hf4 = figure (); clf;
  plot (1:10);
  printf ("F) plot 之后 gcf=%g gca=%g children(gca)=%d\n", ...
          gcf (), gca (), numel (get (gca (), "children")));
catch e
  printf ("F) ERR: %s\n", e.message);
end_try_catch

try
  close (hf4);
  printf ("M) close 成功\n");
catch e
  printf ("M) ERR: %s\n", e.message);
end_try_catch
