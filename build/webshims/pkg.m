## Octave-Full-Wasm — `pkg` 网页版 shim：`pkg load <未装载的包>` 自动装载（D6，2026-09-25；
## T4 货架感知，2026-10-12）
##
## 网页版的包管理器是**页面资产装载器**（OctaveAssets）——包文件由它 fetch + 写盘 + addpath，
## 核心 `pkg.m` 的数据库由 pkgfix 从磁盘现状生成。缺口只有一个：
## 用户敲 `pkg load <名>` 时，那个包可能**还没装载**（不在磁盘 ⇒ 数据库里没有 ⇒ 核心报
## "package not installed"）。
##
## 本 shim 只拦这一种情形。包有**两个来源**，点火方式不同（`__webpackage_source__` 判定）：
##   · `'shipped'`（随站清单 `assets/pkg/*.js`）⇒ `OctaveAssets.load(名)`（字节已随站）
##   · `'shelf'`（货架 `assets/forge-catalog.json`）⇒ `OctaveAssets.install(名)`
##     （fetch 同源 tarball + sha256 校验 + 引擎内建 gunzip/untar —— 设计稿 §3）
## 点火都是**即返**：真正的装在页面侧异步跑，`.m` 这里只轮询账本等终态。
## 其余一切 pkg 命令 ⇒ **路径手术委托核心**（把本 shim 目录临时摘掉，跑完恢复）。
##
## ⚠️ 轮询的 `__web_pause_ms__` 需要挂起能力 ⇒ `pkg load` 与 `pause` 同一架构规则：
##    **走 eval_async**。同步入口上碰到未装载包会以 SuspendError 拒绝（可挂起命令的信号）。
##
## ── T4 改的三处（每一处都针对实测到的具体毛病）──────────────────────────────
##   ① **先问来源**：老 shim 只查 `__webassets_pending__`（随站清单）⇒ 货架上的包敲
##      `pkg load` 仍报 "is not installed"，而 `OctaveAssets.install()` 明明是好的。
##   ② **终态判据**（不再只看"名单里有没有"）：装好 ⇒ 走核心；**失败 ⇒ 立刻带上原因报错**；
##      货架上没有 ⇒ 明说"没有"；货架读不到 ⇒ 明说"读不到"（**不许**把这句说成"没有"——
##      那是假断言，用户会以为这个构建没有那个包）。
##      老 shim 的 `while …tries < 600`（60 s 上限）在失败时让用户**干等**，且期间不可分辨。
##   ③ **批量**：`pkg load a b` 逐个判来源（原实现只对第一个候选名查名单，其余靠核心报错）。
## SPDX-License-Identifier: AGPL-3.0-or-later

function varargout = pkg (varargin)

  ## ★ 门：**本构建才有** `__web_run_js__`（webpause.oct）。宿主（glue-selftest、第三方包）
  ##   上它不存在 ⇒ 整条 web 路径必须整体跳过（老 shim 靠"名单为空"间接达到同一效果；
  ##   T4 新增的"点火读货架"不再依赖名单，所以要把这件事**明写**成一道门）。
  if (nargin >= 2 && strcmpi (varargin{1}, 'load') && __web_pkg_can_fire__ ())
    names = __web_pkg_names__ (varargin{2:end});
    parked = {};
    ## ⚠️ **不在这里等货架**（T4 第一版就是这么错的，实测抓住）：等待要走
    ##    `__web_pause_ms__`，而它的挂起只能发生在 promising 栈上 —— **同步入口**
    ##    （页面队列外的 `eval_string("pkg load x")`）调用它当场抛
    ##    `SuspendError: trying to suspend without WebAssembly.promising`，而那个抛错
    ##    在 Octave 侧 try/catch **抓不住**（直接穿到 JS）⇒ 打个错包名就把调用方炸掉。
    ##    正解是**开机就把货架目录读好**（`bridge/octave-core.js` 后台 `catalog()`）⇒
    ##    到这里问来源永远是**同步可答**的；真没读到时候（页面刚起、目录 404）就退回老行为。
    for k = 1:numel (names)
      [src, why, state] = __webpackage_source__ (names{k});
      if (strcmp (src, "shipped"))
        ## 随站资产：字节已在站点上，点火 = load（<script> 注入，秒级）
        parked{end + 1} = names{k};
        __web_pkg_fire__ (sprintf ("OctaveAssets.load('%s');", names{k}));
      elseif (strcmp (src, "shelf"))
        ## 货架包：要 fetch 同源 tarball + sha256 + 解包 ⇒ 打印一行（用户知道在下载）
        parked{end + 1} = names{k};
        printf ("pkg: 正在从货架装载 %s …（首次使用才下载）\n", names{k});
        __web_pkg_fire__ (sprintf ("OctaveAssets.install('%s');", names{k}));
      endif
      ## ★ `loaded` / `miss` / `unknown` / 已记录的失败 一律**不拦**，交给下面委托的核心 pkg：
      ##   · `loaded` —— 已装，核心走它自己的官方路径（打印/幂等都归它管）；
      ##   · `miss`   —— 两个名单都没有。**这里绝不能报错**：账本只记"页面装载器知道的东西"，
      ##                 而包完全可能**已经在磁盘上**（本会话早先装过、或用户自己写的文件）
      ##                 ⇒ 该不该报错只有核心能判（`package x is not installed`）。
      ##                 我第一版在这里 error，那就是**假失败**（本仓最忌讳的形状）。
      ##   · `unknown` —— 账本缺席/货架读不到 ⇒ 问不出来就什么都不说，退回老行为。
      ##                 "读不到" ≠ "没有"：把前者说成后者是假断言。
    endfor

    if (! isempty (parked))
      if (! __web_suspend_ok__ ())
        ## 到这一步**才**需要挂起（要等页面 fetch + 解包落地）⇒ 同步入口在这里拦下，
        ## 给出可读的报错（而不是让它去撞 SuspendError）—— 与 pause/ginput 同一架构规则。
        error ("pkg: loading packages needs an async context (use eval_async)");
      endif
      __web_pkg_wait__ (parked);        # 等终态；失败**立刻**抛出（不干等满 60 s）
    endif
  endif

  ## 委托核心 pkg.m：路径手术（摘掉本 shim 所在目录 ⇒ pkg 解析到核心实现）
  wdir = fileparts (mfilename ('fullpath'));
  oldp = path ();
  path (strrep (strrep (oldp, [wdir ':'], ''), [':' wdir], ''));
  newp = oldp;                          # ★ 核心抛错时 cleanup 也有值（实测踩过：undefined 吞掉原错误）
  unwind_protect
    if (nargout > 0)
      [varargout{1:nargout}] = pkg (varargin{:});
    else
      pkg (varargin{:});
    endif
    ## ★ 浏览器侧 IPC 后端选择（2026-10-15，symbolic 的 IPC 缝）：装完 `symbolic` 后，
    ##   把它的 IPC 后端钉到 `system` —— 那条后端调的是**全局名 `system`**，而全局名
    ##   会落到我们的 webshim（本构建里那个 shim 把 Python 调用接到 Pyodide）。
    ##   ⚠️ 为什么必须显式设（不是可选优化）：包自己的 autodetect（`python_ipc_driver.m`）
    ##      看 `exist('popen2') > 1` —— 本构建里 popen2 是**内建**（exist==5）⇒ 自动选
    ##      `popen2`，而它 fork 必失败（无 shell）⇒ **必须**替它选一条真能跑的路。
    ##   ⚠️ 用 `try`（不是硬设）：`symbolic` 不在路径上 / `sympref` 签名变了都不该**炸装载**；
    ##      设失败的后果是"用户调符号计算时报清晰错"，比"pkg load 本身报错"好。
    ## ⚠️ 只在装 `symbolic` 时做（别对每个包都调 sympref —— 那是它的私有偏好）。
    ##   ⚠️ **别引用 `names`**：它只在上面那个 `if (… __web_pkg_can_fire__ ())` 分支里定义
    ##      （实测踩到：另一条分支进来 `names` 未定义 ⇒ 被 catch 静默吞掉 ⇒ 设置没做）。
    ##      用 `__web_pkg_names__` 现算（任何分支都可用）。
    if (nargin >= 2 && strcmpi (varargin{1}, 'load') && ...
        any (strcmpi (__web_pkg_names__ (varargin{2:end}), 'symbolic')))
      try
        if (exist ('sympref') == 2)
          sympref ('ipc', 'system');
        endif
      catch
        ## 静默：`symbolic` 可用性由它自己的函数在**用时**判（本 shim 不抢答）
      end_try_catch
    endif
    newp = path ();
  unwind_protect_cleanup
    path (oldp);                        # 恢复原路径（含本 shim）
    ## 核心新加进来的目录（如 pkg load 的包目录）按原顺序补回
    adddirs = setdiff (strsplit (newp, ':'), strsplit (oldp, ':'), 'stable');
    for k2 = numel (adddirs):-1:1       # addpath 前置 ⇒ 逆序遍历保持核心的顺序
      addpath (adddirs{k2});
    endfor
  end_unwind_protect

endfunction


## 把 `pkg load a b {c}` 的参数形式归一成名字 cell
##   `pkg load a`（char）/ `pkg load a b`（多参）/ `pkg load {a,b}`（cell，含核心的
##   "依赖也一起装"用法）。
##   ⚠️ 跳过两类**不是包名**的东西：① 旗标（`-nodeps`/`-verbose`…，核心的 available_actions
##      那套）；② 版本字面量（`pkg load a 1.2.3` 这种写法里第二个参数不是包名）。
##      认错的下场是**凭空报一个假失败**（拿 "1.2.3" 去查名单 ⇒ 报"货架上没有 1.2.3"）。
function names = __web_pkg_names__ (varargin)

  names = {};
  for k = 1:numel (varargin)
    v = varargin{k};
    if (iscell (v))
      for j = 1:numel (v)
        if (ischar (v{j}) && ! isempty (v{j}))
          names{end + 1} = v{j};
        endif
      endfor
    elseif (ischar (v) && ! isempty (v))
      if (v(1) == "-")
        continue;                       # 旗标（-nodeps 等）：交给核心解析
      endif
      if (__web_pkg_is_version__ (v))
        continue;                       # 版本字面量：不是包名
      endif
      names{end + 1} = v;
    endif
  endfor

endfunction


## 本构建能点火吗（`__web_run_js__` = webpause.oct，只在本构建里存在）。
##   宿主上没有它 ⇒ 整个 web 装载路径跳过、直接委托核心 pkg（= 老行为）。
##   ⚠️ 用 `exist` 判而不是 try/catch：函数**不在**时 try/catch 也能兜住，但那样会把
##      "本构建的 .oct 没装上"这种真故障也一起吞掉（本仓最忌讳的静默）。
function tf = __web_pkg_can_fire__ ()

  tf = (exist ("__web_run_js__") == 3) && (exist ("__web_pause_ms__") == 3);

endfunction


## 版本约束字面量的判据（保守：只认"以数字开头且含点"或"以比较符开头"）
function tf = __web_pkg_is_version__ (s)

  tf = ! isempty (regexp (s, '^(\d+\.\d+|[<>=]=?)', 'once'));

endfunction


## 点火：把一段 JS 交给页面同步执行
##   ⚠️ `OctaveAssets.load/install` 都是**即返**的（返回 promise，不阻塞）⇒ 这里不会死锁；
##      真正要等的东西见 `__web_pkg_wait__`。
function __web_pkg_fire__ (js)

  __web_run_js__ (js);

endfunction


## 等终态：parked 里的每个包，轮询 `__webpackage_source__` 直到 ok 或 failed。
##   ★ 判据与老实现的三处差别（都针对实测到的毛病）：
##     ① 失败**立刻**结束（老实现要等满 60 s 才吭声）；
##     ② 单次轮询间隔 100 ms、总上限按**每个包** 60 s 计（货架包要下载 + 解包）；
##     ③ 抛出的错带**原因**（老实现只把核心那句 "is not installed" 转述出来）。
function __web_pkg_wait__ (parked)

  for k = 1:numel (parked)
    nm = parked{k};
    tries = 0;
    while (tries < 600)
      [src, why, state] = __webpackage_source__ (nm);
      if (strcmp (state, "ok"))
        break;
      endif
      if (strcmp (state, "failed"))
        ## src='miss'/'unknown' 时 why 已经把话说清楚了（"没有"与"读不到"分得开）
        error ("pkg: 无法装载 %s —— %s", nm, why);
      endif
      __web_pause_ms__ (100);           # 让出等页面 fetch + 写盘
      tries += 1;
    endwhile
    if (tries >= 600)
      error ("pkg: 装载 %s 超时（60 s）—— 页面装载器没有落账", nm);
    endif
  endfor

endfunction
