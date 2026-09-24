# HANDOFF · Octave-Full-Wasm（给 AI 的接续说明）

> 本文唯一目的：**抗上下文压缩**。新会话只读这一份就能接着干。
>
> **两层文档**（2026-09-24 拆开）：
> · **本文 `HANDOFF.md` = 活状态**：现在是什么样、下一步干什么。§0–§4 / §6–§8 是主体。
> · [`HISTORY.md`](HISTORY.md) = **历史与过程**（第三轮 T1–T10、批次 A–E、图形线 P5→WebGL、
>   第四轮换 11.3.0 基线、以及 `§5.23`–`§5.32` 的逐批实况）。里面的数字是"**当时如此**"。
> · **正文里单写的 `§5.x` / `§9` / `§10` 一律指 `HISTORY.md`**（编号保留，免得历史记录错位）。
>
> **最后更新：2026-09-24**。现状一句话：**R1–R10 与 T1–T10 全部落地**；外部审核给的
> R0–R5 里 **R1（无 shell 的清晰报错）、R4（`plot(hax,…)`/`voronoi` 单输出）、R3（fontconfig
> ⇒ `fontname` 真生效、`listfonts` 可用）已上线**，**R5 的 JSPI 组合探针已通过**（把
> `pause`/`kbhit`/`recordblocking` 接上去的那一步**没做**，见 §8）。全量与部署 sha **见文末
> `AUTO:STATE`**（机器维护，别在这里手写）。
>
> ⚠️ **动手前必须知道的七条**：
> ① **构建主树**：opengl-ON + gl2ps-ON + FreeType-ON + fontconfig-ON，GL 头是 gl4es+GLU。
>    重配的口径是 **`WITH_OPENGL=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1`** ——
>    ⚠️ **`WITH_OPENGL=1` 一个字都不能省**：它掌管"把被 configure 翻掉的
>    `GL_GLEXT_PROTOTYPES`/`HAVE_GLBLENDFUNCSEPARATE` 恢复成 1"，省掉它**编得过、链接过、
>    自检全绿**，但运行时默认 toolkit 静默掉回 `web`（图走 SVG 回落，见 HISTORY §5.31）。
>    `config.h` 变了必须 `make clean`（§10.3 坑 2）。
> ② **推送阻塞在人**：`gh` token 失效（`gh auth setup-git` 救不回来）⇒ 要人跑一次
>    `gh auth login` 才能 `git push origin main`；内容一直有落到持久盘镜像
>    `refs/heads/main-20260924`。若 `github.com` 又被拦，照 HISTORY §5.17 走 API。
> ③ **容器里的构建脚本是另一份拷贝**：改完仓库的 `configure-113-full.sh`/`link-web.sh`
>    必须 `docker cp` 进容器，否则跑的是旧的（HISTORY §5.20 末为此白跑两个大重建）。
> ④ `print` 的矢量输出依赖 gl2ps + shell 管道 + (gs|svgconvert)，**没有 shell 是有意的**
>    ⇒ **plot 桥自己那份 SVG 是唯一能出矢量的实现**，别当冗余砍。
> ⑤ **文档会自己更新，也会拦你**：文末 `AUTO:STATE` 是机器维护的（部署件 sha/体积、最近一次
>    全绿回归、交付包、包内 wasm 与部署件同 sha），pre-commit 会重算并 `git add`；活状态段落里
>    写死的旧数字会被 `.githooks/check-handoff.py` 拒提交 —— 改断言，别改检查器。
> ⑥ **别猜挂载点/路径**：`.githooks/check-consistency.py` 核对"站点资产的 `addpath` ==
>    `build/assets-meta.json` 的 `mount`"（`pkgfix` 挂的是 `m/pkg`，猜错会让 `pkg list` 静默坏掉）。
>    **字体目录同理**：不是 `/usr/src/octave/...`，而是 configure 的 prefix 下
>    `share/octave/11.3.0/fonts`（`link-web.sh` 从 Makefile 读 `octfontsdir`，不写死）。
> ⑦ **两个站点现在是"逐字节相同"的**（M2 + FreeType + fontconfig + 新桥 + `webshims`）；
>    回退点见 §3.1。**验收前提一律以 `sha256sum` 实测为准**，别背旧话。
>
> **文档约定（`.githooks/check-handoff.py` 按此执行，别违反）**
> · **活状态 = 头部 + §0–§4 / §6–§8**：那里的断言必须与产物一致，否则 pre-commit 直接拦。
> · **历史 = `HISTORY.md`**（`§5.x` / `§9` / `§10`，append-only）：数字与判断是"当时如此"，检查器不查。
> · 活状态里要引用旧值（"本批之前是 X"），就在**那一行**写清 `历史` / `退役` / `之前`，检查器认这个标记。
> · 机器维护的数字（部署件 sha 与体积、最近一次**全绿**回归、交付包、资产条目）在**文末
>   `AUTO:STATE` 区块**：由 `.githooks/update-handoff.py` 从持久盘产物重算，**别手写、别手改**。
>

---

## 0. 铁律（先读，违反会被拦）

1. **只在下面这个路径工作**：
   - 仓库：`/mnt/hdd/zcode-projects/Octave-Full-Wasm`（**唯一**可改的 git 仓）
   - 构建容器：docker `obuild`（源码在容器内 `/usr/src/octave-wasm/`）
   - 第三方源码/产物：`/mnt/hdd/octave-wasm-build/`、`/tmp/opencode/`
2. **禁止碰课程仓** `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917`——Octave 相关内容已刻意从中移出。课程仓与本体项目无关。
3. **纯客户端计算**：Octave 解释器恒跑在浏览器 wasm 内。禁止任何服务端执行代码的端点。
4. **不 force-push、不删 git 对象、不改历史**。
5. 白名单仓库：新增文件必须同步 `!路径` 到 `.gitignore`，否则 pre-commit 直接拒。
   ⚠️ **闸门有盲区**：`check-whitelist.py` 只看**已暂存**的文件 ⇒ **被忽略且从未 `git add`
   的文件它看不见**。2026-09-24 就这么查出 4 个承重文件（`promote-webgl.sh`、`recover-113.sh`、
   `post.js`、`build/webshell/*.m`）从来没进过 git（§5.27）。**新增文件后主动看一眼**
   `git status --short --ignored <目录>`，别只信闸门。
6. 每完成一批：更新本文件 + `build/CLIBS.md` + `README` 状态 → 提交推送。

---

## 1. 这是什么

浏览器里跑**完整版 Octave 7.2**（Emscripten → wasm）。上游 `rwl/octave-wasm`（BSD）只预装 16 个 `.m` 目录，本仓把剩下的能力尽量补全：全量核心脚本、forge 统计、C 库长尾（qrupdate/ARPACK/FFTW/Qhull/GLPK/…）、plot 翻译桥（Octave 算 → gnuplot-wasm → SVG）。

**架构定位**（外部审核给出的框架，指导第三轮）：本项目的价值不是"把 Octave 的桌面组件
逐个搬进 wasm"，而是**把宿主层换成浏览器原生 API**：

```text
                  GNU Octave 7.2（数值核心一字不改）
                            │
        ┌───────────────────┼───────────────────┐
     数值核心            graphics            系统 API
   （C/Fortran，           objects          （文件/shell）
    已全部可用）              │                   │
                        Web toolkit          browser shim
                            │                   │
        └───────────────────┼───────────────────┘
                            │
                  browser-native layer
        ┌──────────────┬────┴─────┬──────────────┐
   gnuplot-wasm     WebAudio    DOM        MediaDevices
```

**含义**：桌面版那些"外部进程/设备"部件（gnuplot 进程、PortAudio、ImageMagick、
Ghostscript、shell）**不移植**，而是**换成 JS 侧的等价物**。
已按此路线落地的：图像（stb_image）、压缩（zlib/bz2 内建）、音频播放（WebAudio）、
网络（同步 XHR）、绘图（plot 桥 + `print -dsvg`）。第三轮继续：help 渲染、
graphics 对象、文件操作、pkg 语义、`input()`、录音、文件选择。

- 远程：`https://github.com/ArchivalEra/Octave-Full-Wasm`（私有）
- 许可：AGPL-3.0（`LICENSE`）；混合体无其他选择
- 当前 HEAD：以 `git log -1` 为准（本文档自身也随每次提交更新；勿在文档里写死哈希，容易过期）
- 产物体积（**当前 11.3.0 车道：`-O2` + MAIN_MODULE=1 + HDF5**；交付走 EdgeOne 自动压缩）：
  wasm raw **34.30MB / gzip 7.78MB**；js raw **0.68MB / gzip 0.15MB**；
  data raw **6.80MB / gzip 1.34MB** → **首包 gzip 合计 ≈9.3MB**。
  另加**按需懒加载资产 19MB / 71 个文件**（谁用到谁下载，不计入首包）。
  ⚠️ **O 级口径**：`-O1` 是 **7.2 时代**的 R10 结论（见 `build/BENCH.md`）；
  **11.3.0 车道用的是 `-O2`**（`build/113/configure-113-full.sh` 的 `CFLAGS/CXXFLAGS`
  与 `link-web.sh` 的 `EXC_FLAGS` 都是 `-O2`）。别把两者混着写。
  历史：`MAIN_MODULE=1` 不做 DCE ⇒ 7.2 时代 gzip 从 6.18MB 涨到 10.96MB；HDF5 再 +1.5MB。
  **`MAIN_MODULE=2` 值得重做**（2026-09-22 调查）：Emscripten 会在 side module 上主链时
  **自动生成保活集**，不再需要手工维护导出清单 —— 见 §8 的"仍待办"。
- **2026-09-22 修掉一个"数据里带无用副本"的构建 bug**：`--preload-file` 按第一个 `@`
  切 `src@dst`，而 `m/@ftp` 的源路径自带 `@` ⇒ **整棵 m/ 树被复制到
  `/ftp@/usr/src/octave/m/@ftp/`**。实测文件表 2181 条里 **1087 条是重复（5.25MB / 44%）**，
  且 `@ftp` 自己的文件不在正确路径上。修完 **octave.data 13.83MB → 6.99MB
  （gzip −1.31MB）**，wasm 逐字节未变。见 §5.13。

---

## 2. 当前状态（已验证的基线）

### 2.1 已完成并**浏览器实测**通过

| 批次 | 内容 | 证据 | commit |
|---|---|---|---|
| — | 5 个 C 库：qrupdate / ARPACK / FFTW(双+单) / Qhull / GLPK | `eigs` 残差 1e-14、`fft` 正弦谱峰 32、`delaunay`/`glpk` 数值对 | `685999a` |
| **0** | dldfcn 静态注册表 + `convhulln` + `fftw()` | 11/12 绿 | `c4652b0` |
| **1a** | zlib / libbz2 / RapidJSON / CCOLAMD + `gzip`/`bzip2` | `gzip`/`bzip2`/`jsonencode`/`jsondecode`/`save -v7` 全通 | `a4f2510` |
| **1b** | libsndfile → `audioread`/`audiowrite`/`audioinfo`/`audioformats` | wav 往返：SampleRate=8000、8000 样点、峰值 1 | `4ed5392` |
| **1d** | **真 `.oct` 动态装载**（`MAIN_MODULE=1` + wasm side module，已采用） | 8761 实测 **20/20**；`.oct` 装载 `dldprobe()`=42；convhulln 数值与静态注册逐位一致 | `a8bec25` |
| **2** | **Forge 包体系**：10 个包懒加载 + 19 个编译件 `.oct` | 2A 21/21、2B 15/15；真数值（bfgsmin/editDistance/libsvm） | `7e3c1d6` `6a2fb38` |
| **3** | **R1 SUNDIALS 6.1.1 → `ode15s`/`ode15i`** | 刚性方程对真解 `y=cos t` 误差 9.2e-05（收紧容差 1.1e-08）；**主 wasm 零改动** | `e559a7e` |
| **4** | **R6 压缩/归档无 shell 化**（zip/unzip/tar/untar/gunzip/bunzip2） | 20/20，含二进制字节级往返与目录递归 | `346a516` |
| **5** | **R4 图像 I/O**（stb_image → imread/imwrite/imfinfo） | 17/17，PNG/BMP/TGA 无损像素级一致、JPEG 有损往返 | `130ded5` |
| **6** | **R9 `print -dsvg`**（纯 `.m` SVG 生成器）+ plot 桥 marker 丢失修复 | 43/43；不依赖 gnuplot/Asyncify | `4b1b2c6` |
| **7a** | **plot 桥 v2 2D**：barh/stairs/area/errorbar/pie + subplot 真多面板 + figure(n) 真多图 + axis | 54/54 | `87b3e2c` |
| **7b** | **plot 桥 v2 3D**：plot3/scatter3/mesh/surf/contour（Octave 侧投影，渲染器零改动） | 34/34 | `7e0ecca` |
| **8** | **R8 WebAudio**：18 个 `__player_*` 纯 `.m` 实现（零编译）+ AudioBufferSourceNode 桥 | 47/47，真实 AudioContext 调度 | `f15189d` |
| **9** | **R5 网络**：**真同步** urlread/urlwrite/webread/websave（同步 XHR，**无需 Asyncify**） | 30/30，含 1MB 二进制字节完整 | `648fa2f` |
| **11** | **R10 基准矩阵**：采纳 **`-O1`** 为基线 | 解释器密集代码快 5–10×，体积还小 7.5MB | `93f302e` |
| **12** | signal + control 包（补 R2 缺口）+ SLICOT 崩溃根因 | 42/42 | `3fe0551` |
| **13** | **dldfcn 回归官方 dlopen 装载**（摘掉静态注册） | 68/68，`exist` 5→3、`which` 指向 `.oct` | `632231b` `4292a01` |
| **交付** | 整站打包（可静态托管） | 包内 **14 套 402 项全绿**；首包 gzip ≈11.6MB | `dist/octave-full-wasm-site-20260921` |
| **T6** | `audiodevinfo` shim + `doc`（浏览器）+ **页面输出落点** | `accept-t6-audio-doc` **33/33**；资产车道零重链 | `e86ebb0` |
| **T7** | `audiorecorder`（19 个 `__recorder_*` + getUserMedia/MediaRecorder 桥） | `accept-t7-recorder` **40/40**（Chromium 假麦克风）；`recordblocking` 如实报错 | `e86ebb0` |
| **T10** | Asyncify 最小实验 → **结论不可采用** | `-s ASYNCIFY=1` 与 `-fwasm-exceptions` 互斥，`wasm-opt --asyncify` 直接失败 | `6a5ed8e` |

### 2.1.1 交付包（不在 git 里，在磁盘上）
```
/mnt/hdd/octave-wasm-build/site/                     # **站点源**（8761 服务的就是它，含 assets/ 懒加载资产）
/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260921/   # 交付包，可直接 rsync 上静态托管
/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260921.tar.zst  # 归档 26.7MB + .sha256
```
- 重打一条命令：`sh build/make-dist.sh`（站点 → 包 + 预压 `.gz` + MANIFEST + `.tar.zst`）。
  包内 `serve.py`/`DEPLOY.md` 的源文件已在仓库 `dist/` 下（此前只在磁盘上，属可复现性缺口）。
- 包内 `assets/oct/*.oct` 的 7 个是 **dldfcn 核心组**，`index.html` 自动装载；
  其余资产按需 `await OctaveAssets.load(...)`。

### 2.2 dldfcn 模块（**批次 13 起走官方 dlopen**，不再是静态注册）
11 个函数 ← 7 个 `.oct`（`assets/oct/`，`index.html` 自动装载）：
`__delaunayn__ / __glpk__ / __voronoi__ / convhulln / fftw / gzip(+bzip2) /
audioread(+audiowrite/audioinfo/audioformats)`
—— 语义与桌面版一致：`exist()=3`、`which()` 返回 `.oct` 文件路径。
多函数模块靠 manifest 的 `aliases` 建符号链接（Octave 按**文件名**找 `.oct`）。

### 2.3 未完成
**R1–R10 全部落地**；第三轮计划（T1–T10）见 **§5.5**，来源是
`build/GAPS-2.md`（缺口清单）+ `build/GPT-REVIEW-2.md`（外部审核）。
已论证不可行/不做：nan 与 tsa 的源是 MEX（需 mex 运行时）、miscellaneous 的
`sample.cc`/`text_waitbar.cc`、control 的 SLICOT 编译件（崩页面，见 §4.12）、
`publish`/`keyboard`/`getframe`（审核判定暂缓，见 §5.5）。

### 2.4 资产懒加载车道（**新能力一律走它**）
站点 `assets/` 下按需 fetch，**主 wasm 只在改 Octave 本体时才重链**：
```
assets/manifest.json          36 个资产：kind=oct | octdir | js | file
assets/oct/*.oct              单文件模块（dldfcn 核心组 7 个 + __ode15__ + webio + webimage + webnet）
assets/octdir/<pkg>/*.oct     包编译件（struct/optim/statistics/geometry/miscellaneous/control）
assets/pkg/*.js               Forge 纯 .m 包（含 signal/control）
assets/m/*.js                 .m 资产（webaudio / webnet / webshell 覆写 / webimage 注册 / plot 桥覆写）
assets/data/*                 kind=file：doc-cache、built-in-docstrings（按 mount 投放）
```
- 生成：`build/assets.py bundle-m|bundle-pkg|gen-manifest`；取包：`build/forge-fetch.py`；
  一键：`build/forge-build.sh`；编 `.oct`：`build/build_oct.sh`（dldfcn）/
  `build/build_pkg_oct.sh`（Forge 包）
- 加载：`bridge/assets-loader.js` → `OctaveAssets.load('__ode15__')`
- **必须知道的机制**（踩过，见 §4.10/4.11/4.12）：Octave 会自己执行目录里的 `PKG_ADD`；
  `.oct` 按**文件名**查找，多函数模块要建符号链接（manifest 里 `aliases`）；
  **side module 引用主模块 Fortran 符号时签名不匹配会整页崩**（SLICOT 那批）。

---

## 3. 环境与操作

### 3.1 容器 / 镜像 / 端口
```
obuild   最早的构建容器（批次 1b 非 PIC 态）—— 留着当最远回退点
odld     **当前主力**：PIC 全树 + MAIN_MODULE=1 主链 + HDF5 + SUNDIALS + 全部 .oct 目标文件
owasm    旧的线上构建，端口 8757，别动
镜像     octave-build:b5-image（**最新检查点**，批次 5 后全状态，5.97GB）
         octave-build:b1-hdf5（批次 1 后，5.67GB）
         octave-build:pic-oct2（PIC 全树 + cmake 3.27.9，5.56GB）
         octave-build:pic-oct（PIC 全树，5.25GB）
         octave-build:pre-dldfcn（批次 1b 可用态，4.27GB）
         octave-build:b2-snapshot / :final / :shutdown / :libs / :full / octave-wasm:latest
端口     8757=旧构建  8761=基线（改这里）  8762=staging/实验  8764=交付包验证
```
- **每批跑完就 `docker commit odld octave-build:<批次名>`**——断电后容器内的"最近写入"
  可能损坏（`exec format error` 就是这么来的），镜像检查点是唯一可靠的落盘（§4.8）。
- 容器内源码/产物：`/usr/src/octave-wasm/{src,target,third_party}`；第三方源码树在容器 `/tmp/`
  （SUNDIALS/HDF5/Forge 解包都在那儿，**容器重建会丢，需要时可从 `/mnt/hdd/.../third_party/` 重解**）
- `src/Makefile` = 仓库 `build/Makefile`；`src/main.cc` = 仓库 `build/main.cc`
- **新容器从检查点起**：`docker run -d --name odld2 octave-build:b5-image sleep infinity`
- **ccache 共享（第四轮起，已实测可用）**：宿主持久目录
  `/mnt/hdd/octave-wasm-build/ccache/`（含 `ccache.conf`）。挂载方式：
  `docker run -v /mnt/hdd/octave-wasm-build/ccache:/ccache -e CCACHE_DIR=/ccache …`。
  用 `CC="ccache emcc"` / `CXX="ccache em++"` 包。
  **⚠️ 构建目录的路径必须逐字固定**——绝对 `-I` 会进 hash，换路径就整片失效（实测）。
  缓存不进镜像，`docker commit` 不会把它塞进 image。宿主已装 `meson 1.12.0` /
  `ccache 4.13.6` / `ninja 1.13.2`。
  （历史：退役的 OSMesa 线要的是**容器里**那份 meson，不是宿主的 —— 见 §5.16。）

### 3.2 起服务与预览（**断电后一条命令**）
```bash
sh build/recover.sh          # 起容器 → 站点缺失则从 odld 重建 → harness → 8761 → 自动验收
```
- 站点根：**`/mnt/hdd/octave-wasm-build/site`**（持久盘；旧的 /tmp/opencode/oweb3 已废弃）
- 测试 harness：**`/mnt/hdd/octave-wasm-build/harness`**（含 playwright-core + `run.sh`）
- 验收套件在仓库 `test/browser/accept-full.mjs`，跑法：
  `/mnt/hdd/octave-wasm-build/harness/run.sh <仓库里的脚本> [URL]`
- 本机 curl 一律加 `--noproxy '*'`（**只对 127.0.0.1 直连有效**；外网要走代理，见 3.6）

### 3.3 构建一条龙（在容器内）
```bash
export PATH=/opt/cmake/bin:/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:$PATH
# 1) 重 configure：build/reconf-pic.sh（PIC 是硬要求，见 §4.1）
# 2) 全量 make（-O0 + -j24 约 12 分钟）
cd /usr/src/octave-wasm/third_party/octave-7.2.0 && emmake make -j24 && emmake make install
# 3) 重链 web 端（分钟级）
cd /usr/src/octave-wasm/src && rm -f web/octave.{js,wasm,data} && make web/octave.js
# 4) 拷出部署到持久站点
sudo docker cp odld:/usr/src/octave-wasm/src/web/octave.js /mnt/hdd/octave-wasm-build/site/
```

### 3.4 浏览器自动验证（无人值守唯一验收手段）
- Node + `playwright-core`（在 harness 里），可执行 `/usr/bin/chromium`，
  参数 `--no-proxy-server --no-sandbox --disable-dev-shm-usage`
- 套件：`test/browser/accept-full.mjs`（19 项：核心回归 + `.oct` 装载 + 资产懒加载）
- 模式：`goto` → 轮询 `Module.feval('strcat',['a','b'],1)` 等就绪 → `Module.eval_string(expr)`
  + 抓 `Module.last_error_message()` 与 console
- **数值/行为只认实测输出**；不要凭"应该对"

### 3.5 git 推送
- 重启后 git 可能推不动：`gh auth setup-git`（keyring 重启失效）
- 仓内 hooks：pre-commit 重算 README 的 `AUTO:FILES` 区块 + 校验白名单；pre-push 校验 README 新鲜
- **禁用 `--no-verify`**

### 3.6 网络与代理（**新**）
- 宿主/容器直连境外极慢 → **走本机 HTTP 代理**：
  - 宿主：`curl -x http://127.0.0.1:2080 …`（实测 3.9MB/s）
  - 容器：`curl -x http://192.168.137.1:2080 …`（网关地址用 `ip route | awk '/default/{print $3}'` 查，会变）
- GitHub 直连基本不可用（45MB 的 cmake 下到一半就断）；**大件一律走代理**
- 容器内下载也可用代理（已验证 200），SUNDIALS / Forge 包都靠这条

---

## 4. 血泪坑（照抄，别重踩）

### 4.1 dldfcn 不能 dlopen（A 组根因）—— 2026-09-20 已亲手核实
`.oct` 模块无法加载 → 很多函数明明库有却 `exist=0`。**结论：`.oct` 确实用不了，但根因不是"wasm 做不到"，是三层叠加，其中第一层是上游 fork 自己挖的。**

1. **上游 fork 掏空了装载代码**（决定性）。`third_party/octave-7.2.0/liboctave/util/oct-shlib.cc` 里
   `octave_dlopen_shlib` 的**构造函数不调用 `dlopen`**、`search()` **不调用 `dlsym`**（`void *function = nullptr; return function;`）。
   该文件在 `rwl/octave-wasm` 的 git 里**被跟踪且工作区干净**（commit `e584306c`）→ 是 fork 的既定行为，**不是本项目会话改的**。
   旁证：fork 里还留着一份 octave-4.4.1，同处代码是**被 `//` 注释掉**的（上游原样），7.2.0 里连注释都删净了；
   fork 镜像构建日志 `/mnt/hdd/octave-wasm-build/build.log:27635` 有 `oct-shlib.cc:210:9: warning: variable 'flags' set but not used`，印证镜像里就是这个版本。
   注意：构造函数里 `flags` 算了却没用，就是 dlopen 调用被删掉的直接后果。
2. **Emscripten 侧本就要求可重定位构建**。`dlopen` 的 JS 实现 `src/library_dylink.js` **整个被 `#if RELOCATABLE` 包住**；
   `RELOCATABLE` 只由 `MAIN_MODULE`/`SIDE_MODULE` 自动开启（`settings.js:1015`）。非该模式下 dlopen 只有一句
   `"To use dlopen, you need enable dynamic linking"`。且 `emcc.py:837` 在 `RELOCATABLE` 时**自动追加 `-fPIC`** → 走这条路要**全树重编**。
3. **dldfcn 从来不在构建里**。`libinterp/dldfcn/Makefile` 不存在（automake 没生成 = 该目录没进构建），容器内 `find / -name "*.oct"` **一个都没有**。

**实测（浏览器，8761 基线，2026-09-20）**：
- `WebAssembly.Module.customSections(mod,'dylink.0')` → `0`；导入表 85 项、**无任何 dl 符号**；`Module._dlopen` → `undefined`。
  （wasm 里唯一那处 "dlopen" 字样来自 RTTI 名 `N6octave19octave_dlopen_shlibE`，不是符号。）
- 往 wasm FS 丢假 `probeoct.oct` 再 addpath：`exist("probeoct")` → **3**（路径**认** `.oct`），调用 `probeoct(1)` →
  `error: /tmp/probeoct.oct is not a valid shared library`（rc=2）。这正是 `is_open()` 恒 false 后由
  `libinterp/corefcn/dynamic-ld.cc:171` 抛的那句。探针脚本：`/tmp/opencode/octave-accept/octprobe.mjs`（备份见 §3.4）。

**推论**：`STATIC_DLD_FCNS` 是现基线（8761）架构下的正解。

**但是 —— 2026-09-20 当天已把真 dlopen 做通并实测通过（实验构建在 8763，独立容器 `odld`，基线未动）**：
`.oct` **能用**。四件事缺一不可，全部配方与实测见 `build/CLIBS.md`「真 .oct 动态装载」节：
1. 恢复 `oct-shlib.cc`（上游 `release-7-2-0` 同名文件覆盖，diff 只有 3 处 hunk）；
2. 全树 `-fPIC`：`build/reconf-pic.sh` + `build/rebuild-pic-libs.sh`（只有 glpk/arpack/sndfile/qhull/fftw3+3f 这 5 个库需要，`.so` 系零报错不用动）；
3. 主链 `-s MAIN_MODULE=1 -s ALLOW_TABLE_GROWTH=1`（另需 `embuilder build --pic zlib bzip2`）；
4. `.oct` 用 `build/build_oct.sh` 编成 `-sSIDE_MODULE=1` 的 wasm，**不链任何库**。

实测（8763）：自写 `dldprobe.oct` → `dldprobe()`=42；把 `gzip`/`convhulln` 从静态表摘掉后
只能靠 `.oct` 活，功能正常且**数值与静态注册逐位一致**；回归对照与 8761 无差异。

**代价（决定是否采用的关键）**：gzip 后总交付 6.18MB → **11.05MB（+79%）**
（wasm 4.94→8.05MB，js 51KB→1.81MB——`MAIN_MODULE=1` 不做 DCE，JS 里那份 29.8MB 的
dylink 符号表压完是 1.81MB）；首帧 ready 863ms → 1136ms。
未做的优化：`MAIN_MODULE=2` + 显式导出清单，应能同时压缩两份。
**采用与否属产品取舍，需人工拍板；未改基线。**

**解**：`main.cc` 顶部 `STATIC_DLD_FCNS(X)` 宏表登记 `{name, G_installer}`，Phase 3 里逐个 `getter(no_shl,false)` → `symtab.install_built_in_function`。
- 新增模块 = 加一行 + 编 `.o` + 在 `Makefile` 的 `EM_LDFLAGS` 挂 `.o`。
- 编 `.o` 用 `build/build_dldfcn.sh <name>`（容器内跑；`docker cp` 后要再 `chmod +x`）。
- installer 符号名 = `G` + 函数名（如 `convhulln`→`Gconvhulln`，`__delaunayn__`→`G__delaunayn__`）。

### 4.2 ⚠️ dldfcn 的 `.o` 必须在 config.h 反映 feature **之后**编
先用旧 config.h 编，`#if defined(HAVE_XXX)` 走 else 分支 → 函数装上却报 `... was unavailable or disabled`。改 configure 后**务必重编相关 `.o`**。

### 4.3 FFTW 线程桩（必须返回成功）
`build/fftw_threads_stub.c`：`fftw_init_threads`/`fftwf_init_threads` **返回 1**（返回 0 会让核心 `fft` 直接崩，报 "Error initializing FFTW threads"）；`*_plan_with_nthreads` 空实现。
代价：`fftw('threads',N)` 静默 no-op（不报错）——已知偏差。

### 4.4 ARPACK 三连坑
1. `duplicate symbol: debug_/timing_`（F2C 公共块多文件重复定义，wasm-ld 严格）——
   **反直觉**：`emcc -fcommon` 在本工具链把定义变 `U`（未定义），**禁用**。
2. vs-arpack 是 MKL 口味 ABI（`dlacpy("A",…)` 前导字符），与 reference LAPACK 不兼容 → 弃用。
   改用 **arpack-ng 3.7.0 Fortran 源** + `build/normalize_arpack.py`（`!`注释→`c`，`&`续行→定式续行）。
3. 最终：**全源 cat 进单个 TU 编译**（公共块天然单定义），`second_stub.f` 提供 `second()` 桩，`emar` 重建 `libarpack.a`。
- configure 需预置 `octave_cv_lib_arpack_ok_1=yes`（ARPACK 的 C++ 运行测试在容器旧 Node 14 下挂，链接本身 OK）。

### 4.5 CCOLAMD / zlib / bz2 / RapidJSON
- `HAVE_CCOLAMD=1` 后**必须补 `-lccolamd`**（`libccolamd.so` 已在 target/lib），否则 undefined `ccolamd/csymamd`。
- zlib/bz2 用 Emscripten ports：`embuilder build zlib bzip2`（头/库进 sysroot），终链补 `-lz -lbz2`。
- RapidJSON：header-only，解包到 `target/include/rapidjson/`；configure 去掉 `--disable-rapidjson`。

### 4.6 CXSparse "too old" —— **已解决（批次 1）**，是假失败
报错文本骗人：库和头都好好的（`cs.h` 里 `CS_VER=3/CS_SUBVER=1`，`libcxsparse.so.3.2.0` 也在）。
真因：`OCTAVE_CHECK_CXSPARSE_VERSION_OK` 走 **`AC_PREPROC_IFELSE`（纯预处理）**，而它**只吃 `CPPFLAGS`**；
本仓的 `-I target/include` 一直只写在 `CFLAGS/CXXFLAGS` 里 → 预处理时找不到 `cs.h` → 判成"太老"。
**修法一行**：configure 时加 `CPPFLAGS="-I$INCDIR"`（已内建在 `build/reconf-pic.sh`），
并恢复 `--with-cxsparse --with-cxsparse-includedir/-libdir` → `HAVE_CXSPARSE_VERSION_OK=1`。
两个行为边界（非缺陷，桌面版同）：`qr(s,0)` 经济模式 CXSparse 不支持；`[Q,R,P]=qr(s)` 的 P 为空
（但 `s=Q*R` 恒等式成立，残差 7e-15——验收用这个判据）。SPQR 本轮未做。

### 4.7 其它
- `-lz -lbz2 -lccolamd -lsndfile` 都要手工进 `Makefile` 的 `EM_LDFLAGS`（Octave 自己的链接行不管我们的 web 终链）。
- 终链只剩 `cgejsv_`/`zgejsv_` 两个良性未定义警告。
- 容器内 Node 14 太旧：**任何需要在 configure 期“运行”的测试都可能假失败**（`unexpected section <Exception>`）。对策：预置对应 `octave_cv_*` 缓存变量。
- 容器有网络；`docker cp` 会重置可执行位。

### 4.8 断电（2026-09-20 真发生过一次，代价与教训）
- **宿主机 `/tmp` 是 tmpfs**：站点、浏览器测试脚本、node_modules 全丢，恢复靠人肉拼。
  已改正：站点 → `/mnt/hdd/octave-wasm-build/site`；harness → `.../harness`；
  **验收套件进仓库** `test/browser/accept-full.mjs`；一键恢复 `build/recover.sh`。
- **容器内的最近写入也可能损坏**：断电后容器里的 cmake 报
  `exec /opt/cmake/bin/cmake: exec format error`（tar 解压没落盘）。教训：
  **关键工具装完立刻 `docker commit` 打检查点**（`pic-oct` → `pic-oct2` 就是这么来的）。
- 但容器是 `Exited` 不是删除 → **内部既有文件基本全幸存**（PIC 产物、主 wasm 37.9MB、
  5 个 PIC 库、.oct、源码树都在），`docker start` 即可，不必重建。
- **恢复后必须重跑验收再继续**：本次恢复后 19/19 全绿才接着干。

### 4.9 境外下载（见 §3.6）
GitHub 直连基本不可用（45MB 的 cmake 下到一半断），**一律走本机 2080 代理**；
容器内走网关（`192.168.137.1:2080`，会变，用 `ip route` 查）。

---

### 4.10 Octave 会**自己执行**目录里的 `PKG_ADD`（批次 5 踩到）
`addpath` 一个含 `PKG_ADD` 的目录时，Octave 自动 run 它。加载器起初又手动 run 了一遍
→ `imformats("add", …)` 执行两次 → `imformats("png")` 返回两条 →
`imwrite` 里 `fmt.write(varargin{:})` 报 **`a cs-list cannot be further indexed`**。
**解**：不要手动 run `PKG_ADD`（Octave 本就会跑），且注册类代码写成幂等。
这条对所有 `PKG_ADD` 型资产都成立（Forge 包也受影响）。

### 4.11 `.oct` 按**文件名**查找；多函数模块要建符号链接（批次 4 踩到）
`webio.oct` 里导出 6 个函数（`__web_zip__` 等），但 `exist("__web_zip__")` 恒为 0——
因为 Octave 找的是**与函数同名的 `.oct` 文件**。桌面版就是这么解决的：
`bzip2.oct -> gzip.oct` 是符号链接。**解**：manifest 里给模块声明 `aliases`，
loader 在挂载后对每个函数名 `FS.symlink` 到该模块。
（`octdir` 分支也要支持 `aliases` —— control 包的 `lti_input_idx.oct` 导出
`__lti_input_idx__`，就是靠它才挂上的。）

### 4.12 ~~side module 引用主模块 Fortran 符号时签名不匹配会整页崩~~（批次 12 踩到）

> #### 🚨 **2026-09-22 探针更正：下面这段的根因写错了，别再照它去修。**
> 完整实测见 **`build/113/NOTES-slicot.md`**。三条更正：
> 1. **不是"签名不匹配"，是"那些符号根本不存在"** —— `__control_slicot_functions__.oct`
>    导入 48 个 SLICOT 例程，逐个查主 wasm 的符号表：**定义了 0 个**。
>    所以调用落到空导入 → 整页崩。文档里那句 `signature mismatch: zdotu_` 警告是
>    **另一件事**（libqrupdate vs librefblas），与本项无关。
> 2. **库能编**：`slicotlibrary.a` **从未编过**，本次编出来了 ——
>    f2c **614/614 成功**、emcc **613/613 成功**（5,019,126 字节），关键符号自检全 T。
> 3. **真正的卡点是另一个 ABI 分歧，而且 static/side 都会撞**：把库静态打进调度模块时
>    `wasm-ld` 报 `function signature mismatch: dggev_` —— 控制包手写的
>    `F77_FUNC(dggev,DGGEV)`（17 参，LAPACK 原样）与 f2c 生成的（19 参，多两个
>    **CHARACTER 隐藏长度参数**）不一致。原生链接器不查类型所以"能跑"，wasm-ld 查。
>    **⇒ 当年那句"静态注册不受影响"就本项而言不成立**（错误发生在链接期）。
> 4. **做法**（1–3 天，不是"半小时的小实验"）：按 `patch-odepack-callback-arity.sh`
>    的同型做法，逐个把冲突声明对齐（粗查潜在冲突面 **47 个符号**），逐个重链，
>    最后验 `ss`/`step`/`tf2ss` 的数值。**本轮已探针到此为止并如实记录。**

control 包的 48 个 SLICOT 编译件一调用 `ss`/`step`/`tf2ss`，wasm 层直接抛
`TypeError: Cannot read properties of undefined (reading 'apply')`，**整个页面死掉**。
根因：`.oct` 以 side module 形式链接（本项目既定做法：`-sSIDE_MODULE=1`、不链库），
它按**自己的声明**编出对主模块 Fortran 符号的导入；而主模块里那些符号
（`zdotu_` 等）的实际签名不同 —— `wasm-ld` 每次链接都在警告
`function signature mismatch`。静态注册那条路不受影响，因为 `.o` 进同一次链接、
签名由链接器统一；**side module 没有这个统一过程**。
**处置**：那批 `.oct` 不发布（只发纯 `.m` 面）。**将来若要修**：先做最小实验——
把某个 SLICOT `.oct` 改成静态注册看是否可用。

### 4.13 两条 wasm/JS 互操作的硬约束（批次 9 踩到）
1. **`EM_ASM` 在 side module 里不可用**（`EM_ASM is not supported in side modules`）——
   它的 JS 体要在**链接期**拼进主模块胶水。替代：`emscripten_run_script()`
   （主模块导出的普通库函数）；参数传递用「写 MEMFS + JS 读回」，
   因为一个 `const char*` 装不下 URL+method+body 三样。
2. **同步 XHR 不能设 `responseType`**（`InvalidAccessError`）。要拿字节就用
   `overrideMimeType('text/plain; charset=x-user-defined')` + `responseText`，
   再 `charCodeAt(i) & 0xFF` 逐字节还原 —— 1MB 二进制实测无损。

## 5. 历史记录（**已拆到 `HISTORY.md`**）

> 本节的正文（第三轮 T1–T10 的过程、批次 A–E、图形线 P5/WebGL 的来龙去脉、
> 每一轮的实测数字）**原样搬到了 [`HISTORY.md`](HISTORY.md)**，编号不变
> （`§5.x` / `§9` / `§10` 仍是原来的号）。
> **为什么拆**：HANDOFF 从 400 行长到 2700 行，而"现在是什么状态"只占其中一小半 ——
> 每次接续都要把历史也读一遍，既慢又容易**照抄过期数字**（2026-09-24 一天里抓到 5 处）。
> 现在的口径：**HANDOFF 只放活状态（现在什么样、下一步干什么）；过程与旧数字在 HISTORY**。
> 机制不变：`.githooks/check-handoff.py` 仍只查活状态段落，`§5.x` 依旧是"当时如此"的豁免区。

**正文里单写的 `§5.x` / `§9` / `§10` 一律指 `HISTORY.md`**（编号保留，免得历史记录错位）。
## 6. 文件地图（仓库内）

| 路径 | 作用 |
|---|---|
| `HISTORY.md` | **历史记录（append-only）**：2026-09-24 从 HANDOFF 原样拆出（`§5.x`/`§9`/`§10`）。查"当年为什么这么做、踩过什么"用 `grep -n 关键词 HISTORY.md` |
| `build/Makefile` | 构建主 Makefile（含 `EM_LDFLAGS` 全库清单 + dldfcn `.o` 挂载 + `STATIC_DLD_FCNS` 相关） |
| `build/main.cc` | wasm 入口；`STATIC_DLD_FCNS` 注册表 + Phase 3 安装 + addpath 两段式 + feval/eval_string 绑定 |
| `build/reconf*.sh` | configure 配方。**当前基线是 `reconf-pic.sh`**（含 `-fPIC` 与 `CPPFLAGS` 两处关键）；`reconf-batch1*.sh`/`reconf.sh` 是历史 |
| `build/rebuild-pic-libs.sh` | 5 个静态库的 `-fPIC` 重建（glpk/arpack/sndfile/qhull/fftw3+3f）——**重编 Octave 时必须一起走** |
| `build/build_dldfcn.sh` | 编 dldfcn `.cc` → `.o`（**静态直装**车道，挂终链） |
| `build/build_oct.sh` | 编 dldfcn `.cc` → `.oct` **side module**（动态装载车道，不挂终链） |
| `build/build_pkg_oct.sh` | 编 **Forge 包** `src/*.cc` → `.oct`（内含 3 个垫片 + config.h 纠正表/合成兜底） |
| `build/assets.py` | 资产工具：`bundle-m` / `bundle-pkg` / `gen-manifest` |
| `build/render-docstrings.py` | **T1**：构建期用**真 makeinfo** 预渲染 `built-in-docstrings`（去 texinfo 标记 → `help` 走 plain text 分支）。宿主侧跑 |
| `build/check_m.py` | `.m` 语法预检（宿主 Octave，秒级）：括号平衡 + 多函数同文件。**改 `.m` 前先跑它** |
| `build/webfile/` | **T3**：`copyfile`/`movefile`/`ls` 的进程内实现（10 个纯 `.m`，同名覆写核心函数，无 shell） |
| `build/webshims/` | **R1/R0（2026-09-24）**：**无 shell 的清晰报错**覆写 —— `popen.m`（`-1` → error）、`system.m`（`status == -1` → error；两输出形态原样透传给内建）|
| `build/pkgfix/` `build/pkgrestore/` | **T4**：pkg 数据库生成器 + **还原**被 fork 删掉的 `installed_packages.m`（与 upstream 逐字节相同） |
| `build/BASELINE-11.3.md` | **第四轮当前依据**：11.x 收益核实、19 patch 漂移实测、Edge-Tools 11.1.0 配方全文（5 处 sed / `emf77` / webgl toolkit / 接口 / COI 代价）、5 条 sed 对 11.3.0 命中实测、vanilla 11.3.0 三项核对、ccache 实测 |
| `build/113/configure-113-full.sh` | **11.3.0 全开 configure**：依赖写成**一张表 + `SKIP` 变量**（按库集合二分只需改一行；`SKIP=umfpack` 即精确关单个库，且会**显式加 `--without-umfpack`**——仅不传 `--with-*` 不够） |
| `build/113/build-libs.sh` | **② 的 11 个库**逐库独立构建（每库独立 prefix `/src/deps/<lib>` + 符号自检）。踩过的坑全在注释里（hdf5 交叉编译、zlib 非 autoconf、CHOLMOD 的 NPARTITION、rapidjson、bzip2 的 CC=gcc…） |
| `build/113/build-oct.sh` | 编 `.oct` side module。两种模式：dldfcn（`build-oct.sh convhulln …`）与**我们自己的 `.cc`**（`OUT=… CC_SRCS="webio:/路径/webio.cc" build-oct.sh --cc`） |
| `build/113/link-web.sh` | 11.3.0 的 **web 主链**（含 `--whole-archive` 的教训与定点 `-Wl,-u` 的 zlib 符号拉取；`M_SRC` / `EXPORTED_FUNCS` / **`EXPORT_IF_DEFINED`** 三个口子 + 末尾预载路径自检） |
| `build/113/fix-slicot-abi.py` | **SLICOT ABI 对齐**（2026-09-23）：把控制包手写 `F77_FUNC` 声明缺的 CHARACTER 隐藏长度参数补上（尾部默认实参 `= 1`）。硬自检 + 幂等；见 `NOTES-slicot.md` §5 |
| `build/113/rebuild-pic-blas.sh` | **重编 Fortran 三库带 `-fPIC`**（libf2c/refblas/lapack）→ 独立 prefix `/src/deps/lapack-pic/`，**不动 `/usr/local`**（主链还在用那份）。side module 必须 PIC；实测约 65 秒 |
| `build/113/patch-ax-pthread.sh` | **闸门③**：emscripten 下跳过 `AX_PTHREAD`，但**保留 `pthread.h` 检测** |
| `build/113/probe-side-module.sh` | **闸门②**：不碰 Octave，30 秒验证 MAIN_MODULE+SIDE_MODULE 机制 |
| `build/113/apply-platform-patches.sh` `emf77` `build-deps.sh` `fix-rapidjson.py` | 平台补丁 / f2c 包装 / 早期四库 / rapidjson 补丁。**`ss-long64.h` 已被证伪，勿用** |
| `build/113/NOTES-umfpack.md` | **UMFPACK 整页 trap 的调查记录**：含**一个被实测证伪的假设**（索引宽度）与下一步该查什么 |
| `build/113/NOTES-archive.md` | **gzip/zip 两个整页 trap 的根因与修法**（zlib 不在主模块）+ 三条走过的弯路 |
| `build/113/GATE3-QUESTION.md` | 闸门③ 当时的求判问题单（顶部已有解题记录，余下留档）
| `build/BASELINE-10.3.md` | 前一份（10.3 方向）依据：10.3 wasm recipe 原文摘录（19 patch、Flang 工具链、他们关掉的库）+ edgetools.io 图形撞墙记录。**保留作历史记录** |
| `build/forge-fetch.py` | Forge 取包器（按 Octave 版本过滤 + 依赖递归 + sha256 校验） |
| `build/forge-build.sh` | Forge 纯 `.m` 车道一键（取包 → 打包 → 出清单） |
| `build/recover.sh` | **断电后一键恢复**（起容器 → 工具链体检 → 站点 → harness → 8761 → 自动验收） |
| `build/webio.cc` | R6 压缩/归档内建（zlib+bz2，zip/tar 自实现） |
| `build/webimage.cc` | R4 图像内建（stb_image/stb_image_write） |
| `build/fftw_threads_stub.c` | FFTW 线程桩（必须） |
| `build/normalize_arpack.py` | ARPACK F77 源净化器 |
| `build/second_stub.f` | ARPACK `second()` 计时桩 |
| `build/plotbridge/*.m` | plot 翻译桥垫片（plot/hold/legend/xlim/… 20 个）+ 桥自身的状态机 |
| `build/plotbridge/__pb_fields__.m` | **单个面板的字段表**（名字/默认值/新轴是否重置）——那三处的单一真源 |
| `build/plotbridge/__pb_palette__.m` | 唯一的 7 色调色板（取色 `k` 从 1 起循环） |
| `build/plotbridge/__pb_publish__.m` | **无 GL 设备的显示回落**：把当前状态渲成 SVG 交给页面（见 §5.22） |
| `.githooks/update-handoff.py` | **HANDOFF 自更新**：从持久盘产物重算文末 `AUTO:STATE`（部署件 sha/体积、最近一次全绿回归、交付包…） |
| `.githooks/check-handoff.py` | **陈旧断言闸门**：`HANDOFF.md` 的活状态段落（头部 + §0–§4/§6–§8）与产物矛盾就拒提交；**只看 `HANDOFF.md`**（历史在 `HISTORY.md`，不查） |
| `.githooks/check-consistency.py` | 挂载根/启动清单/车道路径的一致性检查（pre-commit + pre-push） |
| `.githooks/handoff-context.py` | ZCode `SessionStart` hook 的输出（把"先读 HANDOFF.md + 当前部署状态"注入会话；`.zcode/config.json`） |
| `build/glue-selftest.m` `build/glue-selftest.sh` | **胶水层自带测试的统一驱动**（目标名单单一真源；宿主秒级 / 浏览器 `accept-selftest`） |
| `build/113/build-fontconfig.sh` | **R3**：静态 `libfontconfig` + `libexpat`（`-fPIC` + `-fwasm-exceptions`）→ `/src/deps/{fontconfig,expat}`；四个坑写在注释里，带符号自检 |
| `build/113/probe-fontconfig.{c,sh}` | **R3 的机制闸门**（30 秒、不碰 Octave）：静态 fontconfig + MEMFS 配置/字体能不能用；量出两条静默陷阱（宿主 env 进不来 / 默认配置路径是双斜杠 `//fonts/fonts.conf`）|
| `test/browser/probe-fontname.mjs` | **R3 的验收探针**（13 项）：`listfonts`/`__get_system_fonts__` + **像素级判别**（只改 `fontweight`/`fontangle` ⇒ `getframe` 像素和必须不同）|
| `bridge/queue.js` | MEMFS 队列的**协议无关部分**（取 fs / 读走清空 / 切分），四个宿主桥共用 |
| `bridge/assets-loader.js` | **资产懒加载器**（manifest → fetch → 写 FS → addpath；支持 `aliases` 符号链接） |
| `bridge/index.html` | 站点入口（原版 + loader，只读清单不预加载） |
| `test/browser/accept-*.mjs` | **验收套件（进仓库，断电不丢）**：套数与项数见文末 `AUTO:STATE` 区块；**逐套清单与覆盖说明**见 `dist/DEPLOY.md` 的表 |
| `test/browser/accept-requirements.mjs` | **需求级验收（一屏看全 R1–R10）**——新会话起手体检用；按需求编号而非批次组织 |
| `test/browser/probe-*.mjs` | **探针**（不进 sweep，按需跑）：`probe-text-render`（FreeType 出字，6 项）、`probe-m2-lazyload`（M2 没破坏懒加载，7 项）、`probe-cold-start`（冷/温分量，只测不判）、**`probe-core-names`（名字面与已知偏差的当班实况，23 项 —— §7 那几条「能用/不能用」的断言靠它防腐；R1/R4 上线时它当场把 3 条「已知缺口」翻成绿）**、`probe-want-matcher`（断言匹配器的红-绿对照）|
| `test/browser/bench-core.mjs` | R10 基准套件（10 项计时 + ready + 体积；每项 3 次取中位数） |
| `build/BENCH.md` | **R10 结论**：O0/O1/O2 矩阵与采纳依据（取 O1） |
| `build/build_oct.sh` | 编 dldfcn `*.cc` → `.oct`（官方装载车道，不挂终链） |
| `build/build_pkg_oct.sh` | 编 Forge 包 `src/*.cc` → `.oct`（三个垫片 + config.h 纠正表） |
| `build/make-dist.sh` | **打交付包**（站点 → 预压 `.gz` + MANIFEST + `.tar.zst`） |
| `dist/DEPLOY.md` | 交付包的部署说明（nginx 配置 / 托管要点 / 已知偏差） |
| `dist/serve.py` | 本地预览服务（wasm MIME + gzip_static 语义） |
| `build/webaudio/*.m` | R8：18 个 `__player_*` 纯 `.m` 实现（零编译） |
| `bridge/webaudio.js` | R8 页面侧：队列 → AudioContext + AudioBufferSourceNode |
| `bridge/webnet.js` | R5 页面侧：异步 fetch 桥（`OctaveNet.prefetch/get`） |
| `build/GAPS.md` | **第一轮需求书**（R1–R11；**R1–R10 已全部落地**），保留作为"当时怎么判断"的记录 |
| `build/GAPS-2.md` | **第二轮缺口清单 v2**：全部剩余缺口（A–H 八组），每条带实测证据、要搜的问题、验收标准 |
| `build/GPT-REVIEW-2.md` | **外部审核**（GPT 对 GAPS-2 的逐条审查）：两处纠错、A1 的核心架构建议、排好序的工作量表 |
| `build/CLIBS.md` | **C 库长尾全部配方与坑**（最重要的一手记录） |
| `vendor/forge/*.m` | forge 统计纯 `.m`（16 个） |
| `vendor/extra/*.m` | 自研 fft/ifft/ttest + asciiplot |
| `vendor/MANIFEST.md` | vendor 来源与许可 |
| `.opencode/goal-state.md` | 上一轮无人值守的 goal 状态（含恢复步骤） |

容器内关键路径：`/usr/src/octave-wasm/src/{Makefile,main.cc}`、`.../target/{include,lib}`、`.../third_party/octave-7.2.0/config.h`。

---

## 7. 已知偏差（如实）
- `fftw('threads',N)` 静默 no-op（4.3）。
- ~~`gunzip`/`bunzip2` 调 `system` 报错~~ → **批次 4 已修复**：`zip/unzip/tar/untar/gunzip/bunzip2`
  全部改成进程内实现（`webio.oct` + `webshell` 覆写），二进制往返字节级一致。
  仍存在的同类：任何**其它**调 `system()` 的 `.m`（全树共 34 个文件）——本构建里会清晰报错。
- ~~**shell 一族只有两输出形式"清晰报错"**~~ → **2026-09-24 已修（R1/R0 覆写层，见 §5.30）**：
  `[st,out]=system("ls")` / `unix(...)` 一向清晰报错（`system: unable to start subprocess for 'ls'`，
  **这条文本一字未改**）；而 `st = system("ls")`（静默 `-1`）、`system("ls")`（无输出参数，**静默通过**）、
  `popen("ls","r")`（静默 `-1`）现在**也抛同一条清晰错误**。做法是 `build/webshims/{popen,system}.m`
  **同名覆写**（只作用于解释器名字解析；C++ 内部的 `octave::popen()` 不受影响）。
  回归钉在 `test/browser/accept-shellerr.mjs`（14 项）与探针 `probe-core-names.mjs`。
  **仍存在的同类**：其它调 `system()` 的 `.m`（全树 34 个文件）现在会**清晰报错而不是静默继续** ——
  这是有意的（"做不了明确报错"），但要记得它改变了这些 `.m` 的行为。
- ~~**`help` 对非平凡输入会报 `makeinfo` 子进程错误**~~ → **T1 已修复（内建）**：
  构建期用真 makeinfo 预渲染 + 去掉 `-*- texinfo -*-` 标记，`help sin`/`help sqrt`/
  `help disp` 全部可用（见 §5.6）。**仍存在的部分**：`help ode45` 这类 `.m` 文件的
  docstring 走运行时路径，仍会报 makeinfo 错误——这是剩余缺口，不是已解决项。
  （`doc-cache` 注入**已实测无效**，别再试。）
- ~~**图形句柄是"半死"状态**：`gca()` 报 `invalid handle`、`figure()` 返回假句柄~~
  → **T2 已修复**（`web` toolkit，资产车道零重链，见 §5.5.1）：
  `figure/gcf/gca/get/set/title/xlabel/ylabel/close/allchild/findall` 全部可用，
  `set(gca,'xlim',[0 5])` → `get` 得 `[0 5]`（实测）。
  **半真化的边界（实测，2026-09-22）**——这些不是 bug，是"只救句柄、不碰绘图"的直接后果：
  - `plot(1:5)` 后 `get(gca,'children')` = **0**（plot 桥的序列不在真对象里，
    渲染走桥出 SVG）；`h = plot(...)` 返回**空句柄**。
  - ~~**`plot(hax, ...)` 这类"首参是句柄"的调用形态桥不支持**~~ → **2026-09-24 已支持（R4，见 §5.30）**：
    `plot/hold/grid/axis` 都接受"首参 = **当前** axes"的形态（是别的 axes 就明确报错）。
    `title/xlabel/ylabel/xlim/ylim` 是 2026-09-23（批次 B）就已支持的。**这就是 `voronoi` 单输出失败的真因，现已修好。**
  - `getframe()` 报 `failed to capture frame data, potentially due to insufficient
    graphics capabilities`（toolkit 的 `get_pixels` 返回空）。
  ⚠️ **2026-09-23 起这几条的适用条件变了**：站点的**默认 toolkit 已是 `webgl`（真渲染器）**
  ⇒ **镜像层默认开着**：`plot(1:5)` 会**同时**建出真 line 对象（`get(gca,'children')` 不再是 0、
  `h = plot(...)` 拿到真句柄）、`getframe()` 返回真像素。上面那三条只在**显式切到 `web`**
  （`graphics_toolkit("web")`）时成立 —— `accept-t2-graphics` 就是显式切过去验老语义的。
- **（新，2026-09-23）桥的参数宽容度**：桥比核心宽容的写法（如 `plot(x,x,'+','')`）以前收下，
  现在默认有真渲染器 ⇒ 会走到核心实现 ⇒ **按核心（=桌面）的严格性报错**。这是向桌面看齐，
  但"凡桥比核心松的写法都要重新核"（§8 待办 8）。
- **（新，2026-09-23）`audioplayer`/`audiorecorder` 每个对象占一个 slot + 一个 MEMFS 文件**：
  生命周期与对象一致，本构建**没有可靠的"对象死了"信号** —— `@audioplayer` 的 classdef
  里**没有 `delete.m`**（`ls m/audio/@audioplayer/` 只有 get/set/play/pause/… 12 个文件），
  没有析构钩子可挂；而 `stop` 之后**还能再 `play(p)` 重播**（数据属于对象），所以在 stop 时
  删 `/tmp/pba_<id>.f64` 会弄坏重播。⇒ 如实记录，不做"看起来干净"的清理。
  （审计候选 5 原本的建议是"stop 时 unlink"，落地时按上面两条实测改成记录偏差。）
- **（新，2026-09-23）`bridge/webnet.js` 现在**被 `index.html` 加载**了**：此前它一直被部署、
  却没被页面加载（而 `accept-net` 的注释以为站点会加载 ⇒ 只有那个自己注入脚本的测试里它才
  存在）。`OctaveNet.prefetch/get` 目前唯一调用者就是那条测试；同步的 `urlread` 那族**不依赖
  它**（入口自包含在 `webnet.cc` 的内联 JS 里）。
- **（新，2026-09-23）没有 WebGL2 的设备也能看见图**（此前是**静默空白**）：浏览器拿不到
  GL 上下文时（旧设备、GPU 被 blocklist、`--disable-webgl`），toolkit 落一个信号
  `/tmp/p5_nogl.txt` ⇒ 桥把自己渲的 **SVG** 交给页面显示（`accept-p5-fallback` 15 项钉住）。
  代价如实记：那条路**没有抗锯齿/硬件加速**，且页面每 250 ms 采样一次（见 §5.22）。
- **（新，2026-09-23）`xlim()`/`ylim()`/`axis()`/`clf()`/`legend()`/`title()` 等接受输出参数**：
  以前桥这些 shim 声明 0 个输出、被当有返回值调就报 `too many outputs`；为让"核心调用期间的
  转发"进得来，它们现在声明的输出个数与核心对齐，**桥自己的路径返回空**（不是"假的限值"）。
- **文字渲染：产物里还没有**（批次 D 半途，见 §5.26）。容器里的树**已经开着 FreeType**
  （`config.h` 的 `HAVE_FREETYPE 1` + `HAVE_FT_REFERENCE_FACE 1`）、字体预载已接进 `link-web.sh`，
  **只剩最后一次链接**；链接出来并上线后这条会消除。当前（M1 产物）的现象仍是：每次会话一条警告
  `opengl_renderer::render_text: support for rendering text (FreeType) was unavailable
  or disabled when Octave was built`（`text-renderer.cc:53` 的 `static bool warned`，
  只在首次建 axes 时打一次），之后文本能力静默缺失；数值与 plot 桥不受影响。
  ~~**上线后的两条代价**：无 fontconfig ⇒ `fontname` 存得住但渲染时被忽略、`listfonts()` 报
  `structure has no member 'family'`。~~ → **2026-09-24 两条都已修（R3，见 §5.31）**：fontconfig 上线后
  `fontname`/`fontweight`/`fontangle` **真的改像素**（探针 `probe-fontname.mjs` 13 项钉住），
  `listfonts()` 返回 `FreeSans`、`__get_system_fonts__()` 有 family/angle/weight/suitable（n=4）。
  **仍如实记的边界**：本构建**只有 4 个 FreeSans 面**，所以 `fontname` 填别的家族名（如 `"Courier"`）
  会**落回** FreeSans——这是"没有系统字体目录"的必然，不是 bug（探针里有一条交底断言钉住）。
- **（新，2026-09-23）`urlread` 的 POST 形态只能"如实回报"**：本地预览服务器是
  `python3 -m http.server`，**不支持 POST**（返回 501）⇒ `urlread(url,"post",…)` 返回 `ok=0`。
  交付的静态托管同样如此。`accept-net` 那条断言已按实测改写（原来 `want='1'` 是靠错误消息里
  `501` 的 `1` 假过的，批次 A 的数字边界把它扫出来，见 §5.23）。POST 请求本身照发、状态如实回报。
- **（新，2026-09-23）桥对"核心合法但桥做不到"的形态一律明确报错**（批次 B，见 §5.24）：
  `xlim/ylim/title/xlabel/ylabel` 支持句柄优先（**只接受 `gca()`**，别的句柄报
  `only tracks the current axes`）；`bar/barh` 的宽度参数、`surf/mesh` 的颜色矩阵、
  `legend` 的句柄形态都**明确报错**（以前分别是"当 X 数据画错""静默丢掉""当标签"）。
  另：桥仍**有意保留**的降级（饼图的 EXPLODE/LABELS、`scatter3` 的 SIZE/COLOR、`print` 的
  `-r/-color` 选项、`plot3(X,Y)` 抬 z）都已写进各自文件头并用断言钉住。
- ~~**`doc`** 报 `unable to find the Octave info manual`（无 shell 起不了 info 浏览器）~~
  → **T6 已修**（`build/webdoc/doc.m`，资产车道，见 §5.10）。
  → **`.m` 文件的 docstring 也已修（P1，2026-09-22）**：构建期预渲染 + 去标记，
  1043/1043 渲染成功、离线对照 **25/25 与桌面 `help` 逐字一致**，见 **§5.14**。
  **⇒ `help` 这条偏差已彻底消除**（内建走 `built-in-docstrings`、`.m` 走预渲染）。
- **`audiorecorder` 的 `recordblocking` 不可用**（T7）：语义是"等页面把录音做完"，
  而**实测 `pause()` 期间浏览器事件循环完全停摆**（区间内 tick = 0）⇒ 必须 Asyncify。
  本构建**如实报错**并给出替代用法（`record(r,len)` + `getaudiodata`），不静默降级。
  **`record`/`stop`/`getaudiodata` 正常**（`accept-t7-recorder` 40/40）。
- **`pause()` 会完全阻塞页面**（行为事实，不是缺陷）：这条同时决定了
  `recordblocking` 与 `uigetfile`（T8）都必须走 Asyncify；
  反过来也解释了 `input()` 为什么能用 —— `window.prompt` 是**同步**的浏览器 API。
  写验收时**等待要在 JS 侧做**（`setTimeout`），不能用 Octave 的 `pause`。
- ~~**control 包的 SLICOT 编译件未发布**~~ → **2026-09-23 已修好并发布**（§5.15）：
  `ss`/`step`/`pole`/`zero`/`norm`/`lyap`/`dlyap`/`care`/`tf2ss`/`c2d` 全部可用且数值正确
  （`step` 与 `1-e^-t` 误差 1.1e-16）。`accept-slicot.mjs` 25/25。
  **两个卡点的根因**（都在 `build/113/NOTES-slicot.md`）：精简 libf2c 去掉 I/O 子系统
  （表条目 13→1）+ 给 `f__r_mode`/`f__w_mode` 一个数据垫片。
- ~~**`voronoi` 的**单输出形式**报 `X and Y sizes do not match`**~~ → **2026-09-24 已修（R4，见 §5.30）**：
  根因确实是 plot 桥不支持 `plot(hax, …)`（首参句柄被当数据）——现在桥支持"当前 axes 的句柄优先形态"
  （`voronoi` 内部就是 `plot(hax, …)`，`hax = gca()`），**单输出可用**、两输出照旧。
  桥的判据同时**逐条对齐了核心**（`__plt_get_axis_arg__.m` 的 `scalar && ishghandle && != 0 && !isfigure`），
  所以 `plot(0)`/`plot(5)` 仍是"画数据"，`plot(别的 axes, …)` 才明确报错。
  **★ 2026-09-24 更正一句（当场量的，别照抄旧话）**：`parent` 属性对形态
  （`plot(x,y,"parent",hax)`）**不是"不复制"** —— 真渲染器那条路是**核心在画**（镜像把原样
  varargin 交给核心），实测 `drawnow` 之后图**正常出**、`getframe` 有墨（ink=12306）。
  **真正的问题在桥自己的状态**：它对这一形态**静默多记了一条序列**
  （同一条线：普通形态 `numel(__pstate__().series)` = **1**，`parent` 形态 = **2**）⇒
  在**没有 GL 的设备上**（SVG 回落是**按桥状态**渲的）会多画一条不存在的线。
  这是"静默曲解"那一类（批次 B 的靶子），**尚未修**；修法很小：在 `plot.m` 里认出
  `"parent"` 属性对（值是 `gca()` 就剥掉、别的句柄就明确报错）。
- nan / tsa 的 MEX 源、miscellaneous 的 `sample.cc`/`text_waitbar.cc` 未编入。
- **句柄/对话框一族：大部分已能用**（2026-09-24 实测更正 —— 以前整条记成"未做，归图形分支"）。
  真渲染器（`webgl`）上线后，`accept-p5-graphics` 那套断言之外我又逐条实测了一遍
  （`test/browser/probe-core-names.mjs`，19 项，8761 全绿）：
  ✅ `hgsave`（写出 `.hgs`）、`copyobj`、`uicontrol`/`uimenu`（**建出对象、属性可读写**，
  但**我们的 toolkit 不画控件** ⇒ 没有"看得见的按钮"）、`gcbo`、`waitfor`、`inputname`、
  `menu`（回落成控制台菜单并真的提示，走 `input()`/`window.prompt`）、
  `movie`（**要 ≥2 帧**；内部用 `pause`，而 `pause` 会阻塞页面 ⇒ 动画观感未细验）。
  ❌ 仍不可用/仍缺：`questdlg`（上游口径 `not available in this version of Octave`）、
  `uisetfont`（未测）。（`voronoi` **单输出** 2026-09-24 已修 —— R4 之后桥支持 `plot(hax,…)`，见 §5.30。）

---
- **（新，2026-09-24）首帧冷启动拆开量过：不做预热**（§5.28）：第一次 `clf` **375 ms** +
  第一次 `plot` 73 ms + 第一次 `drawnow` **177 ms**；之后每张图 **24–58 ms**。
  预热两条路的算术都不划算（开页预热把总额从 ~1678 ms 拉到 ~1736 ms；ready 之后预热独占主线程
  ~177 ms）⇒ **这是有意不做**，不是留着没做。

## 8. 一句话接续
**当前基线 8761 = Octave 11.3.0**（2026-09-22 换的基线，原 7.2）。
**`-O2`** 编译（11.3.0 车道的口径；`-O1` 是 7.2 时代的 R10 结论，见 `build/BENCH.md`），
**dldfcn 走官方 dlopen 装载**。全量**见文末 `AUTO:STATE` 区块**（2026-09-23 收口 + 审计两批后实测；
构成见 §5.21 与 `dist/DEPLOY.md` 的表），含需求级 `accept-requirements` 与图形线
`accept-p5-graphics`（**64 项**，8761 上真跑）。
交付包与包内 wasm 的 sha **见文末 `AUTO:STATE` 区块**（那里还自动核对"包内 wasm 与部署件同 sha"
这条硬证据）；重打命令 `sh build/make-dist.sh`。

**7.2 的回退快照**：`/mnt/hdd/octave-wasm-build/site-72bak/`（90M）。
回退：`cp -a site-72bak/. site/`（**注意** `build/recover.sh` 已是 11.3.0 口径，
回退后要用它得先把取值源改回 `obench`，见 git 历史）。

**R1–R10 全部落地**；第三轮 **T1–T7 全部完成**（T1 `help` §5.6；T2 图形句柄 §5.5.1；
T3 文件操作 §5.7；T4 pkg §5.8；T5 `input()` §5.9；**T6 音频设备/文档/输出落点** 与
**T7 录音** §5.10；**T10 Asyncify 实验=不可采用** §5.11）。
**第四轮（11.3.0 换基线）已完成，见 §10**；§9 保留为当时的计划与决策记录。

### ⬜ 仍待办（按建议顺序）

> **▶ 当前状态**：**两个站点的产物逐字节相同**（M2 + FreeType + 新桥 + `webshims`）——
> 以 `sha256sum octave.wasm` 实测为准，别背旧话。回退点：`site-m1bridge-bak-20260924/`
> （M1+新桥那份）、`siteWebGL-m1bak-20260923/`（更早）。
> **部署件 sha、体积、最近一次全绿回归见文末 `AUTO:STATE` 区块**（别在这里手写）。
> **本轮（第五批，2026-09-24）**：外部审核的方案 R1（popen/system 覆写）+ R4（`plot(hax,…)`）
> 已落地并全量验绿（§5.30）；**R3（fontconfig）也已上线并验绿（§5.31）**；⇒ **只剩 R5（JSPI 探针）**。
>
> **▶ 改胶水层时的三个快回环**（别一上来就跑 29MB 端到端）：
> · `sh build/glue-selftest.sh` —— 宿主秒级，跑胶水层文件自带的 `%!test`（现在 **69 项**：
>   5 个桥参数纯 helper —— 句柄判定 / 剥首参 / bar 拆分 / 图例拆分 / surf 拆分 —— 含 R4 给
>   `__pb_axes_arg__`/`__pb_strip_axes__` 补的「0 与 figure 都不是目标 axes」那几条）；
> · `python3 .githooks/check-consistency.py` —— 路径/挂载点/启动清单一致性；
> · `python3 .githooks/check-wants.py` —— 断言可证伪性（已接进 pre-commit）。
> 浏览器侧对应 `accept-selftest.mjs`（30 项）、`accept-queue-drift.mjs`（12 项）、
> `accept-shellerr.mjs`（14 项，R1）、`probe-want-matcher.mjs`（13 项：匹配器本身的红-绿对照）。

1. **（R1/R4/R3 做完；R5 只剩"接到产品上"那一步）**：
   · ✅ **R5 的机制探针已通过**（§5.32）：`-fwasm-exceptions` + `-sJSPI` + `MAIN_MODULE=2` +
     `SIDE_MODULE`/dlopen 四件一起成立（`build/113/NOTES-jspi.md` 有配方与三条实现要求）。
     **下一步（独立一批，未做）**：把真的 `.oct` 与 `pause`/`kbhit`/`keyboard`/`recordblocking`
     接上去 —— 要动 Octave 本体 + 页面调用形态（入口必须 `WebAssembly.promising`）+ 全量回归。
   · ✅ **R3 fontconfig**（§5.31）：静态 `libfontconfig`+`libexpat` + 显式 MEMFS 配置（`/fonts.conf` +
     `<dir>` 指向已预载的 `octfontsdir` + `<cachedir>` 到可写目录）；`fontname` 现在真改像素、
     `listfonts`/`__get_system_fonts__` 可用（R2 消失）。**没有**做 fake `listfonts`。
   · 外部审核给 R5 的**警告仍然有效**（照抄在这里，免得下一轮忘）：
     *"JSPI 已经在生产浏览器里了" ≠ "JSPI + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen 这个组合被验证过"*
     —— 所以机制探针必须先过（已过，见上），**而"接到 `pause` 上"仍要自己重新验一遍**，
     不许拿"探针通过"当"产品功能已完成"。
2. **（阻塞在人）`gh auth login` 之后 `git push origin main`**：token 失效
   （`gh auth setup-git` 救不回来），本地领先 `origin/main` 若干笔；内容**没丢** ——
   已落持久盘镜像 `mirror` 的 `refs/heads/main-20260924`（§5.17.1）。
3. **手机真机速度**：模拟器验不了 WebGL（§5.19）⇒ 要真设备。桌面 + CPU 降频 + 分辨率标定的
   结论见 `NOTES-webgl.md` §4.5（渲染器本身快 3.4–8.9×，端到端被桥与冷启动盖住）。
4. **`print` 的核心矢量路径**不可达（**不是待办**）：缺 shell 管道（有意）+ gs。
   **plot 桥自己那份 SVG 是唯一矢量实现**；无 GL 设备的显示回落（§5.22）也建立在它之上 —— 别当冗余砍。
5. **无 GL 回落的边界**（**不是待办**）：没有抗锯齿/硬件加速；页面 250 ms 采样一次，
   最后一张图最多晚 250 ms 出现。见 `NOTES-webgl.md` §4.7。
（非图形：已全部清零 —— 下面三条都是**已做完**的存档，不是待办）
1. ✅ **G1 `MAIN_MODULE=2`**（§5.25 做成、2026-09-24 上线）：保活清单生成器
   `build/113/gen-keep-list.sh`（`wasm-dis` 读 IMPORT 段）+ **链接期保活闸门**
   `build/113/check-oct-imports.py`（与基线差分：只在"基线导得出、新构建导不出"时报失败）+
   `link-web.sh` 的 `MAIN_MODULE_LEVEL=1|2` / `KEEP_LIST=` / `OCT_SCAN_DIRS=` 口子。
   **两道墙都拆了**：① 自动加载 dylib —— 走自己生成保活集那条路，不把 `.oct` 放主链命令行；
   ② JS 库符号 —— 用 `LIB_FUNCS`（`DEFAULT_LIBRARY_FUNCS_TO_INCLUDE`）把
   `emscripten_run_script`/`__assert_fail`/`abort`/`exit` 暴露给 side module，**实测可用**
   （accept-net / accept-image / accept-slicot / accept-forge2 在 M2 站点上全绿）。
   ⇒ **不需要**把 R5 改写成队列桥，也**不需要** `oct_js_run` 包装。
2. ~~**`help` 覆盖 `.m` 文件的 docstring**~~ → ✅ **已完成（2026-09-22）**：构建期预渲染
   （`build/prerender-m-docstrings.py` + 官方 `__makeinfo__` 驱动 + `link-web.sh` 的
   `M_SRC`），1043/1043 渲染成功、离线对照 **25/25 与桌面逐字一致**、
   `accept-t9-helpm` 18/18。**`doc-cache` 注入仍然别再试**（那是另一条路，已实测无效）。
3. ~~**长尾**：control 的 SLICOT 编译件~~ → ✅ **已修好并上线（§5.15）**。

**覆盖率已经收口**（见 §5.12）：桌面 11.3.0 的可调用名字 **926/926** 都可用，
唯一不在的是 Debian 打包产物 `debian_missing_handler`（不属 Octave）。

**顺带修掉一个"数据里带无用副本"的构建 bug**（2026-09-22）：`--preload-file` 按第一个
`@` 切 `src@dst`，而 `m/@ftp` 的**源路径自带 `@`** ⇒ **整棵 m/ 树被复制到
`/ftp@/usr/src/octave/m/@ftp/`**（实测文件表 2181 条里 1087 条是重复，5.25MB / 44%），
且 `@ftp` 自己的文件不在正确路径上。修法与收益见 §5.13。

（历史：图形线最早叫 P5 OSMesa，在 `graphics-osmesa` 分支上做；那条线**已退役**，全过程留档在 `build/113/NOTES-p5-osmesa.md`。现在的图形线只有 `webgl`，见 §5.21。）

**起手体检**：`harness/run.sh test/browser/accept-requirements.mjs` —— 一屏看全十条需求。
**改 `.m` 前先跑** `python3 build/check_m.py <目录>`（宿主秒级语法预检，见 §5.6）。
只在 `/mnt/hdd/zcode-projects/Octave-Full-Wasm` 及 `obuild`/`odld`/`obench`/`o113` 容器内工作。

**恢复流程（断电/新会话第一条命令）**：
```bash
sudo docker start obuild odld obench o113 && sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/recover.sh
```
它会起容器、体检 o113 工具链、必要时按 **11.3.0** 口径重组站点、起 8761、跑验收
（需求级 + 核心回归）。11.3.0 车道的独立恢复是 `build/recover-113.sh`（起 8762）。

最近的镜像检查点（11.3.0 车道）：**`octave-build:113-coverage-100`** / `113-nongfx-t6t7`（`o113`）。
更早的 7.2 检查点：**`octave-build:b13-official-dldfcn`**（`obench`，**O1 基线 + 官方装载**，
当前主力）；`octave-build:b12-forge2`（`odld`，O0）；更早的 `b9-net`…`b5-image` 是回退点。

**架构要点（别再走弯路）**：
- 主链是 `-s MAIN_MODULE=1` + 全树 `-fPIC` + **`-O1`** → **新能力一律做成 `.oct`/`.m`
  资产懒加载**，不必重链那 45MB 主 wasm（批次 3/4/5/6/8/9/12/13 都是这么零改动落地的）。
- **dldfcn 也走这条路**（批次 13）：`.oct` + manifest 的 `aliases`，不再是静态注册。
- 任何"重编 Octave 本体或静态库"的操作必须走 `build/reconf-pic.sh` +
  `build/rebuild-pic-libs.sh`；**换 O 级**走 `build/reconf-bench.sh <0|1|2>`（在一次性容器里做，
  别污染基线）。非 PIC 对象会让主链链接失败。
- 新增资产流程：写源码 → 编 `.oct`（`build/build_oct.sh` 或 `build_pkg_oct.sh`）→
  进站点 `assets/` → `build/assets.py gen-manifest` → 写验收脚本进 `test/browser/`。
  多函数模块记得在 meta 里声明 `aliases`（§4.11）。

---

## 附 · 机器维护的状态区块（**自动生成，别手改**）

<!-- AUTO:STATE -->
> 本区块由 `.githooks/update-handoff.py` 重算，**不要手改**（pre-commit 会刷新并 `git add`；pre-push 会 `--check`）。

| 项 | 值 |
|---|---|
| `octave.wasm` | 29,463,242 B raw / 7,016,523 B gz | sha256 `4faaa96d583ed978…` |
| `octave.js` | 454,042 B raw / 87,229 B gz | sha256 `35401e7acff28505…` |
| `octave.data` | 8,674,824 B raw / 2,515,502 B gz | sha256 `c2be24347381cb13…` |
| 三大件 gzip 合计 | **9,619,254 B** | |
| 资产条目 | 48 | |
| 最近一次**全绿**回归 | `20260924-064307` · **36 套 / 952 PASS / 0 FAIL** | http://127.0.0.1:8761/ |
| 交付包 | `octave-full-wasm-site-20260924` · tar.zst 25,905,182 B · `d73c58dd08f27565…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `main` · HEAD 提交日期 2026-09-24 （**HEAD 的 sha 以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->

