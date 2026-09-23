## saveas for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The core saveas.m requires a real graphics handle (it calls ancestor()):
## this build has none, so calling it errors out before reaching print.
## Here it simply forwards to the bridge's print, and infers the format from
## the filename extension like the core version does.
##
##   plot (1:10); saveas (gcf (), "/tmp/p.svg");
##   plot (1:10); saveas (1, "/tmp/p.svg");

function saveas (h, filename, fmt)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    __pb_core__ ("saveas", h, filename, fmt);
    return;
  endif


  if (nargin < 2)
    print_usage ();
  endif
  if (! (ischar (filename) && isrow (filename)))
    error ("saveas: FILENAME must be a string");
  endif

  if (nargin >= 3 && ! isempty (fmt))
    if (! ischar (fmt))
      error ("saveas: FMT must be a string");
    endif
    print (h, filename, ["-d" fmt]);
  else
    print (h, filename);
  endif

endfunction
