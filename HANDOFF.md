# HANDOFF · Octave-Full-Wasm（给 AI 的接续说明）

> 本文唯一目的：**抗上下文压缩**。新会话只读这一份就能接着干。
> 最后更新：**2026-09-23（图形线收口：桥句柄缓存 → `webgl` 变默认 → OSMesa 后端退役）**：
> · **非图形已清零**：SLICOT 修好并上线（见 §5.15）。**8761 的实际套件数/项数见文末 `AUTO:STATE` 区块**（由脚本从最近一次全绿回归里读，别在这里手写）。
> · **图形线只剩一条后端**：**`webgl`（gl4es → GLES2 → WebGL2/GPU）**。2026-09-23 用户拍板的
>   "A" 一次做完：**默认 toolkit = webgl**（开箱 `plot(...); drawnow` 就出真图）、加 `FULL_ES3`、
>   **OSMesa 后端退役**（7 个仓内文件删除、脚本分支删掉、脚本与配方留在 git 历史）。
>   见 **§5.21**。
> · **plot 桥的镜像层改成"一次性句柄缓存 + 深度转发"**（§5.21）：**一次镜像 146 → 1.5 ms（~97×）**，
>   一张图的**温开销 395 → 94 ms（4.2×）**。顺带**更正**了 §5.20 那条归因（"剩下的 480 ms 是
>   两次 `path` 手术"是**错的**：真凶是**冷启动**，见 NOTES-webgl.md §4.5.13）。
> · 验收：`accept-p5-graphics` 由 54 增到 64 项（新增 10 条：pie/contour/legend 的嵌套转发、
>   DEPTH 复位、默认 toolkit）。**全量套件数/项数见文末 `AUTO:STATE` 区块。**
> 8761 当前 = Octave 11.3.0**（带 GL）**，wasm sha `6c75a4942df286826f8f02c1…`、
> 默认 toolkit = `webgl`、全量 **32 套 848 项全绿**（见 §5.21 的"上线"小节）；
> 本批**之前** 8761 是 `bac48adb…`（不带 GL），那份站点留档在 `site-prewebgl-bak/`。
> **接续先读 §8（一句话接续 + 仍待办）与 §5.13–§5.21（近几轮实况）；§9 是当时的计划、§10 是第四轮实况。**
> ⚠️ 四条必须在动手前知道的：
> ① **构建主树现在是 opengl-ON + gl2ps-ON，且 GL 头已换成 gl4es+GLU 的**（见 §5.16 末尾"怎么切回去"
>    与 §5.21 / `build/113/gl-headers-webgl.sh`）；
> ② 推送：`github.com` 2026-09-23 晚已恢复，`main` 已推到 `origin/main`；**若又被拦**，改走 GitHub API + 持久盘镜像（见 §5.17，含对齐命令）；
> ③ **容器里的构建脚本是另一份拷贝** —— 改完仓库的 `configure-113-full.sh`/`link-web.sh`
>    必须 `docker cp` 进容器，否则跑的是旧的（§5.20 末为此白跑两个大重建）；
> ④ `print` 的矢量输出依赖 **gl2ps + shell 管道 + (gs|svgconvert)**，本构建**没有 shell 是
>    有意的** ⇒ **plot 桥自己那份 SVG 是唯一能出矢量的实现**，别把它当冗余砍掉（§5.20）。
>
> **文档约定（`.githooks/check-handoff.py` 按此执行，别违反）**
> · **§5.x / §9 / §10 是历史记录（append-only）**：里面的数字与判断是"当时如此"，不必与今天一致。
> · **头部 + §0–§4 / §6–§8 是活状态**：那里的断言必须与产物一致，否则 pre-commit 直接拦。
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

## 5. 计划与进度

**底线**：8761 永远是最近一次通过验收的构建（任何新批失败不许让它退化）。
**失败策略**：每批重试 ≤2 次；仍失败 → 回滚镜像、记 `CLIBS.md`、转下一批。

### ✅ 已完成（本轮 2026-09-20 无人值守，全部已浏览器实测 + 已推送）

| 批次 | 内容 | 验收 | 关键结论（别重做） |
|---|---|---|---|
| 1 | HDF5 1.14.2 → `save/load -hdf5`；CXSparse 假失败修复 | 回归 19/19 + 专项 16/16 | HDF5 是**唯一**需要重链主 wasm 的批（wasm +7.1MB）；CXSparse 只需 `CPPFLAGS` 一行（§4.6） |
| 2A | Forge 10 包纯 `.m` 懒加载（1482 个 `.m`） | 21/21 | 版本必须按 Octave 过滤（1.7.7 要 ≥8.1 用不了，选中 1.7.3）；PKG_ADD 机制见 §4.10 |
| 2B | Forge 编译件 19 个 `.oct` | 15/15 | 工具 `build/build_pkg_oct.sh`；**优先读包自带 src/Makefile 的每目标分组**，否则 duplicate symbol |
| 3 | SUNDIALS 6.1.1 → `ode15s`/`ode15i` | 14/14 | **主 wasm 零改动**（SUNDIALS 静态码全在 .oct 内）；不开 configure 也能编，`-D` 开宏即可 |
| 4 | 压缩/归档无 shell 化（6 个函数） | 20/20 | zip 走 zlib raw deflate + 自实现中央目录；tar 自实现 ustar；§4.11 的别名坑 |
| 5 | stb_image → `imread`/`imwrite`/`imfinfo` | 17/17 | 走 `imformats("add")` 注册，`imread.m` 零改动；§4.10 的双重注册坑 |
| 6–13 | **见 §2.1 批次表**（R9 print、plot v2 2D/3D、R8 音频、R5 网络、R10 基准、signal/control、官方 dldfcn） | 见各批 | 每批都有"别重做"的结论记在 `CLIBS.md` 对应小节 |

**资产全部在站点 `assets/` 下按需懒加载**——新增能力一律做成 `.oct`/`.m` 资产
（`build/build_oct.sh` / `build/build_pkg_oct.sh` / `build/assets.py`），
只有动了 Octave 本体或必须静态进主链才走 Lane B（`build/reconf-pic.sh` + `reconf-bench.sh`）。

### ✅ R1–R10 全部落地

| 需求 | 结果 | 关键结论（别重做） |
|---|---|---|
| R1 SUNDIALS | `ode15s`/`ode15i` 可用 | SUNDIALS 静态码全在 `.oct` 内，主 wasm 零改动 |
| R2 Forge 包 | statistics/optim/signal/control + 6 个包可用 | 版本必须按 Octave 过滤；编译件优先读包自带 `src/Makefile` 分组 |
| R3 HDF5 | `save/load -hdf5` | 唯一需要重链主 wasm 的批；CXSparse 的 "too old" 是 `CPPFLAGS` 假失败 |
| R4 图像 | `imread`/`imwrite`/`imfinfo` | stb_image + `imformats("add")` 注册，`imread.m` 零改动 |
| R5 网络 | **真同步** `urlread` 系列 | **不需要 Asyncify**：同步 XHR 可用（见 §4.13）；`EM_ASM` 在 side module 里不可用 |
| R6 压缩归档 | 6 个函数进程内实现 | 无 shell 化；`.oct` 按文件名查找要建别名 |
| R7 CXSparse | 已开 | **SPQR 不是缺口**：`spqr` 函数在 Octave 3.6.0 就被 `qr` 取代（GPT 审核指出，已核对官方 obsolete 表）；稀疏 `qr` 走 CXSparse 后端，已实测可用 |
| R8 WebAudio | `audioplayer` 全 18 个符号可用 | **纯 `.m` 就够**（句柄=struct，零编译）；不用 AudioWorklet |
| R9 图形导出 | `print -dsvg`（2D+3D 都能出） | 纯 `.m` SVG 生成器；gnuplot 路线要 Asyncify 才有同步通道，故不采用 |
| R10 编译级别 | 7.2 时代**采纳 `-O1`**；**11.3.0 车道用 `-O2`** | 解释器密集代码快 5–10×；wasm64 不碰 |

### ⬜ 第三轮（**进行中**，GPT 审核已就位）

**来源**：`build/GAPS-2.md`（缺口清单 v2，逐条实测）→ `build/GPT-REVIEW-2.md`
（外部审核，含纠错与路线建议）→ 下面是消化后的可执行计划。

**T1 已完成（见 §5.6）**：`help` 走**构建期 makeinfo 预渲染**，零覆写、零运行时代码。

**GPT 的两处纠错（已核对，采纳）**：
- **`spqr` 不是缺口**：该函数 Octave 3.6.0 就被 `qr` 取代（官方 obsolete 表）；
  稀疏 `qr` 走 CXSparse 后端且已实测可用。**永久删除 F1**。
- **`record()` 本来就不阻塞**：只有 `recordblocking()` 才需要等待 →
  B1 难度比原估低。

**GPT 的核心架构建议（最重要的一条，采纳）**：
> **A1 不要复活真 gnuplot 后端**（那必然撞 `system()`/pipe/同步输出），
> 而是写一个**薄 toolkit**（`web_graphics_toolkit`），只提供 graphics object
> 生命周期与属性系统；**渲染继续走已验证的 plot 桥**。
>
> ```
> graphics.cc → 真 figure/axes/line 对象 → get/set/gca/gcf → Web toolkit
>                                                        ↓
>                                              现有 plot 桥 → gnuplot-wasm/SVG
> ```
> 官方 gnuplot toolkit 的 `redraw_figure()` 本就只是调 `__gnuplot_drawnow__`，
> 说明 toolkit 层很薄 —— 我们把它换成自己的桥即可。

**执行顺序（GPT 排定，逐批做，每批 staging 验证 → 上线 8761 → 提交推送）**：

| # | 批次 | 内容 | 工作量估计 | 车道 |
|---|---|---|---|---|
| ~~1~~ | ~~**T1**~~ | ✅ **已完成**：`help` 走**构建期 makeinfo 预渲染**（不是覆写渲染器）。见 §5.6 | — | 资产（零重链） |
| ~~2~~ | ~~**T2**~~ | ✅ **已完成（2026-09-22）**：`web` graphics toolkit 挂上，`figure/gcf/gca/get/set/title/allchild/close` 全部可用。**实际走的是资产车道、主 wasm 零改动**（计划记的 Lane B 不需要 —— `available_graphics_toolkits()` 是**运行时注册表**，且有内建 `register_graphics_toolkit()` 可登记）。见 §5.5 之后的 T2 小节与 `build/113/NOTES-t2-graphics.md` | — | **资产（零重链）** |
| ~~3~~ | ~~**T3**~~ | ✅ **已完成**：`copyfile`/`movefile`/`ls` 进程内实现（`build/webfile/`，纯 `.m`）。见 §5.7 | — | 资产 |
| ~~4~~ | ~~**T4**~~ | ✅ **已完成**：还原被 fork 删掉的 `installed_packages.m` + 生成 pkg 数据库（`build/pkgfix/`）。见 §5.8 | — | 资产 |
| ~~5~~ | ~~**T5**~~ | ✅ **已完成**：`input()` **本来就能用**（Emscripten 默认 stdin → `/dev/tty` → `window.prompt`），只加了官方扩展点 `Module.stdin` 让验收可确定性断言。见 §5.9 | — | 无需代码 |
| ~~6~~ | ~~**T6**~~ | ✅ **已完成（2026-09-22）**：`audiodevinfo` 最小 shim + `doc` 的浏览器实现 + **输出落点**（计划外，见下）。`accept-t6-audio-doc` **33/33**。见 **§5.10** 与 `build/113/NOTES-t6-t7-hostlayer.md` | — | **资产（零重链）** |
| ~~7~~ | ~~**T7**~~ | ✅ **已完成（2026-09-22）**：19 个 `__recorder_*` 纯 `.m` + `getUserMedia`/`MediaRecorder` 桥；权限三态各自明确报错。`accept-t7-recorder` **40/40**。**`recordblocking` 如实报错**（实测需要 Asyncify，见 §5.10） | — | **资产+JS 桥（零重链）** |
| ~~8~~ | ~~**T8**~~ | ✅ **已完成（2026-09-22）**：`uigetfile` 可用（**两步**：第一次弹框并提示"选好后再跑一次"，第二次返回结果；取消返回 0；`MultiSelect` 返回 cell，选中文件字节被复制进当前目录）。走官方缝 `__fltk_uigetfile__`（**必须是 `.oct`** —— 中间层 `__uigetfile_fltk__.m` 的门禁是 `exist==3`）。`accept-t8-uigetfile` **19/19**。见 **§5.12** 与 `build/113/NOTES-coverage-100.md` | — | 资产 + JS 桥（零重链） |
| 9 | **T9** | **G1 `MAIN_MODULE=2` + 自动 keep 清单**：读每个 `.oct` 的 wasm import 表 → 生成保活集 → 跑全量回归验证（体积优化，Lane B） | 1–3 d | Lane B |
| ~~10~~ | ~~**T10**~~ | ✅ **已实验（2026-09-22）——结论：Asyncify 不可采用**。`-s ASYNCIFY=1` 链接**失败**：`emcc.py:438` 明确警告 `ASYNCIFY=1 is not compatible with -fwasm-exceptions`，随后 `wasm-opt --asyncify` 报 `__asyncify_get_call_index does not exist` 返回 1，产物未生成。**代价不是体积，而是整条 `.oct` 资产车道**（JS 式异常会让 side module 装载即崩，§10.3 坑 1）。完整记录见 `build/113/NOTES-asyncify.md` | — | 独立目录（部署未动） |

**明确暂缓（GPT 判断，采纳）**：`D2b publish`(2–4d)、`E2 keyboard/kbhit/pause`
（等 Asyncify）、`H3 getframe/movie`（等 graphics 成熟）、`H4`、`H1 voronoi 单输出`
（A1 的派生收益，不单独改）。

### 5.5.1 T2 已完成（2026-09-22）——图形句柄半真化（`web` toolkit）

**结论：T2 不需要重链主 wasm。** 原来记成 "Lane B"，是因为 `graphics_toolkit.m:86`
 有一道门禁 `if (! any (strcmp (available_graphics_toolkits (), name))) error ("%s toolkit
 is not available")` —— 看着像"清单在编译期写死"。读源码发现不是：

- `available_graphics_toolkits()` 返回的是**运行时注册表**（`gtk_manager::available_toolkits_list()`）；
- 而且有**内建** `register_graphics_toolkit("web")` 能把名字加进去
  （其文档明说"只是把字符串加进可能清单，不做校验"），`gtk_manager::register_toolkit`
  在默认库为空时**还会顺手设为默认库**；
- `load_toolkit()` 是头文件里的 inline，`register_toolkit` 符号由 `MAIN_MODULE=1` 导出；
  `base_graphics_toolkit` / `gtk_manager.h` / `interpreter.h` 都在**安装树**里。

⇒ 于是 T2 落成**资产**：`build/113/web_graphics_toolkit.cc` → `__init_web__.oct`（side module）
 + `build/webgraphics/PKG_ADD`（Octave 在 `addpath` 时自动执行：登记 + 装载）
 + `index.html` 启动装载清单里加 `webgraphics`
 + `build/plotbridge/figure.m` 补上"同时建真对象"（**它以前是假的**，只记图号）。

**契约要点**：`base_graphics_toolkit` 的默认实现都会 `gripe_if_tkit_invalid()`，而基类
`is_valid()` 默认 **false** —— 所以至少要 `is_valid→true`、`initialize→true`、
`redraw_figure` no-op。命名空间有坑：`graphics_object` 在 `octave::`，而 `Matrix`/
`uint8NDArray`/`graphics_handle`/`octave_value_list` 在**全局**。

**半真化的边界**：真对象存在、属性可读写往返（`set(gca,'xlim',[0 5])` → `get` 得 `[0 5]`），
`line()`/`title()` 也落到真对象上；但 **plot 画的序列仍在 plot 桥自己的状态里**
（渲染走桥出 SVG），所以 `get(gca,'children')` 不列 plot 的线、`xlim` 不自动跟随数据。
这是"只救活句柄语义、不碰绘图重构"的直接后果。

**验收**：`accept-t2-graphics` **26/26**（8761/8762 各一遍）。坑与诊断开关见
`build/113/NOTES-t2-graphics.md`（含"side module 里 fprintf(stderr) 打不出来"、
"浏览器缓存 .oct"、`get(ax,'title')` 返回句柄不是字符串、`figure(n)` 透传多余实参
导致退回纯编号 等 6 条）。

### 5.6 T1 已完成（2026-09-21）——`help` 可读

**结论：`help` 不需要自研渲染器。** makeinfo 是 Perl 程序、wasm 里跑不了，
但**它的输出是确定性的**，所以渲染挪到**构建期**用真 GNU makeinfo 做。
**这是 Octave 自己的做法**（`doc/interpreter/mk-doc-cache.pl:102` 就是构建期调
makeinfo 生成 doc-cache）。

**让 `help` 用上它：零覆写、零运行时代码。** 靠 Octave 自己的格式判定——
`help.cc:141` 的 `looks_like_texinfo()` **只检查第一行有没有 `-*- texinfo -*-`**；
去掉这行 → 格式判成 `plain text` → `help` 直接打印、不调 makeinfo。

- 工具：**`build/render-docstrings.py`**（构建期，宿主侧）
- 实测：**894/896** 条渲染成功；2 条失败的是 `methods`/`properties`（源码里本就是
  `@c #` 注释状态，桌面版也拿不到）
- 验收：**`test/browser/accept-help.mjs` 12/12 绿**，含"`which __makeinfo__` 必须指向
  核心文件"这条**官方性护栏**；全量 `accept-requirements` 仍 14/14
- 装载：`built-in-docstrings` + `doc-cache` 改为**随页面启动装载**（约 2.5MB），
  因为 `help` 属于"开箱就该能用"

**⚠️ 走过弯路，别再走**：先做过一版**自研 texinfo→纯文本渲染器**（覆写
`__makeinfo__.m`，7 个文件约 700 行），**已全部删除**。错在把"宿主组件不可用"
当成"要重新实现宿主组件"，而不是"把它挪到构建期"——官方 `mk-doc-cache.pl` 就在
仓库里示范了后一条。详见 `CLIBS.md` 批次 T1 节。

**剩余缺口（如实）**：只覆盖**内建**。`help ode45` 这类 `.m` 文件的 docstring 是
运行时从 `.m` 里读的，**不吃 `built-in-docstrings`**，仍会报 makeinfo 错误。
要覆盖得预渲染 1010 个 `.m` 的 docstring（侵入性大得多）。

**顺手留下的工具**：`build/check_m.py`（宿主 Octave 秒级 `.m` 语法预检，含括号平衡
与"多函数同文件"检查）。**注意**：宿主是 11.x、目标是 7.2，**通过不代表 7.2 通过；
失败几乎一定是真失败**——它是"过滤器"，验收仍以浏览器实测为准。

### 5.7 T3 已完成（2026-09-21）——文件操作进程内实现

**问题**：`copyfile`/`movefile`/`ls` 原版**全部以 shell 命令收尾**
（`system('cp -r …')` / `system('mv …')` / `system('ls -C -1 …')`），
本构建无 shell → 三个函数全废。

**做法**：`build/webfile/`（**10 个纯 `.m`，零编译**）同名覆写，
用 Octave 自己就能读写的文件系统（`fopen`/`dir`/`glob`/`mkdir`/`rename`/`rmdir`）实现。
**签名与返回约定照抄原版**（含 `[status,msg,msgid]`、status 与 `system()` 相反的
口径、多源报错文本），不另创 API。

**明确不同（如实）**：`ls` 的 `-l`/`-R` 等选项**不支持**——与其静默忽略选项返回
一个看着正常但不是用户要的东西，不如**清晰报错**；`ls` 无输出参数时一行一个名字
（非 shell 的多列布局）；不保留权限/时间戳（浏览器文件系统里没有可保留的）。

**验收**：**`accept-fileops.mjs` 20/20 绿**。每条断言同时验证 (a) 功能对（含
二进制 0..255 字节级一致、目录递归、`cp -r` 嵌套语义）与 (b) **没有走 shell**
（负向匹配）。(b) 是这个批次的全部意义，只测 (a) 不够。

**实测新坑**（4 条，详见 `CLIBS.md` 批次 T3）：`unlink` **不能删目录**（要用 `rmdir`）；
`"\"` 是未终止字符串（要写 `"\\"`）；Octave 没有 `<<` 运算符；`error` 跨行拼接要 `...`。

### 5.8 T4 已完成（2026-09-21）——pkg 语义

**两个根因，缺一不可**：

1. **fork 删掉了读数据库的代码。** `pkg list` 永远返回 "no packages installed"，
   根因是 fork 把 upstream `scripts/pkg/private/installed_packages.m` 里读
   `load(local_list).local_packages` 的 **16 行换成了 3 行空赋值**。
   旁证：`expand_rel_paths.m` 仍在 `module.mk` 里但**已无调用者**（唯一调用点就是被删那段）；
   镜像里的 octave-4.4.1 副本是同一改动的更早形态（用 `#` 注释）。
   **处置：把官方文件放回去**（`build/pkgrestore/installed_packages.m`，
   **与 upstream 逐字节相同**，脚本里硬 `assert` 校验）。
2. **数据库是空的**：Forge 包由资产加载器直接写 FS + `addpath`，**从不经过 `pkg install`**。
   补 `build/pkgfix/`（5 个纯 `.m`）从**磁盘现状**生成数据库。

**两个非显然的点（都踩过）**：
- **复用官方 `get_description`，不要自己解析 DESCRIPTION**。手写解析器建的 struct
  缺 `depends` → `pkg describe` 报 `structure has no member 'depends'`。
  但它是**私有函数**，而 Octave 私有函数按**调用者目录**解析 ——
  所以 `__pkgfix_sync_db__.m` 必须挂在 **`m/pkg/`** 下才能调到它。
- **`pkg install` 会造 `packinfo/` 子目录，资产包不会**。`describe.m` 找的是
  `<dir>/packinfo/INDEX`，而资产包把 INDEX 放**包根**（模拟的是 `inst/` 上提）。
  同步时按 `install.m:597-610` 的清单把 `packinfo/` 造出来。

**数据库路径（别猜）**：`pkg.m:420-422` 的原式
`fullfile(user_config_dir(),"octave",__octave_config_info__("api_version"),"octave_packages")`
→ 实测 `/home/web_user/.config/octave/api-v57/octave_packages`。
**文件名没有前导点**（`~/.octave_packages` 只是 `pkg` 文档里 `local_list` setter 的例句）。

**验收**：**`accept-pkg.mjs` 16/16 绿**（`pkg list` 列 5 个包带版本、`pkg load` 成功且
`list` 标 `*`、`pkg describe` 有内容、未装包清晰报错、`normpdf` 等包内函数不回归）。


**其它遗留（非 GPT 清单内，仍挂着）**：
- **control 的 SLICOT 编译件**：见 §4.12，需先做静态注册的小实验。
- **`help` 对 `.m` 文件仍不可用**（§5.6 的剩余缺口）：内建已修好（构建期预渲染），
  但 `help ode45` 走的是运行时从 `.m` 读 docstring 的路，不吃 `built-in-docstrings`。
  **别再试 `doc-cache` 注入**（已实测无效：错误只是从"文件缺失"变成"makeinfo 不可用"）。

### ❌ 已论证不做（别再试）
- **`spqr`**：该函数 Octave **3.6.0 就被 `qr` 取代**（官方 obsolete 表）。
  `exist("spqr")==0` **不是缺口** —— 稀疏 `qr` 走 CXSparse 后端且已实测可用。
  （`GAPS-2.md` 的 F1 已据此永久删除；外部审核的纠错。）
- **`ichol`**：报"遇到零主元"是**正常数学错误**，不是后端缺失。已从缺口清单删除。
- **真 gnuplot 后端**（`__init_gnuplot__` + `__gnuplot_drawnow__` 那套）：
  必然撞 `system()`/pipe/同步输出。**改走"薄 toolkit + 复用现有 plot 桥"**（见 §5.5 T2）。
- nan / tsa 的源是 **MEX**（`mexFunction`），需 mex 运行时；miscellaneous 的 `sample.cc`/`text_waitbar.cc` 未过。
- ImageMagick / PortAudio / Ghostscript / libarchive / OpenGL / Java / FLTK-Qt / `system`-`popen`
  （各有替代或有意保持"清晰报错"）。
- **第三轮明确暂缓**（审核判定）：`publish`、`keyboard`/`kbhit`/`pause`（等 Asyncify）、
  `getframe`/`movie`（等 graphics 成熟）。
- 托管/UI：**已明确后置**。用户倾向：解耦成两个静态端点（如 `/cli`、`/gui`）+ 共享 core 运行时；
  **不要 R2/Worker**（纯静态托管即可，服务端零计算）；Service Worker 可离线。
  GUI 用 JupyterLite + 自研 kernel 适配器（`jupyterlite/kernel` 接口，模板见 `jupyterlite/javascript-kernel`）；
  `xeus-octave` 是原生内核、未 wasm 化，仅参考。

---

## 6. 文件地图（仓库内）

| 路径 | 作用 |
|---|---|
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
| `.githooks/check-handoff.py` | **陈旧断言闸门**：活状态段落（头部 + §0–§4/§6–§8）与产物矛盾就拒提交；§5/§9/§10 是历史记录，不查 |
| `.githooks/check-consistency.py` | 挂载根/启动清单/车道路径的一致性检查（pre-commit + pre-push） |
| `.githooks/handoff-context.py` | ZCode `SessionStart` hook 的输出（把"先读 §8 + 当前状态"注入会话；`.zcode/config.json`） |
| `build/glue-selftest.m` `build/glue-selftest.sh` | **胶水层自带测试的统一驱动**（目标名单单一真源；宿主秒级 / 浏览器 `accept-selftest`） |
| `bridge/queue.js` | MEMFS 队列的**协议无关部分**（取 fs / 读走清空 / 切分），四个宿主桥共用 |
| `bridge/assets-loader.js` | **资产懒加载器**（manifest → fetch → 写 FS → addpath；支持 `aliases` 符号链接） |
| `bridge/index.html` | 站点入口（原版 + loader，只读清单不预加载） |
| `test/browser/accept-*.mjs` | **验收套件（进仓库，断电不丢）**：套数与项数见文末 `AUTO:STATE` 区块；**逐套清单与覆盖说明**见 `dist/DEPLOY.md` 的表 |
| `test/browser/accept-requirements.mjs` | **需求级验收（一屏看全 R1–R10）**——新会话起手体检用；按需求编号而非批次组织 |
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
- `system`/`unix`/`popen` 清晰报错（本就达标，且是**有意**保持）。
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
  - **`plot(hax, ...)` 这类"首参是句柄"的调用形态桥不支持**（`plot`/`hold`/`title`/
    `xlabel` 实测全报错）→ 这就是 `voronoi` 单输出版本失败的真因。
  - `getframe()` 报 `failed to capture frame data, potentially due to insufficient
    graphics capabilities`（toolkit 的 `get_pixels` 返回空）。
  ⚠️ **2026-09-23 起这几条的适用条件变了**：站点的**默认 toolkit 已是 `webgl`（真渲染器）**
  ⇒ **镜像层默认开着**：`plot(1:5)` 会**同时**建出真 line 对象（`get(gca,'children')` 不再是 0、
  `h = plot(...)` 拿到真句柄）、`getframe()` 返回真像素。上面那三条只在**显式切到 `web`**
  （`graphics_toolkit("web")`）时成立 —— `accept-t2-graphics` 就是显式切过去验老语义的。
  `plot(hax, ...)` 那条是**桥自身**的限制，两种 toolkit 下都还在。
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
- **FreeType 未构建**（`--without-freetype`）：效果是**每次会话一条**警告
  `opengl_renderer::render_text: support for rendering text (FreeType) was unavailable
  or disabled when Octave was built`（`text-renderer.cc:53` 的 `static bool warned`，
  所以只在首次建 axes 时打一次），之后文本能力静默缺失。数值与 plot 桥不受影响。
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
- `voronoi` 的**单输出形式**（要画图）：T2 之后**已能走到绘图**，但终点是 plot 桥的
  `plot(hax, x, y)` 调用形态不支持（见上面的边界条目）→ 报 `X and Y sizes do not match`。
  两输出形式正常。**根因在 plot 桥，不在句柄系统。**
- nan / tsa 的 MEX 源、miscellaneous 的 `sample.cc`/`text_waitbar.cc` 未编入。
- **句柄/对话框一族划归图形分支**（2026-09-22 用户拍板）：`hgsave`/`copyobj`/
  `uicontrol`/`uimenu`/`uisetfont`/`movie`/`gcbo`/`questdlg`/`menu` 以及 `inputname`
  （H4）**不在非图形轮次内** —— 它们要真图形对象才谈得上语义，归 `graphics-osmesa` 分支。
  现状（源码级，供分支参考）：`exist=2` 但依赖真对象；`menu.m` 会回落成
  **控制台菜单**（走 `input()`，T5 之后**可能已经能用** —— 分支开工时先验这一条）；
  `questdlg.m:136-139` 在 `__event_manager_have_dialogs__()` 为假时是**直接报错**
  "not available in this version of Octave"（上游行为，如实保持即可）。

---

## 8. 一句话接续
**当前基线 8761 = Octave 11.3.0**（2026-09-22 换的基线，原 7.2）。
**`-O2`** 编译（11.3.0 车道的口径；`-O1` 是 7.2 时代的 R10 结论，见 `build/BENCH.md`），
**dldfcn 走官方 dlopen 装载**。全量 **32 套 848 项全绿**（2026-09-23 收口后实测；
构成见 §5.21 与 `dist/DEPLOY.md` 的表），含需求级 `accept-requirements` 与图形线
`accept-p5-graphics`（**64 项**，8761 上真跑）。
交付包：**`dist/octave-full-wasm-site-20260923`**（209 文件；wasm raw 35.15MB / gz 8.04MB；
**包内 wasm sha 与部署件同** `6c75a4942df286826f8f02c1…`）；重打命令 `sh build/make-dist.sh`。

**7.2 的回退快照**：`/mnt/hdd/octave-wasm-build/site-72bak/`（90M）。
回退：`cp -a site-72bak/. site/`（**注意** `build/recover.sh` 已是 11.3.0 口径，
回退后要用它得先把取值源改回 `obench`，见 git 历史）。

**R1–R10 全部落地**；第三轮 **T1–T7 全部完成**（T1 `help` §5.6；T2 图形句柄 §5.5.1；
T3 文件操作 §5.7；T4 pkg §5.8；T5 `input()` §5.9；**T6 音频设备/文档/输出落点** 与
**T7 录音** §5.10；**T10 Asyncify 实验=不可采用** §5.11）。
**第四轮（11.3.0 换基线）已完成，见 §10**；§9 保留为当时的计划与决策记录。

### ⬜ 仍待办

> **✅ 接手第一件事（历史：2026-09-23 已完成）**：8761 全量回归当时补到 ——
> **30 套 / 757 PASS / 0 FAIL**（**历史数值**；原推算 756、实测 757；用 `/mnt/hdd/octave-wasm-build/sweep.sh`
> 跑的，脚本落在持久盘上，日志在 `sweep-logs/`）。见 **§5.14**。
>
> **▶ 非图形已全部清零**（SLICOT 2026-09-23 修好并上线，见 §5.15）。
> **▶ 图形线只剩一条后端：`webgl`**（gl4es → GLES2 → WebGL2/GPU；OSMesa 已退役，见 §5.21）。
> `plot(...); drawnow` 真渲出像素且**默认就是它**；`accept-p5-graphics.mjs` **64 PASS / 0 FAIL**；
> **8761（= 本包内容）与 8768 全量各 32 套 848 项全绿**（838 + 桥新增的 10 条）。
> **▶ plot 桥两刀**：按行发 series（§5.20，3.5×）+ 镜像层句柄缓存（§5.21，每次镜像 ~97×、
> 每图温开销 4.2×）。
> **▶ 胶水层审计（§5.22，2026-09-23）**：六个候选按依赖顺序落地 —— 文档自更新机制、
> `%!test` 接进验收、字段表/调色板各一处声明、**无 GL 设备的 SVG 显示回落**、播放状态机
> 收成一个 module（+ 修掉 resume 丢采样率的实测 bug）、队列 primitive + 漂移测试、
> 死字段与一致性闸门。**顺带查出并修掉 4 处真缺陷**（详见 §5.22 各候选）。
>
> **仍待办（按建议顺序）**：
> 1. ~~桥剩下的 ~480 ms~~ → ✅ **已完成（§5.21）**。
> 2. ~~A：`webgl` 变默认 + `FULL_ES3` + OSMesa 后端退役~~ → ✅ **已完成（§5.21）**。
> 3. ~~上线体积账~~ → ✅ **已推上 8761**（`build/promote-webgl.sh`）。
>    **体积账（实测，raw / `gzip -9`）**：
>
>    | 文件 | raw 前 | raw 后 | Δraw | gz 前 | gz 后 | Δgz |
>    |---|---|---|---|---|---|---|
>    | `octave.wasm` | 35,970,251 | 36,858,059 | +887,808 | 8,159,315 | 8,430,732 | +271,417 |
>    | `octave.js` | 683,614 | 744,750 | +61,136 | 151,341 | 160,981 | +9,640 |
>    | `octave.data` | 6,804,767 | 6,804,767 | 0 | 1,314,025 | 1,314,025 | 0 |
>    | `assets/m/plotbridge.js`（启动清单内） | 88,855 | 139,189 | +50,334 | 25,058 | 34,313 | +9,255 |
>
>    **三大件 gzip 合计 9,624,681 → 9,905,738（+281,057 B / +2.9%）**；
>    wasm raw 34.30 → **35.15 MiB**（对照：退役的 OSMesa 版 45,580,621 = 43.47 MiB）。
>    当时那轮的 8761 全量 32 套 848 项全绿（`sweep-logs/20260923-8761-webgl-clean/`）。
>    ⚠️ 之后胶水层审计又改了构建（toolkit 加了无 GL 信号）⇒ **体积与套件数以文末 `AUTO:STATE` 区块为准**，
>    `dist/` 在批末重打。
> 4. **手机真机速度**：模拟器验不了 WebGL（§5.19）⇒ 要真设备；桌面 + 降频 + 分辨率标定的
>    结论见 NOTES-webgl.md §4.5。
> 5. 已知缺口：**文字渲染**（`--without-freetype`，刻度/title 空白但不崩，且**会话第一条
>    axes 会打一条带 6 行调用栈的 warning**）；**`print` 的核心矢量路径**（缺 shell 管道 + gs，
>    见 §5.20；gl2ps 已补上）。
> 6. **（新）首帧冷启动 ~0.6 s**：真渲染器第一次出图要建上下文 + `initialize_gl4es()` + 编 shader。
>    想省掉它得在页面启动时**预热一次**（代价：开页多花这点时间 + 可能闪一下空图）。
>    §5.21 已把"冷/温"分开量清楚，做不做是产品取舍。
> 7. **（新）测试自身的"截断后匹配"写法还有多处**：`accept-*.mjs` 里有多个套件把输出
>    `slice(0,N)` 之后再 `includes(want)`。默认换成真渲染器后，会话第一条 axes 的
>    FreeType warning（带调用栈）就挤掉过两条断言（`accept-dldfcn`/`accept-forge2`，已修）。
>    **下次再遇到"某条断言只在会话第一次绘图时红"，先看这里。**（`grep -n "slice(0, 200)" test/browser/`）
> 8. **（新）"桥宽容 vs 核心严格"要对一遍**：默认真渲染器后，桥的宽容调用会走到核心实现
>    ⇒ 核心的严格报错会浮出来（实测：`plot(x,x,'+','')` 桌面本来就报错）。这是**向桌面看齐**，
>    但意味着**凡桥比核心松的写法都要重新核**（全量 sweep 是主要防线，§5.21）。

（非图形：一条待办 + 一条长尾 —— 图形线开工前建议先清掉）
1. **G1 `MAIN_MODULE=2`** —— **2026-09-22 已实测到"差一件事"**（见
   `build/113/NOTES-main-module-2.md`，含复现命令与产物留档）：
   · **体积收益是真的**：自己生成保活清单（`wasm-dis` 读 import 段 →
     `-Wl,--export-if-defined=`）链出来的 M2 构建是 wasm **27.73MB**（M1 35.97MB）、
     js **339KB**、三大件 gzip **7.82MB（−1.81MB）**，而且**能开页**、`accept-full` 20/20
     （含 `.oct` 的 dlopen 与真调用）。
   · **两道墙**：① 把 `.oct` 放主链命令行那条"官方自动保活"路会让 Emscripten 把它们记成
     **启动时要加载的 dylib**（实测 `404 : …/__bfgsmin.oct`），懒加载设计直接破功；
     ② 更麻烦的是 **JS 库符号**：`webnet.cc` 要的 `emscripten_run_script` **不是 wasm 导出**，
     M1 下所有 JS 库函数对 side module 可见、M2 下只有 `EXPORTED_FUNCTIONS +
     SIDE_MODULE_IMPORTS` 里的才可见，而 `EXPORTED_FUNCTIONS` 对非 wasm 导出名**直接报错**
     ⇒ M2 构建的**网络那一路（R5）会挂**。
   · **所以下一步不是"再做一遍"，而是挑一条**（NOTES 第三节给了三条候选，其中
     "把 R5 换成纯 .m 队列桥、彻底不用 `emscripten_run_script`"最符合本项目架构）。
   · 文档更正：`CLIBS.md` 说"imported symbols 在 `dylink.0` 段"**是错的**（那 7 字节不含
     符号名），真工具是 `wasm-dis`。
   验收：体积降 **且** 全量套件全绿。
2. ~~**`help` 覆盖 `.m` 文件的 docstring**~~ → ✅ **已完成（2026-09-22）**：构建期预渲染
   （`build/prerender-m-docstrings.py` + 官方 `__makeinfo__` 驱动 + `link-web.sh` 的
   `M_SRC`），1043/1043 渲染成功、离线对照 **25/25 与桌面逐字一致**、
   `accept-t9-helpm` 18/18。**`doc-cache` 注入仍然别再试**（那是另一条路，已实测无效）。
3. **长尾（进行中）**：control 的 SLICOT 编译件（`ss`/`step`/`tf2ss`）—— **见 §5.15**：
   签名分歧已修、`step` 已出真值，卡在装载期；三条候选路线在 NOTES 5.6。

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

## 9. 第四轮：换基线到 **Octave 11.3.0** + 重构图形线

> **事实依据全文见两份档案**（本节只写**决策与计划**，事实不在这里重复）：
> - **`build/BASELINE-11.3.md`（当前依据）**：11.x 的收益、patch 漂移实测（19 个 patch
>   对 10.3/11.3 逐个实打）、Edge-Tools 11.1.0 配方全文（5 处 sed / `emf77` /
>   webgl toolkit / 接口形态 / COI 代价）、5 条 sed 对 11.3.0 的命中实测、
>   **vanilla 11.3.0 三个月末核对**（`dlopen` 真在 / `looks_like_texinfo` 同机制 /
>   `installed_packages.m` 未被动）、构建环境与 ccache 实测。
> - **`build/BASELINE-10.3.md`**：10.3 recipe 原文、19 个 patch 名单、工具链变量、
>   他们关掉的库、edgetools.io 图形撞墙记录。**保留作为「当时怎么判断」的记录。**

### 9.1 三个决定性事实（先看这三条，再谈计划）

1. **没有"官方 wasm Octave"**。`octave.org` 主页/下载页/news 无 wasm 字样；
   upstream `release-10-3-0` 的 `configure.ac`（116KB）里 wasm/emscripten/WebAssembly
   **出现 0 次**。10.3.0 的 wasm 能力来自**社区封装**（emscripten-forge recipe + 定制 LLVM）。
   **我们不会被官方版取代。**
2. **10.3.0 的 recipe 真实可用**（`emscripten-forge/recipes` →
   `recipes_emscripten/octave`），且**链接模型与本项目相同**：
   主模块 `-sMAIN_MODULE=1`、`.oct` 走 `-sSIDE_MODULE=1`。
   工具链是 **Emscripten + 定制 LLVM 20.1.7 的 Flang**（含 Fortran common-symbol 补丁）。
   → 我们的 `.oct` 资产车道能续，且 **Fortran 从 f2c 路线换成真编译器**，
   消掉整类 f2c 问题。
3. **它的能力面比我们窄得多**：长尾库几乎全关
   （`--without-glpk/qhull_r/fftw3/qrupdate/hdf5/cxsparse/curl` +
   SuiteSparse 全家 + `--without-opengl`）。**我们补的长尾正是他们没有的。**

**所以这一轮不是"换成别人的东西"，而是"取它的工具链与平台 patch，
叠加我们的 C 库长尾与宿主层"。**

### 9.2 目标版本：**11.3.0**（原定 10.3.0，**已实测证伪后改**）

**原理由已不成立。** 原来拒 11.x 的理由是「无 wasm recipe，19 个 patch 要重新推导一遍」。
实测结果（详见 `BASELINE-11.3.md` §3）：19 个 patch 按序实打到 11.3.0 上
**16/19 直接干净应用**，失败 3 个且都不是坏消息——
**0009 已经进上游（该删）**、0010 只是生成物 `Makefile.in`（在 `Makefile.am` 层重做）、
**0016 只挂 1 个 hunk**。即「16 个直接用 + 1 个删除 + 2 个局部重做」，
涉及 4 个文件、不到 25 个 hunk。

**改用 11.3.0 的五条理由**（按权重）：

1. **Fortran 路线保住**：Edge-Tools 建的就是 **11.1.0，且用 f2c**（`--enable-fortran-calling-convention=f2c`）。
   走 f2c 则我们 13 个批次的积累（libf2c2、ARPACK 单 TU、5 个 PIC 库）**原样继承**；
   走 emscripten-forge 的 Flang 则作废一大半。
2. **补丁面小**：Edge-Tools 对源码的全部改动是 **5 处 sed**，且**实测 5/5 命中 11.3.0**
   （含 `getlocalename_l-unsafe.c:659`、`cxx-signal-helpers.cc:195`、`interpreter.cc:756`）。
3. **与本机参照同版**：本机 `octave` 就是 **11.3.0**。`render-docstrings.py`、
   `check_m.py`、全部验收断言都能拿**逐位同版**的原生 Octave 对照。
4. **收益正是 11.x 的**：卷积 10%–150×、`randi` 4.5×、logical 求和最高 6×、
   打印 PDF 快 25%；MATLAB 兼容有一整节（稀疏/对角 broadcasting、一大批函数的
   `"all"`/`vecdim`/`nanflag`/`ComparisonMethod`、`min`/`max` 的 `"linear"`、
   `qr` 单输出只返回 R…）。用户动因，已核实成立。
5. **toolkit 白拿**：Edge-Tools 的 `webgl-graphics-toolkit.cc` 就是 `§5.5 T2` 要写的
   「薄 toolkit」，已在 11.1.0 上验证能注册能跑；P5 只剩 OSMesa 一件事。

**要拿的与不要的（关键取舍）**：

| 要素 | 取自 |
|---|---|
| Octave | **11.3.0**（vanilla `ftp.gnu.org`） |
| 工具链 | **emsdk 5.0.7** |
| Fortran | **f2c**（`emf77` 那套） |
| 平台补丁 | **Edge-Tools 的 5 处 sed**；emscripten-forge 的 19 个 patch 留作**已知坑清单**参考 |
| 链接模型 / 长尾 / 宿主层 | **我们自己的**（`MAIN_MODULE=1` + `.oct` 走 `SIDE_MODULE=1`、C 库长尾、T1/T3/T4/T5） |
| 图形 | Edge-Tools 的 `webgl` toolkit + **OSMesa**；现有 plot 桥与 `print -dsvg` 作过渡与回退 |

**明确不采用**：他们 `--without-*` 那一长串（那是**能力裁剪，不是平台要求**）、
以及照抄会继承的 **pthread/COI 托管前提**（建议加 `--disable-threads`，需实测确认）。

**三个利好核对（vanilla 11.3.0，详见 `BASELINE-11.3.md` §6）**：我们 7.2 的坑多来自上游
fork `rwl/octave-wasm` 的改动，而 11.3.0 走 vanilla，那些坑**大部分不存在**——
`oct-shlib.cc:246` **真调 `dlopen`**（`§4.1` 根因消失，不必再覆盖该文件）、
`help.cc:141` 的 `looks_like_texinfo` **同机制**（T1 原样成立）、
`installed_packages.m` **167 行未被删改**（`§5.8` 的 fork 删除不存在，
`build/pkgrestore/` 不需要，只要 `build/pkgfix/` 那一半）。

### 9.3 阶段与闸门

每阶段都必须过闸门才进下一阶段；**7.2 基线（8761）在 10.3 通过等价验收之前不动**。

**P0 · 建新容器并复现 11.3.0**（独立容器；**别碰 obuild/odld/obench 与 8761**）
- 拉 `emscripten/emsdk:5.0.7`（1622MB，最后更新 2026-04-30）建容器，命名 `o113`
- 容器内装 `ccache` + `meson`(1.x)——**现有容器装不了**（Ubuntu 20.04，meson 候选 0.53.2，
  距 Mesa 要的 1.x 差得远；`emsdk:5.0.7` 的新基底能把 ccache 4.x + 可用 meson 一起带来）
- 挂宿主持久 ccache：`-v /mnt/hdd/octave-wasm-build/ccache:/ccache -e CCACHE_DIR=/ccache`
  **构建目录路径必须逐字固定**（绝对 `-I` 会进 hash，实测见 `BASELINE-11.3.md` §7.1）
- 源码：`ftp.gnu.org/gnu/octave/octave-11.3.0.tar.xz`（27919604 字节；本地已有副本）
- 补丁：**Edge-Tools 的 5 处 sed**（`BASELINE-11.3.md` §4.1 表）。**每处保留他们的
  `! grep -q …` 守卫**——模式对不上就让构建**明确失败**，不要静默改错
- configure 用他们的开关，但：**去掉 `--without-x`**（11.3.0 已移除该选项）、
  **加 `--disable-threads`**（保持现在免 COI 的托管前提；需实测确认与
  emsdk 5.0.7 + f2c 相容）
- 冒烟：`node` 起 octave + 一句矩阵解
- **闸门（三条，缺一不可）**：
  1. configure + make 通过；能起；`disp(A\b)` 数值正确
  2. **`.oct` side module 在 emsdk 5.0.7 下能装载**（`MAIN_MODULE=1` +
     `ALLOW_TABLE_GROWTH` 的行为换代必验）——**这是本轮新引入的最大不确定性**，
     我们批次 1d/13 是在 emsdk 3.1.24 上做的
  3. **不引入 COI/SharedArrayBuffer 需求**（否则托管前提变了，`dist/DEPLOY.md` 要跟着改）
- **失败就回滚**：`o113` 是独立容器，三个基线容器与 8761 全程不受影响

**P1 · 接上我们的站点接口**
- 目标：产出**我们能用的 `octave.wasm + octave.js`**（`Module.eval_string` 可用），
  而不是直接采用他们的接口或 Xeus/JupyterLite（那是别的集成模型，我们的静态站点是自己的资产）
- **注意 Edge-Tools 的接口形态与我们不同**（`BASELINE-11.3.md` §4.3）：他们是
  `MODULARIZE=1 INVOKE_RUN=0` + 页面侧 `callMain(['--norc','--quiet','--eval', script])`
  的**一次性 CLI 调用**，运行时要靠 `octave-runtime.tar` 解到 MEMFS + `OCTAVE_HOME`。
  我们要的是**可反复 eval 的常驻解释器** → 得把 `build/main.cc`（`feval`/`eval_string`
  绑定 + 两段式 addpath）移植到 11.3.0，而不是照抄他们的 `callMain`
- **闸门**：现成的 `accept-requirements.mjs` 里**至少解释器与 eval 两条**能跑

**P2 · 长尾回归（本轮的命脉，也是最贵的一段）**
- 在他们关掉的库里逐个重新打开，**每个都要在 10.3 + Flang 下重新验证**：
  `glpk` / `qhull_r`(delaunay/convhulln) / `fftw3`+`fftw3f` / **ARPACK**(eigs) /
  `cxsparse` / SuiteSparse(amd/colamd/cholmod/umklm/...) / `hdf5` / `curl`
- **Flang 的收益在这一段兑现**：7.2 时为 ARPACK 公共块重复定义做的
  "全源 cat 进单 TU"（CLIBS.md 批次 0）在 Flang 下应当不需要
- 逐个过：编得过 → 数值对（照抄现有验收的判据：`eigs` 残差、`delaunay` 顶点、
  `glpk` 最优值、`fft` 谱峰）
- **闸门**：每开一个库，该库对应的**单条数值断言**必须过；过不了就**如实关回去并记录**
- **风险**：这一段可能发现某些库在 Flang 下需要新 patch；**允许部分回退**，
  回退的代价是能力面变窄（但比 7.2 基线窄不了，因为 7.2 是全开）

**P3 · `.oct` 资产车道移植**
- `.oct` 按 10.3 头文件重编（`build_oct.sh` / `build_pkg_oct.sh` 移植）
- manifest / loader / `aliases` 符号链接机制**原样复用**（架构相同，见 9.1）
- **闸门**：`exist('convhulln')==3` 且 `which` 指向 `.oct`（即批次 13 的官方装载语义）

**P4 · 宿主层移植**
- 把已完成的四批搬过来并重跑验收。**三处「要不要重查」已在 vanilla 11.3.0 上核对完
  （`BASELINE-11.3.md` §6），结论都是利好**：
  - **T1 help**：`help.cc:141` 的 `looks_like_texinfo` **机制与 7.2 相同**
    （仍 `find ("-*- texinfo -*-")`）→ `build/render-docstrings.py` + 去标记**原样成立**
  - **T3 文件操作**：`build/webfile/`（纯 `.m`）应当直接可用；
    要确认 11.3.0 的 `copyfile`/`movefile`/`ls` 是否仍以 `system()` 收尾
  - **T4 pkg**：`installed_packages.m` **167 行未被删改**（读库代码都在）→
    **`build/pkgrestore/` 不需要**（那个坑是 fork 特有的），只需 `build/pkgfix/`
    那半（从磁盘生成数据库），并核对 `api_version` 是否仍为 `api-v57`
  - **T5 input**：已验证「不需要代码」（Emscripten TTY → `window.prompt`），
    只需确认 11.3.0 + 新 emsdk 下行为一致，`Module.stdin` 扩展点仍在
- **额外便利**：`oct-shlib.cc:246` 在 vanilla 11.3.0 里**真调 `dlopen`** →
  `§4.1` 的根因不存在，**不需要**「用上游文件覆盖 `oct-shlib.cc`」这一步
- **闸门**：`accept-help` / `accept-fileops` / `accept-pkg` **三套全绿**

**P5 · 图形线重构（你要的"真正的完整版"）— ⚠️ 见下方更新：步骤① 已完成**
- **方向：OSMesa**（Mesa 软件光栅化）。这是**唯一可信的"完整"路径**，依据：
  edgetools.io 走 `LEGACY_GL_EMULATION` + Octave 自己的 `opengl_renderer`，
  死在 `glEnd: numVertices must be an integer`，并自述 emscripten 那段模拟
  *"do not expect it to work"*；**两支外部团队都没做出浏览器内图形**。
  **⚠️ 2026-09-22 实测更正**：那条结论只对**WebGL 模拟**路线成立。
  **OSMesa + softpipe 这条路是通的，立即模式也正常** —— 见下面的"步骤① 已完成"。
- OSMesa 建成后：Octave 的 `opengl_renderer` **原样运行**，
  `print -dpng/-dsvg/-dpdf`、屏幕渲染、`getframe` 全都回到官方实现
- **过渡与回退**：现有 plot 桥 + `print -dsvg`（纯 `.m` SVG）**保留**，
  在 OSMesa 未就绪时是可靠方案；两者不冲突（一个走 toolkit，一个走桥）
- **闸门**（分步，别一步到位）：
  1. OSMesa 在 wasm 里渲出一张纯色/三角到内存缓冲（最小验证）
  2. 薄 toolkit 的 `redraw_figure` 接上 OSMesa（**T2 的目标**在 10.3 上重做）
  3. `plot/surf/mesh/contour` 逐个出图，与 7.2 桥的产物对照
- **风险（如实）**：Mesa 是大依赖（meson 构建、swrast 软件路径），
  这是本轮**最大的一块不确定性**；所以它排在最后，且**允许只完成第 1 步并如实记录**

#### ✅ P5 步骤① 已完成（2026-09-22）—— OSMesa 在 wasm 里渲出了正确的三角形

计划允许"只完成第 1 步并如实记录"，这一步已经做完且**断言是硬的**（读回像素比颜色）：

```
GL_VERSION  = 3.3 (Compatibility Profile) Mesa 24.0.9
GL_RENDERER = softpipe                     ← 软件光栅化，没 LLVM
清屏红色 中心 = 255 0 0 255                 PASS
立即模式绿三角：重心 = 0 255 0 255          PASS
                左下/右上 = 黑底            PASS
```

- **意义**：**推翻"浏览器内图形做不出来"的前提** —— 失败的是 WebGL 模拟路线，
  而 **OSMesa 支持立即模式（`glBegin/glEnd`）**，那正是 Octave `opengl_renderer` 要的。
- **做的东西**：Mesa 24.0.9（`-Dosmesa=true -Dgallium-drivers=swrast -Dllvm=disabled`
  + `default_library=static -Dshared-glapi=disabled`）建到 wasm，806 个目标全绿。
  脚本/补丁/交叉文件/垫片都在 `build/113/`：
  `patch-mesa-osmesa-static.sh`（两处平台补丁）、`emscripten-cross.ini`（emsdk 不自带）、
  `osmesa-smoke.c` + `osmesa-smoke.sh`（步骤① 验证，node 里跑，无 canvas）、
  `osmesa-stubs.c`（补 `sched_getcpu`/`pthread_setname_np`）。
  完整记录见 **`build/113/NOTES-p5-osmesa.md`**（含 6 条踩坑：meson 单引号、
  pkg-config 跨机器、meson 不用 CPPFLAGS、`shared-glapi` 是 shared 目标、
  `detect_os.h` 看预编译宏、垫片）。
- **体积代价（步骤②的决策依据）**：`libOSMesa.a` 20.1MB；最小 smoke 的 wasm 11.3MB。
- **步骤② 的进展（2026-09-22 打断处，详见 `build/113/NOTES-p5-osmesa.md` 的"步骤② 进展"）**：
  · **libGLU 9.0.3 已建到 wasm**（`/src/libwork/glu-build/src/libGLU.a`，685742 字节）——
    它只带 meson、没有 configure；用 `-Dgl_provider=osmesa` + **手写 `osmesa.pc`**
    （Mesa 自产那份是交叉半成品，带 `-pthread`/`-sPTHREAD_POOL_SIZE` 垃圾，别用）。
  · **GLU 剖分已在 OSMesa 上验证通过**（`build/113/osmesa-glu-smoke.c` + `.sh`）：
    凹 L 形多边形，横杠/竖杠内=黄、**凹口内=黑**、界外=黑，四条像素断言全 PASS
    ⇒ 步骤② 的**最后一个库层面未知被消掉**。（顺带发现 GLU 默认吐 `GL_TRIANGLE_FAN`
    而不是 `GL_TRIANGLES` —— 按错的类型画过一版，碰巧像素对，已改。）
  · **`glshim`**（`/src/deps/glshim`）：`libGL.a`=`libOSMesa.a`、`libGLU.a`=上面的 GLU、
    头用 Mesa 的 —— 把 OSMesa **冒充成 `-lGL`/`-lGLU`**，让 `--with-opengl` 落在软光栅路上。
  · **`configure-113-full.sh` 加了 `WITH_OPENGL=1`**（默认仍是 `--without-opengl`），
    带 OpenGL 的 **configure 已跑通：`config.h` 里 `#define HAVE_OPENGL 1`**。
  · **卡点（下次就修这一条）**：`HAVE_OPENGL_GL_H` / `HAVE_OPENGL_GLU_H` /
    `HAVE_OPENGL_GLEXT_H` / `HAVE_GLUTESSCALLBACK_THREEDOTS` **还是 undef**，
    而 `gl-render.cc` 的 `#include` 块正是靠它们（`acinclude.m4:1565/1616/1621/1648`）
    ⇒ 一个 GL 头都不会被包含、编不过。要查这几个头探测为什么失败（疑似吃不到我们传的
    `CPPFLAGS`，或按 macOS `OpenGL/gl.h` 风格试的）。
  · **③ 还没开始**（截至 §9.3 当时）：`plot/surf/mesh/contour` 逐个出图并与 7.2 桥产物对照。
    **2026-09-23 已完成，见 §5.16**：步骤①②③ 全部打通，8763 上 54 PASS / 0 FAIL，
    逐图类型真渲出非空白画面（根因是 toolkit 缺 `#include "config.h"`）。
  · **回退不变**：plot 桥 + `print -dsvg` 保持可用，两者不冲突。

> ~~🚨 主树现在是"混态"~~（**2026-09-22 已清除；2026-09-23 又因 B 档重新切成 opengl-ON** ——
> 见 §5.16 末尾"主树当前状态与怎么切回去"，那份说明才是最新的）。

**P6 · 收尾**：全量验收、重打交付包、文档、逐阶段提交 + `docker commit`

### 9.4 纪律（沿用并加强）

- **8761 永不退化**：10.3 全程在**独立容器 + 独立端口**（8762/8764）上做，
  7.2 基线在 10.3 通过等价验收前不替换
- **每阶段 `docker commit` 一个检查点**，命名 `octave-build:<phase>`；断电只认镜像
- **改 `.m` 前先跑** `python3 build/check_m.py <目录>`
- **事实优先**：本轮的每个"能/不能"都要有实测或源码引用；
  尤其 **10.3 与 7.2 的差异（`help.cc` 判定、`installed_packages.m` 是否同样被删改、
  `.oct` ABI）不许假设，必须重查**
- 新文件同步 `.gitignore` 白名单；文档只用 Read/Edit 改

### 5.9 T5 已完成（2026-09-21）——`input()` **不需要代码**

**结论：`input()` 本来就是可用的。** Emscripten 不定义 `Module.stdin` 时把
`/dev/stdin` 软链到 `/dev/tty`，而 TTY 默认输入就是 `window.prompt('Input: ')`
（读 `library_tty.js` 的 `default_tty_ops.get_char` 确认）→ 弹浏览器原生对话框。

之前看到的 `input: reading user-input failed!` **不是缺陷**：那是对话框被**取消**
（=EOF）。本机 `octave-cli --eval "v=input('x? ')" < /dev/null` 报**一字不差**的同一句。

唯一加的：`bridge/index.html` 的 `Module.stdin`（Emscripten **官方扩展点**，
**必须在启动前定义**，启动后赋值无效——`FS.init()` 时才做 `createDevice`）。
它优先从 `window.__octaveStdin` 队列取行，队列空回退 `window.prompt`，
**真人用户体验不变**；加它只为**可测**（playwright 的 dialog 是异步的，
与同步阻塞的 `window.prompt` 交错会让连续 `input()` 拿到错位答案）。

**⚠️ EOF 是粘性的**：`std::cin` 读到一次 EOF 就永久 EOF（本机同理）→
用户取消过一次对话框后，此后所有 `input()` 都会失败（与桌面一致）。
**测试顺序因此有意义**：EOF 断言必须放最后，否则污染后面全部断言。

**验收**：`accept-input.mjs` **9/9 绿**。

---

### 5.10 T6 + T7 已完成（2026-09-22）——浏览器宿主语义（音频设备 / 文档 / 录音）

**结论：两批都走资产车道，主 wasm 零改动。** 各批的验收：
`accept-t6-audio-doc` **33/33**、`accept-t7-recorder` **40/40**（用 Chromium 假麦克风，确定性）。
完整一手记录（含 4 个坑与复现命令）见 **`build/113/NOTES-t6-t7-hostlayer.md`**。

**T6 = 三件事**（比计划多一件）：

1. **`audiodevinfo` 最小 shim**（`build/webaudio/audiodevinfo.m`）：没有 PortAudio →
   内建整个被编掉（`exist` = **0**）。给一个静态"浏览器默认设备"模型
   （输入/输出各一台、ID 恒为 0、名字如实写 `Browser …`，**不假装**是真硬件）。
   **语义上最容易写错的一条**：`audiodevinfo(io)` 返回的是**设备个数**，
   `audiodevinfo(io, id)` 返回的是**名字字符串**；第三参数官方只认 `"DriverVersion"`。
2. **`doc` 的浏览器实现**（`build/webdoc/doc.m`）：官方 `doc.m` 末路是 `system()` 起
   info 浏览器进程（无 shell → 实测报"info manual 缺失"，**那句错还误导**）。
   改成只负责"取文本并显示"，文本仍走官方 `help()`，**不自研 texinfo 渲染**（T1 的教训）。
3. **输出落点（计划外，但它是 2 的前提）**：实测发现 8761 的页面**什么都不显示** ——
   `disp(42)` 之后 `document.body.innerText` 仍是空串、上游骨架那个 `<pre id="output">`
   **从来没人往里写**。给 `Module.print`/`printErr` 各加一句**额外**写 DOM
   （仍照常走 console，否则 26 套全打掉）。**这才让"显示到页面"这条验收有意义。**
4. 顺手摘掉一个**误导性告警**：`index.html` 的启动清单挂着 7.2 车道的
   `installed_packages.m`，而清单里没有该资产 → 每次开页都喊
   "pkg 支持装载失败"，而 `pkg` 其实好着（`accept-pkg` 16/16）。

**T7 = `audiorecorder`**（19 个 `__recorder_*` 纯 `.m` + JS 桥）：

- 不移植 PortAudio；句柄是 `struct("Id",id)`，状态在全局表，动作走
  `/tmp/pra_queue.txt`，页面 `bridge/webaudiorec.js` 落实，
  PCM 写回 `/tmp/pra_<id>.f64` 供 Octave **同步**读取。
- **为什么用 MediaRecorder**：它不走主线程；AudioWorklet 要 SharedArrayBuffer，
  而本构建刻意**不要求 COI**。代价：只有 stop 后解码完才知道真实样本数。
- 权限三态（允许/拒绝/无安全上下文）各自一句能照着做的错误，**绝不假装麦克风永远存在**。

**★ 本批最重要的实测结论（推翻了我中途的一个错判断）**：
**`pause()` 期间浏览器事件循环完全停摆**（区间内 tick = 0；`pause(1)`/`pause(2)`/
`for pause(0.1)` 三种写法都一样）。我先前的测量把 eval **前后**的 tick 也算进去了，
据此得出过"pause 会让出主线程"——**那是错的**。三条推论：

1. **`recordblocking` 需要 Asyncify**（要等页面跑完而 Octave 一阻塞页面就停）
   → 本构建**如实报错**并在错误里给出替代用法（`record(r,len)` + `getaudiodata`）。
2. **`uigetfile`（T8）同病**，计划里记的"需 G2 先验"是对的；
   反过来也解释了 `input()` 为什么能用 —— `window.prompt` 是**同步**的浏览器 API。
3. **写验收时的等待必须发生在 JS 侧**（`setTimeout`），不能用 Octave 的 `pause`。
   这也正是真人用 REPL 的节奏：命令返回 → 页面自由 → 下条命令读数据。

**其它两个坑（详见 NOTES）**：`__recorder_getaudiodata__` 必须返回**声道×帧**，
且空数据也要有那一行（`@audiorecorder/getaudiodata.m` 单声道路径会做 `data(1,:)`，
返回 `0×1` 直接 "out of bound 0"）；`getUserMedia` 是异步的，**还没授权时来的
`stop` 必须记下来**，否则随后 resolve 会开始**无限录音**。

**顺手补的可复现性缺口**：`assets/meta.json`（承载 `deps`/`note`/**`aliases`**）
**只存在于磁盘站点、不在 git** → 只拿仓库重建不出站点。已纳入仓库
`build/assets-meta.json`，并补了工具 **`build/assets.py sync-js`**
（不能用 `gen-manifest`：它整份重算，会把 11.3.0 站点 `file` 类资产的
11.3.0 专属 mount 路径算错）。

### 5.11 T10 已完成（2026-09-22）——**Asyncify 不可采用**（实测）

计划里 T10 是"只实验不采用"。实验做完了，**结论比预期干脆：它在这个构建里链不出来**，
因此**不可以采用**。完整记录见 **`build/113/NOTES-asyncify.md`**。

- **做法**：`EXTRA_LDFLAGS="-s ASYNCIFY=1" bash link-web.sh /src/websrc/asyncify-out`
  （Asyncify 是链接期 binaryen 变换，不用重编任何 `.o`；输出到独立目录，部署未动）。
- **结果（硬失败）**：`emcc.py:438` 明确警告
  `ASYNCIFY=1 is not compatible with -fwasm-exceptions. Parts of the program that mix
  ASYNCIFY and exceptions will not compile.`，随后
  `wasm-opt --asyncify` 报 `Fatal: Module::getFunction: __asyncify_get_call_index does
  not exist` 并返回 1 —— **`octave.js` 未生成**。
- **为什么这条结论是决定性的**：本构建**必须**用 `-fwasm-exceptions`
  （§10.3 坑 1：JS 式异常引入只在胶水里的 `invoke_*`/`__cxa_*`，side module 装载即崩）。
  所以"上 Asyncify"的真实代价不是体积，**而是整条 `.oct` 资产车道**
  （dldfcn 核心组 + 全部 Forge 编译件 + `__ode15__` + 录/放音桥）。
  **代价与收益完全不成比例。**
- **体积那点数据只能当下界**：换旗标后（Asyncify pass 之前）的中间 wasm 41.17MB
  vs 部署版 35.97MB（+5.2MB）。**Asyncify pass 没跑成，所以从没得到过有效产物**——
  别把这 +14.5% 写成"Asyncify 的代价"。
- **对 T8 的直接影响**：`uigetfile` **不走 Asyncify**，改走外部审核并列的**路线 B**
  （非标准异步 API），并如实标注与 MATLAB 语义不同。
- **安全**：实验前后部署件 sha256 都是 `bac48adb960c9c79…`（`site/` 与
  `o113:/src/websrc/out/` 两侧都核过）。

### 5.12 T8 + 覆盖率收口（2026-09-22）——**桌面可调用名字 926/926**

**这一批的缘起是一个可复现的度量**：宿主机上正好是**同版 Octave 11.3.0**，把它的
`__list_functions__`（927 个可调用名字）逐个拿去浏览器里 `exist()`。对照结果：

| | 数量 |
|---|---|
| 桌面可调用名字 | 927 |
| **浏览器里可用**（装载懒加载资产后） | **926** |
| 唯一"缺" | `debian_missing_handler` —— **不是 Octave 的东西**（在 `/usr/share/octave/**site**/m/`、属 Debian 的 `octave-common` 包，是上游 `distro_missing_handler.m` 的改名版） |

⇒ **按 Octave 真实能力面算 = 926/926。** 那 5 个名字都是**用官方源码真补上**的，
不是桩；完整查证过程（含 6 条实测/源码发现与复现命令）见
**`build/113/NOTES-coverage-100.md`**。要点：

- **`__init_gnuplot__` / `__have_gnuplot__`**：官方 `.cc` **零外部依赖**（上游 `_LIBADD`
  只有 liboctinterp）⇒ 直接编成 side module。行为与"桌面没装 gnuplot"**一字不差**：
  `__have_gnuplot__()` 返回 0，`__init_gnuplot__()` 报上游原话
  `the gnuplot program is not available, see 'gnuplot_binary'`。
- **`__init_fltk__` / `__fltk_check__`**：官方 `.cc` 的 FLTK 部分是 `#if HAVE_FLTK` 包起来的，
  但 DEFUN **无条件存在**、缺 FLTK 时报 `err_disabled_feature` ⇒ 编出来就是
  **上游"没编 FLTK"的官方行为**（模块只有 2545 字节）。
- **`__fltk_uigetfile__`**：官方那个要 FLTK 头 ⇒ **我们自己写**（`build/webfilepick.cc`）。
  **为什么必须是 `.oct`**：`uigetfile` 的调用链是
  `uigetfile.m → __get_funcname__ → __uigetfile_fltk__.m（m/gui/private/）→ __fltk_uigetfile__`，
  而中间那层开头就是 `if (exist("__fltk_uigetfile__") != 3) error("fltk graphics toolkit required")`
  ⇒ 纯 `.m` 覆写**满足不了这道门禁**。
  **为什么是两步**：选择框异步 + Octave 一阻塞页面就停摆（§5.10 坑 1）⇒
  第一次调用弹框并**明确报错**提示"选好后请再执行一次"，第二次返回结果。
  验收 `accept-t8-uigetfile` **19/19**（Playwright `fileChooser` 把选单个/取消/多选三种场景都走完）。
- 顺带两个坑：`MultiSelect` 传过来是**字符串** `"on"`（不是逻辑值，第一版多选因此失效）；
  FLTK 过滤器串**自带制表符**，入队前必须消毒否则请求被拆段。
- 一个**化妆品级噪音**（上游行为，没改）：工具架不是 `fltk` 时 `__get_funcname__` 会打
  `warning: uigetfile: no implementation for toolkit 'web', using 'fltk' instead`。
- **`help uigetfile` 仍报 makeinfo 错** —— 那是 `.m` docstring 的既存缺口（§5.6 / C7），
  **不是本批引入**；验收里专门用一条断言把它钉成"已知缺口"。

**本批之后，非图形只剩两件**：G1 `MAIN_MODULE=2` + keep 清单（体积，Lane B）、
以及 `help` 覆盖 `.m` 的 docstring（约 1010 个 `.m`）。
（**收口情况**：`help`-.m 已在 P1 完成（§5.13）、SLICOT 已在 §5.15 完成并上线；
**只剩 G1**。）

### 5.13 P1 已完成（2026-09-22）——`help <mfile>` 可用 + 修掉"数据里带整棵重复树"

**① 构建期预渲染 `.m` 的 docstring**（用户可见的最大一块缺口）：

- **为什么 T1 的表救不了它**：`.m` 的 docstring **永远不查 `built-in-docstrings`** ——
  那条回退只在符号表和**文件查找都失败**时才走（`help.cc:206-232` 的 `raw_help`）。
- **为什么必须在构建期改文件**：`help X` 第一次解析会把 docstring **缓存在
  `octave_function` 对象上**（`octave_function::doc_string()`）；运行期覆写 MEMFS 有
  "谁先被解析谁赢"的竞态。
- **工具**：`build/prerender-m-docstrings.py`（抽取 + 写回 + 3 条自检）+
  `build/render_docstring_batch.m`（**渲染交给官方的 `__makeinfo__`**）。
  接线：`link-web.sh` 新增 `M_SRC`（默认安装树，指到 staged 树即可；
  **运行期路径完全不变**）。
- **★ 第一版为什么全错（值得记住）**：只复刻了 makeinfo 调用，漏了 `__makeinfo__.m`
  里的一整套文本变换 —— 去掉**每行一个前导空格**（`text(2)==" "` 那个守卫成立是因为
  `looks_like_texinfo` 的 `erase(0,p1)` **把标记行的换行符留了下来**）、`@end tex` 缩进、
  `@seealso`→`@xseealso` 并转义 `@`、`@ref/@xref/@pxref`、收尾 ` -- : `。
  结果离线对照 **20/20 逐字不同**（折行宽度 + 每行差一个空格）。
  **改用官方函数后，"与桌面一致"变成构造性成立**（宿主同版 11.3.0，
  `texi_macros_file()` 与站点发的 `macros.texi` 逐字节相同）。
- **实测**：1043/1043 渲染成功、0 失败（另有 3 个无 docstring、5 个非 texinfo）；
  离线对照 **25/25 与桌面 `help` 逐字相同**；`accept-t9-helpm` **18/18**。
- **抽取规则用活**（`lex.cc:2253-2301` / `5288-5303` / `comment-list.h:150-168`）：
  "先跳空白、再去掉**所有**前导 `#`/`%`" ⇒ 内容里**缩进过的** `## xx` 能无损写回，
  只有**第 0 列**就是 `#`/`%` 时才无解（工具会明确失败而不是静默少字符）。
- **测试自身的三个坑**（都写进 `accept-t9-helpm.mjs` 的注释了）：别只取前 N 个字符断言
  （`help` 开头是签名行）；多行 `{...}` cell 字面量**每行列数必须一致**（用 `strsplit`）；
  `end_try_catch` 后直接跟 `if` 需要分隔符。

**② 修掉 `@ftp` 预载路径错位**（调查中查出的构建 bug，零风险、净赚体积）：

`--preload-file` 按**第一个 `@`** 切 `src@dst`，而 `m/@ftp` 的**源路径自带 `@`** ⇒
那一条被切成 `src=.../m/`、`dst=ftp@/usr/src/octave/m/@ftp`，于是**整棵 m/ 树被复制**
到那个怪路径下。实测：

| | 修前 | 修后 |
|---|---|---|
| octave.js 文件表记录 | 2181（其中 **1087 条**在 `/ftp@/…`） | 1108（**0 条**） |
| 文件表里重复数据 | **5.25MB（44%）** | 0 |
| `/usr/src/octave/m/@ftp/loadobj.m` | **不存在** | 存在 |
| octave.data | 13,829,164（gz 2,652,167） | **6,989,733（gz 1,337,924）** |
| octave.js | 785,187（gz 166,645） | 683,642（gz 151,361） |
| octave.wasm | 35,970,251 | **逐字节未变**（`bac48adb…`） |

修法：源路径里含 `@` 的目录先拷到**名字里没有 `@`** 的暂存目录再预载（目的地照旧写
`/usr/src/octave/m/@ftp`）；并在 `link-web.sh` 末尾加**构建期自检** —— 产物里出现
`/ftp@` 记录就直接 FATAL，别静默出包。

**两个验收（本批）**：`accept-t9-helpm` 18/18；8762 全量回归 + 8761 复跑全绿。

---

### 5.14 非图形收尾轮（2026-09-22）—— 四件事 + 一条待补的验证

本轮按"彻底收尾非图形"的口径做了四件，**两件落地、两件探到确切的墙并如实留档**。
每件都有独立 NOTES；这里只给索引与**接手必须知道的状态**。

| # | 事 | 结果 | 记录 |
|---|---|---|---|
| ① | **`@ftp` 预载路径错位**（emscripten 按第一个 `@` 切 `src@dst`，而 `m/@ftp` 源路径自带 `@`） | ✅ **已修并上线**：`octave.data` 13.83MB→**6.99MB**（gz −1.31MB），wasm 逐字节未变；并在 `link-web.sh` 末尾加了构建期自检（产物出现 `/ftp@` 记录直接 FATAL） | **§5.13 ②** |
| ② | **`help <mfile>`**（`.m` docstring 撞运行时 makeinfo） | ✅ **已修并上线**：构建期预渲染（1043/1043），离线对照 **25/25 与桌面逐字一致**，`accept-t9-helpm` 18/18 | **§5.13 ①** |
| ③ | **`MAIN_MODULE=2`（体积）** | ⚠️ **不采纳，留档**。体积收益是真的（wasm 35.97→**27.73MB**、gzip **−1.81MB**，且能开页、`accept-full` 20/20），但撞两道墙：官方"把 `.oct` 上主链"那条会让 Emscripten **启动时自动加载 dylib**（`404 __bfgsmin.oct`）；补 JS 库符号时又发现 `emscripten_run_script` **不是 wasm 导出**，M2 下网络那一路（R5）会挂 | **`build/113/NOTES-main-module-2.md`** |
| ④ | **SLICOT（control 的 `ss`/`step`/`tf2ss`）** | ⚠️ **探针完成，根因更正**：不是"签名不匹配"，是那 48 个例程**在主 wasm 里定义了 0 个**（库从未编过）；库**能编**（f2c 614/614、emcc 613/613 → 5.0MB 归档）；真卡点是控制包手写声明 vs f2c 生成的 **CHARACTER 隐藏长度参数**分歧（`dggev_` 17 vs 19），**静态注册同样会撞** | **`build/113/NOTES-slicot.md`** |

#### ✅ 接手第一件事（**已于 2026-09-23 完成**）：补跑 8761 的全量回归

本轮最后一次 8761 全量跑到 `accept-help`（约一半）时**被人工中断，已跑部分全绿**。
P1 的完整证据来自 **8762**：那轮 **728 PASS / 1 FAIL**，唯一失败是 `accept-t8` 里
**"`.m` docstring 是已知缺口"的旧护栏**——P1 补上缺口后它如实报错（护栏该有的行为），
已翻正为正向断言并在 8761 上复验 **20/20**。
⇒ 当时按"728 + 那 1 项翻正 + pkgoct 27"推成 **756**；**实测 757**（2026-09-23 已补跑确认，
见 §5.15；SLICOT 上线后是 31 套 784）。跑法：

```bash
/tmp/sweep.sh http://127.0.0.1:8761/     # 或逐套 harness/run.sh test/browser/accept-*.mjs http://127.0.0.1:8761/
```

#### ⚠️ 本轮踩到的一个操作陷阱（会污染结论）

**后台 sweep 正在跑时，不要手动跑 harness 测试。** `harness/run.sh` 把脚本固定拷到
`$H/_run.mjs`，两边并发会互相覆盖 —— 我因此得到过一轮"假失败"（M2 首轮的 2 FAIL
一度被我当成抢文件的产物），干净重跑后才发现**那是真的回归**。
规则：**同一时间只让一个东西写 `_run.mjs`**。

#### 本轮新增/修改的工具与测试

- `build/prerender-m-docstrings.py`（抽取 + 写回 + 3 条自检 + `--verify-desktop` 离线对照）
- `build/render_docstring_batch.m`（**渲染走官方 `__makeinfo__`**；文件名必须与函数名一致）
- `build/113/link-web.sh`：新增 `M_SRC`（预载源树，指向 staged 树）、`EXPORTED_FUNCS`
  （M2 车道要把 JS 库符号列进导出，**写在 EXTRA_LDFLAGS 里会被后面那行覆盖**）、
  末尾的预载路径自检
- `test/browser/accept-t9-helpm.mjs`（18 项）、`accept-t8-uigetfile.mjs`（护栏翻正 → 20 项）

---

### 5.15 SLICOT **已修好并上线**（2026-09-23）—— 非图形最后一件清零

一手记录在 **`build/113/NOTES-slicot.md` 第五节**（新增 7 小节，含全部复现命令与判据陷阱）。
这里只给**接续必须知道的**：

**已修掉（有实测）**：
1. **`CHARACTER` 隐藏长度分歧** —— 工具 **`build/113/fix-slicot-abi.py`**（幂等，带硬自检）：
   51 处声明里 37 处需补、**0 处**违反"Δ == CHARACTER 个数"；只补**声明**、尾部参数给
   **默认值 1**（调用点一字不改）；重复声明只允许第一处带默认值（C++ 的两条规则都踩过）。
   `ab13ad` 的返回类型 `int`→`double`（AB13AD 是 `DOUBLE PRECISION FUNCTION`，返回值被丢弃）。
   ⇒ **`build-oct.sh --cc` 链接零警告**，产物 2.98MB。
2. **LAPACK/BLAS 没被主模块导出**（`.oct` 调用落到 emscripten stub，报
   `TypeError: resolved is not a function`）—— 走用户拍板的**自包含**路线：
   新脚本 **`build/113/rebuild-pic-blas.sh`** 重编 Fortran 三库带 `-fPIC` 到
   **独立 prefix `/src/deps/lapack-pic/`**（**不动 `/usr/local`**，主链还在用那份）。
   librefblas/liblapack/libf2c 全过，**实测约 65 秒**。
3. **控制包 `common.cc` 没被编进调度模块**（`max/min/error_msg/warning_msg` 缺定义）
   → 单编 `common.oct.o` 一起链。

**★ 好消息**：`oct-b` 形态（8.10MB）在 8762 实测 —— `ss(-1,1,1,0)` 出真对象、
`pole(tf(1,[1 1]))` = `-1`、**`step(ss(-1,1,1,0),0:0.5:2)` = `0 0.3935 0.6321 0.7769 0.8647`
（解析解 `1-e^-t`，逐位吻合）**。（修之前 `ss`/`step` 是**整页崩**。）

**④ 最后两个卡点也都解了（2026-09-23，路线① 成功）**：
  · **表条目**：I/O 子系统那批 libf2c 成员会在 side module 里造出**模块自己的表条目**
    （`dylink.0` 的 `tableSize` 13→1）。做成**精简归档 `libf2c-subset.a`**（剔掉
    open/close/fmt/fmtlib/dfe/due/dolio/lread/lwrite/rsfe/wsfe/…）后，剩下的 1 个不影响装载。
  · **那个假报错的真身**：`tableSize` 只是引子，真正的崩点是加载器的
    `reportUndefinedSymbols()` —— 碰到"**必需但解析不到**"的符号时它去读 `undefined.value`，
    抛出的是 `TypeError: Cannot read properties of undefined (reading 'value')`，
    **完全看不出是缺符号**。给 staging 的 `octave.js` 加一句日志才看到真名：
    `P5DBG-undef: sym=f__w_mode required=true`（libf2c 的**数据**符号，引用走 GOT.mem ⇒ 必需）。
    修法：`build/113/f2c-io-shim.c` 给 `f__r_mode`/`f__w_mode` 一个最小定义（空表，只在 I/O 错误路径用）。

**可复用的诊断手段**：给 staging 的 `octave.js` 打一句补丁让 stub 打出**缺失符号名**
（`MISSING-OCT-SYMBOL: pow_di` 就是这么拿到的；`site113/octave.js.orig` 是原样备份）。

**已上线（8761）**：`site/assets/octdir/control/__control_slicot_functions__.oct`（8.1MB，自包含）
+ manifest 里 49 个 `__sl_*__` 别名（`{file,names}` 形态）。
**实测（8761）**：`norm(tf(1,[1 1]))`=0.7071、`step(ss(-1,1,1,0))`=1−e^-t（误差 1.1e-16）、
`lyap(-1,1)`=0.5、`dlyap(0.5,0.75)`=1、`care(0,1,1,1)`=1、`tf2ss` 反算=5/12。
新套件 **`test/browser/accept-slicot.mjs` 25/25**；`accept-forge2` 的两条旧护栏已翻正（42→**44**）。
**全量回归 31 套 784 项全绿**。产物留档在 `/mnt/hdd/octave-wasm-build/slicot-fix/`（a–e 五个版本）。

> ⚠️ **两条判据陷阱（新踩，别再踩）**：
> ① 主 wasm **根本没有 name 段**（只有 `dylink.0`）⇒ `emnm` 读到的名字**就是导出段**，
> 不是"所有符号"；未导出的函数连名字都不存在。**判"某符号在不在主模块里"不能只看名字**。
> ② 用 `comm` 比对符号表前必须 `LC_ALL=C sort` —— Python 的码点序与 shell 的 locale 序不同，
> 会凭空多出一堆"缺口"（第一批分析里 331 个缺口大多是这么来的）。

---

### 5.16 图形线（P5）：A 档试到底 → B 档（主 wasm 带 GL）→ **步骤②③ 打通并验收**

一手记录在 **`build/113/NOTES-p5-osmesa.md`**（第七节 = 过程与推翻的推断；**第八节 = 根因与修法，接手先看它**）。
这里只给接续必须知道的：

**实验通道是 8763（`/mnt/hdd/octave-wasm-build/siteP5`）**；8761 **全程未动**
（wasm 仍是 `bac48adb…`）。图形版的 `octave.wasm` 是 **45,580,621 字节**（比基线 +11.3MB raw，
因为 OSMesa 进了主模块）——**这是 B 档的代价，也是它不能直接上 8761 的原因**。

**已达成（实测，8763）**：主树 `WITH_OPENGL=1` 重配重编 + 主链 `-lGL -lGLU`（glshim 把 OSMesa
冒充成 GL）+ **toolkit 编进主模块** ⇒ `graphics_toolkit('osmesa')` = `osmesa` ✔、
`figure(7)` 真对象 ✔、**`plot(...); drawnow` 真渲出像素** ✔、`getframe` 返回真 cdata ✔、
页面 `<img>` 贴上 PNG ✔。`test/browser/accept-p5-graphics.mjs`（当时叫 accept-p5-osmesa）= **54 PASS / 0 FAIL**，
逐图类型（plot/plot3/semilogy/loglog/stairs/stem/area/bar/pie/contour/errorbar/scatter/
scatter3/mesh/surf）全部解码 PNG 后**非空白**。

**根因（一句话）**：`build/113/osmesa_toolkit.cc` 没 `#include "config.h"` ⇒ 该 TU 里
`HAVE_OPENGL` 未定义 ⇒ `octave::opengl_functions` 被编成**空类**（虚表只有 2 槽），
而 `gl-render.o`（`HAVE_OPENGL=1`）的 `set_viewport` 要取**第 77 槽** ⇒ 越界 trap。
修法就是补上那句（Octave 自己的 `gl-render.cc:26-28` 就这么写）。产物只 +5KB。
**原先记的"trap 在 `ensure_context()`"是误判** —— 当时那版**根本没编进探针**
（`grep -c 'P5TK GL_VERSION='` = 0），而且 `octave_stdout` 带缓冲、trap 后会丢。

**步骤③ 的关键发现**：修好渲染后仍是白图，因为 **plot 桥（`build/plotbridge/`）的 .m
一个真图形对象都不建**（v1 时代设定：没有 toolkit、渲染在 JS 侧）。
新增 `build/plotbridge/__pb_mirror__.m`：桥的每个绘图/状态函数结尾多调一句，
**把桥目录临时从 path 摘掉再 `feval` 同名核心函数** ⇒ 真对象就有了。
⚠️ 必须"整段调用期间都摘掉"：只把顶层换成句柄会让 `pie`/`contour` 炸在
`__pie__` 内部的 `axis(h, [...])`（首参是句柄，桥的 `axis.m` 不认）。
代价：每张图多约 0.26s（两次 `path()` 重扫，各 0.13s）。
**门禁**：只在真渲染器（`osmesa`）在线时镜像；`web` 下**完全不走**，
所以 **8761 行为逐字节不变**（验收里有一条专门守这个）。

**A 档（Mesa 全打进 `.oct`）的三道墙**（都有实测，别再走）：① Chrome 禁主线程同步编译
>8MB（已用页面侧异步预加载解）② `.oct` 需要的 JS 库函数不在主模块胶水里（已用 wasm-SjLj
重编 Mesa/GLU 解）③ 10.8MB/表 12543 的 side module 装载期读到错位字符串（未解，故转 B 档）。

**下一步（若要继续这条线）**：① 把 B 档的体积账谈清（45.58MB 能不能上 8761，或按需加载）；
② 文字渲染仍缺（`--without-freetype` ⇒ 刻度/title 空白但不崩，如实记录）；
③ 只读渲染管线之外的 `print -dpdf/-dps` 走 gl2ps 那条路还没实测过。

**回退**：`siteP5` 是独立目录，删掉/重拷即可；8761 与 `site/` 未被触碰。


#### 主树当前状态与怎么切回去（**动手前必读**）

为 B 档，主树被**重新 configure 成 opengl-ON** 并**全量重编**过（`make clean` + `emmake make -k -j24`）：

| | 现在（2026-09-23 收口后） | 切回"不带 GL" |
|---|---|---|
| `config.h` | `HAVE_OPENGL 1` + `HAVE_GL_GL_H/_GLU_H/_GLEXT_H` + `HAVE_GL2PS_H 1` | `cd /src/bin && PATH=/src/bin:$PATH SKIP= bash configure-113-full.sh`（**不带** `WITH_OPENGL`/`WITH_GL2PS`）|
| **GL 头** | `/src/deps/glshim/include` 是**软链** → `/src/deps/glheaders-webgl/include`（**gl4es + GLU 的头**，由 `build/113/gl-headers-webgl.sh` 组装；命令行逐字没变，见 §5.21） | `bash /src/bin/gl-headers-webgl.sh --revert`（把 Mesa 那份从 `include.mesa-bak` 换回来）|
| `.o`/`.a`（libinterp/liboctave） | 与之一致（opengl 版；`gl-render.o` 现在引用 `gl4es_gl*`，**没有裸 `gl*`**）| 配置切回后**必须重编**（否则混编；automake 不会因 config.h 变而全量重编，`make clean` 最稳）|
| 备份 | —— | `/src/libwork/config.h.pre-opengl-p5`（opengl 化之前）、`/src/libwork/config.h.pre-opengl`（更早）、opengl-on 那份在 `/src/libwork/config.h.opengl-on`、**gl2ps 化之前那份在 `/src/libwork/config.h.pre-gl2ps`** |

**2026-09-23 晚又加了一个开关**：`WITH_GL2PS=1`（`configure-113-full.sh`，默认关）。
它把 wasm 版 gl2ps 摆进搜索路径（`/src/deps/gl2ps`，配方 `build/113/build-gl2ps.sh`），
于是 `config.h` 变成 `HAVE_OPENGL 1` **+ `HAVE_GL2PS_H 1`**；`link-web.sh` 会自动链
`libgl2ps.a`（库在就加）。**切回去**：重配时去掉 `WITH_GL2PS=1` 即可（`config.h` 变 ⇒ 又要大重建）。
**注意它不是"print 就好了"**：`print` 还卡 shell 管道，见 §5.20。

**部署产物（2026-09-23 收口后）**：`site/`（8761）的三大件现在就是**带 GL 的那份**
（`octave.wasm` sha256 `6c75a4942df286826f8f02c1…`，36,858,059 字节）；容器里
`/src/websrc/out/` = 带 GL 的、`out-webgl`/`out-webgl3` 是同内容、
**不带 GL 的那份留档在 `/src/websrc/out-nongl-bak/`**；站点回退点
`/mnt/hdd/octave-wasm-build/site-prewebgl-bak/`。8763（`siteP5`）是退役的 OSMesa 站点，别再用。

⚠️ 另记一条本轮的构建坑：**全量 `make` 必须 `-k`** —— `libinterp/dldfcn/__fltk_uigetfile__.oct`
这个目标在 `--without-fltk` 下必然失败（`/usr/bin/install: omitting directory 'libinterp/dldfcn/.libs/'`），
另外 in-tree 的 `src/octave-cli` 与那几个 `.oct` 目标会因 `cgejsv_`/`zgejsv_`（良性未定义）而失败
（**我们不发它们**，web 产物走 `link-web.sh` 自己的链接行）。
**只改了 GL 头内容时**（§5.21 的 2b）：`emmake make -k -j24` 是**增量**的，实测只重编
`gl-render`/`gl2ps-print`/`__init_fltk__` 三个 TU（automake 的 `.Plo` 认路径、内容变了才重编）。

---

### 5.17 ⚠️ 本轮的网络异常：`github.com` 被拦，推送改走 GitHub API（2026-09-23 04:4x）

**现象**：`git push` 一律 `Recv failure: 连接被对方重置`（直连、HTTP 代理 2080、
SOCKS5、`http.version=HTTP/1.1` 全试过）；同时 **`gh api` 正常**（`api.github.com` 通）。
⇒ `github.com` 这个域被网络层拦了，`api.github.com` 没被拦。

**处置（已做）**：
- 用 **GitHub API**（`gh api` 的 Git Data 接口：blobs → tree（`base_tree` + 改动路径，
  模式取 `git ls-tree` 的真实值，**不能写死 100644**）→ commit → PATCH ref）把工作推上去；
  **每个提交都校验 `tree` SHA 与本地一致**才更新 ref。
- 结果：远端 `refs/heads/main = 51a276a`，其 **tree 与本地 `13288a6^{tree}` 逐位相同**
  （`ab9b297`）✔；但因为它落在中断之后，**远端是两个本地提交合成的一个提交**
  （消息取的是后一条 = HANDOFF §5.16 那条）。
- 本地仍保留**两条提交的详细历史**（`8720eba`、`13288a6`），
  并已推到一个**持久盘裸镜像** `/mnt/hdd/octave-wasm-build/mirror-Octave-Full-Wasm.git`
  （remote 名 `mirror`）—— 网络恢复前它就是"已落盘"的凭据。

**下一次要先做的对齐**（否则 `git push` 会因 non-fast-forward 被拒）：
```bash
git fetch origin && git reset --hard origin/main   # 工作区当时是干净的；内容与本地逐位相同
```
（想保两提交的形状，可先用 `git push mirror main` 确认镜像里有，再对齐。**不要 force-push**。）

> **✅ 2026-09-23 晚：网络恢复，已对齐并推送**（本条替代上面那段"下次要先做"）：
> `github.com` 又能连了（`git ls-remote origin` 正常、`git push` 直连成功）。
> 当时的实况与处置：
> 1. 远端 `main` 是 `db01c41`，它的 **tree 里没有图形线那批**（只有 `accept-p5-osmesa.mjs`，
>    没有改名后的 `accept-p5-graphics.mjs`）—— 因为图形线的活一直只在 `graphics-webgl` 分支上，
>    main 从未合过它。
> 2. 我的新提交**以 `origin/main` 为父**（`git commit-tree <我的 tree> -p origin/main`），
>    于是推送是 **fast-forward**：`db01c41..69968ad`，把**图形线全部 + 本批**一起带进 main。
>    核对过没有丢东西：远端有、我没有的文件**只有** `accept-p5-osmesa.mjs`（那是**改名**掉的
>    `accept-p5-graphics.mjs` 的前身）。
> 3. 本地 `main` 已 `git branch -f main 69968ad` 与远端对齐（旧形状的提交仍在
>    `graphics-webgl` 与持久盘镜像里，**没有删任何对象**）；`graphics-webgl` 也推到了 `69968ad`。
> 4. **持久盘镜像 `mirror` 的 `main` 仍是旧形状（`9b211ae`）**，动不了它（把它提到新形状会被判
>    non-fast-forward，而**不许 force-push**）。**内容不缺**：新的那棵树在镜像里的
>    `refs/heads/graphics-webgl`（= `d03331e`，tree `183b65ca…`）上。
> 5. **下次接续**：正常 `git push origin main` 即可（网络好着）；若 `github.com` 又被拦，
>    照上面第一段走 GitHub API，**别 force-push**。

---

### 5.18 图形线 WebGL：**换成 gl4es → WebGL2（GPU），步骤①②③ 全部打通**（2026-09-23 晚）

**起因**：OSMesa 是**纯软件光栅化**（CPU 逐像素），手机上速度/体积都吃力。
⚠️ **口径要准**：OSMesa **不是**"手机上不能跑"（它不碰 GPU/API，任何 wasm 浏览器都能跑），
问题是**量** —— 速度与体积。这条动因成立，但"手机端速度"**至今没量过**（本仓无手机环境）。

**结论：打通了，而且体积大赚。**

| | 值 |
|---|---|
| 8768（`siteWebGL`）全量回归 | **32 套 / 838 PASS / 0 FAIL（全绿）** |
| 8768 图形验收 | `accept-p5-graphics.mjs` **54 PASS / 0 FAIL**（与 OSMesa 站点同一套件） |
| 逐图类型 | **15/15 非空白**（plot…surf，解码 PNG 数颜色 9–740 色） |
| `octave.wasm` | OSMesa **45,580,621** → WebGL **36,725,241**（**省 ~8.9MB**；比基线只 +2.4MB） |

**做法一句话**：把"GL 垫片"从 OSMesa 换成 **gl4es**（`ptitSeb/gl4es`，OpenGL 1.5/2.1 → GLES2，
**官方带 Emscripten 目标**）。它自己实现立即模式 —— 而 emscripten 自带的
`LEGACY_GL_EMULATION` 在这件事上是**实测失败**的（Edge-Tools 死在 `numVertices must be an integer`
at `glEnd`）。实测：`gl4es-smoke` 在真 Chromium 里 **16 PASS / 0 FAIL**（立即模式绿三角逐像素）。
覆盖度也量过：Octave 要的 **76 个 GL 符号，gl4es 76/76 全覆盖**。

**一手记录**：`build/113/NOTES-webgl.md`（**接手先读它**，含四个坑与复现命令）。
`build/113/GRAPHICS-BRANCH.md` 顶部有指针。

**四个坑（都在 NOTES §4.3，别再踩）**：
1. `config.h` 不只"要 include"，**位置**也必须在所有 include 最前（放后面撞
   `oct-conf-post-public.h` 重复定义）。
2. GLU 要带 **wasm-SjLj** 重编（libtess 用 longjmp；否则 `R_WASM_TABLE_INDEX_SLEB` 报
   `emscripten_longjmp` 不能当目标 —— 与 OSMesa 线同坑同修法）。
3. `gl-render.cc` 直接引用的 GL 符号是**裸名**（量出来：`glGetIntegerv`×1 + `glu*`×10），
   要加 `gl4es-unmangled-shim.c` 转回 gl4es。
4. gl4es 的 getter 会把 **WebGL 不认的枚举**原样转发（`GL_SAMPLE_BUFFERS`/`GL_SAMPLES`、
   `GL_LINE_SMOOTH`）⇒ `patch-gl4es.sh` 让它们从 gl4es 自己的状态回答。

**两条后端并存可切**：`osmesa_toolkit.cc` 与 OSMesa 那条链的旗标**一字未改**；
`link-web.sh` 用 `GL_BACKEND=webgl` 选后端。验收套件按站点**自动选**后端
（`webgl` → `osmesa`），两个都没有就明确 SKIP（8761 基线因此保持全绿）。

**分支拓扑**：`main`(9b211ae) → `graphics-osmesa-p5`(c9ad754) → **`graphics-webgl`**（本线）。
`main` **未动**。

**★ 速度实测（2026-09-23，桌面 + CDP 降频 + 真 GPU，见 `NOTES-webgl.md` §4.5）**：
- **渲染器确实快了**：`getframe`（必然重渲）2D 17→**5 ms**、3D 62→**7 ms**（真 GPU，CPU×1）；
  CPU 降频 4× 后 72→18 / 253→26 ms ⇒ 纯渲染 **快 3.4×（2D）/ 8.9×（3D）**。
- ⚠️ **必须先确认 WebGL 跑在哪**：headless 默认是 **SwiftShader（软件）**，
  要加 `--use-gl=angle --use-angle=gl` 才是真 GPU（本机 RTX 4060）。
- ★★ **但端到端几乎没差别**：`figure; clf; surf(peaks(40)); drawnow` 是 **OSMesa 2137 ms
  vs WebGL 2111 ms**。拆开看：`drawnow` 只 **+7 ms**、`getframe` **12 ms**，
  而 **`surf(peaks(40))` 自己就 ~1.9 s**（核心 `surface()` 同数据只要 **45 ms**）。
  ⇒ **瓶颈在 plot 桥的 3D 路径，不在渲染器**（差两个数量级，换平台也成立）。
  **下一步最值得做的是把桥那 1.9 s 拿掉**，不是继续抠渲染器。

**还没做**：① **真机**速度（桌面 GPU 降不了频，4060 远强于手机 GPU ⇒ 上面的数字对手机是乐观的）；
② **把 plot 桥 3D 路径的 ~1.9 s 拿掉**（§4.5.3，现在优先级最高）；
③ 与 OSMesa 的逐图**结构性对照**；
④ 上线体积账（WebGL 只 +2.4MB，比 OSMesa 好谈得多，但仍未上 8761）；
⑤ 文字渲染仍缺（`--without-freetype`，刻度/title 空白但不崩）。

---

### 5.19 `android-emulator` 插件：**在这台 Linux 上真能跑**（2026-09-23）

**问题**：想知道"图形后端在手机上到底行不行"。
**结论**：插件**能用**，但**它验不了 WebGL**（下面有原因）——所以"手机端速度"仍只有
桌面 + CPU 降频 + 分辨率标定那条间接证据（见 `NOTES-webgl.md` §4.5）。

**先更正我自己的两个错说法**（当时只看名字没核对）：
- ❌ "技能没注册、调不到" ⇒ 错。用插件限定名 `android-emulator:android-dev` 能加载。
- ❌ "没有 `mcp__android_emulator__*` 工具" ⇒ 错。工具在，名字是
  `mcp__plugin_android-emulator_android-emulator__<tool>`。

**`android_preflight` 的 Host OS 那行永远是红的，但它不拦事** —— 源码 `preflight.js:24`
就是个 `ok:` 布尔，**没有任何 gate**。所以装好工具链就能用。

**装在哪（全在 /mnt/hdd，约 2.8 GB）**：

| | 位置/做法 |
|---|---|
| JDK 17 | `/mnt/hdd/android-dev/jdk17`（Azul Zulu 17.0.13；Adoptium 会跳到被封的 github，用 Azul CDN）|
| Android SDK | `/mnt/hdd/android-sdk`（cmdline-tools + platform-tools + emulator + `system-images;android-35;default;x86_64`）|
| AVD `medium_phone` | 盘像也在 hdd：`~/.android/avd` → `/mnt/hdd/android-avd` |
| **免重启**让插件找到 SDK | `~/Android/Sdk` → 软链到 `/mnt/hdd/android-sdk`（插件 `sdkRoots()` 认这条路径；不用改配置、不用重启 ZCode）|
| **免重启**让插件找到 Java | SDK 的 `cmdline-tools/latest/bin/java` 放个 3 行 shim（插件在非 Windows 上 `javaHome()` 只认 macOS 路径、永远返回 undefined；而 `androidEnv().PATH` 必含这个目录）|

**实测**：模拟器 `emulator-5554`（Android 15 / API 35）起来了，截图 / adb / logcat 全通；
站点在里面**正常启动**（Octave 资产全加载）。探针走 `index.html?bench=1&tk=…`，
输出经 `console.log` → `adb logcat`（**Android WebView 没有 DevTools，这是唯一自动化取数通道**）。

| 后端 | 2D line | 3D surface | 端到端 surf+drawnow |
|---|---|---|---|
| OSMesa | 28.0 ms | 94.0 ms | 1831 / 1914 / 2038 ms |
| WebGL | **建不出上下文** | — | 1755 / 1960 / 1836 ms |

两个结论：① **端到端 ~1.9 s 在 Android 上原样复现**（桌面 2111/2137）⇒ 瓶颈在桥、换平台一样；
② **模拟器验不了 WebGL**：`eglCreateContext: EGL_BAD_CONFIG (0x3005)` +
`ContextResult::kFatalFailure: WebGL1 blocklisted`（模拟器的 GL 是 "Android Emulator
OpenGL ES Translator"，被 Chromium 拦）。toolkit 已改成属性**逐级退让**（ideal → 关抗锯齿 →
不保绘制缓冲 → emscripten 默认），真机上 config 受限的机型需要它。

### 5.20 ★ plot 桥的 1.7 s：已归因、已提速 3.5×；"跳过管线"那条路**走不通**（2026-09-23）

**为什么重要**：实测 `drawnow` 只花 **7 ms**、`getframe` **12 ms**（渲染），而用户写的
`figure; clf; surf(peaks(40)); drawnow` 要 **2111 ms**（WebGL）/ **2137 ms**（OSMesa）——
**瓶颈一直在 plot 桥，不在渲染器**。换 WebGL 后端省的是那十几毫秒。

**归因（`test/browser/probe-bridge-cost*.mjs`，全部实测）**：`surf(peaks(40))` 共 **1686 ms**
= `__pb_surface__` 建 **1521 条 series**（39×39 单元各一条）1386 ms（其中 `save -ascii` 写
1521 个小文件 306 ms；写 1 个含 1521 行的文件只要 1 ms ⇒ **成本在条数不在数据量**）
+ `__pstate__` 两次 emit ~390 ms。**与镜像无关**（切成 `web` 后仍 1705 ms）。

**走过的两条路**：

1. **"真渲染器在线时跳过桥的数据管线"** —— 实测 **1686 → 439 ms（3.8×）**，
   **但走不通**：`print -dsvg` 会红，因为它**唯一**依赖桥自己那份 SVG。
   顺藤摸到两层墙（都是实测）：
   - `HAVE_GL2PS_H` 是 undef ⇒ **已补**：`build/113/build-gl2ps.sh`（源码走 Debian pool，
     上游 geuz.org 连不上、github 被拦）+ `configure-113-full.sh` 的 `WITH_GL2PS=1`
     （默认关）+ `link-web.sh` 自动链 `libgl2ps.a`。**重建后 gl2ps 确实进树了**
     （`checking for gl2ps.h... yes`、`gl2ps-print.o` 引用 14 个 gl2ps 符号、0 个未定义）。
   - **但还有第二层**：`print -dsvg` 的错变成
     `print: failed to open pipe "| cat > \"…\""` at `__opengl_print__.m:204`
     —— Octave 把 gl2ps 的输出**穿过 shell 管道**落盘，而本构建**故意没有 shell**
     （`system`/`unix`/`popen` 是有意报错，也是"纯客户端计算"铁律的一部分）。
     `-dpdf/-dps/-deps` 另需 gs。⇒ **核心 print 出矢量不是补一个库能解决的**；
     "跳过管线"在当前架构下**不可达**（除非做只认 `cat > f` 的假 popen —— 与铁律冲突，不做）。
     gl2ps 仍留在树里：把"gl2ps 缺失"这层永久去掉，将来只剩 popen。

2. **★ 改在桥内部：让 series 变少**（`__pb_surface__.m`，**这条落地了**）
   | | 原来 | 现在 |
   |---|---|---|
   | `surf` | 每单元一条闭合多边形 = 1521 条 | **每条行带一条** = 39 条 |
   | `mesh` | 每单元一条四点轮廓 = 1521 条 | **行折线 + 列折线** = 80 条 |

   遮挡不变：`depth` 对行号单调 ⇒ 按行排序 ≡ 按单元排序。
   **实测 1686 → 480 ms（3.5×）**（剩下的 480 ms 基本是镜像的两次 `path` 手术）；
   在 `web` toolkit 的站点上（桥是显示路径、无镜像）省的是**全部 ~1.7 s → ~50 ms**。
   **渲染改动人工看过图**（`probe-bridge-svg-out.mjs` 把桥自己的 SVG 抠出来渲成 PNG）：
   surf 带状形状/遮挡正确（如实记：非仿射投影下逐行直边与逐单元边在边缘有极细错位）；
   mesh 是经典线框、横竖都在，观感更干净。

**连带的测试改动**：`accept-plot3d.mjs` 原来断言"mesh 11×11 ≥100 条折线 / surf 9×9 ≥64 个面片"
——那是**旧实现**的元素数。已改成按 **m+n（网格线框）/ m−1（行带）** 推出来的期望，
并在文件里写清为什么。改前 29 PASS / 5 FAIL，改后 **34 PASS / 0 FAIL**。

**还没做**：① 桥剩下那 480 ms（镜像的 `path` 手术；要回到句柄缓存方案，但得处理
`pie`/`contour` 会嵌套调 `axis` 的情况）；② 手机端真机速度（模拟器验不了 WebGL，见 §5.19）；
③ 上线体积账；④ 文字渲染仍缺（`--without-freetype`）。

---

### 5.21 ★ 图形线收口：桥句柄缓存 → `webgl` 变默认 → 砍 OSMesa（2026-09-23）

一手记录在 **`build/113/NOTES-webgl.md` 的 §4.5.13 与 §4.6**（含复现命令与探针）。这里只给接续
必须知道的。

**（1）plot 桥的镜像层：两次 `path` 手术 → 一次性句柄缓存 + 深度转发。**
`build/plotbridge/__pb_core__.m`（新）+ `__pb_in_core__.m`（新）+ 31 个 shim 的**前导**
（由 `build/plotbridge/insert-core-forward.py` 幂等插入）+ 重写的 `__pb_mirror__.m`。
- 机制：**一次** path 手术把 31 个核心函数 `str2func` 缓存起来，之后永不再动 path；核心调用
  期间 `DEPTH>0`，被桥挡住的名字**逐个转发回核心**（等价于旧"整条摘 path"，但不必枚举
  核心内部调了谁）。**危险点**：DEPTH 必须在错误路径复位（`unwind_protect_cleanup`），
  否则此后所有桥函数静默转给核心、桥的状态再不更新 —— 验收里有专门一条钉它。
- **实测（8768/桌面，A/B 同站点）**：镜像一次 **146.2 → 1.5 ms（~97×）**；温
  `figure; clf; surf(peaks(40)); drawnow` 从 405/391/396 → **101/93/88 ms（4.2×）**。
- ★ **更正 §5.20 的归因**："剩下的 480 ms 基本是两次 `path` 手术"是**错的** —— 端到端那个数
  被**冷启动**盖住了（首次 clf/surf/drawnow 合计 ~0.6 s：建上下文 + `initialize_gl4es()` +
  编 shader + 首帧 `glReadPixels`/PNG）。量的时候**冷/温必须分开**。
- ★ **两个必须知道的 Octave 行为**（实测）：① **输出个数检查发生在函数体之前** ⇒ shim 声明的
  输出个数必须 ≥ 核心实现的，否则转发那段**根本进不来**（为此加宽了 10 个 shim）；
  ② 加宽之后桥自己的路径上 `xlim()`/`axis()` 之类**从报错变成返回空**（放宽，不是回归）。
- 验收：`accept-p5-graphics` **64 PASS / 0 FAIL**（54 → 64，新增 10 条）。

**（2）`webgl` 变默认 toolkit + `FULL_ES3` + OSMesa 退役。**
- `build/webgraphics/PKG_ADD`：有 `webgl` 就选它（**开箱即真渲染**），否则退回 `web`。
- `link-web.sh`：`GL_ES_FLAGS = -sFULL_ES2=1 -sFULL_ES3=1`（**ES2 是 gl4es 的要求；ES3 是加试项** ——
  上下文本来就是 WebGL2，ES3 管的是 emscripten 那层 GLES3 模拟；实测 +9,291 字节、全绿，故保留）。
- OSMesa 退役：删 `build/113/` 的 7 个文件（toolkit/stubs/两个 smoke/patch 脚本）+ 容器里的同名件；
  `link-web.sh` 只剩 webgl 一条（给别的 `GL_BACKEND` **明确失败**并指路 `graphics-osmesa` 分支）；
  `main.cc` 去掉 `P5_OSMESA_TOOLKIT`；`__pb_real_renderer__` 白名单 → `{"webgl"}`；
  `p5canvas.js` 的 `BACKENDS=['webgl']`（删 `useOsmesa`）；`accept-p5-graphics` 后端清单 → `['webgl']`。
- ★ **连带发现（不是 bug）**：镜像层一开，桥里**比核心宽容**的调用会真的走到核心 ⇒ 核心的严格性
  浮出来。实测 `plot(x,x,'+','')`（末尾空串）**桌面 Octave 本来就报**
  `plot: properties must appear followed by a value`；`accept-print` 里那条用例已改成合法写法。
- ★ **另一条测试自身的坑**：默认换成真渲染器后，会话**第一次建 axes** 会打一条 FreeType warning
  **带 6 行调用栈**（既有偏差）。两个套件的 `ev()` 把输出**截断到 200 字符再匹配**，于是
  `plot/print 仍可用`（want=`'2'`）在 `accept-dldfcn`/`accept-forge2` 各**假红**一次。
  已改成"**匹配用完整输出、只有显示才截断**"。**同类写法在别的套件里还有**（见 §8 待办 8）。

**（3）编译期 GL 头：Mesa → gl4es+GLU**（OSMesa 退役后最后一处隐藏依赖）。
新脚本 `build/113/gl-headers-webgl.sh`：组装 `/src/deps/glheaders-webgl/include/GL`
（gl4es 的 gl.h/glext/glx + **GLU 自己那份不改名的 glu.h**），再把 `/src/deps/glshim/include`
变成**指向它的软链** ⇒ 编译命令行**逐字不变**（ccache 不整片失效、automake 只重编真正依赖 GL 头的
**3 个 TU**：`gl-render`/`gl2ps-print`/`__init_fltk__`）。实测重编后 `gl-render.o` 里裸 `glGetIntegerv`
变成 **`gl4es_glGetIntegerv`**、**一个裸 `gl*` 都不剩**（`glEnd`/`glVertex3f`/… 全没了），`glu*` 10 个
仍是裸名（由 libGLU.a + `gl4es-unmangled-shim.c` 提供）。链接结果中性、wasm 36,858,059。
**还原一行**：`bash /src/bin/gl-headers-webgl.sh --revert`。

**（4）顺手补的链接自检**：`link-web.sh` 末尾查**产物**（必须含 `gl4es_gl*`、必须**不含**
`OSMesaMakeCurrent`、toolkit .o 里必须有 `gl4es_gl*`）—— 因为 `ERROR_ON_UNDEFINED_SYMBOLS=0`
会把未定义符号静默放过（历史踩过：链接"成功"、运行期第一次 GL 调用才炸）。

**（5）上线（8761）**：新增 **`build/promote-webgl.sh`** 把"部署带 GL 的那份"固化下来
（备份 → 容器内 `out/`→`out-nongl-bak/`、带 GL 的产物→`out/` → 三大件 + 桥文件 + 资产重打 +
清单刷新 + **自检**：两侧 wasm sha 一致 / 桥资产含 `__pb_core__` / webgraphics 是新 PKG_ADD /
`p5canvas.js` 在 / wasm 含 `gl4es_gl`）。`build/recover.sh` 也补了两处：拷贝清单**补上
`p5canvas.js`**（此前漏了 ⇒ 新 `index.html` 会 404）、大件来源加 `SRC_OUT` 变量。
实测：wasm sha `6c75a4942df286826f8f02c1…` 两侧一致；**8761 全量 32 套 848 项全绿**；
体积账见 §8 待办 3 的表。**回退点**：`site-prewebgl-bak/` + 容器 `out-nongl-bak/`。
★ **顺带修掉一个潜在坑**：promote 之前容器里的 `/src/websrc/out/` 其实是一份**过期**构建
（`octave.js` 785,187 / `octave.data` 13,829,164 = **`@ftp` 预载修复之前**那份），而
`recover.sh` 正是从那儿取三大件 ⇒ **断电恢复会把 8761 悄悄退回旧构建**。
现在 `out/` 与部署件**逐字节一致**（`octave.wasm`/`octave.data` 的 sha256 两侧相同）。

**（6）本批改动清单（供审阅）**
新增：`build/plotbridge/{__pb_core__.m,__pb_in_core__.m,insert-core-forward.py}`、
`build/113/gl-headers-webgl.sh`、`build/promote-webgl.sh`、
`test/browser/probe-bridge-mirror-cost.mjs`。
修改：`build/plotbridge/` 的 32 个 `.m`（31 个 shim 加前导 + mirror 重写）、
`build/webgraphics/PKG_ADD`、`build/113/{link-web.sh,configure-113-full.sh}`、`build/main.cc`、
`bridge/{p5canvas.js,index.html}`、`build/recover.sh`、
`test/browser/{accept-p5-graphics,accept-t2-graphics,accept-print,accept-dldfcn,accept-forge2,accept-net,probe-gfx-bench}.mjs`、
`dist/DEPLOY.md` + 五份文档。
删除（历史在 git）：`build/113/` 的 7 个 OSMesa 件。

---

### 5.22 胶水层架构审计：候选 3/4/1 落地（2026-09-23）

缘起：用户要"审一次我们自己的胶水"（Octave 本体不动）。三个并行探查 + 逐条复跑，
产出 6 个候选（报告在 `/tmp/architecture-review-20260923-100919.html`）。按依赖顺序做，
**一件一提交、每件在 8768 上验**。第一个落地的不是候选、而是**文档自更新机制**（见 §0 与
`.githooks/`）：HANDOFF 文末 `AUTO:STATE` 由脚本从产物重算，活状态断言与产物矛盾会被
pre-commit 拦下 —— 它当场就抓出 6 处真实腐烂（头部还写着"31 套 784"、`github.com` 被拦
的过期说法、§6 的 7.2 时代套件清单…）。

**候选 3 · 把早就写好、却从没人跑的 `%!test` 接进验收**
`webfile` 10 个 + `pkgfix` 4 个文件里本来就有断言，而全仓 `test/browser/*.mjs` **一次都没
调过 Octave 的 `test`**。新增 `build/glue-selftest.m`（**目标名单单一真源**，脚本式所以能
被浏览器 `eval_string`）+ `build/glue-selftest.sh`（宿主，秒级）+ `accept-selftest.mjs`（进
sweep）。**当场抓到一条真 bug**：`__wf_basename__("/")` 返回 `""` 而实现里另有一段想返回
`"/"` 的**死分支**（文档与代码自相矛盾）；孪生 `__pkgfix_basename__` 同一毛病（断言没覆盖
`/` 所以一直没露）。按"我们的 bug 就改代码"修掉两份。实测：宿主 **36/36**、
8768 `accept-selftest` **24/24**。**只 webfile/pkgfix 带 %!test** —— 其余胶水目录一个都没有。

**候选 4 · 面板字段表与调色板各收成一处声明**
字段集合原来写在四处（初始化/摘出/放回/新轴重置，emit 是第五处），加字段漏一处就是静默
状态泄漏 ⇒ 新增 `__pb_fields__.m`（一张表：名字/默认值/新轴是否重置），四处全部改成派生；
顺带在表里写清**刻意不在表里**的字段（`n` 必须跨面板单调，混进去会让 `/tmp/pbN.dat`
互相覆盖）。调色板三处各抄一份 ⇒ 新增 `__pb_palette__.m`，并**删掉 `__pb_cycle_color__.m`**
（1 个调用者的浅 module）。**又抓到一条真 bug**：`/tmp/pb_spec.json` **不是合法 JSON**
（`__pb_emit__` 从来没写过开头的 `{`），而它唯一的读者 `octplot.html:127` 直接
`JSON.parse` ⇒ **那个 PoC 页每次打开都在抛异常**，没人发现，因为没有任何套件碰这条 seam。

**候选 1 · 无 GL 设备的显示回落（并把那条死掉的第二渲染路径删掉）**
实测（可复现）：`--disable-webgl` 的 Chromium 里 `plot(...); drawnow` **不报错、MEMFS 里
没有 PNG、页面空白**。修法不是"让 toolkit 硬撑"，而是承认它出不了像素：
① toolkit 落 `/tmp/p5_nogl.txt` 信号（`build/113/webgl_toolkit.cc`）；
② `__pb_real_renderer__` 据此判定"没有真渲染器"（**选中了 toolkit ≠ 它出得了像素**）；
③ 桥用**已有的** `__svg_render__`（`print -dsvg` 那个，仓库里最被测过的渲染器）渲 SVG，
   页面采样后贴成 `<img>`（`show()` 按扩展名定 MIME —— 以前写死 `image/png`，贴不了 SVG）。
删除：spec JSON 出口（`__pb_emit__.m`）、`bridge/plotbridge.js`、`bridge/octplot.html`
—— 那条路的读者只有 PoC 页，而"无 GL 也要看得见图"现在由 SVG 回落承担，**一个渲染器
替代了两个**；字段表的 `spec_key` 列随之消失。顺带把 `__pb_real_renderer__` 里那条
"真渲染器在线时跳过数据管线"的**错误注释**改写清楚（照它做会把 `print -dsvg` 和回落一起
废掉 —— 审计把这条列为"注释带偏维护者"的实例）。

**代价（实测，宿主 Octave）**：渲一张 SVG = 直线 **31.7 ms** / `surf(peaks(40))`
**437.5 ms** / `contour(peaks(20))` **384.5 ms**。所以**没有**跟着每个绘图命令推一次，
而是"桥写便宜修订号 `/tmp/pb_rev.txt` + 页面 250 ms 采样"—— 代价与命令数无关，
渲染次数由采样率决定。

**验收**：宿主 36/36；8768 `accept-p5-fallback` **15/15**（含"前提：本机真的没有 WebGL"、
信号、判定、SVG 图元与文字、页面 blob、第二次绘图更新、`print -dsvg` 不受牵连）、
`accept-p5-graphics` **65/65**（新增"GL 在线时不再产 SVG 回落"）、`accept-selftest` 24/24、
`accept-plotv2` 54 / `accept-plot3d` 34 / `accept-print` 43 / `accept-t2-graphics` 26 全绿。

**候选 5 · 播放状态机收成一个 module（并先修掉一个实测 bug）**
审计里唯一的**实测行为缺陷**：`resume` 把 44100 立体声播成 8k 单声道 —— 根因是两侧各一半
（`.m` 侧只入队播放位置、JS 侧把 rate/channels 写死成 8000/单声道），而套件里唯一的 resume
断言用的恰好是单声道 8k 的素材，**与默认值巧合掩盖了它**。先单独提交修掉（入队按 play 的
`[from,to,rate,nch]` 形状带全参数）+ 加断言（读入队那一行 = 两侧唯一的接口，实测
`0 44100 2`）。随后新增 `build/webaudio/__pba_transition__.m`：**只有它写那六个状态字段**
（play/pause/resume/stop/tick/finish + 一个只回报时长的 duration），六个 `__player_*` 保留
原签名只做 dispatch（diff **−68/+21 行**）。顺带修掉旧洞：`play` 没清 `PausedAt` ⇒
`play; pause; play` 之后 `CurrentSample` 会算成负数。**回报**：状态机第一次能脱离浏览器测
（`%!test` 覆盖全套迁移 + 两个 no-op 边界），并接进了宿主/浏览器的自带测试名单。

**候选 2 · MEMFS 队列："协议无关部分"收成一个 primitive + 行漂移测试**
四个宿主桥各自实现同一形状（追加一行 → 页面读走清空 → 结果写回），"取 fs 的守卫"抄了五遍、
`readQueue` 抄了三遍，而**没有一处声明过行格式** ⇒ 已经漂移两次。新增 `bridge/queue.js`
（`window.OctaveQueue`：取 fs / 读走清空 / 按制表切分，仅此三件），四个桥改用它，
**各自的 codec 仍留在本文件**并把行格式写成可执行的声明（导出的 `parseLine`）。
新增 `test/browser/accept-queue-drift.mjs` **12/12**：从 Octave 侧用**真的生产函数**入队，
用页面侧**真的解析函数**读回比对 —— 包括 **ufp 走真的 C++ 生产者**（C++ 与 JS 两种语言之间
最该测的一条）。**不上生成器**（审计结论 a+c）：把四种 codec 合成一个对象等于把字节布局从
生产者旁边搬走，拿 locality 换行数；测试是更便宜的接口证据。
★ **顺带查出一处真部署缺口**：`bridge/webnet.js` 一直被部署、却**没被 `index.html` 加载**
（而 `accept-net` 的注释以为站点会加载它 ⇒ 只有那个自己注入脚本的测试里它才存在）。
已补上 `<script>` 并更正注释（`urlread` 那类**同步**网络不依赖它 —— 那次入口自包含在
`webnet.cc` 的内联 JS 里）。

**候选 6 · 删掉会引人犯错的死字段；"7.2 残留"查清其实是对的；加一致性闸门**
 · 清单里的 `run` 字段：声明"加载时请手动执行 PKG_ADD"，而**加载器从来不看它**，
   而 `assets-loader.js` 恰好有一段注释**警告别手动跑**（会让 `imformats("add")` 这类注册
   重复执行）⇒ 是个陷阱字段，已从两个 emitter 删净（并写明"别再引入"）。
 · `build/Makefile` 的 `OCTAVE_VER = 7.2.0`：审计列为"7.2 残留"，**实为误读** —— 它是
   **7.2 车道的上游配方**（`rwl/octave-wasm`），11.3.0 容器里根本没有这个文件（重链走
   `build/113/link-web.sh`）⇒ 加说明而非改路径（改了反而错）。
 · 新增 `.githooks/check-consistency.py`（pre-commit + pre-push）：挂载根三处是否一致
   （实测 `main.cc` 的 18 条路径都在 `/usr/src/octave/m` 下）、`index.html` 启动清单的 14 个
   名字是否都在清单里（站点读不到就明确跳过）、11.3.0 车道里是否混进 `/7.2.0/` 路径
   （`build/Makefile` 例外且有说明）。
 · **一处没按 Q8 的答案做**：启动清单**没有**改成"从 manifest 派生" —— 那份清单不是数据而是
   产品决策，`index.html` 里它带着三段注释解释"为什么这些要随页面装"；派生只能把理由挪走或
   丢掉，而防名字拼错的收益已被检查拿到，且不必碰启动路径（最容易把整站搞挂的地方）。

**踩坑记（两处，都值得记）**：
 · **`{函数调用}` 在 Octave 里不是合法 cell** —— `{struct ("a", 1)}` 会掉进命令语法
   （`{sin (1)}` 实测把 sin 的帮助打出来）。`__svg_panel_boxes__.m:24` 早就记过这条，
   我又踩了一遍；现在 `__pb_publish__.m` 的注释直接互指那条。
 · **`%!error <pat> code` 不能写在 `%!test` 块里** —— 框架当普通语句执行，失败只印
   `<K` 这种没头没尾的信息；错误用例要单独起 `%!error` 块。
 · 还有一条**真竞态**：浏览器里页面轮询器也会写回落文件，所以"publish 在有 GL 时是
   no-op"这条性质不能在 `%!test` 里断言（会随机红）—— 改到"没有别的写者"的
   `accept-p5-graphics` 里断言。

---

## 10. 第四轮实况：Octave 11.3.0 已落地（2026-09-22）

> **§9 是当时的计划，本节是实际做出来的结果。接续请以本节为准。**
> 全部结论都有实测；细节另见 `build/BASELINE-11.3.md`（外部事实）、
> `build/113/`（脚本与三份 NOTES）。

### 10.1 现在是什么状态

| | **8761（当前基线）** | 8762（同一内容的第二个入口） |
|---|---|---|
| 内容 | **Octave 11.3.0**（wasm sha `11f6175a…`） | 同左 |
| 站点目录 | `/mnt/hdd/octave-wasm-build/site` | `.../site113` |
| 容器 | `o113`（`emsdk 5.0.7`，Ubuntu 24.04）；`obuild`/`odld`/`obench` 保留作回退 | 同左 |
| 验收 | **30 套 757 项全绿**（2026-09-23 实测；8762 未复跑本轮）—— **SLICOT 上线后是 31 套 784，见 §5.15** | 同左 |

**7.2 的回退快照**：`/mnt/hdd/octave-wasm-build/site-72bak/`（90M，160 个文件）。
`cp -a site-72bak/. site/` 即可回退内容。

**28 套的构成**（`http://127.0.0.1:8761/` 与 `8762` 上各跑一遍都全绿；逐套实测见
下；`accept-113-pkgoct` 的自有汇总格式是「27 个模块：OK 27」，不是 `PASS/FAIL` 那套）：

- **11.3.0 侧 6 套**：`accept-113-boot` 10、`accept-113-oct` 8、`accept-113-assets` 16、
  `accept-113-libs` **17**（含稀疏 `lu` 的六个形态）、`accept-113-ode15` **29**
  （含 5 条 `lsode` 断言 —— 2026-09-22 修好，原先那 1 项"已知缺陷"已转正）、
  `accept-113-pkgoct` **27**。
- **图形句柄（T2）**：`accept-t2-graphics` **26**（`web` toolkit：figure/gcf/gca/get/set/title/close）。
- **需求级**：`accept-requirements` **14/14**。
- **7.2 时代的 19 套**（全部在新内容上复跑通过）：
  `accept-full` **20**、`accept-hdf5` 16、`accept-forge` **22**、`accept-forge-oct` 15、
  `accept-forge2` 42、`accept-dldfcn` 68、`accept-ode15` 14（项数不变 —— 那条 `lsode` 从"只查 `exist`"**换成**了真调用）、`accept-archive` 20、
  `accept-image` 17、`accept-print` **43**、`accept-plotv2` **54**、`accept-plot3d` **34**、
  `accept-audio` 47、`accept-net` 30、`accept-help` 12、`accept-fileops` 20、
  `accept-pkg` 16、`accept-input` 9。

**本轮（2026-09-22 第二轮）做完的事**：

- **待办 1 ✅ SUNDIALS → 真 `__ode15__.oct`**：不再是桩。ode15s/ode15i 实测跑通，
  `accept-113-ode15` **29/29**。**主 wasm 一个字节没动**（sha256 前后一致），
  SUNDIALS 的静态码整个打进了 `.oct`（250195 字节）。提交 `459ddd1`。
- **待办 2 ✅ 27 个包 `.oct` 按 11.3.0 重编**：`accept-113-pkgoct` **27/27 零 trap**
  （含真跑 libsvm）。提交 `3cbb81a`。旧件备份在
  `/mnt/hdd/octave-wasm-build/octdir-72bak`。
- **待办 3 ✅ `accept-print` 测试自身崩溃的病修好了**：两层根因 —— ① `svgCheck` 的
  失败分支返回的对象没有 `texts` 字段却无条件 `.some()`；② **更关键**：这套没等
  `window.__octaveReady`，在 plotbridge 挂上前就断言。两层都修完 43/43。
  `accept-plotv2`/`accept-plot3d` 是**同一个病**，一并修好（54/54、34/34）。
- **待办 4 ✅ 稀疏 `lu`（UMFPACK）根因查明并修好**：建 SuiteSparse 时**漏传
  `-DNBLAS`（和 CHOLMOD 的 `-DNSUPERNODAL`）**，UMFPACK 去调本仓那套 **f2c 转出来的
  BLAS** → ABI 错位踩内存 → 整页 trap。证据：7.2 vendored 的 SuiteSparse 树相对干净
  tar 包只有 3 处人工改动，前两处正是这两个开关；`libumfpack.a` 的 BLAS 未定义符号
  **10 → 0**。`accept-113-libs` 11/12 → **17/17**。提交 `52489ab`。
- **待办 5 ✅ 换基线到 8761**（本节的核心）：8761 现在服务 11.3.0。
  换之前先补了一组**关键证据**——把 7.2 时代的 19 套全部指向 11.3.0 内容跑一遍，
  发现 5 处不对齐（2 处是测试自身的病，3 处是"7.2 站点有、site113 没有"的**内容缺口**）：
  `dldprobe.oct`（探针，源码此前从未入仓 → 已补 `build/113/dldprobe.cc` 并用
  `build-oct.sh --cc` 重编）、`lanetest` 资产、以及 **`m/forge` 的 20 个预装 .m**
  （7.2 的主链把 `vendor/` 预装进了 `octave.data`，11.3.0 的 `link-web.sh` 漏了它 →
  `normpdf` 从"开箱即有"变成"要加载 statistics 资产"，**是行为回退**；文件集已入仓
  `build/forge-preload/` 并由 `link-web.sh` 预加载）。
  换完之后这些套件在 8761 上复跑全绿（补上 T2/T6/T7/T8/P1 后，**2026-09-23 实测 30 套 757 项**；
  再加 SLICOT 那一套与护栏翻正后为 **31 套 784**，见 §5.15）。
  清单与决策记录见 `build/113/PROMOTION.md`。
- **新查出 1 个两代基线共有的缺陷**：`lsode` 调用即整页 trap（见 10.6 第 6 项与
  `build/113/NOTES-lsode.md`）。**7.2 上同样存在，不是换基线引入的。**

### 10.2 三道闸门（P0）全部通过

| 闸门 | 结果 | 关键 |
|---|---|---|
| ① 能编能跑、数值对 | ✅ | `A\b`/`det`/`svd`/`eig` 与本机同版 11.3.0 **逐位一致** |
| ② `.oct` side module 可用 | ✅ | `build/113/probe-side-module.sh`：emsdk 5.0.7 上 MAIN_MODULE+SIDE_MODULE 得 43 |
| ③ 免 COI（非共享内存） | ✅ | `patch-ax-pthread.sh`：解耦「有无 pthread.h」与「要不要线程」→ `shared:true` 1→0 |

### 10.3 本轮的**关键坑**（都踩过、都有实测，别再走）

1. **异常模式必须全树 + `.oct` 统一用 `-fwasm-exceptions`**。
   JS 式异常（`-fexceptions`）会引入 `invoke_*`/`__cxa_*` 这些**只存在于 JS 胶水里**的
   符号，side module 靠主模块**导出表**解析导入 → 装载即
   `could not load dynamic lib … TypeError: Cannot read properties of undefined`。
   我之前判断反了方向（把 main.o 改成 -fexceptions 去"对齐树"），正解是**把树也改过来**。
   副作用是好的：wasm 35.75MB → 27.67MB。
2. **`automake` 不会因「编译命令行变了」而重编** → 只改 CXXFLAGS 再 make 会得到
   **混编**，链接期断言 `invoke_ functions … exceptions and longjmp are both disabled`。
   **必须先 `make clean`**（7.2 的 reconf-pic.sh 注释警告过这条）。
3. **zlib 不在主模块里 → `gzip`/`zip` 调用即整页 trap**（本轮抓到并修好）。
   两半缺一不可：① zlib 构建必须 `-fPIC`（它的 configure 靠**环境变量**收 CFLAGS）；
   ② 主链**定点** `-Wl,-u,<sym>` 拉进 `.oct` 需要的那几个 zlib 符号
   （核心自己只用到一小部分，按需拉取不会带进来）。
   **⚠️ 不要用 `--whole-archive`**：那样也修好 gzip/zip，却**把 convhulln/glpk 弄崩**
   （整库符号撞车）。详见 `build/113/NOTES-archive.md`。
4. **判定缺陷的唯一可靠手段是「装载之后真的调用」**。`exist('gzip')==3` 放行了，
   但 trap 是到回归护栏才暴露。**装载类断言不够。**
5. **别用 `nm`/`grep JS` 判 wasm 符号**：`nm` 读不了 wasm 对象（用 `emnm`）；
   grep JS 会假阳性（MAIN_MODULE 的导出在 wasm 导出段）。**要解析导入/导出段。**
   而**「缺导入」也不能预测 trap**——7.2 能用的那一对缺 68 个，我们缺 26 个却炸。
6. **`emconfigure` 会覆盖 `CC`/`CXX`** → ccache 要用 **configure 命令行参数**传
   （仅 export 无效）。实测接对后同样重复编译 **5 hits / 0 misses**。
7. **资产命名与依赖**：`.oct` 叫 `X-oct`、`.m` 注册层叫 `X`（7.2 惯例）；
   `X`(js) **必须显式声明 `deps: ['X-oct']`**（loader 的自动注入只对 `js→octdir` 生效），
   否则别名（`__web_imwrite__` 之类）建不出来。
8. **挂载路径要跟着版本走**：T1 的 `built-in-docstrings`/`doc-cache`/`macros.texi`
   要挂到 11.3.0 的 etc 目录（`<prefix>/share/octave/11.3.0/etc/`），
   而且 **`macros.texi` 与 `plotbridge` 都要进 `index.html` 的启动装载清单**——
   否则 `help plot` 会走到 stock 的 texinfo `.m` 上、触发运行时 makeinfo 报错。
9. **`SuiteSparse` 用 `static` 目标**（不要 `library`：它末尾会编 `.so`，
   而 `SO_OPTS` 带 `-Wl,--no-undefined`，wasm-ld 不认识）；
   **`CHOLMOD_CONFIG=-DNPARTITION`**（否则引 METIS，而我们没建）。
10. **hdf5 是交叉编译经典问题**：`H5lib_settings.c`/`H5Tinit.c` 由**刚编出来的程序**
    在运行时生成，Node 下看不到宿主文件 → 必须用**宿主原生 gcc** 编那两个构建期工具并运行。
11. **rapidjson 1.1.0 与新 clang 不兼容**（`GenericStringRef` 的 const 成员赋值）→
    已用 `build/113/fix-rapidjson.py` 改 no-op。
12. **bzip2 的 Makefile 里 `CC=gcc` 是普通赋值，连 make 命令行的 CC 都压不住** →
    绕开它的 Makefile、直接编那 7 个源文件。**zlib 的 configure 不是 autoconf**
    （不接受 `CC=...` 参数，只能走环境变量）。
13. **f2c 生成的回调调用，实参个数必须与 C++ 回调的形参个数**完全一致****。
    原生 x86 上 C 不检查函数指针签名，多一个/少一个实参只是读到垃圾（通常无害）；
    **wasm 的 `call_indirect` 会做精确类型检查，不符即 `unreachable` → 整页死**。
    这就是 `lsode` 的根因（odepack 的 Fortran 给 4 个实参、Octave 的 `lsode_f` 有 5 个）。
    同类风险仍在其它 f2c 回调上（`quad`/`daspk`/`lsode_j`…）—— 新增这类接口时，
    先数两边的参数个数，别只看"能不能编过"。
    修法见 `build/113/patch-odepack-callback-arity.sh`。
14. **定位 wasm 里的 `unreachable`：从"报索引"到"报源码行"的三步**（这次靠它破案）：
    ① `link-web.sh DIAG_NAMES=1` → 保留 name 段，栈里就有函数名；
    ② `DIAG_ASSERT=1` → 若是 emscripten 断言类 abort 会打出原因（没有就说明是裸
       `unreachable`）；
    ③ `DIAG_SOURCEMAP=1` → 出 `octave.wasm.map`，把浏览器给的
       `wasm-function[N]:0x<偏移>` 里的**文件偏移**当 source map 的 generated column
       解析，直接翻成 `文件:行`（本仓的 `wasm-opt`/`wasm-dis` 不带 dwarfdump，只能这么走）。
    三个开关**只写独立目录，不碰部署产物**。

### 10.4 已经做出来的东西

- **`o113` 容器**：emsdk 5.0.7；依赖装在 `/usr/local`（libf2c/refblas/lapack/pcre2）
  与 **`/src/deps/<lib>`（每库独立 prefix）**：glpk、fftw(3+3f)、qhull、sndfile、
  rapidjson、hdf5、zlibbz2、arpack、qrupdate、suitesparse(9 个 .a)。
- **`build/113/` 全部脚本**（每个都带实测注释与守卫）：
  `apply-platform-patches.sh`（Edge-Tools 那 5 处）、`patch-ax-pthread.sh`（闸门③）、
  `emf77`（f2c 包装）、`build-deps.sh`（早期四库）、`build-libs.sh`（② 的 11 个库，
  逐库独立 prefix + 符号自检）、`configure-113-full.sh`（**依赖表 + SKIP 变量**，
  供按库集合二分）、`build-oct.sh`（dldfcn 与**我们自己的 `.cc`** 两种模式，
  本轮加了 `OCT_DEFS/OCT_INCS/OCT_LIBS` 开口子）、`link-web.sh`（11.3.0 的 web 主链）、
  `probe-side-module.sh`（闸门②）、`fix-rapidjson.py`、`ss-long64.h`（**已被证伪，勿用**）。
  **本轮新增**：`build-sundials.sh`（SUNDIALS 6.1.1 → `/src/deps/sundials`，带符号自检）、
  `build-ode15.sh`（真编 `__ode15__.oct`：门禁宏 + `-lsundials_ida` 自包含）、
  `build-pkg-oct.sh`（27 个包 `.oct`，**显式模块表** + 合成 config.h）、
  **`dldprobe.cc`**（dlopen 自检探针的**源码** —— 此前只有 7.2 编出来的二进制，没源码）、
  **`patch-odepack-callback-arity.sh`**（修 `lsode`：给 odepack 的 7 处 `CALL F` 补第 5 个
  实参，与 Octave 的 `lsode_f` 对齐。**必须在编译主树之前跑**，或改后重编那 3 个 .f）。
  **`web_graphics_toolkit.cc`**（T2：`web` graphics toolkit 的 side module —— 登记+装载，
  渲染 no-op 交给 plot 桥；构建见文件头）
  诊断开关（`link-web.sh`，默认关、只写独立目录）：`DIAG_NAMES` / `DIAG_ASSERT` /
  `DIAG_SOURCEMAP` / `EXTRA_LDFLAGS`。
- **站点资产**（`site/` 与 `site113/` 内容相同）：`assets/oct/` 11 个 `.oct`（7 个核心
  dldfcn + webio + webimage-oct + webnet-oct + **`__ode15__`（真模块，250195 字节，
  内嵌 SUNDIALS）**）、`assets/m/`（webfile/pkgfix/webshell/webaudio/webnet/webimage/
  plotbridge/**lanetest**）、`assets/pkg/`（12 个纯 `.m` Forge 包）、
  `assets/octdir/`（**已按 11.3.0 重编的 27 个 `.oct`**；7.2 旧件备份在
  `/mnt/hdd/octave-wasm-build/octdir-72bak`）、`assets/data/`（T1 三件）、
  `dldprobe.oct`（根目录，`accept-full` 用）、`minioct.oct`（`accept-113-oct` 用）、
  `vendor/`（forge 预装集留档，源码在 `build/forge-preload/`）、`VERSION`（基线标识）。
- **仓库补的可复现性缺口**：`post.js`、`build/webshell/` 的 6 个 `.m`
  （此前只在 7.2 站点的压缩 bundle 里）、**`build/113/dldprobe.cc`**、
  **`build/forge-preload/`（20 个预装 .m）**。
- **四份 NOTES + 一份清单**（都在 `build/113/`）：`NOTES-umfpack.md`（**根因已查明**，
  附一个被证伪的假设）、`NOTES-archive.md`（gzip/zip 两个 trap 的**根因与修法**）、
  `GATE3-QUESTION.md`、`NOTES-lsode.md`（`lsode` 整页 trap：证据、排除过的解释、下一步）、
  **`PROMOTION.md`**（换基线的判定、清单、已完成项、还剩什么）。

### 10.5 恢复流程（断电/新会话）

```bash
sudo docker start obuild odld obench o113
sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/recover.sh       # 8761（**已是 11.3.0**）
sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/recover-113.sh   # 8762（同一内容）
```
两个脚本现在都按 **11.3.0** 口径工作：
- `recover.sh` 的三大件来自 **`o113:/src/websrc/out/`**（原为 `obench` 的 7.2 产物），
  站点内容从 `site113/` 组装，清单**只读核对摘要**（不再 `gen-manifest` ——
  那会按 7.2 口径把 11.3.0 的 mount 路径算错），并用 `site/VERSION` 判断是否已是 11.3.0。
- `recover-113.sh` 是 8762 车道的同一套逻辑（起 o113 + 起 8762）。
- **回退到 7.2**：`cp -a /mnt/hdd/octave-wasm-build/site-72bak/. /mnt/hdd/octave-wasm-build/site/`
  （内容立刻回到 7.2）；若要连恢复脚本一起回退，从 git 历史取 `recover.sh` 的旧版。

**检查点**：`octave-build:113-assets-full`（11.3.0 全状态）。
更早：`113-pkg` / `113-trapfix` / `113-hostlayer` / `113-oct-assets` / `113-no-umfpack` /
`113-full-deps` / `113-libs2` / `113-libs1` / `113-wasm-eh` / `113-base`。

重启后 **gh token 会失效**：`gh auth setup-git` 有时能救、有时要重新 `gh auth login`。

### 10.6 待办（✅ = 已完成）

1. ✅ **SUNDIALS → R1 `ode15s`**（提交 `459ddd1`）。
   `__ode15__.oct` 已是**真模块**（250195 字节，SUNDIALS 静态码全在 `.oct` 内），
   **主 wasm 零改动**（sha256 前后一致）—— 所以**不需要**重配/重编/重链主树，
   原计划那一串是照 configure 车道设想的，实车走 `.oct` 车道更短更安全。
   三个脚本：`build/113/build-sundials.sh` → `build-ode15.sh`（`build-oct.sh` 提供
   `OCT_DEFS/OCT_INCS/OCT_LIBS` 开口子）。验收 `accept-113-ode15` **29/29**。
   实测要点：刚性问题误差 9.1979e-05（7.2 站点 9.2e-05）；vdp1000 与 8761
   **五个用例判定与步数完全一致**（54/失败/失败/537/724）。
2. ✅ **27 个包 `.oct` 按 11.3.0 重编**（提交 `3cbb81a`）。
   `build/113/build-pkg-oct.sh`：模块表显式写死（control 的 SLICOT 那条 Fortran 路
   本仓不建，自动分组会编出坏模块）+ **合成 config.h**（不跑包自带 configure）。
   验收 `accept-113-pkgoct` **27/27 零 trap**。旧件在 `/mnt/hdd/octave-wasm-build/octdir-72bak`。
3. ✅ **`accept-print` / `accept-plotv2` / `accept-plot3d` 测试自身崩溃**：
   ① `svgCheck` 的失败分支返回的对象**没有 `texts` 字段**却无条件 `.some()`；
   ② **没等 `window.__octaveReady`**（plotbridge 挂上前就断言）。
   修完分别 **43/43、54/54、34/34**。
4. ✅ **稀疏 `lu`（UMFPACK）根因查明并修好**（提交 `52489ab`）：
   建 SuiteSparse 时**漏传 `-DNBLAS` / `-DNSUPERNODAL`** → UMFPACK 去调本仓那套
   **f2c 转出来的 BLAS**（`-lrefblas`）→ ABI 错位踩内存 → 整页 trap。
   证据：7.2 vendored 的 SuiteSparse 树相对干净 tar 包只有 3 处人工改动，前两处正是
   这两个开关；`libumfpack.a` 的 BLAS 未定义符号 **10 → 0**，其余符号集与 7.2 一致。
   `accept-113-libs` 11/12 → **17/17**（那六条 trap 形态已立成护栏）。
5. ✅ **S6 换基线到 8761**：**已换**。8761 现在服务 11.3.0（wasm sha `11f6175a…`）。
   换前补了关键证据（7.2 的 19 套指向 11.3.0 内容跑一遍），顺带补上三处**内容缺口**
   （`dldprobe.cc` 源码入仓并重编、`lanetest` 资产、`m/forge` 的 20 个预装 .m）。
   `recover.sh` 与 `DEPLOY.md` 同步改完，7.2 快照留在 `site-72bak/`。
   清单见 `build/113/PROMOTION.md`。
6. ✅ **`lsode` 整页 trap —— 根因查明并修好**（2026-09-22）。
   **根因：ODEPACK 的用户回调参数个数与 Octave 的不一致 —— 4 个 vs 5 个。**
   本树 odepack 的 Fortran 调 `F` 给 **4 个**实参（`dlsode.f:1393`、`dstode.f` ×3、
   `dprepj.f` ×3，共 7 处），f2c 因此生成 4 参函数指针调用；而 Octave 的
   `lsode_f` 有 **5 个**形参（多一个 `F77_INT& ierr`）。原生 x86 上 C 不检查函数指针
   签名所以"看起来能用"，**wasm 的 `call_indirect` 做精确类型检查 → 不符即
   `unreachable` → 整页死**。旁证：`lsode_j` 是 7 参而 dprepj 的 `(*jac)(…)` 也是 7 参
   → **只有 `f` 这一侧不匹配**，这正解释了为什么只有 F 的调用点会 trap。
   **修法**：新增 `build/113/patch-odepack-callback-arity.sh`（给那 7 处 `CALL F`
   补第 5 个实参，用不声明的 `JERR` 走隐式 INTEGER，不动声明区；幂等 + 自检 7/7）。
   **修复后实测**（8761）：`|x(2)-e^-2| = 4.301e-08`（原生同题 4.3e-08）、`istate=2`、
   两状态精确、非刚正常、**刚性问题 2.744e-08**。`accept-113-ode15` **24 → 29/29**，
   7.2 时代的 `accept-ode15` 里那条"只查 `exist`"也改成了真调用。
   完整诊断链与**测法陷阱**（`lsode` 返回 `[x,istate,msg]` 不是 `[t,y]`）见
   **`build/113/NOTES-lsode.md`**。
   诊断手段留在 `link-web.sh`（默认关，只写独立目录）：
   `DIAG_NAMES=1`（保留 name 段）/ `DIAG_ASSERT=1`（`-s ASSERTIONS=1`）/
   `DIAG_SOURCEMAP=1`（`-g -gsource-map`，把 wasm 偏移翻成源码行 —— 这次就是靠它
   定位到 `dlsode.c:1618`）/ `EXTRA_LDFLAGS`。
7. ✅ **`dist/` 重打包**：**`octave-full-wasm-site-20260922`**。2026-09-22 重打过两次，
   最后一版含 T6/T7 的新资产（197 文件；wasm raw 34.30MB / gz 7.78MB；
   `octave-full-wasm-site-20260922.tar.zst` 22.47MB）。重打：`sh build/make-dist.sh`。
   **已核实包内 `octave.wasm` 与部署件同 sha**（`bac48adb…`）—— 早先那句"这一包是
   lsode 修复前的 wasm"是**冻的**，不必再补打。
8. ✅ **T2/A1 图形句柄半真化**（2026-09-22）：`web` graphics toolkit 挂上，
   `figure/gcf/gca/get/set/title/allchild/findall/close` 全部可用；
   **资产车道、主 wasm 零改动**（计划原记的 Lane B 不需要）。
   `accept-t2-graphics` **26/26**。半真化的**边界**已实测记进 §7（`get(gca,'children')`=0、
   `plot` 返回空句柄、`plot(hax,…)` 不支持、`getframe` 报像素捕获失败）。
   详见 **§5.5.1** 与 `build/113/NOTES-t2-graphics.md`（含 6 条踩坑记录）。
9. ✅ **T6 / T7 / T10**（2026-09-22，见 **§5.10** 与 **§5.11**）：
   T6 `audiodevinfo` + `doc` + **页面输出落点**（计划外但必需）；
   T7 `audiorecorder`（19 个 `__recorder_*` + MediaRecorder 桥，`recordblocking` 如实报错）；
   T10 Asyncify 实验 → **结论不可采用**（与 `-fwasm-exceptions` 互斥）。
   全部走资产车道，**主 wasm 零改动**；全量套件全绿。
10. ⬜ **非图形只剩一件**：G1 `MAIN_MODULE=2` + keep 清单（Lane B）。
    ~~`help`-.m 预渲染~~ 已在 P1 完成（§5.13）；~~H2 `uigetfile`~~ 已在 T8 完成（§5.12）；
    ~~SLICOT 编译件~~ 已修好并上线（§5.15）。详见 **§8 的"仍待办"**。
11. ⏭️ **P5 OSMesa 图形线** → **`graphics-osmesa` 分支**（不在 main 上做）：
    - **步骤① ✅ 已完成**：OSMesa 在 wasm 里渲出正确三角形、**含立即模式**（提交 `4821a5f`）。
    - **步骤② 的卡点已澄清（不是卡点）**：原先记的"四个 GL 头门禁仍是 undef"
      是**误判** —— 那四个是 **Apple 目录布局**的宏（`HAVE_OPENGL_GL_H` 等），
      `acinclude.m4:1544` 的 break 循环让 Apple 那支根本没被探测；
      真门禁 `HAVE_GL_GL_H/_GLU_H/_GLEXT_H` **当时就全是 1**。
      并且 **11.3.0 里 `gl-render.cc` 是无条件编译的**、**没有 `__init_opengl__.cc`**
      （opengl toolkit 在 libgui 的 GLCanvas）⇒ 没有现成 toolkit 可抄。
      **ABI 已核**：安装头里零个 `HAVE_OPENGL`/`HAVE_GL_`，所以可以在 opengl-on 的配置下
      编我们的 `.oct`，而主 wasm 保持 opengl-off ⇒ **仍可走资产车道**。
      详见该分支上的 `build/113/NOTES-p5-osmesa.md`。
    - **主树混态已清除**（2026-09-22）；**2026-09-23 图形线 B 档又把主树切成了 opengl-ON**：
      现在 `config.h` 是带 `HAVE_OPENGL 1` 的那份，**已 `make clean` + 全量重编**（`.o`/`.a` 与之一致）。
      切回"与 8761 部署一致"的配置：`cd /src/bin && PATH=/src/bin:$PATH SKIP= bash configure-113-full.sh`
      （不带 `WITH_OPENGL`）+ 重编；两份 `config.h` 备份在 `/src/libwork/config.h.pre-opengl-p5`
      （本轮 opengl 前）与 `/src/libwork/config.h.pre-opengl`（更早那份）。**详见 §5.16 末尾。**

---

## 附 · 机器维护的状态区块（**自动生成，别手改**）

<!-- AUTO:STATE -->
> 本区块由 `.githooks/update-handoff.py` 重算，**不要手改**（pre-commit 会刷新并 `git add`；pre-push 会 `--check`）。

| 项 | 值 |
|---|---|
| `octave.wasm` | 36,858,059 B raw / 8,430,732 B gz | sha256 `6c75a4942df28682…` |
| `octave.js` | 744,750 B raw / 160,981 B gz | sha256 `0714229914e64c10…` |
| `octave.data` | 6,804,767 B raw / 1,314,025 B gz | sha256 `6bece3d87ab3aa3a…` |
| 三大件 gzip 合计 | **9,905,738 B** | |
| 资产条目 | 47 | |
| 最近一次**全绿**回归 | `20260923-8761-webgl-clean` · **32 套 / 848 PASS / 0 FAIL** | http://127.0.0.1:8761/ |
| 交付包 | `octave-full-wasm-site-20260923` · tar.zst 25,983,323 B · `8e0d22a2bca8e2b2…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `main` · HEAD 提交日期 2026-09-23 （**HEAD 的 sha 以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->
