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
- 产物体积（**已采用 MAIN_MODULE=1 / 真 .oct 版**）：wasm raw 37.9MB / gzip 7.98MB；
  js 29.8MB / gzip 1.80MB；data 6.17MB / gzip 1.18MB。**三大件 gzip 合计 10.96MB**
  （采用前是 6.18MB，+79% 是 .oct 能力的代价）。

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
| **交付** | 整站 gzip 打包（可静态托管） | 包内 20/20 通过；用户实下 **10.96MB** | `dist/octave-full-wasm-site-20260920` |

### 2.1.1 交付包（不在 git 里，在磁盘上）
```
/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260920/      # 84MB，可直接 rsync 上静态托管
/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260920.tar.zst  # 18.8MB 归档
  └─ serve.py（wasm MIME + gzip_static）、DEPLOY.md（nginx 配置）、MANIFEST.sha256
```
包内 `oct/*.oct` 是运行时动态装载的示例；装法（纯浏览器端）见 `DEPLOY.md`。

### 2.2 已装 dldfcn（`main.cc` 的 `STATIC_DLD_FCNS`，一行一模块，共 11 个）
`__delaunayn__ / __glpk__ / __voronoi__ / convhulln / fftw / gzip / bzip2 /
audioread / audiowrite / audioinfo / audioformats`

### 2.3 未完成（下一批）
- **批次 1c**：CXSparse（configure 报 "too old"）+ SPQR（源码不在，需另下）
- **批次 2**：SUNDIALS → `ode15s`/`ode15i`
- **批次 3**：HDF5 → `save/load -hdf5`
- **桥接**：fetch/urlread（需 Asyncify）、xls、WebAudio、image
- **零编译车道**：plot 桥 v2、forge 统计长尾、验证矩阵、`help` 文档注入

---

## 3. 环境与操作

### 3.1 容器 / 镜像 / 端口
```
obuild   构建容器（sleep infinity）—— docker start obuild
odld     .oct 实验容器（同 sleep infinity，独立；改它不影响 obuild）
owasm    旧的线上构建，端口 8757，别动
镜像     octave-build:pre-dldfcn（= 批次 1b 可用态快照，做实验前打的，4.27GB）
         octave-build:b2-snapshot（相近快照）
         octave-build:final / :shutdown / :libs / :full（更早的检查点）
         octave-wasm:latest（最原始镜像）
端口     8757=旧构建  8761=基线（改这里）  8763=同一份构建的副本
         8764=交付包验证用（跑的就是 dist/ 里那包）  8762=dlopen PoC  8758/8760=历史
```

> 实验容器/端口是临时的：不需要时 `docker stop odld`（镜像留着，随时可
> `docker run -d --name odld octave-build:pre-dldfcn sleep infinity` 重来）。
> 8763/8762 的静态服务在 /tmp（tmpfs），重启即空。
- 容器内源码/产物：`/usr/src/octave-wasm/{src,target,third_party}`
- `src/Makefile` = 仓库 `build/Makefile`；`src/main.cc` = 仓库 `build/main.cc`（每次改完要 `docker cp` 进容器 + 重编 octave.o）

### 3.2 起构建容器与预览
```bash
sudo docker start obuild
# 8761 预览（/tmp 是 tmpfs，重启即空；先从备份恢复）
#   备份在 /mnt/hdd/persist-octave/opencode-20260920/ 与 /mnt/hdd/persist-octave/RESUME.md
cp -r /mnt/hdd/persist-octave/opencode-20260920/. /tmp/opencode/
cd /tmp/opencode/oweb3 && setsid nohup python3 -m http.server 8761 --bind 127.0.0.1 --protocol HTTP/1.1 &
# 本机 curl 一律加 --noproxy '*'
```

### 3.3 构建一条龙（在容器内）
```bash
# 环境
export PATH=/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:$PATH
# 1) 重 configure（见 build/reconf-batchN.sh 模板，改掉对应 --without-*）
# 2) 全量 make（~45-50 分钟）
cd /usr/src/octave-wasm/third_party/octave-7.2.0 && emmake make -j24 && emmake make install
# 3) 重链 web 端（分钟级）
cd /usr/src/octave-wasm/src && rm -f web/octave.{js,wasm,data} && make web/octave.js
# 4) 拷出部署
docker cp obuild:/usr/src/octave-wasm/src/web/octave.{js,wasm,data} /tmp/opencode/oweb3/
```

### 3.4 浏览器自动验证（无人值守唯一验收手段）
- Node + `playwright-core`，可执行 `/usr/bin/chromium`，参数 `--no-proxy-server --no-sandbox --disable-dev-shm-usage`
- 测试脚本在 `/tmp/opencode/octave-accept/*.mjs`（**tmpfs，会丢**；备份见 3.2）
- 模式：`page.goto('http://127.0.0.1:8761/')` → 轮询 `Module.feval('strcat',['a','b'],1)` 等就绪 → `Module.eval_string(expr)` + 抓 `Module.last_error_message()` 与 console
- **数值/行为只认实测输出**；不要凭"应该对"

### 3.5 git 推送
- 重启后 git 可能推不动：`gh auth setup-git`（keyring 重启失效）
- 仓内 hooks：pre-commit 重算 README 的 `AUTO:FILES` 区块 + 校验白名单；pre-push 校验 README 新鲜
- **禁用 `--no-verify`**

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

### 4.6 CXSparse "too old"（未解）
去掉 `--without-cxsparse` 后 configure 报 `CXSparse library is too old (< 2.2)`。
`m4/acinclude.m4` 的 `OCTAVE_CHECK_CXSPARSE_VERSION_OK` 是 preprocess 检查，依赖 `HAVE_CS_H`/`HAVE_SUITESPARSE_CS_H`/`HAVE_CXSPARSE_CS_H` 之一被定义；当前 `cs.h` 在 `target/include/cs.h`（`CS_VER=3,CS_SUBVER=1`）。需查清为何该宏未定义。

### 4.7 其它
- `-lz -lbz2 -lccolamd -lsndfile` 都要手工进 `Makefile` 的 `EM_LDFLAGS`（Octave 自己的链接行不管我们的 web 终链）。
- 终链只剩 `cgejsv_`/`zgejsv_` 两个良性未定义警告。
- 容器内 Node 14 太旧：**任何需要在 configure 期“运行”的测试都可能假失败**（`unexpected section <Exception>`）。对策：预置对应 `octave_cv_*` 缓存变量。
- 容器有网络；`docker cp` 会重置可执行位。

---

## 5. 下一阶段计划（~~2 小时*无人值守*，已获用户批准：编译允许）

**优先级与决策（用户已拍板"全部按我的倾向"）**
1. SUNDIALS 版本：**主选 6.1.x**（有 wasm 先例；`__ode15__.cc` 含 `HAVE_SUNDIALS_SUNCONTEXT` 分支支持 6.x），**备选 5.8.x**。
2. 零编译车道**与构建并行**（会抢 CPU，构建略慢，总产能更高）。
3. 失败策略：每批重试 ≤2 次；仍失败→回滚镜像、记 `CLIBS.md`、转下一批。
4. **底线：8761 永远是最近一次通过验收的构建**（任何新批失败不许让它退化）。

### 批次 2 · SUNDIALS → `ode15s`/`ode15i`（首位）
- 源：`sundials-6.1.1.tar.gz`（**待下载**到 `/mnt/hdd/octave-wasm-build/third_party/`）
- 构建：`emcmake cmake`，`-DSUNDIALS_PRECISION=double -DSUNDIALS_INDEX_SIZE=32 -DEXAMPLES_ENABLE*=OFF -DKLU_ENABLE=ON -DKLU_INCLUDE_DIR=target/include -DKLU_LIBRARY_DIR=target/lib`，静态
- Octave：去掉 `--without-sundials_ida --without-sundials_nvecserial --without-sundials_sunlinsolklu`
- dldfcn：编 `__ode15__.cc` → `.o`（**在 config.h 之后**）+ 注册 `X("__ode15__", G__ode15__)`
- 终链：`-lsundials_ida -lsundials_nvecserial -lsundials_sunlinsolklu -lsundials_sunlinsoldense [-lsundials_core]`
- 验收：`ode15s` 跑刚性方程（Van der Pol / `y'=-1000(y-cos t)-sin t`）与参考一致；`ode15i` exist=5；回归无退化

### 批次 1c · CXSparse + SPQR
- CXSparse：先解 4.6 的头宏问题；SPQR：从 `suitesparse-full-5.4.0.tar.gz`（已在 third_party）取 `SPQR/` 单独编。
- 验：稀疏 QR 数值对照。

### 批次 3 · HDF5（另起一轮，风险最高）
- 选有 wasm 先例的版本；先独立 smoke test 再接 Octave；`FE_INVALID` 是已知 Emscripten 冲突点。
- 验：`save -hdf5`/`load` 往返。

### 零编译车道（与构建并行）
1. plot 桥 v2：`barh/errorbar/stairs/area/pie/plot3/scatter3/mesh/surf/contour`、`subplot`→`set multiplot`、`figure(n)`、`axis equal/tight`、`print -dsvg`、中文标签。
2. forge statistics 长尾：manifest 驱动注入（`anova/ttest2/ztest/kmeans/pca/`分布族）——**运行时 `.m` 注入零重编**（`Module.FS.writeFile` + `addpath`，可遮蔽 builtin）。
3. 验证矩阵：覆盖率量尺（`exist` + 数值 + 图产物）。
4. 候选：`help` doc-cache（`target/share/octave/7.2.0/etc/doc-cache`，2MB）运行时注入。

### 后续（本轮不做）
- 桥接 fetch/`urlread`（需 Asyncify，编译期）、xls、WebAudio、image。
- 托管/UI：**已明确后置**。用户倾向：解耦成两个静态端点（如 `/cli`、`/gui`）+ 共享 core 运行时；**不要 R2/Worker**（纯静态托管即可，服务端零计算）；Service Worker 可离线。GUI 用 JupyterLite + 自研 kernel 适配器（`jupyterlite/kernel` 接口，模板见 `jupyterlite/javascript-kernel`）；`xeus-octave` 是原生内核、未 wasm 化，仅参考。

---

## 6. 文件地图（仓库内）

| 路径 | 作用 |
|---|---|
| `build/Makefile` | 构建主 Makefile（含 `EM_LDFLAGS` 全库清单 + dldfcn `.o` 挂载 + `STATIC_DLD_FCNS` 相关） |
| `build/main.cc` | wasm 入口；`STATIC_DLD_FCNS` 注册表 + Phase 3 安装 + addpath 两段式 + feval/eval_string 绑定 |
| `build/reconf*.sh` | 各批次 configure 配方（当前：`reconf.sh` 基线、`reconf-batch1.sh`、`reconf-batch1b.sh`） |
| `build/build_dldfcn.sh` | 编 dldfcn `.cc` → `.o`（容器内跑） |
| `build/fftw_threads_stub.c` | FFTW 线程桩（必须） |
| `build/normalize_arpack.py` | ARPACK F77 源净化器 |
| `build/second_stub.f` | ARPACK `second()` 计时桩 |
| `build/plotbridge/*.m` | plot 翻译桥垫片（plot/hold/legend/xlim/… 20 个） |
| `bridge/octplot.html` | PoC 验证页（含运行时注入胶水 + 4 个 demo 按钮） |
| `bridge/plotbridge.js` | spec→gnuplot 脚本 + marker 表（marker 表已按肉眼锁定） |
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
- `gunzip`/`bunzip2`（`.m` 包装）调 `system("gzip -d …")` → 无 shell，**清晰报错**；符合"宿主专属=明确报错"口径。
- `system/unix/popen` 已清晰报错（本就达标）。
- `audioformats` 输出正确，仅测试脚本预期字符串不符。

---

## 8. 一句话接续
**当前基线 8761 = 批次 0/1a/1b + 真 `.oct` 动态装载（MAIN_MODULE=1）**，实测 20/20；
交付包已打在 `/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260920/`（+ `.tar.zst`），
用户实下 10.96MB。下一步是**批次 2（SUNDIALS 6.1.x → ode15s/ode15i）**，配零编译车道并行；
每批自动验证、通过才覆盖 8761、提交推送。只在 `/mnt/hdd/zcode-projects/Octave-Full-Wasm`
及 `obuild`/`odld` 容器内工作。

**注意架构已变**：主链是 `-s MAIN_MODULE=1` + 全树 `-fPIC`。这带来一个直接好处——
**新 dldfcn 模块可以只编成 `.oct` 用运行时加载，不必重链那 38MB 主 wasm**
（`build/build_oct.sh`）。但任何"重编 Octave 本体/静态库"的操作都必须走
`build/reconf-pic.sh` + `build/rebuild-pic-libs.sh`，否则非 PIC 对象会让主链链接失败。
