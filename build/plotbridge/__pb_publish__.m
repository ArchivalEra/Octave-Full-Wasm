## plot 桥：**把当前状态渲成一张图交给页面**（own code, repo license）。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 它在什么情况下做事 ──────────────────────────────────────────────────────
## 只在**没有真渲染器**时。这一条同时覆盖两种情况：
##   ① 站点没有带 GL 的主 wasm（toolkit 是 `web`）—— 桥本来就是唯一显示路径；
##   ② 站点带 GL 但**这台设备建不出 WebGL2 上下文**（旧浏览器、GPU 被 blocklist、
##      `--disable-webgl`…）—— toolkit 虽然被选中，却一个像素也出不来。
##
## ── 为什么需要它（2026-09-23 胶水层审计候选 1）────────────────────────────────
## 实测：在 `--disable-webgl` 的 Chromium 里 `plot(...); drawnow` **不报错、MEMFS 里也没有
## PNG**，页面静默一片空白 —— 用户只看到"命令成功、什么也没发生"。而桥自己那份 SVG
## 渲染器（`__svg_render__`，也就是 `print -dsvg` 用的那个）本来就能把图渲出来，
## 只是**没有任何人在这个时刻去调它**。
##
## ── 做法：MEMFS 里放一个文件，页面去发现它 ──────────────────────────────────
## 与仓库里其它宿主桥同一条路子（`.m` 侧写文件、页面侧轮询）：这里把 SVG 写到
## `/tmp/p5_fallback.svg`，`bridge/p5canvas.js` 发现内容变了就用 `<img>` 贴出来
## （`__svg_render__` 出的带文字——刻度/title——反而比无 FreeType 的 GL 那条更完整）。
##
## ⚠️ 不渲 PNG、不碰 GL：这条路径完全不依赖 toolkit，所以它自己不可能再失败一次。
## ⚠️ 失败要**静默吞掉**：显示回落坏了不该把用户的绘图命令搞挂（验收里有专门一条）。
## ⚠️ 代价（如实记）：没有真渲染器时**每次状态变更都会渲一张 SVG**（`__pstate__` 里调）。
##    这是"页面永远显示最新一张"的代价；实测单张 ~10–40 ms（见 NOTES-webgl §4.7）。

function __pb_publish__ ()

  ## 真渲染器在线 ⇒ 出图归 toolkit（它渲 PNG，页面贴 PNG），这里什么都不做
  if (__pb_real_renderer__ ())
    return;
  endif

  try
    svg = __svg_render__ ();
    if (isempty (svg))
      return;
    endif
    fid = fopen ("/tmp/p5_fallback.svg", "w");
    if (fid < 0)
      return;
    endif
    fputs (fid, svg);
    fclose (fid);

    ## 一次性说明：让用户知道为什么图长得不一样、以及矢量导出还能用
    persistent told
    if (isempty (told))
      told = true;
      printf (["plot: 本机没有可用的 WebGL2 渲染器，图以 **SVG** 显示" ...
               "（带刻度与文字）。矢量导出用 print -dsvg。\n"]);
    endif
  catch
    ## 显示回落失败不能把绘图命令搞挂：静默（验收里有一条专门钉它）
  end_try_catch

endfunction


%!test
## ★ 这份断言在**任何**站点都能跑：自己造一个 "本机没有 GL" 的信号文件
##   （就是 toolkit 建不出上下文时落的那一个），于是回落在 GL 站点上也能被验证。
##   这样这条测试既覆盖了回落本身，又**顺带钉住**了"信号文件是回落的唯一开关"。
%! global __pb__;
%! saved = __pb__;
%! marker = "/tmp/p5_nogl.txt";
%! had = (exist (marker, "file") == 2);
%! unwind_protect
%!   fid = fopen (marker, "w"); fputs (fid, "test: pretend no GL\n"); fclose (fid);
%!   assert (! __pb_real_renderer__ ());      # 信号在 ⇒ 必须被当作"没有真渲染器"
%!   p = __pstate__ ();                       # 初始化一份干净状态
%!   fid = fopen ("/tmp/pb1.dat", "w"); fputs (fid, "1 1\n2 4\n3 9\n"); fclose (fid);
%!   ## ⚠️ 别写 `{struct (...)}` —— 同一个坑 `__svg_panel_boxes__.m:24` 早就记过
%!   ##    （"never write `{round (x), …}`"）：`{}` 字面量里的 `名字 (实参)` 会掉进命令语法。
%!   ##    这次是我又踩了一遍 —— 所以这里**先算进变量再包 cell**。
%!   sr = struct ("file", "/tmp/pb1.dat", "style", "lines", "color", "#0072BD", ...
%!                "dt", 1, "pt", 6, "ps", 1, "marker", "", "title", "");
%!   p.series = {sr};
%!   p.n = 1;
%!   __pb__ = p;                              # 直接摆状态，绕开 emit 的副作用
%!   if (exist ("/tmp/p5_fallback.svg", "file") == 2)
%!     unlink ("/tmp/p5_fallback.svg");     # ⚠️ unlink 对不存在的文件**报错**（不是 rm -f）
%!   endif
%!   __pb_publish__ ();
%!   assert (exist ("/tmp/p5_fallback.svg", "file") == 2);
%!   txt = fileread ("/tmp/p5_fallback.svg");
%!   assert (numel (txt) > 200);              # 不是空壳
%!   assert (! isempty (strfind (txt, "<svg")));
%!   ## 拿掉信号之后的行为要跟"本机到底有没有真渲染器"一致 —— 这条断言因此写成
%!   ## 两分支：有（8768/8761 那种带 GL 的站点）⇒ publish 必须 **no-op**，不抢 toolkit 的活；
%!   ## 没有（宿主 Octave 用的是 gnuplot，或 site 没有带 GL 的 wasm）⇒ 继续出 SVG。
%!   ## 这样同一份 `%!test` 在宿主与两个站点上都成立，且两边的语义都被钉住。
%!   if (exist ("/tmp/p5_fallback.svg", "file") == 2)
%!     unlink ("/tmp/p5_fallback.svg");
%!   endif
%!   unlink (marker);
%!   ## 信号一走，答案就等于"当前选中的是不是 webgl" —— 这条**与环境无关**
%!   ## （宿主 Octave 用 gnuplot ⇒ 假；8768/8761 带 GL ⇒ 真），但把契约钉死了。
%!   assert (__pb_real_renderer__ () == any (strcmpi (graphics_toolkit (), {"webgl"})));
%!   __pb_publish__ ();                  # 只断言"不报错"
%!   ## ⚠️ 这里**不**断言"文件没被写出来"：浏览器里页面侧的轮询器（bridge/p5canvas.js）
%!   ##    也会在信号出现时调 __pb_publish__，它有理由写这个文件 —— 那是**真竞态**，
%!   ##    不是被丢掉的性质。这条性质改在 accept-p5-graphics 里断言（GL 站点上文件不该存在），
%!   ##    因为那套没有别的写者。
%! unwind_protect_cleanup
%!   if (! had && exist (marker, "file") == 2), unlink (marker); endif
%!   clear -g __pb__;
%!   if (isstruct (saved)), __pb__ = saved; endif
%! end_unwind_protect
