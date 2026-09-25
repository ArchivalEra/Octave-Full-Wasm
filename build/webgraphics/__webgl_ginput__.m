## Octave-Full-Wasm — `__webgl_ginput__`：webgl 工具箱的取点实现（G3，2026-09-25）
##
## 上游 `ginput.m` 委托给工具箱函数 `__<toolkit>_ginput__` ⇒ 本文件就是 webgl 工具箱
## 的那一只（随 webgraphics 资产装载）。轮询形态：
##   arm（清空并开始收点）→ 循环 { pending？取点；否则 `__web_pause_ms__(50)` 让出 }
## 坐标映射（与 fltk 同一公式，2-D 线性；3-D 见上游 Implementation Note）：
##   画布 CSS px → 图形窗口 px（按 img/canvas 实际显示尺寸缩放，y 翻转）
##   → 数据坐标（axes position + xlim/ylim 线性映射）
##
## SPDX-License-Identifier: AGPL-3.0-or-later

function [x, y, buttons] = __webgl_ginput__ (fig, n)

  if (! __web_suspend_ok__ ())
    error ("ginput: 本浏览器不支持 JSPI 的挂起能力（需要 Chromium 137+ 等；见能力门 __octaveJspiRequire）");
  endif

  ## 上游 ginput.m 的调用签名：feval(toolkit_fcn, fig) 或 feval(toolkit_fcn, fig, n)
  if (nargin < 2 || isempty (n) || n < 0)
    error ("ginput: 网页版需要给出点数 n（ginput(3)）；无参/Inf 的'等到按 RET'形式暂不支持");
  endif
  n = double (n);

  ax = gca ();
  drawnow ();
  figpos = get (fig, "position");       # [left bottom width height]（图形窗口 px）
  # ⚠️ axes position 默认是 **normalized** 单位（实测踩过：不转像素就把所有点当
  #   "axes 外"丢掉 ⇒ 死循环）。与 figure 对齐成像素再做映射。
  saveu = get (ax, "units");
  set (ax, "units", "pixels");
  axpos = get (ax, "position");
  set (ax, "units", saveu);
  xl = get (ax, "xlim");
  yl = get (ax, "ylim");

  __web_ginput_arm__ ();                # ★ 先 arm 再收：上一次的点击不会漏进这一次
  x = [];
  y = [];
  buttons = [];

  while (numel (x) < n)
    __web_pause_ms__ (50);              # 让出主线程（页面在此期间收点击）
    while (__web_ginput_pending__ () > 0 && numel (x) < n)
      v = __web_ginput_pop__ ();
      if (isempty (v))
        break;
      endif
      px = v(1); py = v(2); rw = v(3); rh = v(4); b = v(5);
      # 画布 CSS px → 图形窗口 px（等比缩放 + y 翻转：figure 原点在左下）
      fx = px * (figpos(3) / rw);
      fy = (rh - py) * (figpos(4) / rh);
      # 点在 axes 外（图题/边距）⇒ 丢弃，继续等
      if (fx < axpos(1) || fx > axpos(1) + axpos(3)
          || fy < axpos(2) || fy > axpos(2) + axpos(4))
        continue;
      endif
      dx = xl(1) + (fx - axpos(1)) / axpos(3) * (xl(2) - xl(1));
      dy = yl(1) + (fy - axpos(2)) / axpos(4) * (yl(2) - yl(1));
      x(end+1) = dx;
      y(end+1) = dy;
      buttons(end+1) = b;
    endwhile
  endwhile

endfunction
