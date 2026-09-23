# 部署说明 · Octave-Full-Wasm 站点包

**纯静态站点**：**Octave 11.3.0** 全文解释器跑在浏览器 wasm 内，服务端只发文件、零计算。

> **2026-09-22：基线已从 7.2.0 换到 11.3.0。** 8761 上现在服务的就是这一版；
> 7.2 的站点快照留在 `/mnt/hdd/octave-wasm-build/site-72bak/`（回退：
> `cp -a site-72bak/. site/`）。换基线的判定与清单见 `build/113/PROMOTION.md`。
>
> **2026-09-23：图形线收口 —— 本站点现在带真渲染器。** `octave.wasm` 由**带 GL** 的那份链接
> 产出（gl4es → GLES2 → **WebGL2/GPU**），**默认 toolkit 就是 `webgl`** ⇒ 开箱
> `figure; plot(1:10); drawnow` 就出真图。OSMesa（Mesa 软件光栅化）后端**已退役**。
> 换装流程固化在 **`build/promote-webgl.sh`**；细节见 `HANDOFF.md` §5.21 与
> `build/113/NOTES-webgl.md` §4.5.13 / §4.6。
> **回退点**：`/mnt/hdd/octave-wasm-build/site-prewebgl-bak/`（改之前那份站点）
> 与容器里的 `/src/websrc/out-nongl-bak`（不带 GL 的链接产物）。

## 包内容

```
index.html          入口（起解释器 + 资产清单；dldfcn 核心组开箱即用）
octave.js           胶水层（含 dylink 符号表）
octave.wasm         主模块（MAIN_MODULE=1 可重定位，支持运行时 dlopen）
octave.data         预装 .m / 帮助文件（含 m/ 的 35 个子目录 + **m/forge 的 20 个预装 .m**）
VERSION             基线标识（octave-11.3.0）
assets/             懒加载资产（按需 fetch，不进首包）
  manifest.json       资产清单（名称 → url / 挂载点 / 依赖 / 别名）
  oct/*.oct           单文件模块（dldfcn 核心组、__ode15__、webio、webimage、webnet）
  octdir/<pkg>/*.oct  包编译件（struct/optim/statistics/geometry/control/miscellaneous，27 个）
  pkg/*.js            Forge 纯 .m 包
  m/*.js              .m 资产（webaudio/webnet/webshell/webfile/plotbridge/pkgfix/…）
  data/*              数据文件（doc-cache、built-in-docstrings、macros.texi）
dldprobe.oct        dlopen 自检探针（accept-full 用；源码 build/113/dldprobe.cc）
minioct.oct         dldfcn 闸门探针（accept-113-oct 用）
vendor/             forge 预装集留档（**已打进 octave.data 的 m/forge**；源码 build/forge-preload/）
```

**与 7.2 包的两处结构差别**（都是 11.3.0 侧有意为之）：
- **没有 `gp/`（gnuplot-wasm）、没有 `plotbridge/` + `plotbridge.js` 顶层目录**：
  11.3.0 的 plot 桥是**纯 `.m` 直接生成 SVG**，不依赖 gnuplot。plotbridge 现在是一个
  **懒加载资产**（`assets/m/plotbridge.js` + `assets/m/plotbridge/`）。
- `help` 从 7.2 的运行时 `__makeinfo__` 换成**构建期预渲染**：内建走 `built-in-docstrings`，
  `.m` 文件的 docstring 也已预渲染成纯文本并随主链预载（`build/prerender-m-docstrings.py`）。

## 体积

首包（三大件，gzip 后就是用户实际下载量）：

| 文件 | raw | gzip -9 |
|---|---|---|
| octave.wasm | 46.7 MB | ~9.5 MB |
| octave.js | 21.5 MB | ~1.9 MB |
| octave.data | 6.2 MB | ~1.2 MB |
| **合计** | **74.4 MB** | **≈12.6 MB** |

外加 **懒加载资产**（谁用到谁下载，不计入首包）。具体数字以包内
`MANIFEST.sha256` 与 `du -sh assets` 为准。

`*.gz` 已随包生成，配合下面的 nginx 配置即可让服务器零压缩成本地发预压文件。

## 部署

### nginx

```nginx
server {
  root /var/www/octave;
  # 关键 1：wasm 必须正确 MIME，否则浏览器放弃流式编译
  types { application/wasm wasm; application/octet-stream oct data; }
  # 关键 2：直接发预压好的 .gz
  gzip_static on;
  # 本构建无线程，不需要 COOP/COEP；若要上多线程版才需要
  location / { try_files $uri $uri/ =404; }
}
```

### 其它静态托管（GitHub Pages / S3 / Cloudflare Pages / EdgeOne 等）

直接整目录上传即可。这些平台自己带 gzip/brotli，包里的 `.gz` 用不上（留着无害）。
**不要**用 `python -m http.server` 直接上生产——它不回 `application/wasm`；
本包自带 `serve.py` 补上了这点，`python3 serve.py 8080` 即可本地起。

## `.oct` 模块：官方插件模型

主模块以 `-s MAIN_MODULE=1` 链接，**支持运行时 dlopen 真 `.oct`**（wasm side module）——
与桌面版 Octave 的插件模型完全一致：`exist()` 返回 3、`which()` 返回文件路径，
加模块不必重链那 46MB 的主 wasm。

**包内 `assets/oct/` 的 7 个模块就是 dldfcn 核心组**（`convhulln` / `__delaunayn__` /
`__voronoi__` / `__glpk__` / `fftw` / `gzip` / `audioread`），`index.html` 在页面
加载时自动装好，所以 `delaunay`/`convhulln`/`glpk`/`fftw`/`audiowrite`/`gzip`
开箱即用。其余资产按需懒加载：

```js
await OctaveAssets.load('statistics');   // 装一个包（含其编译件）
await OctaveAssets.load(['signal', 'control']);
await OctaveAssets.load('__ode15__');    // 单个模块
```

自制 `.oct` 的配方见仓库 `build/build_oct.sh` 与 `build/CLIBS.md`「真 .oct 动态装载」节；
模块文件名与导出函数名不一致时**必须**在 `manifest.json` 的 `aliases` 里建符号链接
（Octave 按文件名找 `.oct`——例如 `gzip.oct` 同时导出 `bzip2`）。

## 能力清单（本版）

- **核心**：全量核心 `.m`（plot/ode/signal/special-matrix/…）、HDF5、CXSparse、SUNDIALS
- **C 库长尾**：qrupdate / ARPACK / FFTW(双+单) / Qhull / GLPK / zlib / bz2 / libsndfile
- **dldfcn**：`convhulln` `delaunayn` `voronoi` `glpk` `fftw` `gzip`/`bzip2` `audioread` 系列
- **图形**：plot 桥 v1/v2（2D + 3D：`plot3`/`mesh`/`surf`/`contour`/`subplot`）、
  `print -dsvg`（纯 `.m` SVG 生成器，不依赖 gnuplot）
- **图形对象句柄**：`figure`/`gcf`/`gca`/`get`/`set`/`title`/`allchild`/`findall`/`close` 全部可用
  （此前**建不出图形对象**，一律 invalid handle）。
- **★ 真渲染（2026-09-23 起默认）**：`webgl` graphics toolkit —— GL 1.x 调用经 **gl4es**
  翻译到 GLES2 → **WebGL2（GPU）**，Octave 自己的 `opengl_renderer` 一字不改。
  **默认 toolkit 就是它**：`figure; plot(1:10); drawnow` 开箱就出真图、`getframe()` 返回真像素、
  页面贴出 toolkit 渲的 PNG。`plot 桥`同时把这些调用**镜像**成真图形对象
  （于是 `get(gca,'children')` 能列出线、`h = plot(...)` 拿到真句柄）。
  显式切回"只出句柄、渲染归桥"的老模式：`graphics_toolkit("web")`。
  ⚠️ 文字渲染仍缺（`--without-freetype`）：刻度/title 空白但不崩，且**每次会话**在第一条
  axes 上打一条带调用栈的 warning。
- **图像**：`imread`/`imwrite`/`imfinfo`（stb_image）
- **压缩归档**：`gzip`/`bzip2` + 进程内 `zip`/`unzip`/`tar`/`untar`/`gunzip`/`bunzip2`（无 shell）
- **音频**：`audioread` 系列 + `audioplayer`（WebAudio 桥）
- **网络**：同步 `urlread`/`urlwrite`/`webread`/`websave`（XMLHttpRequest 同步模式，无需 Asyncify）
- **Forge 包**：statistics / optim / geometry / struct / miscellaneous / signal / control / …

## 验收状态

本包内容 = 最近一次在浏览器实测通过的构建。**32 套 848 项全绿**，
在 `http://127.0.0.1:8761/`（**即本包内容**）上跑（用
`/mnt/hdd/octave-wasm-build/sweep.sh http://127.0.0.1:8761/`；逐套日志在 `sweep-logs/`）。

**需求级** `accept-requirements` **14/14**（R1–R10 各一条最小实测 + 架构护栏）。
其中 R1 `ode15s`/`ode15i` 由内嵌 SUNDIALS 6.1.1 的真 `.oct` 提供（此前是"桩"）。

| 套件 | 项数 | 覆盖 |
|---|---|---|
| accept-requirements | 14 | **需求级**：R1–R10 + 架构护栏 |
| accept-p5-graphics | **64** | **真渲染（webgl → WebGL2/GPU）**：PNG/`getframe`/15 种图非空白 + 镜像层与 DEPTH 复位护栏 |
| accept-t2-graphics | 26 | **图形对象句柄**（`web` toolkit：figure/gcf/gca/get/set/title/close） |
| accept-113-boot | 10 | 11.3.0 能起、能 eval |
| accept-113-oct | 8 | 真 `.oct` side module 能被装载并调用 |
| accept-113-assets | 16 | 资产车道语义 |
| accept-113-libs | 17 | 逐库数值断言（含**稀疏 `lu` 的六个形态**，见下） |
| accept-113-ode15 | 29 | SUNDIALS `ode15s`/`ode15i` 数值 + **`lsode`（已修复）** |
| accept-113-pkgoct | 27 | 27 个包编译件逐个真调用（零 trap） |
| accept-full | 20 | 核心回归 + 官方 .oct 装载 + 资产车道 |
| accept-hdf5 | 16 | `save/load -hdf5` |
| accept-forge | 22 | Forge 纯 .m 包（含 forge 预装集） |
| accept-forge-oct | 15 | Forge 编译件 |
| accept-forge2 | 44 | signal + control（含 SLICOT 编译件的真数值） |
| accept-slicot | 25 | `ss`/`step`/`tf2ss`/`lyap`/`care`/… 数值 |
| accept-dldfcn | 68 | dldfcn 官方装载语义与真数值 |
| accept-ode15 | 14 | SUNDIALS `ode15s`/`ode15i`；`lsode` 那条已从「只查 exist」换成真调用 |
| accept-archive | 20 | 压缩/归档无 shell 化 |
| accept-image | 17 | 图像 I/O |
| accept-print | 43 | `print -dsvg` |
| accept-plotv2 | 54 | plot 桥 v2（2D） |
| accept-plot3d | 34 | plot 桥 v2（3D） |
| accept-audio | 47 | WebAudio 播放 |
| accept-net | 30 | 同步网络 |
| accept-help | 12 | `help`/`lookfor`/`get_first_help_sentence` |
| accept-t9-helpm | 18 | `.m` docstring 的 `help`（构建期预渲染） |
| accept-fileops | 20 | 文件操作语义 |
| accept-pkg | 16 | `pkg` 数据库/list/load/describe |
| accept-input | 9 | `input()` 与 EOF |
| accept-t6-audio-doc | 33 | `audiodevinfo` + `doc` + 输出落点 |
| accept-t7-recorder | 40 | `audiorecorder`（MediaRecorder 桥） |
| accept-t8-uigetfile | 20 | `uigetfile`（两步式 + 权限/取消三态） |

`lsode` **曾整页 trap，2026-09-22 已修好**（根因：ODEPACK 的用户回调给 4 个实参，
而 Octave 的 `lsode_f` 有 5 个形参，wasm 的 `call_indirect` 做精确类型检查 → 不符即
`unreachable`。修法见 `build/113/patch-odepack-callback-arity.sh`，详见
`build/113/NOTES-lsode.md`）。现在 29/29 里含 5 条 `lsode` 断言。
⚠️ 注意 `lsode` 的返回约定是 **`[x, istate, msg]`**，不是 `[t, y]`。

## 已知偏差（如实）

- ~~**`lsode` 调用即整页 trap**~~ **已修复**（2026-09-22）：详见上面的说明与
  `build/113/NOTES-lsode.md`。这条留档是因为它**在 7.2 上也存在**（不是换基线引入的），
  而且此前没被任何套件发现 —— 7.2 的 `accept-ode15` 对 `lsode` **只断言了 `exist`**。
- `system`/`unix`/`popen` 清晰报错（有意保持，wasm 无 shell）。
- `fftw('threads',N)` 静默 no-op（线程桩，数值不受影响）。
- `-dpng`/`-dpdf` 打印清晰报错并提示改用 `-dsvg`（无光栅器、无 Ghostscript）。
- **文字渲染仍缺**（`--without-freetype`）：刻度/title 空白但不崩；且**每次会话**在第一条
  axes 上打一条 warning（`opengl_renderer::render_text: support for rendering text (FreeType)
  was unavailable…`，带调用栈）。数值与绘图本身不受影响。
- **首帧 ~0.6 s**（真渲染）：会话里第一次出图要建 WebGL 上下文 + `initialize_gl4es()` +
  编 shader + 首帧 `glReadPixels`/PNG 编码。**之后每张图 ~90 ms**（实测，桌面）。
- **桥的参数宽容度与桌面一致**：桥以前比核心宽容的写法（如 `plot(x,x,'+','')`）现在会走到
  核心实现、按核心（=桌面）的严格性报错 —— 这是**向桌面看齐**，不是缺陷。
- **`plot(hax, …)` 这类"首参是句柄"的调用形态桥不支持**（两种 toolkit 下都一样）
  ⇒ `voronoi` 的**单输出形式**（要画图）因此不可用；两输出形式正常。
- `xlim()`/`ylim()`/`axis()`/`clf()`/`legend()`/`title()` 等**接受输出参数但返回空**
  （桥记录的是"请求"、不是核心算出来的值）。
- **`help` 走构建期预渲染**，不再有运行时 `makeinfo` 子进程 —— 内建（T1）与
  `.m` 文件的 docstring（P1，`accept-t9-helpm` 18/18）都覆盖了；
  7.2 那条"help 必失败"的偏差**在 11.3.0 上已彻底消除**。

