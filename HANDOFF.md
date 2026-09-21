# HANDOFF · Octave-Full-Wasm（给 AI 的接续说明）

> 本文唯一目的：**抗上下文压缩**。新会话只读这一份就能接着干。
> 最后更新：2026-09-20（会话交接）。

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
见 §5「⬜ 剩余」。**R1–R10 全部落地**；剩下的都是收尾性质或已论证不做。
已论证不可行/未过：nan 与 tsa 的源是 MEX（需 mex 运行时）、miscellaneous 的
`sample.cc`/`text_waitbar.cc`、SPQR、control 的 SLICOT 编译件（崩页面，见 §4.12）、
`help` 的 makeinfo 路径（无 shell，实测修不了）。

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
| R7 CXSparse | 已开 | SPQR 仍未做（P3，非阻塞） |
| R8 WebAudio | `audioplayer` 全 18 个符号可用 | **纯 `.m` 就够**（句柄=struct，零编译）；不用 AudioWorklet |
| R9 图形导出 | `print -dsvg`（2D+3D 都能出） | 纯 `.m` SVG 生成器；gnuplot 路线要 Asyncify 才有同步通道，故不采用 |
| R10 编译级别 | **采纳 `-O1`** | 解释器密集代码快 5–10×，体积还小 7.5MB；wasm64 不碰 |

### ⬜ 剩余（都是非阻塞的）

1. **SPQR**（R7 的尾巴）：Suitesparse 里可取，需单独编 + `--with-spqr`。非阻塞。
2. **control 的 SLICOT 编译件**：见 §4.12，需先做静态注册的小实验验证可行性。
3. **`help` 的 makeinfo 路径**：**已实测修不了**（doc-cache 注入试过，见 §7）。保持清晰报错。

### ❌ 已论证不做（别再试，见 §7 与 `build/GAPS.md`）
- nan / tsa 的源是 **MEX**（`mexFunction`），需 mex 运行时；miscellaneous 的 `sample.cc`/`text_waitbar.cc` 未过。
- ImageMagick / PortAudio / Ghostscript / libarchive / OpenGL / Java / FLTK-Qt / `system`-`popen`
  （各有替代或有意保持"清晰报错"）。
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
| `build/GAPS.md` | **差距审计 + 需求书**（实测缺口、硬约束、R1–R11 分条需求与验收标准） |
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
- **`help` 对非平凡输入会报 `makeinfo` 子进程错误**：wasm 无 shell。`.m` 文件的
  docstring 直接可读（`help plot` 可用），但走 texinfo 渲染的路径（含所有内建）必然失败。
  **已实测修不了**——注入 `doc-cache` + `built-in-docstrings` 后错误只是从"文件缺失"
  变成"makeinfo 不可用"，因为渲染那一步绕不过去。不影响函数调用本身。
- **control 包的 SLICOT 编译件未发布**（§4.12）：`ss`/`step`/`tf2ss` 不可用；
  `tf`/`tfdata`/`dcgain`/`pole`/`zero`/`feedback`/`bode` 等纯 `.m` 面正常。
- `voronoi` 的**单输出形式**（要画图，走 `gca`）不可用；两输出形式正常。
- nan / tsa 的 MEX 源、miscellaneous 的 `sample.cc`/`text_waitbar.cc` 未编入。
- SPQR 未做（R7 尾巴，非阻塞）。

---

## 8. 一句话接续
**当前基线 8761 = 批次 0/1a/1b/1d + 1 + 2A/2B + 3 + 4 + 5 + 6 + 7a/7b + 8 + 9 + 11 + 12 + 13**，
`-O1` 编译，**dldfcn 走官方 dlopen 装载**。全量 **15 套 418 项全绿**（含需求级
`accept-requirements`），交付包在
`/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260921/`（重打：`sh build/make-dist.sh`）。
**R1–R10 全部落地**；剩下只有 SPQR、control 的 SLICOT、`help` 三件非阻塞事项（见 §5 剩余）。
**起手体检**：`harness/run.sh test/browser/accept-requirements.mjs` —— 一屏看全十条需求。
只在 `/mnt/hdd/zcode-projects/Octave-Full-Wasm` 及 `obuild`/`odld`/`obench` 容器内工作。

**恢复流程（断电/新会话第一条命令）**：
```bash
sudo docker start obuild odld obench && sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/recover.sh
```
它会起容器、体检工具链（cmake 曾因断电损坏）、必要时重建站点、起 8761、跑验收。
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
