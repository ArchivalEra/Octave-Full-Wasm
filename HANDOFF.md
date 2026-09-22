# HANDOFF · Octave-Full-Wasm（给 AI 的接续说明）

> 本文唯一目的：**抗上下文压缩**。新会话只读这一份就能接着干。
> 最后更新：2026-09-22（**第四轮 11.3.0 已实际落地到 10 套验收 194/195**
> —— **接续先读 §10**，它包含本轮全部已验事实、坑与剩余待办；§9 是当时的计划）。

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
- 产物体积（**当前：`-O1` + MAIN_MODULE=1 + HDF5**；交付走 EdgeOne 自动压缩）：
  wasm raw 44.5MB / gzip 9.07MB；js raw 20.5MB / gzip 1.33MB；data raw 5.94MB / gzip 1.15MB。
  **三大件 gzip 合计 ≈11.6MB**（上一版是 12.5MB——`-O1` 让 js 缩了 10MB）。
  另加**按需懒加载资产 20MB / 59 个文件**（谁用到谁下载，不计入首包）。
  历史：`MAIN_MODULE=1` 让 gzip 从 6.18MB 涨到 10.96MB（不做 DCE），HDF5 再 +1.5MB；
  `-O1` 又把它拉回 11.6MB（见 §5 批次 11）。`MAIN_MODULE=2` 能把体积压得更低，
  但 **DCE 会删掉 `.oct` 要 import 的函数**（运行时 `null function` 崩），未采用——
  要吃得维护一份导出清单（见 `CLIBS.md`）。

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
  `ccache 4.13.6` / `ninja 1.13.2`；**但 OSMesa 要的 meson 是容器里那份**。

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

### 4.12 **side module 引用主模块 Fortran 符号时签名不匹配会整页崩**（批次 12 踩到）
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
| R10 编译级别 | **采纳 `-O1`** | 解释器密集代码快 5–10×，体积还小 7.5MB；wasm64 不碰 |

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
| 8 | **T8** | **H2 `uigetfile`**：`<input type=file>` → MEMFS（**已实测确认**：同步性必须靠 Asyncify —— `pause()` 会完全阻塞页面，所以"轮询等待"那条路走不通，见 §5.10 坑 1） | 1–2 d | 需 G2 先验 |
| 9 | **T9** | **G1 `MAIN_MODULE=2` + 自动 keep 清单**：读每个 `.oct` 的 wasm import 表 → 生成保活集 → 跑全量回归验证 | 1–3 d | Lane B |
| 10 | **T10** | **G2 Asyncify 最小实验**（**只实验不采用**）：用 `ASYNCIFY_IMPORTS/ONLY/REMOVE` 限制插桩范围，测体积/性能/回归。**优先级因 T7 的实测而上调**：`recordblocking` 与 `uigetfile` 都卡在这 | 0.5–1 d | 独立容器 |

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
| `build/113/link-web.sh` | 11.3.0 的 **web 主链**（含 `--whole-archive` 的教训与定点 `-Wl,-u` 的 zlib 符号拉取） |
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
| `build/plotbridge/*.m` | plot 翻译桥垫片（plot/hold/legend/xlim/… 20 个） |
| `bridge/assets-loader.js` | **资产懒加载器**（manifest → fetch → 写 FS → addpath；支持 `aliases` 符号链接） |
| `bridge/index.html` | 站点入口（原版 + loader，只读清单不预加载） |
| `bridge/octplot.html` | plot 桥 PoC 页（含运行时注入胶水 + 4 个 demo 按钮） |
| `bridge/plotbridge.js` | spec→gnuplot 脚本 + marker 表（marker 表已按肉眼锁定） |
| `test/browser/accept-*.mjs` | **验收套件（进仓库，断电不丢）**：15 套 418 项 — `full`(20) `hdf5`(16) `forge`(22) `forge-oct`(15) `forge2`(42) `dldfcn`(68) `ode15`(14) `archive`(20) `image`(17) `print`(43) `plotv2`(54) `plot3d`(34) `audio`(47) `net`(30) `requirements`(16) |
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
- **FreeType 未构建**（`--without-freetype`）：效果是**每次会话一条**警告
  `opengl_renderer::render_text: support for rendering text (FreeType) was unavailable
  or disabled when Octave was built`（`text-renderer.cc:53` 的 `static bool warned`，
  所以只在首次建 axes 时打一次），之后文本能力静默缺失。数值与 plot 桥不受影响。
- ~~**`doc`** 报 `unable to find the Octave info manual`（无 shell 起不了 info 浏览器）~~
  → **T6 已修**（`build/webdoc/doc.m`，资产车道，见 §5.10）。**仍缺**：带 texinfo 标记的
  `.m` 文件走运行时路径仍会撞 makeinfo（与下面那条同源）。
- **`audiorecorder` 的 `recordblocking` 不可用**（T7）：语义是"等页面把录音做完"，
  而**实测 `pause()` 期间浏览器事件循环完全停摆**（区间内 tick = 0）⇒ 必须 Asyncify。
  本构建**如实报错**并给出替代用法（`record(r,len)` + `getaudiodata`），不静默降级。
  **`record`/`stop`/`getaudiodata` 正常**（`accept-t7-recorder` 40/40）。
- **`pause()` 会完全阻塞页面**（行为事实，不是缺陷）：这条同时决定了
  `recordblocking` 与 `uigetfile`（T8）都必须走 Asyncify；
  反过来也解释了 `input()` 为什么能用 —— `window.prompt` 是**同步**的浏览器 API。
  写验收时**等待要在 JS 侧做**（`setTimeout`），不能用 Octave 的 `pause`。
- **control 包的 SLICOT 编译件未发布**（§4.12）：`ss`/`step`/`tf2ss` 不可用；
  `tf`/`tfdata`/`dcgain`/`pole`/`zero`/`feedback`/`bode` 等纯 `.m` 面正常。
- `voronoi` 的**单输出形式**（要画图）：T2 之后**已能走到绘图**，但终点是 plot 桥的
  `plot(hax, x, y)` 调用形态不支持（见上面的边界条目）→ 报 `X and Y sizes do not match`。
  两输出形式正常。**根因在 plot 桥，不在句柄系统。**
- nan / tsa 的 MEX 源、miscellaneous 的 `sample.cc`/`text_waitbar.cc` 未编入。

---

## 8. 一句话接续
**当前基线 8761 = Octave 11.3.0**（2026-09-22 换的基线，原 7.2）。
`-O1` 编译，**dldfcn 走官方 dlopen 装载**。全量 **28 套 719 项全绿**
（11.3.0 的 6 套 + 7.2 时代的 19 套 + T2/T6/T7 三套，在 8761/8762 上各跑一遍都全绿），
含需求级 `accept-requirements`。交付包重打：`sh build/make-dist.sh`。

**7.2 的回退快照**：`/mnt/hdd/octave-wasm-build/site-72bak/`（90M）。
回退：`cp -a site-72bak/. site/`（**注意** `build/recover.sh` 已是 11.3.0 口径，
回退后要用它得先把取值源改回 `obench`，见 git 历史）。

**R1–R10 全部落地**；第三轮 T1 + T3 + T4 + T5 已完成（`help` §5.6；文件操作 §5.7；
pkg 语义 §5.8；`input()` §5.9）。**第四轮（11.3.0 换基线）已完成，见 §10**，
§9 保留为当时的计划与决策记录。
**剩下的长尾**：P5 OSMesa 图形线（本轮范围外）。
第四轮的 `lsode` 整页 trap 与 T2 图形句柄**都已完成**（见 §10.6 第 6 项、§5.5.1）。

**起手体检**：`harness/run.sh test/browser/accept-requirements.mjs` —— 一屏看全十条需求。
**改 `.m` 前先跑** `python3 build/check_m.py <目录>`（宿主秒级语法预检，见 §5.6）。
只在 `/mnt/hdd/zcode-projects/Octave-Full-Wasm` 及 `obuild`/`odld`/`obench`/`o113` 容器内工作。

**恢复流程（断电/新会话第一条命令）**：
```bash
sudo docker start obuild odld obench o113 && sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/recover.sh
```
它会起容器、体检 o113 工具链、必要时按 **11.3.0** 口径重组站点、起 8761、跑验收
（需求级 + 核心回归）。11.3.0 车道的独立恢复是 `build/recover-113.sh`（起 8762）。

最近的镜像检查点：**`octave-build:b13-official-dldfcn`**（`obench`，**O1 基线 + 官方装载**，
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
  · **③ 还没开始**：`plot/surf/mesh/contour` 逐个出图并与 7.2 桥产物对照。
  · **回退不变**：plot 桥 + `print -dsvg` 保持可用，两者不冲突。

> 🚨 **主树现在是"混态"，接手务必先看**：`/src/work/octave-11.3.0/config.h` 已带
> `HAVE_OPENGL 1`，但所有 `.o`/`.a` 仍是 opengl 之前的产物（本次**没有 make、没有重链、
> 没有部署**）。要回到"与部署一致"的配置：
> `cd /src/bin && PATH=/src/bin:$PATH SKIP= bash configure-113-full.sh`（不带 `WITH_OPENGL`）；
> 备份在 `/src/libwork/config.h.pre-opengl`。部署产物（8761/8762/磁盘/`/src/websrc/out/`）
> 全程仍是 `bac48adb960c9c79…`，未受影响。

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
| 验收 | **28 套 719 项全绿** | 同左（两份各跑一遍） |

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
  换完之后这些套件在 8761 上复跑全绿（补上 T2/T6/T7 后为 **28 套 719 项**）。
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
7. ✅ **`dist/` 重打包**：`octave-full-wasm-site-20260922`（78M，187 文件；
   `octave-full-wasm-site-20260922.tar.zst` 22.4MB）。重打：`sh build/make-dist.sh`。
   ⚠️ `lsode` 修好之后**需要再重打一次**（当前这一包是修复前的 wasm）。
8. ✅ **T2/A1 图形句柄半真化**（2026-09-22）：`web` graphics toolkit 挂上，
   `figure/gcf/gca/get/set/title/allchild/findall/close` 全部可用；
   **资产车道、主 wasm 零改动**（计划原记的 Lane B 不需要）。
   `accept-t2-graphics` **26/26**；全量 **26 套 646 项全绿**（再加 T6/T7 后为 **28 套 719 项**）。
   详见 **§5.5.1** 与 `build/113/NOTES-t2-graphics.md`（含 6 条踩坑记录）。
9. **P5 OSMesa 图形线**（本轮到此为止，进度见 §9 与 `build/113/NOTES-p5-osmesa.md`）：
   - **步骤① ✅ 已完成**：OSMesa 在 wasm 里渲出正确三角形、含立即模式（提交 `4821a5f`）。
   - **步骤② 推进到一半**：libGLU 建好、**GLU 剖分在 OSMesa 上验证通过**、glshim 就绪、
     `WITH_OPENGL=1` 的 **configure 跑通（`HAVE_OPENGL 1`）**；
     **卡在四个 GL 头门禁仍是 undef**（`HAVE_OPENGL_{GL,GLU,GLEXT}_H` /
     `HAVE_GLUTESSCALLBACK_THREEDOTS`）⇒ `gl-render.cc` 编不过。
   - **步骤③ 未开始**。
   - 🚨 **主树是混态**（config.h 已带 opengl、产物还是旧的）——想重链出部署同款 wasm
     必须先 `SKIP= bash configure-113-full.sh`（**不带** `WITH_OPENGL`）回到原配置。
     部署产物全程未动（`bac48adb960c9c79…`）。




