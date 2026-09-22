# 部署说明 · Octave-Full-Wasm 站点包

**纯静态站点**：Octave 7.2.0 全文解释器跑在浏览器 wasm 内，服务端只发文件、零计算。

## 包内容

```
index.html          入口（起解释器 + 资产清单；dldfcn 核心组开箱即用）
octave.js           胶水层（含 dylink 符号表）
octave.wasm         主模块（MAIN_MODULE=1 可重定位，支持运行时 dlopen）
octave.data         预装 .m / 帮助文件
assets/             懒加载资产（按需 fetch，不进首包）
  manifest.json       资产清单（名称 → url / 挂载点 / 依赖 / 别名）
  meta.json           人工维护的说明与别名
  oct/*.oct           单文件模块（dldfcn 核心组、__ode15__、webio、webimage、webnet）
  octdir/<pkg>/*.oct  包编译件（struct/optim/statistics/geometry/control/…）
  pkg/*.js            Forge 纯 .m 包（10+ 个）
  m/*.js              .m 资产（webaudio/webnet/webshell 覆写/plot 桥覆写）
  data/*              数据文件（doc-cache、built-in-docstrings）
plotbridge*.m/js    plot 桥（Octave 侧垫片 + JS 侧 spec→gnuplot）
gp/                 gnuplot-wasm（渲染 SVG 用，按需加载）
vendor/             vendored .m（已打进 octave.data，此处留档）
serve.py            本地/自托管服务脚本（wasm MIME + gzip_static）
MANIFEST.sha256     全部源文件的 sha256
*.gz                每个文本资源的预压件（nginx gzip_static 直接发）
```

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
- **图像**：`imread`/`imwrite`/`imfinfo`（stb_image）
- **压缩归档**：`gzip`/`bzip2` + 进程内 `zip`/`unzip`/`tar`/`untar`/`gunzip`/`bunzip2`（无 shell）
- **音频**：`audioread` 系列 + `audioplayer`（WebAudio 桥）
- **网络**：同步 `urlread`/`urlwrite`/`webread`/`websave`（XMLHttpRequest 同步模式，无需 Asyncify）
- **Forge 包**：statistics / optim / geometry / struct / miscellaneous / signal / control / …

## 验收状态

本包内容 = 最近一次在浏览器实测通过的构建。**全量 14 套 400 项全绿**：

> **下一条基线（Octave 11.3.0）已就绪但有意未启用。**
> 它在 `http://127.0.0.1:8762/`（容器 `o113`）上跑通了 14 套，
> 含需求级 `accept-requirements` **14/14**；`ode15s`/`ode15i` 已可用
> （本轮从"桩"换成内嵌 SUNDIALS 的真 `.oct`）。
> **没换成 8761 的原因**：稀疏 `lu`（UMFPACK）在 11.3.0 上不可用，而 7.2 可用 ——
> 换过去就是功能回退，与"新实验不许让 8761 退化"冲突。
> 换基线的完整清单与决策点见 **`build/113/PROMOTION.md`**。

| 套件 | 项数 | 覆盖 |
|---|---|---|
| accept-full | 20 | 核心回归 + 官方 .oct 装载 + 资产车道 |
| accept-hdf5 | 16 | `save/load -hdf5` |
| accept-forge | 21 | Forge 纯 .m 包 |
| accept-forge-oct | 15 | Forge 编译件 |
| accept-forge2 | 42 | signal + control |
| accept-dldfcn | 68 | dldfcn 官方装载语义与真数值 |
| accept-ode15 | 14 | SUNDIALS `ode15s`/`ode15i` |
| accept-archive | 20 | 压缩/归档无 shell 化 |
| accept-image | 17 | 图像 I/O |
| accept-print | 43 | `print -dsvg` |
| accept-plotv2 | 54 | plot 桥 v2（2D） |
| accept-plot3d | 34 | plot 桥 v2（3D） |
| accept-audio | 47 | WebAudio 播放 |
| accept-net | 30 | 同步网络 |

## 已知偏差（如实）

- **`help` 对非平凡输入会报 `makeinfo` 子进程错误**：wasm 无 shell。`.m` 文件的
  docstring 直接可读（`help plot` 可用），但走 texinfo 渲染的路径（含所有内建）
  必然失败。**已实测修不了**（注入 doc-cache 也无用）。不影响函数调用。
- `system`/`unix`/`popen` 清晰报错（有意保持）。
- `fftw('threads',N)` 静默 no-op（线程桩，数值不受影响）。
- **control 包的 SLICOT 编译件未发布**：它们作为 side module 调用主模块的
  Fortran 符号时签名不匹配，一调就整页崩。故 `ss`/`step`/`tf2ss` 不可用；
  `tf`/`tfdata`/`dcgain`/`pole`/`bode`/`feedback` 等纯 `.m` 面正常。
- `voronoi` 的**单输出形式**（要画图）不可用；两输出形式正常。
