## plot 桥：核心函数句柄缓存 + "核心调用中"的深度计数（own code, repo license）。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 它替掉了什么 ────────────────────────────────────────────────────────────
## 镜像层（__pb_mirror__.m）要在"桥的状态更新完之后"再调一次**同名核心函数**，
## 才能建出真图形对象。以前的做法是**每次调用**都把桥目录从 path 上摘掉再恢复：
## 正确，但一次 `path()` 会重扫整条路径（实测 ~0.13 s），一次镜像要两次
## ⇒ **每图多约 0.26 s**，实测桥的 `figure; clf; surf(peaks(40))` 里 ~480 ms 的大头就是它。
##
## 这里换成**一次性**取句柄：用**一次** path 手术把核心函数 `str2func` 下来，之后**永不再动
## path**，每次镜像直接调句柄。句柄在创建时就绑定了具体的函数对象，此后改 path 不会变
## （`functions(fh).file` 可复核；这也是旧实验"快 6.6×"的依据）。
##
## ── 为什么还要 DEPTH 计数 ───────────────────────────────────────────────────
## 旧实验（只缓存句柄、不动 path）当年**炸在 pie/contour**：核心 `__pie__.m:157/160` 写的是
##     axis (h, [-1.5 1.5 -1.5 1.5], "square", "off")     ← **首参是句柄**
## 而桥的 `axis.m` 只认"2/4 元素向量" ⇒ 报 `axis: limits must be a 2- or 4-element vector`。
## 同类还有 `__plt__.m:154` / `__errplot__.m:279` 的 `legend (gca (), …)`。
## 也就是说：**核心实现内部会按名字调被桥挡住的函数**，"只把顶层那一个换成句柄"不够。
##
## 这里用 DEPTH 复现"整段摘 path"的语义：核心调用期间 `DEPTH > 0`，于是**每一个挡住核心
## 名字的桥 shim 开头那句 `if (__pb_in_core__ ())` 成立 → 转发给核心句柄**。
## 好处是**不需要枚举**"核心内部到底调了谁"：不管调哪个被挡名字，解析结果都与"摘掉整条
## 桥目录"一致。（每个 shim 的那段前导由 `build/plotbridge/insert-core-forward.py` 插入。）
##
## ⚠️ **危险点**：DEPTH 必须在**错误路径**上也复位（unwind_protect_cleanup）。否则一次失败的
##    绘图会把 DEPTH 永久留在 >0，此后**所有**桥函数都会静默转给核心 —— 表现为"图还能画，
##    但桥的状态再也不更新"。验收里有一条专门钉这个。
##
## ⚠️ **第二个坑（实测）**：Octave 的**输出个数检查发生在函数体之前** ——
##    `x = f()` 对"只声明 0 个输出"的 f 会在进函数体之前就报
##    `f: function called with too many outputs`。所以转发前导**根本进不来**，
##    除非桥的 shim 声明的输出个数 ≥ 核心实现的（`__pb_add__` 之外的 10 个 shim 因此被加宽，
##    见 insert-core-forward.py 的表）。
##
## 只在真渲染器在线时才会被走到（门禁在 `__pb_mirror__` / `__pb_real_renderer__`），
## 所以 `web` 站点上这套完全空闲。
##
## 模式（用法）：
##   h = __pb_core__ ("plot", 1:10)   → 调核心 plot（要几个输出由调用点决定）
##   n = __pb_core__ ("--depth")      → 当前深度（`__pb_in_core__` 用它）
##       __pb_core__ ("--reset")      → 清缓存与深度（测试用）

function varargout = __pb_core__ (fname, varargin)

  global __pb_core_state__

  if (isempty (__pb_core_state__))
    __pb_core_state__ = struct ("handles", struct (), "depth", 0);
  endif

  if (strcmp (fname, "--reset"))
    __pb_core_state__.handles = struct ();
    __pb_core_state__.depth = 0;
    if (nargout > 0)
      varargout{1} = 0;
    endif
    return;
  endif

  if (strcmp (fname, "--depth"))
    if (nargout > 0)
      varargout{1} = __pb_core_state__.depth;
    endif
    return;
  endif

  if (numel (fieldnames (__pb_core_state__.handles)) == 0)
    __pb_core_state__.handles = __pb_core_handles__ ();
  endif

  if (! isfield (__pb_core_state__.handles, fname)
      || isempty (__pb_core_state__.handles.(fname)))
    error ("plot bridge: no core implementation cached for '%s'", fname);
  endif

  fh = __pb_core_state__.handles.(fname);

  __pb_core_state__.depth = __pb_core_state__.depth + 1;

  unwind_protect
    if (nargout > 0)
      [varargout{1:nargout}] = fh (varargin{:});
    else
      fh (varargin{:});
    endif
  unwind_protect_cleanup
    ## 错误路径也要复位 —— 见文件头那条危险点。
    __pb_core_state__.depth = __pb_core_state__.depth - 1;
  end_unwind_protect

endfunction


## 一次性把核心句柄取下来：**一次** path 手术（摘桥目录）→ `str2func` 每个名字 → 恢复 path。
## 之后调用方把它们存进 `__pb_core_state__.handles`，再也不需要动 path。
function H = __pb_core_handles__ ()

  ## ⚠️ 这份名单必须与 build/plotbridge/insert-core-forward.py 的表**逐字一致**
  ##    （那个工具会解析本文件做自检；不一致就直接失败）。
  NAMES = {"area", "axis", "bar", "barh", "clf", "contour", "errorbar", ...
           "figure", "grid", "hold", "legend", "loglog", "mesh", "pie", ...
           "plot", "plot3", "print", "saveas", "scatter", "scatter3", ...
           "semilogx", "semilogy", "stairs", "stem", "subplot", "surf", ...
           "title", "xlabel", "xlim", "ylabel", "ylim"};

  ## ⚠️ 用 `which` 而不是 `mfilename`：`mfilename("fullpath")` 在**子函数**里给不出全路径
  ##    （实测得到的是子函数名，`fileparts` 之后是空串），于是"摘桥目录"这一步静默失效 →
  ##    句柄会指向桥自己 → **无限递归**。`which("__pb_mirror__")` 此刻一定在 path 上。
  BPDIR = fileparts (which ("__pb_mirror__"));
  if (isempty (BPDIR))
    error ("plot bridge: cannot locate the bridge directory (__pb_mirror__ not on path)");
  endif

  ps = pathsep ();
  p0 = path ();
  parts = strsplit (p0, ps);
  pn = strjoin (parts(! strcmp (parts, BPDIR)), ps);

  ## 兜底：摘桥这一步要是没生效，句柄会指向桥自己 → 无限递归（栈溢出），
  ## 报错信息会指向不相干的地方。宁可在这里明确失败。
  if (strcmp (pn, p0))
    error ("plot bridge: '%s' is not on the current path — cannot reach the core implementations", BPDIR);
  endif

  ## `path(…)` 重扫路径时会把站点本来就有的那条 `Octave:shadowed-function`
  ##（`m/forge/fft.m` 影子内建 `fft`）重报一遍，实测刷屏到看不见别的输出。
  ## 只关这一个 id，退出时按原状态恢复；别的警告照常放行。
  ws = warning ("query", "Octave:shadowed-function");
  warning ("off", "Octave:shadowed-function");

  H = struct ();
  unwind_protect
    path (pn);
    for k = 1:numel (NAMES)
      nm = NAMES{k};
      try
        fh = str2func (nm);
        ## ★ 硬自检：句柄必须落在**核心**文件上。万一解析到桥自己，这里立刻失败，
        ##   而不是等到运行时栈溢出。
        s = functions (fh);
        if (! isempty (s.file) && strncmp (s.file, BPDIR, numel (BPDIR)))
          error ("plot bridge: core handle for '%s' resolved to the bridge itself (%s)", nm, s.file);
        endif
        H.(nm) = fh;
      catch err
        warning ("plot bridge: core handle for '%s' unavailable (%s)", nm, err.message);
        H.(nm) = [];
      end_try_catch
    endfor
  unwind_protect_cleanup
    path (p0);
    if (strcmp (ws.state, "on"))
      warning ("on", "Octave:shadowed-function");
    endif
  end_unwind_protect

endfunction
