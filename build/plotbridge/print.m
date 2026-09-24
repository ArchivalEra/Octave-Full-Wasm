## print/saveas for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Shadows the core scripts/plot/util/print.m (plotbridge is added last, so
## it sits at the front of the path).  The core version needs either a real
## graphics toolkit or an external command (`gs`, gnuplot via system()) —
## neither exists in this build.
##
## Supported: -dsvg (and a .svg filename).  Anything else fails loudly with
## an actionable message instead of a confusing "gs not available".
##
## Why SVG only: the SVG is generated *here*, in pure .m, from the plot-bridge
## state.  There is no synchronous channel to the JS-side gnuplot bridge, and
## no rasteriser in the wasm sandbox.  A page can still turn the SVG into PNG
## with canvas if it needs one.
##
## Usage:
##   plot (1:10); print ("/tmp/p.svg", "-dsvg");
##   plot (1:10); print -dsvg /tmp/p.svg;
##   plot (1:10); print ("/tmp/p.svg");          # extension picks the format
##   saveas (gcf (), "/tmp/p.svg");
##
## ★ **已记录的降级（有意）**：`-color` / `-mono` / `-landscape` / `-r<dpi>` 这类**不属于
##   格式选择**的选项被**忽略**（见下面识别 `-d` 的那段）。与 pie 的 EXPLODE/LABELS 同类：
##   没有任何输入被当成别的东西，出的图是对的，只是选项没生效。钉在
##   `accept-plotv2.mjs` 的"参数契约"节（`print(file, "-r300", "-dsvg")` 必须成功）。

function [out1, out2] = print (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      out1 = __pb_core__ ("print", varargin{:});
    else
      __pb_core__ ("print", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  out1 = [];
  out2 = [];


  fname = "";
  fmt = "";
  h = [];

  for i = 1:numel (varargin)
    a = varargin{i};
    if (ischar (a))
      if (numel (a) > 2 && strncmp (a, "-d", 2))
        fmt = lower (a(3:end));
      elseif (numel (a) > 0 && a(1) == "-")
        ## -color/-mono/-landscape/… : accepted and ignored in v1
      else
        fname = a;
      endif
    elseif (isnumeric (a) || islogical (a))
      if (isscalar (a) && isfigure (a))
        h = a;
      endif
    elseif (isstruct (a) && isfield (a, "type"))
      if (strcmp (getfield (a, "type"), "figure"))
        h = 1;
      endif
    endif
  endfor

  if (isempty (fname))
    error ("print: no output file given (this build supports -dsvg only)");
  endif

  ## extension as the fallback format selector
  [~, ~, ext] = fileparts (fname);
  if (! isempty (ext))
    ext = lower (ext(2:end));
  endif

  if (isempty (fmt))
    if (! isempty (ext))
      fmt = ext;
    else
      fmt = "svg";
    endif
  endif

  switch (fmt)
    case {"svg", "svgz"}
      if (isempty (ext))
        fname = [fname ".svg"];
      endif
      svg = __svg_render__ ();
      fid = fopen (fname, "wb");
      if (fid < 0)
        error ("print: cannot open '%s' for writing", fname);
      endif
      fputs (fid, svg);
      fclose (fid);
      printf ("print: wrote %s (%d bytes, %d series)\n", fname, numel (svg), ...
              numel (__pstate__ ().series));

    case {"png", "jpg", "jpeg", "bmp", "tga"}
      ## ── 光栅输出：走**页面渲出的那张 PNG**（小口子 5，2026-09-24）────────────────
      ## 真渲染器（webgl toolkit）每次重画都把当前图画成 PNG 落在 `/tmp/p5_fig.png`
      ## （`webgl_toolkit.cc` 的 `redraw_figure` → `publish_png`）。所以：
      ##   · `-dpng`：**逐字节拷贝**那张 PNG（不自造光栅器、不重编码 ⇒ 与页面里那张逐位相同）；
      ##   · `-djpg/-dbmp/-dtga`：借本构建的 `imread`/`imwrite`（webimage 资产，R4）转码；
      ##   · **没有 GL**（页面走 SVG 回落）时那张 PNG 根本不存在 ⇒ 明确报错并指向 `-dsvg`。
      ## 先 `drawnow()` 保证它是**当前**这张图（否则拷到的是上一次重画的）。
      if (isempty (ext))
        fname = [fname "." fmt];
      endif

      drawnow ();

      src = "/tmp/p5_fig.png";
      if (! exist (src, "file"))
        error (["print: no raster image to copy: this page has no working GL renderer " ...
                "(the SVG fallback is active), so %s was never written.\n" ...
                "  Use -dsvg here."], src);
      endif

      fid = fopen (src, "rb");
      if (fid < 0)
        error ("print: cannot open '%s' for reading", src);
      endif
      raw = fread (fid, Inf, "*uint8");
      fclose (fid);

      if (strcmp (fmt, "png"))
        fid = fopen (fname, "wb");
        if (fid < 0)
          error ("print: cannot open '%s' for writing", fname);
        endif
        fwrite (fid, raw, "uint8");
        fclose (fid);
        printf ("print: wrote %s (%d bytes, PNG copied from the page render)\n", ...
                fname, numel (raw));
      else
        ## 其他光栅格式：借用图像资产的读写（imread/imwrite），失败就说清缺什么
        try
          img = imread (src);
          imwrite (img, fname);
        catch err
          error (["print: cannot convert the page PNG to -d%s (%s)\n" ...
                  "  The converter is the webimage asset (imread/imwrite); load it first:\n" ...
                  "    await OctaveAssets.load ('webimage')\n" ...
                  "  or just use -dpng / -dsvg here."], fmt, err.message);
        end_try_catch
        printf ("print: wrote %s (-d%s, converted from the page render)\n", fname, fmt);
      endif

    case {"gif", "tif", "tiff"}
      error (["print: raster output (-d%s) is not available in this build.\n" ...
              "  Bitmaps that work here: -dpng (copied from the page render), and " ...
              "-djpg/-dbmp/-dtga via the webimage asset.\n" ...
              "  Or use -dsvg and convert in the page (canvas)."], fmt);

    case {"pdf", "eps", "epsc", "ps", "ps2", "psc", "psc2"}
      error (["print: vector output (-d%s) needs Ghostscript, which is not available in this build.\n" ...
              "  Use -dsvg instead: it is a vector format every browser renders natively."], fmt);

    case {"ofig", "fig", "m", "mfig"}
      error ("print: -d%s (Octave figure files) is not supported: this build has no real graphics handles.", fmt);

    otherwise
      error ("print: unknown output format '%s' (this build supports -dsvg).", fmt);
  endswitch

  out1 = h;
  out2 = fname;

endfunction


function tf = isfigure (v)
  ## No real graphics objects here; the bridge hands out the fake handle 1.
  tf = isscalar (v) && isnumeric (v) && v == 1;
endfunction
