# HISTORY · Octave-Full-Wasm 的历史记录（append-only）

> 本文是 2026-09-24 从 `HANDOFF.md` **原样拆出**的历史部分（第三轮 T1–T10、批次 A–E、
> 图形线 P5→WebGL、第四轮换 11.3.0 基线的全过程，以及 `§5.30`–`§5.32` 这三批）。
> **编号与内容一字未改**；里面的数字是"**当时如此**"，**不要**拿它跟今天的产物对账
> （`.githooks/check-handoff.py` 也因此不查本文）。
> · 想知道**现在**是什么状态、下一步干什么：看 [`HANDOFF.md`](HANDOFF.md)。
> · 想查"这件事当年为什么这么做、踩过什么"：在这里搜关键词（`grep -n 关键词 HISTORY.md`）。

---

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

### 5.17.1 ⚠️ 2026-09-24：`gh` token 失效 ⇒ `origin` 推不上去（重启导致）

**现象**：`git push origin main` → `could not read Username for 'https://github.com'`；
`gh auth setup-git` 也救不回来（`The token in ~/.config/gh/hosts.yml is invalid`）。
这正是 §3.5 记的那条"重启后 gh token 会失效"，只是这次 `setup-git` **救不了**，
需要**人**跑一次 `gh auth login`（交互式）。

**处置（已做，内容没丢）**：
- 今天两笔提交（`5e9b56c` 认证收尾 + `4863a30` 跨天刷新）**已落到持久盘镜像**：
  `/mnt/hdd/octave-wasm-build/mirror-Octave-Full-Wasm.git` 的
  **`refs/heads/main-20260924`**（= `4863a30`）。
- ⚠️ 镜像的 `main` 仍是**旧形状**（`9b211ae`，§5.17 那次 API 推送的产物），与本地 `main`
  不是快进关系 ⇒ **不许 force-push**（铁律 2），所以推到一个新 ref，别去动 `main`。
- **下次接续**：先 `gh auth login`，再 `git push origin main`
  （本地领先 `origin/main` 两笔：`5e9b56c`、`4863a30`）。若 `github.com` 又被拦，照 §5.17 走 API。

**顺带一条机制上的小坑**：`AUTO:STATE` 里记的是 **HEAD 的提交日期**，而"提交"本身会刷新它 ——
**跨天那一笔提交之后，pre-push 一定会说机器块过期**（同一天内不会）。
处置：把刷新后的机器块**再提交一笔**（`4863a30` 就是这么来的）。不是 bug，是自指的必然。

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

**批末实测**：8768 与 **8761** 全量各 **35 套 / 902 项全绿**（8761 的清洁重跑：
`sweep-logs/20260923-8761-audit/`；两个站点在 promote 后已核对为**逐字节相同**）。
体积：`octave.wasm` 36,858,344 raw / 8,428,657 gz（审计给 toolkit 加了"无 GL 信号"，
比审计前 +285 字节）；三大件 gzip 合计 **9,903,662 B**（以文末 `AUTO:STATE` 为准）。
**审计批顺带查出的真缺陷（4 个 + 2 类测试自身的问题）**：
 ① `__wf_basename__("/")` 文档与死分支自相矛盾（候选 3 引出）；
 ② `/tmp/pb_spec.json` **不是合法 JSON**（`__pb_emit__` 从没写过左花括号）⇒ 唯一读者
    `octplot.html` 每次打开都在抛异常（候选 4 引出，已随该出口一起删掉）；
 ③ `resume` 把 44100 立体声播成 8k 单声道（候选 5）；
 ④ `bridge/webnet.js` **部署了但没人加载**（候选 2 引出）；
 ⑤ **`accept-hdf5` 的第一条断言一直在假过** —— want 是裸数字 `1`，靠资产加载器日志里的
    杂数字对上，而它查的 `__have_hdf5__` **在 11.3.0 里根本不存在**（候选 1 的 23 个套件
    补齐"等 `__octaveReady`"之后噪声不再串窗，它立刻暴露）；
 ⑥ 我自己在候选 6 里**把 pkgfix 的挂载点猜错**（`m/pkg` 写成 `m/pkgfix`）⇒ `pkg list`
    整个坏掉、加载器一声不响；被全量回归抓住，随后改成"声明 + 核对"（闸门能在跑验收之前拦）。

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

### 5.23 批次 A：断言可证伪化 —— **扫出 3 条假过断言**（2026-09-23）

缘起 §8 待办 6（"299 处 want 是单个数字"）。**根因只有一条**：套件的 `ev()` 是
"在**整段页面捕获窗口**（eval 输出 + 加载器日志 + warning）里找**子串**"，于是
`want='0'` 会被输出里别的数字里的 `0` 满足。

**做法（改机制，不是改 160 个调用点）**：
- 新闸门 **`.githooks/check-wants.py`**（已接进 pre-commit）：硬查 A 类"先截断再匹配"
  与 C 类"裸子串匹配"（ev 助手里必须走 `wantHit`），B 类"单数字 want + 计数表达式"
  只报告不拦；要保留弱断言就在那一行写 `CHECK-WANTS-OK`。
- 26 个套件的匹配器换成 `wantHit(hay, want)`：**单个数字**按"数字边界"匹配，
  多字符 want 仍子串（Octave 打印 1.5 是 `1.5000`，对多字符用严格词边界会**误红**）。
- 新探针 **`probe-want-matcher.mjs`（13 项）**把这条规则钉在真浏览器里：含
  "**旧写法**确实被 `10` 里的 `0` 满足"的**红-绿对照**、`disp(0)` 仍能对上、
  `1.5000` 不误红、负号/科学记数法正常。
- ★ **探针第一版就被真页面打脸**：只把"数字"当边界时，加载器日志里的 **`11.3.0`**
  仍然贡献出一个 `0` ⇒ `want='0'` 照样假过。**修法：点也算边界字符**。这条若是靠想，
  是想不到的。

**硬证据：3 条假过断言（都能复现）**
1. `accept-hdf5` 第一条（审计批已查明）：`__have_hdf5__` 在 11.3.0 里不存在，靠日志杂数字对上。
2. **`accept-net` 的 POST**：`[s6,ok6]=urlread(url,"post",…)` 实际 `ok6=0`（服务器 501），
   而 `want='1'` 被错误消息里 **`501` 的 `1`** 满足 —— 这条断言**从来没测过 POST**。
   已改成 `disp(sprintf("postok=%d", ok6))` + want=`postok=0`，并把"本地/静态预览服务器不支持
   POST"写进注释与 §7 偏差。
3. **`accept-slicot` 的 step 误差**：`disp(max(abs(y-(1-exp(-t)))))` 实际 `1.1102e-16`，
   `want='0'` 被那串里的 `0` 满足；标签写的却是"误差 < 1e-12"。已改成打印**布尔判定**
   （`disp(… < 1e-12)` + want='1'）。

**8761 全量（批次 A 后）**：`sweep-logs/20260923-8761-batchA/` —— 35 套 914 PASS / 11 FAIL，
**11 条全部有解释**：9 条是批 B 的契约断言（当时新桥还没 promote ⇒ 预期红，逐条见 §5.24），
2 条就是上面第 2、3 条（当轮已修）。
**待补**：批 A+B 合起来在 8761 的全量（跑到 19 套全绿被停，见 §8 第 1 条）。

### 5.24 批次 B：桥的参数契约 —— "不许静默曲解"（2026-09-23，**已 promote**）

**政策**（写进各文件头）：**能做对就做对；做不了就明确报错；有意的降级写清并用断言钉住。**

**新增 4 个纯 helper**（宿主 `%!test` 覆盖得到，29 条断言，都进了 `build/glue-selftest.m`）：
`__pb_axes_arg__`（是不是句柄，纯类型判定）、`__pb_strip_axes__`（剥"首参是目标 axes"那层，
非 `gca()` 就报错）、`__pb_bar_args__`（与核心 `__bar__.m:52-62` **同规则**：`isscalar(w) &&
!isscalar(x)` 才是宽度）、`__pb_legend_args__`（标签/位置拆分）。

**改了 11 个 shim**：
- `xlim`/`ylim`/`title`/`xlabel`/`ylabel`：支持**句柄优先**形态（核心合法）。以前
  `xlim(hax,[0 1])` 把**句柄当限值存下**（实测状态里是 `-62.16`）、`title(hax,"TTL")` 把句柄
  当标题文字、`xlabel(gca(),"x")` 报 `too many inputs`；
- `bar`/`barh`：宽度参数**明确报错**（以前当 X 数据 ⇒ `dimensions mismatch`）；
- `surf`/`mesh`：`(Z,C)` 颜色矩阵**明确报错**（以前静默丢掉）；
- `legend`：数值/句柄参数**明确报错**（以前当标签，图例里冒出一条数字）；
- `scatter`：少了守卫 ⇒ 以前 `scatter(1)` 报下标越界，现在报用法；
- 错误文本**与核心逐字对齐**（`LIMITS must be a 2-element vector` / `unrecognized argument`）。
- `insert-core-forward.py` 同步放宽 `title/xlabel/ylabel` 的签名，并加**自检④**：
  已插前导的文件里"转发实参"必须与表一致（改了签名不跟就会留一个引用不存在变量的前导）。

**验证**（本轮实测）：
- 宿主 `sh build/glue-selftest.sh` **66/66**（原 37，+29）；
- **8768 上新桥**：`accept-plotv2` **72/72**（54→72，+18 条契约断言）、`accept-plot3d` 34、
  `accept-print` 43、`accept-p5-graphics` 65、`accept-t2-graphics` 26、`accept-p5-fallback` 15；
- **旧桥（8761 上当时那份）**：`accept-plotv2` 63/9 —— 9 条红**正好逐条印证旧行为**
  （`xlim(hax,[2 8])` 把句柄当限值、`xlabel` 报 too many inputs、`bar(1:5,0.5)` 报
  `horizontal dimensions mismatch`…）。这就是"这批到底修了什么"的最好证据。
- **promote**：两个站点的 `assets/m/plotbridge.js` 同 sha（`407fb1787cc7…`）+ manifest 同步；
  旧资产留在 `assets-bak/plotbridge-20260923-prebatchB.js`。
**待补**：8761 全量（同 §8 第 1 条）。

### 5.25 批次 C：G1 `MAIN_MODULE=2` —— **两道墙都拆了，只差 promote**（2026-09-23，进行中）

**体积（实测，同一个树/同一套库）**：`octave.wasm` **36,858,344 → 28,707,654 B（−8.15MB，−22%）**；
`octave.js` 744,750 → 451,719。**gzip 待重算**（M2 产物在容器 `/src/websrc/m2keep-out`）。

**新增两个工具（这次把它们进了仓库，不再是一次性命令）**：
- `build/113/gen-keep-list.sh`：扫**部署的全部 `.oct`**（递归，含 `octdir/<包>/`）的 **IMPORT 段**
  （`wasm-dis`；`dylink.0` 段不含符号名，CLIBS.md 那句是错的）⇒ 本次 **45 个 `.oct` → 1267 个
  保活符号**。
- `build/113/check-oct-imports.py`：**链接期保活闸门**。判据是**差分**：只在"基线（今天在跑的 M1）
  导得出、新构建导不出"时报失败；JS 库符号单列一类（可用 `--js-provided` 声明已用 LIB_FUNCS 暴露）。
  **两个假阳性是实测打掉才活下来的**：① side module **自己**的函数在导入段里也会出现
  （`GOT.func`/`GOT.mem`）——`__ode15__.oct` 390 个导入里 **272 个是它自己的**（第一版报了 453
  个"缺导出"，几乎全是假的）；② **exportdesc 只是一个索引**，不能复用 import 的描述体跳过逻辑
  （混用会把名字长度读错位、解出乱码名字）。
- `link-web.sh`：`MAIN_MODULE_LEVEL=1|2` / `KEEP_LIST=` / `OCT_SCAN_DIRS=` / `BASELINE_WASM=`
  四个口子 + 链后闸门；另外修了 `$(dirname "$0")` 在 `cd` 之后解成 `.` 的坑（自检脚本找不到）。

**两道墙怎么拆的（实测）**：
1. **自动加载 dylib**（route A 的 `404 __bfgsmin.oct`）：走"自己生成保活集 + `-Wl,--export-if-defined`"
   那条路，`.oct` **不进主链命令行** ⇒ 懒加载设计不动。
2. **JS 库符号**：`LIB_FUNCS="emscripten_run_script,__assert_fail,abort,exit"`
   （`-s DEFAULT_LIBRARY_FUNCS_TO_INCLUDE=`）—— 四个符号在 M2 下**确实可用**：
   在 8768 的 M2 站点上 `accept-net` 30/30（走 `emscripten_run_script` 的同步 XHR）、
   `accept-image` 17/17（`__assert_fail`）、`accept-slicot` 25/25（`abort`）、
   `accept-forge2` 44/44（`exit`）⇒ **不需要**重写 R5，也**不需要** `oct_js_run` 包装。

**当前状态**：M2 三件已部署到 **8768**（M1 三件备份在 `siteWebGL-m1bak-20260923/`），
关键套件绿；`sweep-logs/20260923-8768-m2/` 那轮跑到 17 套全绿被停。

**2026-09-24 续做（懒加载证据补齐）**：新探针 **`probe-m2-lazyload.mjs`（7 项，8768 实测全绿）**
把"懒加载没破"钉死 —— ① 加载期的 `.oct` 请求只有启动清单里那 **8 个、全在 `assets/` 下**
（route A 那种"站点根目录找 `__bfgsmin.oct`"为 0）；② 装载前 `exist("butter")==0`、
按需 `OctaveAssets.load('signal')` 之后 `==2` 且 `butter(4,0.2)` 真出 5 个系数。
⇒ C 这一批**代码与证据都齐了**，只等 promote（HANDOFF §8 第 2 条）。

### 5.26 批次 D：FreeType 文字渲染 —— **只差最后一次链接**（2026-09-23，半途）

**关键事实（先查源码，省掉一个库）**：**不需要 fontconfig**。无 fontconfig 时
`ft-text-renderer.cc:303-320` 的回落是 `OCTAVE_FONTS_DIR` → `SYSTEM_FREEFONT_DIR` →
`config::oct_fonts_dir()`，在其中找 **`FreeSans[Bold][Oblique].otf`**；而 Octave **自带**这几个
字体（源码 `etc/fonts/`，`make install` 装进 `octfontsdir`）。实测 4 个文件 raw **1,869,688 B**。

**库（新脚本 `build/113/build-freetype.sh`）**：不吃 emscripten 端口的归档（**非 PIC**，与
`MAIN_MODULE` 不是一路），而是**按端口那份源文件清单**（`tools/ports/freetype.py`，42 个 TU）
自己用 `-fPIC` 编 ⇒ 10 秒、`libfreetype.a` 815,860 B、5 个必需符号自检通过。
★ **两个必须踩对的点**：① `-fwasm-exceptions` 必须与整棵树一致 —— 只写 `-O2 -fPIC` 时链接期
直接断言 `invoke_ functions exported but exceptions and longjmp are both disabled`；
② **`EM_PKG_CONFIG_PATH`** —— 只设 `PKG_CONFIG_PATH` 时 `emconfigure` 会让 emsdk sysroot 的
`.pc` 胜出（`FT2_LIBS = -sUSE_FREETYPE`）⇒ 一串 in-tree 链接报 `undefined symbol: FT_Done_Face`。

**configure（`WITH_FREETYPE=1`）**：`config.h` 拿到 `HAVE_FREETYPE 1` + `HAVE_FT_REFERENCE_FACE 1`
（`FT2_CFLAGS/LIBS` 指向 `/src/deps/freetype`）。**顺带发现并处理**：重跑 configure 会把
`GL_GLEXT_PROTOTYPES`/`HAVE_GLBLENDFUNCSEPARATE` 翻成 undef（gl4es 头不声明，而**部署版就是 1** ——
头换掉之后只增量重编过 3 个 TU、config.h 没重生成）⇒ 脚本里**显式恢复为 1**，理由是
"这一批不该顺带改图形行为"且 gl4es 实测提供该符号。

**全量重编**：`make clean` + `emmake make -k -j24`。踩了一个坑：`PATH=/src/bin:$PATH` 只写在
`make clean` 前 ⇒ Fortran 目标全红（**`emf77: command not found`**，264 个）—— `PATH` 必须
`export` 给整条命令。重跑后树编好（`ft-text-renderer.o` 已引用 `FT_*`）。

**字体预载（`link-web.sh`）**：挂载点**从 Makefile 读 `octfontsdir`**
（实测 `/src/work/octave-install/share/octave/11.3.0/fonts`，**不是** `/usr/src/octave` ——
那是 main.cc 自己 addpath 的 m/ 树，两回事），只预载 4 个 FreeSans 变体（1,869,688 B），
并加产物自检（`octave.js` 里必须有 `FreeSans.otf` 记录）⇒ 实测通过。

**剩余一步（被打断的那条命令，原样重跑）**：
```sh
sudo docker exec o113 bash -lc 'export PATH=/src/bin:$PATH; cd /src/bin && \
  M_SRC=/src/work/m-prerendered/m GL_LIBS=1 GL_BACKEND=webgl P5_TOOLKIT=1 \
  MAIN_MODULE_LEVEL=2 KEEP_LIST=/src/libwork/keep.txt \
  LIB_FUNCS="emscripten_run_script,__assert_fail,abort,exit" \
  OCT_SCAN_DIRS=/src/octs-site BASELINE_WASM=/src/websrc/out/octave.wasm WITH_FREETYPE=1 \
  bash link-web.sh /src/websrc/m2ft-out'
```
**验收要点**：产物含 `FreeSans.otf` 记录、**不再**出现那条 FreeType warning、用 `getframe`
的像素差异证明文字真画出来（探针待写）、8768 全量 → promote → 8761 全量。
**上线后的两条代价（如实）**：无 fontconfig ⇒ `fontname` 被忽略（任何字体名落到 FreeSans）、
`listfonts` 为空。
**检查点**：`octave-build:113-freetype-wip-20260923`（树已开着 FreeType + freetype 归档都在镜像里）。

**2026-09-24 续做：链接已跑通 + 文字渲染实测出字**
- 链接（HANDOFF §8 第 3 条那条命令）**已成功**：`/src/websrc/m2ft-out`，
  `octave.wasm` **29,280,186 B**（M2 不带 FreeType 是 28,707,654 ⇒ FreeType 的代码只 +572KB），
  保活闸门过（主模块导出 703 个名字）、FreeType 自检过（4 个 `FreeSans*.otf` 都在产物里）。
- **`build-freetype.sh` 的自检改对了**：`emnm -u <归档>` 的表**不能**直接当"缺符号"读
  （含跨成员引用），改成"每个未定义的自家符号必须在归档**某个成员里有定义**"；
  ⚠️ 比对前把多行串**压成空格**再做 `case` 匹配（命令替换出来是换行分隔，直接比会误判）。
- **新探针 `probe-text-render.mjs`（6 项，8768 实测全绿）**：① 那条 FreeType warning **没了**；
  ② 加 `title/xlabel/ylabel` 后 `getframe` 非白像素 **7391 → 9521（+2130）**（无 FreeType 时是
  **+0**，所以这条是判别性的）；③ 刻度标签换成长文字再 **+2754**。
- **体积账（M2+FreeType 实测）**：wasm 36,858,344 → **29,280,186**（gz 8,428,657 → 6,942,595）；
  js 744,750 → 454,096（gz 160,980 → 87,294）；data 6,804,767 → 8,674,455（gz 1,314,025 →
  **2,513,886**，那 +1,869,688 就是 4 个字体）⇒ **三大件 gzip 合计 9,903,662 → 9,543,775（−359,887）**。
  ⚠️ **字体那 1.2MB gzip 几乎吃掉了 M2 省下的 1.55MB** —— 想再省就只发 `FreeSans.otf`（856,800 raw）
  或做子集化（代价：粗/斜体或非拉丁字形变缺）。

---

### 5.27 仓库可复现性：4 个**承重文件从来没进 git**（2026-09-24）

起因是核对 `promote-webgl.sh` 时顺手 `git check-ignore`：它**被 `.gitignore` 的 `*` 忽略、
从未提交**。顺着查下去还有三个（都是脚本/产物，不是垃圾）：

| 文件 | 为什么承重 |
|---|---|
| `build/promote-webgl.sh` | 8761 的**换装脚本**（§5.21 把它当"固化路径"用） |
| `build/recover-113.sh` | 8762 车道的断电恢复（§10.5 的第二条命令） |
| `build/post.js` | `link-web.sh` 开头**硬要求**它存在（`[ -f "$SRC/post.js" ] \|\| FATAL`） |
| `build/webshell/*.m`（6 个） | zip/tar/gunzip 那批"无 shell 化"的覆写层 |

四个都**已加白名单并提交**；`post.js`/`main.cc` 与容器里正在用的那份 **sha 逐字节一致**
（`52b4aa7f…` / `6631c886…`），所以不是"旧副本顶替"的问题，纯属漏 add。

**为什么闸门没抓到**：`.githooks/check-whitelist.py` 校验的是"**已暂存**的文件在不在白名单里"，
**被忽略且从未 `git add` 的文件它看不见** —— 这是"白名单仓库"这条规矩的固有盲区。
⇒ 教训（已写进 §0 第 3 条的注脚）：**新增文件后主动 `git status --short --ignored <目录>` 看一眼**，
别只依赖闸门。（`build/113/vendor-edge-tools/`、`build/p5osmesa/` 是**有意**不进 git 的：
一个第三方 vendor、一个退役的 OSMesa 目录 —— 别顺手也 add 进去。）

---

### 5.28 批次 E：首帧冷启动 —— **量清了，决定不做预热**（2026-09-24）

**为什么要量**（§8 待办 5）：真渲染器第一次出图要建 WebGL 上下文 + `initialize_gl4es()` +
编 shader + 首帧 `glReadPixels`/PNG，文档里一直记着"~0.6 s"。这一批的纪律是**先量后定**
（计划里就写明允许以"不做"收口）。

**新探针 `test/browser/probe-cold-start.mjs`**（只测不判；**单跑**，不与 sweep 并行 ——
CPU 一抢毫秒数就没意义）：冷/温**分开**量，并把"预热两条路"的总额一起算出来。

| 量（8761，桌面，真 GPU） | 值 |
|---|---|
| navigation → load | 113 ms |
| navigation → `__octaveReady` | **1501 ms** |
| 冷：`clf` / `plot(1:10)` / `drawnow` | **375 / 73 / 177 ms** |
| 温：`clf;plot;drawnow` / 单次 `drawnow` | **58 / 24 ms** |
| 3D：`surf(peaks(24))` 冷 / 温 | **172 / 29 ms** |

⇒ **"0.6 s"拆开了**：真正花在第一次 `drawnow` 上的只有 **177 ms**，另外 ~375 ms 是**第一次
`clf`**（建上下文 + 初始化 gl4es）。这与 §5.21 的更正一致：端到端那 2 s 的大头是**桥自己**
（`surf(peaks(40))` ~1.9 s），不是渲染器。

**决策：不做预热**（如实记，也不打算做）。三条理由都是上表的算术：
1. **开页预热**：ready(1501) + 预热(177) + 温首图(58) ≈ **1736 ms** > 不预热的
   ready + 冷首图 = **1678 ms** —— 预热只是把这段从"首次出图"挪到"开页"，还多付一次温首图。
2. **ready 之后预热**：会**独占主线程** ~177 ms（Octave 的 eval 是同步的；`pause()` 期间浏览器
   事件循环完全停摆，§5.10 实测过）⇒ 用户第一条命令要排队，等于把等待挪到更糟的地方。
3. 收益本就小：177 ms 在"敲完 `plot` 到看见图"里几乎觉察不到（温出图 24–58 ms）。

**结案**：§8 这条**收口为"不做"**，上表就是"为什么不做"的证据（§7 有对应条目）。
将来真要抠，方向是**把首次 `clf` 的 375 ms 做小**（那是上下文/gl4es 初始化），不是预热。

---

### 5.29 缺口语义审计 + 交外部审核的需求书 R0–R5（2026-09-24）

**起因**：用户问"现在离完整版还有什么差距"。我不凭记忆答，先**逐条实测** —— 结果**三处与 §7 口径不符**
（已就地更正）：§7 这类"名字能用/不能用"的断言**会随构建腐烂**，这条经验本身值得记。

| §7 原话 | 实测（8761） |
|---|---|
| "`system`/`unix`/`popen` 清晰报错" | **只有两输出形式**（`[st,out]=system(...)`）清晰报错；`st=system(...)` / `system(...)` / `popen(...)` 一律**静默 −1 / 静默通过**（上游语义如此，但与"宁可清晰报错"相悖 ⇒ 缺口） |
| "无 fontconfig ⇒ `listfonts` 为空" | `listfonts()` **报错**：`structure has no member 'family'` |
| "句柄/对话框一族未做（归图形分支）" | **大部分已能用**：`hgsave`/`copyobj`/`uicontrol`/`uimenu`/`gcbo`/`waitfor`/`inputname`/`menu`/`movie`（要 ≥2 帧）。仍缺：`questdlg`（上游口径）、`uisetfont`（未测）、`voronoi` 单输出 |

**这次实测已固化成探针**：`test/browser/probe-core-names.mjs`（**19 项，8761 全绿**）。
形状值得记：**该成立的断言必须成立**（`system` 两输出清晰报错、`voronoi` 两输出正常、句柄族可用），
**已知缺口按"仍然如此"也算通过**（`popen` −1、`listfonts` 报错、`questdlg` 上游口径、`voronoi` 单输出报错）
⇒ **两个方向的变化都会亮**（缺口被修好、或该成立的东西坏掉）。

**交外部审核的需求书**（用户要"一份简短需求书，他拿去问网页 GPT 要**被广泛搜索验证过的成熟方案**"）：
**按用户要求没有入仓**，只在对话里给了文本。条目（R0–R5）：
- **R0**（本轮新发现）`system`/`unix`/`popen` 的**静默失败** → 清晰报错（覆写层？会不会踩到核心内部的调用？）
- **R1** `popen` 静默 −1（R0 的同类，可并入）
- **R2** `listfonts()` 报"结构无成员" → 人话，或返回只含 FreeSans 的列表；与 R3 的优先级取舍
- **R3**（价值最大）**fontconfig**：建成 emscripten 静态库的先例？缓存目录 `~/.cache/fontconfig` 在只读 MEMFS 怎么办？或"构建期预算映射表"的更轻替代？字体资产策略（4 个 FreeSans gzip ≈1.2MB，已吃掉 M2 省下的 1.55MB 里的大部分）
- **R4** 桥支持 `plot(hax,…)` ⇒ 救回 `voronoi` 单输出（多面板映射 vs handle→panel 表 vs 两输出自绘）
- **R5**（最想请人广泛搜的）**"同步等浏览器"的成熟替代**：JSPI（`-sJSPI`）与 **wasm EH**、与 **side module** 的共存现状；或"分片/重入"的成熟实现（Emacs/GTK/CPython-wasm 那类）

**接续**：用户会随后把 GPT 的方案贴过来 ⇒ 按方案落地，老规矩（8768 验绿 → promote 8761 → 闸门与文档同步）。

---

### 5.30 第五批：外部审核的 R1/R4 落地（2026-09-24）—— 无 shell 的清晰报错 + `plot(hax,…)`

**方案来源**：外部审核对 §5.29 需求书 R0–R5 的答复。它给的执行顺序是
**R1（`popen.m` 覆写）→ R4（`plot(hax,…)`）→ R3（fontconfig）→ R5（JSPI 探针）**，
并明确两条"别踩"：**别用 fake `listfonts` 把验收做绿**（会留下"fontname 看起来能用、渲染没变"）、
**别因为 JSPI 已是正式特性就假设"JSPI + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen"这个组合被验证过**。
本轮做完了前两项（第三项见下、第四项见 §8 待办）。

#### R1/R0 —— shell 入口的**静默失败**改成清晰报错（新资产 `build/webshims/`）

- **先量了机制再动手**：`load path` 里的同名 `.m` **确实遮得住内建** —— 宿主与 wasm 两侧都实测：
  宿主 `which('popen')` 从 `libinterp/corefcn/file-io.cc` 变成 `…/popen.m`、调用落到覆写；
  **wasm 侧同一套**（把 `popen.m` 写进 MEMFS + `addpath` 即可复现）。两条都带上游那句
  `warning: function …/popen.m shadows a built-in function`。
- **只补"上游语义本来就静默"的那一种**。逐行核过 `libinterp/corefcn/toplev.cc` 的 `DEFUN (system)`：
  `return_output = (nargin == 1 && nargout > 1)`；为真时走 `popen` 那条路、失败即
  `error ("system: unable to start subprocess for '%s'")`（**本来就清晰**）；为假时走 `sys::system()`
  返回 waitpid 状态 —— 无 shell 的构建里是 **-1**，于是 `st = system(cmd)` 静默拿 -1、`system(cmd)`
  静默通过。`build/webshims/system.m` 只把 **`status == -1`** 转成清晰报错，其余形态
  （含"两输出 + 显式 `false`"会报 `element number 2 undefined in return list` 这种上游怪癖）**原样透传**；
  `build/webshims/popen.m` 同理（`fid == -1` → 报错）。**两输出形态的文本一字未改**（那是对外契约）。
- **为什么是覆写而不是改 C++**：覆写只作用于**解释器名字解析**；Octave 自己 C++ 里的
  `octave::popen()`（`oct-prcstrm.cc`）不受影响 —— 核内唯一调用者 `__gnuplot_open_stream__.m`
  本来也在 gnuplot 那条不可达的路上。
- **代价（如实）**：`addpath` 该目录时 Octave 会打 2 条 `shadows a built-in function` 警告（`popen`/`system`）
  —— 有意保留（它如实说明"这个内建被覆写了"），而且**不是新噪音**：站点上早有同类一条
  （`m/forge/ifft.m` 遮住内建 `ifft`）。资产**随页面装载**（`index.html` 的启动清单加了 `webshims`）：
  覆写要在 path 前面才遮得住内建，等到用户真调 `system` 时再装就已经晚了。
- **证据**：新套件 `test/browser/accept-shellerr.mjs`（**14 项**）：`which` 指向覆写文件、
  三种以前静默的形态现在都报 `unable to start subprocess`、两输出文本不变、`system()` 用法错误、
  `exist`/普通函数不受影响。探针 `probe-core-names.mjs` 里原本记着"`popen` 静默 -1"的三条
  **当场由红翻绿** —— 这正是那支探针"两个方向都会亮"的设计目的。

#### R4 —— 桥支持 `plot(hax, …)` ⇒ `voronoi` 单输出可用

- **根因**：核心 `voronoi.m` 的单输出路径是 `h = plot (hax, Vvx, Vvy, …, x, y, '+')`（`hax = gca()`），
  而桥的 `plot` 没有"首参是目标 axes"这一层 ⇒ 句柄被当数据 ⇒ 报
  `X and Y sizes do not match`（一句看不出根因的错）。做法就是**复用已有 helper**：
  `args = __pb_strip_axes__ ("plot", varargin)` 之后照旧解析；镜像那一步仍用**原样的 `varargin`**
  （核心自己认这个形态）。同批把 `hold/grid/axis` 的句柄形态也补齐（真实脚本里 `hold(hAx, …)` 是常规写法）。
- **顺手把判据对齐核心**：`__pb_axes_arg__` 从 `isnumeric && isscalar && ishghandle` 改成核心
  `plot/util/__plt_get_axis_arg__.m` 的 `isscalar && ishghandle && v != 0 && ! isfigure`。
  **0 是 root 对象、不是 axes** —— 漏掉这条会让 `plot(0)`（合法：画一个点）被当"句柄优先"而报错。
  收紧后 `xlim(0)` 报的也是核心那句 `LIMITS must be a 2-element vector`。
- **它当场揪出一条"因为判据太松才过"的老测试**：`__pb_strip_axes__` 的 `%!test` 里原来拿
  **figure 句柄**冒充"别的 axes"（`{h2, [0 1]}`），收紧后那条必红 ⇒ 改成用**真 axes 句柄**（`gca()`）。
  这与批次 A 扫出三条假过断言是同一类问题，值得记：**测试里的"替身"如果比真实对象松，它就在骗你**。
- **有意不复制**：`parent` 属性对形态与核心 `legend` tag 支路（桥不做多面板 —— 引入了
  handle→panel 表就要维护 create/delete/subplot/figure 切换与失效，收益不足，见外部审核的比较）。
- **证据**：`accept-plotv2` 72 → **82 项**（新增 10 条句柄契约）；`accept-dldfcn` +3（`voronoi` 单输出、
  显式 `hax`、包装层）；`probe-core-names` 的"`voronoi` 单输出报错"由红翻绿。
  ⚠️ `voronoi` 单输出的**句柄个数**随随机数据变（画的是按 NaN 分段的 `Vv` 射线）⇒ 只断言"拿到了句柄"。
- **`axis(5)` 的文本有两种可能**（实测）：`axis` 的镜像在剥首参**之前**（该 shim 多处提前 return，
  镜像按设计放在开头）⇒ 真渲染器在线时报错来自**核心**（`LIMITS vector must have 2, 4, 6, or 8 elements`），
  切到 `web` toolkit 时镜像关掉、才来自桥。两句话都对 ⇒ 断言只钉"报错且点明是 axis"。

#### 本批怎么上线的（**纯 `.m`/资产批，不重链**）

`assets.py bundle-m <名字> <目录> <mount> <站点>/assets/m/<名字>.js` + `assets.py sync-js <站点> <名字>`
（先打 8768 验绿，再打 8761），外加 `cp bridge/index.html <站点>/`。**wasm 一个字节都没动**
（所以 promote 不需要走 `promote-webgl.sh` 的 docker cp 三段）；`promote-webgl.sh` 的 `M_ASSETS`
已加 `webshims:build/webshims`，下次整站 promote 也会带上它。
全量：`sweep-logs/20260924-031634/` —— **36 套 / 952 PASS / 0 FAIL**（上批 35 套 / 925 项）。

---

### 5.31 第六批：R3 **fontconfig** 上线（2026-09-24）—— `fontname` 真的生效、`listfonts` 能用

**这一批解决的是"批次 D 的两条代价"**（§5.26 就如实记着）：没有 fontconfig 时
`ft-text-renderer.cc` 走 FreeSans 回落 ⇒ ① `fontname` **存得住、渲染时被忽略**；
② `listfonts()` 报 `structure has no member 'family'`（R2）。**同一个根因**，所以只有一条正路：
把 fontconfig 接上。外部审核明确反对"写个 fake `listfonts`" —— 那会把 ① 变成假绿。

**① 机制闸门先行（`build/113/probe-fontconfig.{c,sh}`，30 秒，不碰 Octave）**
`probe-side-module.sh` 的同型做法：先证明"静态 fontconfig + MEMFS 配置/字体"在 wasm 里真能用，
再付全量重编的代价。它当场量出**两条会静默变坏**的事实，直接决定了后面怎么接：
- **宿主环境变量进不来**：node 的 `FONTCONFIG_FILE` 不会进 wasm 的 ENV（打印恒为 `(unset)`），
  所以"外层设环境变量再跑"这条路是无效的 ⇒ 必须在**进程内** `setenv`；
- **编译期默认配置路径是 `//fonts/fonts.conf`（双斜杠）**：`--sysconfdir=/` 的产物，
  Emscripten 的 FS 解析不到它 ⇒ 不显式给变量时 `FcFontList` = **0 个 face 且不报错**
  （现象像"字体没装"，其实是"配置没读到"）。
- 另一条同类：`fonts.conf` 的 `<dir>` 必须是**预载进 wasm FS 的路径**（第一版写成容器里的源路径
  ⇒ 同样是 0 个 face 且不报错）。
- 通过时的实测：`FcInit OK`、`FcFontList` **4 个 face**（Regular/Bold/Oblique/BoldOblique 全列出）、
  `FcFontMatch("FreeSans","Bold") → FreeSansBold.otf`、不存在的家族**落回** FreeSans.otf；
  反证（把 `FONTCONFIG_FILE` 指到不存在的路径）⇒ 0 个 face + `Cannot load default config file`。

**② 库（新脚本 `build/113/build-fontconfig.sh`）**：expat 2.6.4 + fontconfig 2.14.2，
都是静态 + `-fPIC` + `-fwasm-exceptions`（与全树口径一致），装到 `/src/deps/{expat,fontconfig}`。
配方照外部审核给的 OpenSCAD-WASM 先例：`--disable-shared --enable-static --disable-docs --disable-nls
--disable-cache-build --sysconfdir=/ --localstatedir=/ --with-default-fonts=/fonts --disable-libxml2
--with-expat=…`。踩到/绕开的四个坑：
- **`--host=wasm32-unknown-emscripten` 对 expat 用不了**：它自带的 `config.sub` 不认识 emscripten
  （`Invalid configuration … system 'emscripten' not recognized`）⇒ 脚本按 `config.sub` 能力**自动决定**
  给不给 `--host`（不给也能编对，交叉由 `emconfigure` 换 CC 完成，与 zlib/fftw 配方同理）。
- **fontconfig 的 configure 有 emscripten 分支**，会把 `FREETYPE_CFLAGS/LIBS` 写成 **`-sUSE_FREETYPE`**
  （= 让 emcc 去建**非 PIC** 的官方端口）⇒ 工具（fc-cache 等）链接期炸 `undefined symbol: FT_Load_Sfnt_Table`。
  处置：把 freetype 指向**我们自己的 PIC 那份**（configure 期给 CFLAGS，**make 期覆盖 `FREETYPE_*`**，
  因为 configure 的 emscripten 分支会盖掉环境变量）。
- **手写的 `fontconfig.pc` 必须把传递依赖写进 `Libs:`（不是 `Libs.private:`）**：Octave 的探测是
  `AC_LINK_IFELSE`，链接行取 `pkg-config --libs-only-l fontconfig`（**不带 `--static`**）；
  只写 `-lfontconfig` 时探测因 `XML_ParserCreate`/`FT_*` 未定义而判 no，而 configure **只打一句
  WARNING 就照常把树编完**（`config.h` 里 `HAVE_FONTCONFIG` 是 `#undef`）—— 这一版正是这么白跑了一次全量重编。
- **`octave_cv_lib_fontconfig=yes` 预置**（本项目的老对策，§4.7）：容器里那个探测**结构性失真** ——
  `AC_LANG_CALL([], [FcInit])` 生成的是 **C++** 形式的程序（`namespace conftest { … }`），
  却按 `conftest.c` 用 C 编译器编 ⇒ `error: unknown type name 'namespace'`。
  真能力由 ① 的机制闸门独立证明，链接后还有 `link-web.sh` 的产物自检兜底 ⇒ 预置是**有据的**。

**③ configure / 重编 / 重链**：`WITH_OPENGL=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1`。
⚠️ **`WITH_OPENGL=1` 一个字都不能少**（本轮最大的坑）：它同时掌管"把 GL 头探测翻掉的
`GL_GLEXT_PROTOTYPES`/`HAVE_GLBLENDFUNCSEPARATE` 恢复成 1"那段。漏给时：**编得过、链接过、三条自检全绿**，
但运行时**默认 toolkit 掉回 `web`**（`probe-text-render` 直接 SKIP、图走 SVG 回落），
现象极易误判成"fontconfig 把 GL 弄坏了"。已把那段改成 **恢复不了就 FATAL**（原来只是"能改就改"）。
链接命令与批次 D 相同，只多 `WITH_FONTCONFIG=1`（产物写到 `/src/websrc/m2fc-out`，旧产物原样留档）。
`make` 的 in-tree 链接（`octave-cli`、各 `.oct`）仍会因 `cgejsv_`/`zgejsv_` 未定义而报错 ——
**这是既存状态**（§4.7 记过"两个良性未定义"），需要的三个 `.a`（liboctinterp/liboctave/libcorefcn）都正常产出。

**④ 运行期两件事（都在产物里，缺一不可）**：
- `link-web.sh` 生成 `fonts.conf`（`<dir>` = **从 Makefile 读到的 octfontsdir**、`<cachedir>` = `/tmp/fontconfig-cache`）
  并预载到 **`/fonts/fonts.conf`**（不重复打包字体，省 1.87MB）；加两条产物自检：
  `octave.js` 里要有 `fonts.conf` 预载记录、`octave.wasm` 里要有 `FONTCONFIG_FILE` 字符串
  （后者就是查"main.cc 那两行真的进了这次链接"）。
- `main.cc` 的 `execute_interp()` 开头 `setenv("FONTCONFIG_FILE", "/fonts/fonts.conf", 1)` + 尽力建缓存目录。

**⑤ 验收（判别性，外部审核点名要防的那个假绿）**：新探针 `test/browser/probe-fontname.mjs`（**13 项，8768 全绿**）。
关键一条**不看属性、只看像素**：同图同文字，只改 `fontweight`/`fontangle` ⇒ `getframe` 的像素和
**必须不同**；同属性画两次**必须相同**。实测：
`normal 178220056 / bold 178126621 / italic 178224151`（三者互不相同，重复一致）。
`listfonts()` → `FreeSans`；`__get_system_fonts__()` → `family,angle,weight,suitable` 四字段、**n=4**（R2 消失）。
同名探针的**一个写错过的判据也值得记**：`fontname="FreeSans Bold"` 不是"换面"——**家族名不存在**，
fontconfig 会落回 FreeSans Regular（像素当然一样）；真正的映射是
`fontname→FC_FAMILY`、**`fontweight→FC_WEIGHT`、`fontangle→FC_SLANT`**（`ft-text-renderer.cc:330-360` 原文）。
另外 `get_system_fonts` 这个名字在 11.3.0 里**不存在**（`exist`=0），内建真名是 `__get_system_fonts__`（=5）。

**体积账（实测）**：wasm 29,280,186 → **29,463,242**（gz 6,942,595 → 7,016,523）；
js 454,096 → 454,042（gz 87,294 → 87,229）；data 8,674,455 → 8,674,824（gz 2,513,886 → 2,515,502，
多的 369 B 就是 `fonts.conf`）⇒ **三大件 gzip 合计 9,543,775 → 9,619,254（+75,479）**。
⇒ fontconfig + expat 的代价只有 **约 74 KB gzip**（字体那 1.2MB 是批次 D 就付过的）。

#### 5.31.1 顺带修掉：6 个 `accept-113-*` 套件"在 `page.goto` **之前**等 `__octaveReady`"

**症状**：那 6 个套件每个恰好 **183 s**（= 180 s 的等待循环 + 3 s 实活）。原因是那段
"等启动资产装完"的循环被放在了 `await page.goto(...)` **前面** —— 页面还是 `about:blank`，
`window.__octaveReady` 永远不是 `true` ⇒ 循环走满 600×300 ms，然后才去开页；
而开页之后其实 1.5 s 就绪。**每次 sweep 白等 18 分钟**（6×180 s），已存在好几轮没人注意，
因为"它每次都过、只是慢"。

**修法**：把那一段**移到 `page.goto` 之后**（意图不变，位置对了）。
**当场验证**（同一次 sweep 里就能看见）：`accept-113-ode15` **183 s → 5 s**、
`accept-113-pkgoct` **183 s → 5 s**，都仍然全绿；另外 4 个（assets/boot/libs/oct）在改动前那一次
已跑过绿，改动后**逐个重跑也都全绿**（16 / 10 / 17 / 8 项），其中 boot 实测 **3.9 s**。
下一次全量（`20260924-054732`）里 6 个全部在 3–5 s 之间。
**教训**：套件"慢"也是一种腐坏 —— 它不会被任何闸门抓到（全绿），只会悄悄吃掉每次回归的时间。

---

### 5.32 第七批：R5 的 **JSPI 组合探针** —— 通过了（2026-09-24）

**这一批只做"能力闸门"，不碰产品**。外部审核对 R5 的判定是：JSPI 本身成熟（Chrome 137+ /
Firefox 153+ / Safari 27+），JSPI 与 wasm EH 在规范层面兼容，**但"JSPI + `MAIN_MODULE=2` +
`SIDE_MODULE`/dlopen"没有公开的大型项目先例** ⇒ 必须自证，且**探针没过之前不许宣称可用**。

**探针形状**（逐字复刻我们的真实链路，几十行 C/JS，详见 `build/113/NOTES-jspi.md`）：
`JS await Module._run_side(200)` → 主模块 `run_side` → **dlopen/dlsym** side module →
side module 回调主模块 helper → JS 的 **suspending import**（返回 Promise）→ resume。
判据两条：① 墙上时间 ≥ 请求毫秒；② **等待期间 JS tick 增加**（busy-loop 会是 0，只看 ① 会被骗）。

**实测（Chromium 152）**：
| 用例 | 墙上 | tick 增量 | 返回 |
|---|---|---|---|
| ① 主模块 helper 挂起（`main_wait(200)`） | **201 ms** | 1 | 42 |
| ② dlopen→side→主模块→JS 完整链（`run_side(200)`） | **202 ms** | 1 | **43** |
⇒ **9 PASS / 0 FAIL**（`test/browser/probe-jspi.mjs`）。

**三条实现要求**（都是撞出来的，将来接 `pause()` 要照做）：
1. ★ **每个"可能间接挂起"的 JS 入口都要在 `-sJSPI_EXPORTS` 里**：只列 `main_wait` 时从
   `run_side` 进来的链抛 `SuspendError: trying to suspend without WebAssembly.promising`
   —— V8 要求**挂起点所在的整条入口**都是 promising。
2. ★ **JSPI 边界不能直接传 JS 字符串**（要 `ccall`/`cwrap`）：传了会得到 `NULL` ⇒
   `dlopen(NULL)` 返回**主模块句柄** ⇒ dlsym 报
   `Tried to lookup unknown symbol "side_wait" in dynamic lib: __main__`（症状极像"没导出符号"）。
3. ★ **side module 要显式导出符号**：不写就是 `-O2` DCE 后 **64 字节**的空壳。

**还没做（如实）**：P3/P4 —— 把真的 `.oct` 接上、把 `pause`/`kbhit`/`keyboard`/`recordblocking`
改成经 JSPI 等浏览器。那要动 Octave 本体 + 页面调用形态（入口要 promising）+ 重跑全量回归，
**是独立的一批**；本文件只把"机制能不能用"钉死。**也不要回退 Asyncify**（与 `-fwasm-exceptions`
互斥，§5.11 早证过）。

---

### 5.33 第八批：内部属性"缺口"**翻案 —— 不是缺口，未做任何改动**（2026-09-24）

工作令 `build/113/PLAN-next.md` §3.1 原本这么写：我们的 toolkit **缺**核心内部属性
（`isprop(gca,'__legend_handle__')` = 0，`__plotyy_axes__`/`__original_looseinset__`/
`__axes_limits__` 同），核心 `.m` 里那些 `get` 一律报错、偶发漏进 `last_error_message()`
**污染测试判定** ⇒ 要"补齐 22 个名字"、逐条 `isprop` 为真。**一量就翻案，两条都是实测**：

1. **上游也是如此，不是我们的缺陷**。宿主**真** Octave 11.3.0 上切到 `graphics_toolkit('qt')`，
   `get(gca,'__legend_handle__')` **同样报错**（`get: unknown axes property __legend_handle__`），
   `isprop` 同样为 **0**。原因是核心的**惰性 `addproperty`**：这些名字由核心在**用到它们的那一刻**
   现加（`legend.m:286`、`plotyy.m:98`、`colorbar.m:228`、`__gnuplot_legend__.m:629`），
   而**所有**读它们的核心代码都包了 `try/catch`（`__plt__.m:48`、`axes.m:147`、
   `hdl2struct.m:96`、`__errplot__.m:263`）⇒ **"读不到"是预期路径**。
2. **差分 0 差异**：把 67 个候选名（`grep` 出 `scripts/{plot,gui,image}` 里所有 `'__x__'` 字面量）
   × 2 个生命周期阶段（新建图后 / 建过 `legend`+`plotyy`+`colorbar` 之后）的 `isprop` 表，
   在**宿主三个 toolkit（qt / fltk / gnuplot）**与**我们的 wasm** 上各跑一遍 ⇒
   **134 格逐格相同、0 处差异**；顺带证明宿主上这张表**与 toolkit 无关**（qt == gnuplot）。

**"粘连错误"的真身**：`Module.last_error_message()` 是 `build/main.cc:496` 的**绑定**，不是 Octave
函数 —— 宿主上实测 `error: 'last_error_message' undefined`。它读的是上游
`error_system::last_error_message()` 的语义："**最后一次错误**"：被 `try/catch` **吞掉**的错误
也留在里面，且后续成功语句**不清除**（实测 `try,error('boom');catch,end` 之后 `y=3+3`，它仍是
`boom`）。⇒ 那是**测试用法**的问题（拿它当"这次成功了没"的判据），不是产品问题。

**产出（无产品改动 ⇒ 本批不 promote、不跑全量 sweep）**：
- 新探针 `test/browser/probe-internal-props.mjs` + 两边共用的脚本
  `test/browser/fixtures/internal-props-probe.m`：**宿主与浏览器跑同一份 `.m`**，参考表
  **现算现比、不落盘**（随宿主版本自更新；脚本先核对两边 `version()` 必须相同才差分），
  另加三条契约 —— ① 惰性 `addproperty` 的生命周期（建对象前 0 / 建后 1）；
  ② 核心"读不到"是预期路径（读失败后 `plot` 照常出图、`hdl2struct` 照常）；
  ③ `last_error_message()` 粘连（**别拿它当判据**）。
- 实测：8768 上 **11 PASS / 0 FAIL**（`diffs=0`；wasm 与宿主同为 `11.3.0`）。
- 文档：HANDOFF §7 那条"缺属性"改成**翻案**并新增"LEM 粘连"一条；§6 探针行、§8 小口子
  第 1 条同步。

**教训**：工作令里"待办"的**症状描述不能当结论**用 —— 这次差一步就去"补"22 个上游本来就不存在的
属性（**补了反而制造与桌面的新分歧**）。所以本批第一步是先把宿主当真值参照系量一次。

---

### 5.34 第九批：属性对契约 —— 桥不再"多记一条"、也不再"比核心严"（2026-09-24）

工作令 §3 第 2 条要修的是 `plot(…,'parent',hax)` 在桥状态里**多记一条序列**（实测 1 → 2）。
一开工先量，发现**同一类问题不止一处，而且有两头** —— 有的多记、有的干脆报错：

| 形态 | 8761（改前） | 宿主核心 11.3.0（真值） |
|---|---|---|
| `plot(1:3,2:4,'parent',gca())` | 桥状态 **2 条**（第 2 条是 `y = 句柄数值`） | 收（画在当前 axes） |
| `plot(1:3,2:4,'linewidth',2)` | **2 条**（`'linewidth'` 当线型串、`2` 当数据） | 收（真的改线宽） |
| `plot3`/`loglog`/`semilogx`/`semilogy`(…,`'parent',gca()`) | 同样 **2 条** | 收 |
| `surf`/`mesh`(X,Y,Z,`'parent',gca()`) 与 `surf(Z,'linewidth',2)` | **直接报** `expected (Z), (X,Y,Z), …` | 收 |
| `contour(X,Y,Z,'parent'│'linewidth',…)` | 报 `expected (Z), (Z,N), …` | 收 |
| `errorbar(x,y,'parent',gca())` | 报 `expected (Y,E), (X,Y,E), …` | 收 |
| `plot(…,'parent',99)` | （改前静默进状态） | 报 `"parent" value must be an axes handle` |
| `pie(1:3,'linewidth',2)` / `errorbar(…,'linewidth',2)` | 报（文本来自**核心**） | **同样报** ⇒ 这两条本来就对齐 |

**根因三处**（都是"桥自己解析位置参数、没有一个认得出属性对"）：
1. `__pb_parse_series__`：字符令牌一律当线型串，**下一个数值**就当新数据 ⇒ 句柄 / `2` 变成序列；
2. `plot3.m` 与 `__pb_surf_args__.m` 的"丢属性对"循环只认**名字与值都是字符**的形态
   （句柄、数值落进数据槽）；
3. `contour.m` / `errorbar.m` 的 `switch`/`if` 按参数**个数**分支 ⇒ 多一对就落进 `otherwise`。

**做法：判据跟核心同一条，不自己发明**。核心 `__plt__.m:92-104` 的规则是"字符令牌当线型串试，
**不合法 ⇒ 它是属性名、下一个令牌是它的值**"，而"合不合法"由 `__pltopt__` 回答 —— 它是个
**非 private** 的 `.m`（`scripts/plot/util/`），在我们的加载路径上（同目录的 `colstyle` 桥早就在用）。
于是新增三个纯 helper（都能在宿主 `%!test`，进了 `glue-selftest` 名单）：
- `__pb_is_linespec__` —— 委托 `__pltopt__`。**不许手写颜色字母表**：`"red"`、`";key;"` 也是合法
  线型串，手写表必然走样（`__scatter__.m` 那种"关键字 + 无值"的语法更不能套这条规则，
  所以只用在核心自己用 `__plt__` 解析的那几个 shim 上）。
- `__pb_check_parent__` —— `'parent'` 值不是 axes 句柄时**与核心同一句**报错；是别的 axes 时报
  "桥只跟踪当前 axes"（桥只有当前面板一份状态，画到别的面板属于静默做错）。
- `__pb_strip_props__` —— 剥属性对；**末尾那个"孤零零的不合法字符"有意不动**（保持老行为，
  核心在那里会报 `properties must appear followed by a value`，收紧要另开一项）。

接到 `plot`/`plot3`/`loglog`/`semilogx`/`semilogy`（`__pb_parse_series__` 之前）、
`__pb_surf_args__`（替掉那条只认双字符的循环）、`contour`/`errorbar`。**镜像那一步仍拿原样
varargin** ⇒ 属性照旧真生效。

**实测（8768，改后）**：`plot(…,'parent',gca())` 桥状态 **1 条**；`'linewidth',2` 之后 `'r--'`
仍取红（`#FF0000`）；`drawnow` 后 `children=1`（真渲染器照画）；`'parent',99` 报核心同句；
别的 axes 报 "only tracks the current axes"；surf 2 / mesh 6 / contour 16 / errorbar 2 ——
**全部与不带属性对同数**。套件：`accept-plotv2` **92/0**（+10 条新断言）、`accept-plot3d` **44/0**
（+10 条），相邻五个（`accept-p5-graphics` 65 / `accept-t2-graphics` 26 / `accept-print` 43 /
`accept-p5-fallback` 15 / `accept-selftest` 33）全绿；宿主 `glue-selftest` **82/82**
（+13：三个新 helper 自己的 `%!test`）。

**踩到的两个坑（记下来，别再踩）**：
1. ★ **`bundle-m` 的挂载点不是"约定"，是参数**。我第一次传了 `/usr/src/octave/m`（少一层），
   于是 `__pb_mirror__.m` 被写到 `m/` 根上 ⇒ 桥的"摘桥目录"路径手术把**整棵核心 m 树**摘了
   ⇒ `clf` 报 `no core implementation cached`，同时刷一串
   `core handle for 'x' resolved to the bridge itself (/usr/src/octave/m/plot/...)` 的 warning。
   **正确挂载点是 `/usr/src/octave/m/plotbridge`**（`promote-webgl.sh` 的口径就是
   `meta.mount or 默认 = m/<名字>`）。**诊断线索**：warning 里的路径如果是核心自己的文件、
   却被判成"就是桥"，那一定是 `BPDIR` 被算到了**上层目录**。
2. 自己的 `%!test` 里写了 `{magic (3), …}` —— cell 字面量里"函数名 + 空格 + `(…)`"会掉进
   **命令语法**、变成两个元素（`magic` 与 `3`）；这坑本仓记过两次（`__pb_surf_args__.m:92`），
   这次是自己又踩了一遍。字面矩阵才是安全写法。

**一次偶发（记档，别当成回归）**：promote 后 8761 的首轮全量 sweep 里 `accept-forge`
**整页崩**（`Error: page.evaluate: Target crashed`，8 条 CRASH，不是断言失败），该轮合计
36 套 / **953** 项、脚本点名 `accept-forge`；**单独重跑 22/0**，紧接着整轮重跑
**36 套 / 975 项全绿**（`sweep-logs/20260924-081041`）。同一条资产在 8768 上是绿的、两边
sha 相同 ⇒ 判为偶发（页面/渲染进程崩），不是本批改动引起。**教训**：sweep 的"有问题的套件"
里若是 `Target crashed`，先单独重跑一次再下结论 —— 否则会把偶发记成回归（或反过来放过去）。

---

### 5.35 第十批：交互/等待一族 —— `waitbar` 修好、"挂死族"改成清晰报错（2026-09-24）

工作令 §3 第 3 条要的是"`waitbar`/`uisetfont` 的误导报错改清晰、`ginput`/`keyboard` 不许挂死"。
开工先量（8768；**每例新页面 + Node 侧 8 s 超时**，因为挂死会阻塞页面主线程）：

| 名字 | 改前 | 改后 |
|---|---|---|
| `waitbar(...)` | 报 `get: invalid handle (= 2)`（**整族坏**） | ✅ **能用**：句柄有效、`tag=waitbar`、1 个 axes、更新 xdata、`getframe` 有墨 ≈8.9e6 |
| `uisetfont` | 报 `setappdata: H must be a scalar or vector of graphic handles` | 清晰报错（原因 + 替代写法） |
| `ginput(1)` | **挂死**（8 s 无响应） | 清晰报错 |
| `keyboard` | **挂死** | 清晰报错 |
| `uiwait(gcf())` | **挂死** | 清晰报错 |
| `waitfor(gcf())` | **挂死** | 清晰报错 |
| `waitforbuttonpress` / `gtext` | **挂死**（内部就是调 `ginput`） | 同上（连带受益） |

**`waitbar` 的根因在桥、不在核心**：它建图时带 `"integerhandle","off"`（一行 10 个属性对），
而桥的 `figure.m` 一直把**面板号**当图号传给 `__go_figure__(n, props…)`。带这一对参数时 Octave
要的是 **NaN**（"让 Octave 自己分配"——宿主核心 `figure.m` 在"没给图号"时写的正是 `f = NaN`）：
- 宿主（真 11.3.0）：`figure('integerhandle','off')` OK（返回 -1.394）；
  `__go_figure__(2,'integerhandle','off')` **报** `graphics_handle::free: invalid object 2`。
- 8768：`__go_figure__(5,'integerhandle','off')` → `invalid graphics object`；
  `__go_figure__(NaN,'integerhandle','off')` → 有效（-1.345）；`__go_figure__(0,…)` → `failed to create figure handle`。

修法：新纯 helper `__pb_integerhandle_off__`（宿主可测）扫属性对，命中就传 NaN；**其余形态逐字未动**
—— `figure(1)/figure(2)` 那条"面板号 == 真句柄"的假设一个字节都没改，所以 T2/plotv2/plot3d/p5
那些套件不受影响（实测全绿）。**连带**：`dialog`/`errordlg`/`msgbox` 这些对话框的地基也一起好了
（它们建的是同一种图）。

**挂死族改成清晰报错**：新增 `build/webshims/{ginput,keyboard,uisetfont,uiwait,waitfor}.m`，
沿用 R1 那条"load path 里的 `.m` 遮得住内建/核心"的路（`keyboard`/`waitfor` 是**内建**，
另外三个是核心 `.m`）。报错点明原因（等浏览器事件需要 JSPI 挂起，本构建还没有）+ 替代办法
（`input()` 走 `window.prompt` **可用**；字体直接 `set(h,"fontname","FreeSans","fontsize",12)`）。
**交底**：覆写后 `exist("keyboard")`/`exist("waitfor")` 由 **5** 变 **2**、`which` 指向 `webshims/`
—— 名字面在如实说话。**同时更正**了 HANDOFF 早先那句"`waitfor` 可用"（当时只验过"名字存在"）。

**钉子**：新套件 `test/browser/accept-interactive.mjs`（15 项）。形状上的关键点是
**"每例开一个新页面 + Node 侧 8 s 超时"** ⇒ **挂死会被判成失败**，而不是把整个套件卡在那里。

**自己踩的两个坑（记下来，别再踩）**：
1. 套件第一版用 `text.replace(/LIBGL:[^|]*/g, '')` 清噪音 —— 本构建的日志里**没有 `|`**，
   于是 `[^|]*` 一路吃到**整段末尾**，把我们正要匹配的那一行也吃掉了 ⇒ 症状是"三条 waitbar 断言
   永远读到空串"（我还一度以为是 waitbar 没输出）。**改成按行过滤**才对。
2. 本构建**第一次建图**会先刷一屏 gl4es 初始化日志，`disp` 的输出排在它**后面** ⇒ 断言要
   **轮询 sentinel**（出现即返回），别用固定 `sleep`；否则随机器负载随机假失败。

**实测**：`accept-interactive` **15/0**；相邻八个套件全绿（`accept-t2-graphics` 26 /
`accept-plotv2` 92 / `accept-plot3d` 44 / `accept-p5-graphics` 65 / `accept-print` 43 /
`accept-p5-fallback` 15 / `accept-selftest` 34 / `accept-queue-drift` 12）；
宿主 `glue-selftest` **84/84**（+2：`__pb_integerhandle_off__`）。

---

### 5.36 第十一批：可用包可见性 —— 账本 + "装完就认识"（2026-09-24）

工作令 §3 第 4 条："`OctaveAssets.list()` → `__webassets_available__()`，让 `pkg list` 能说清
'有哪些可加载但尚未装载'"。开工先量，量出**两句会误导人的话**（都在 8768 实测）：
- `pkg load statistics` → **`package statistics is not installed`** —— 而 statistics 就在
  `assets/pkg/statistics.js` 里等着被装；
- `pkg list` → 恒 **`no packages installed`**，哪怕 `await OctaveAssets.load('statistics')` 已经装过。

**根因两条**（都是"两边互相看不见"）：
1. **解释器看不见 JS 的加载器对象** ⇒ 有什么可装、装了哪些，在 `.m` 侧完全不可问；
2. **pkg 数据库是启动时的一次快照**（`index.html` 在 boot 时跑一次 `__pkgfix_sync_db__()`，
   从磁盘现状生成）⇒ 之后按需装载的包**不在快照里**，所以 `pkg list`/`pkg load` 都当它不存在。

**做法**：
- **账本落盘**：`bridge/assets-loader.js` 新增 `publish()` —— 在 **init 之后**与**每次装载成功之后**
  把 `{available, loaded, pkg_available, pkg_loaded, stamp}` 写进 `/tmp/webassets.json`
  （`jsondecode` 本构建可用；写失败全 try 兜住，绝不弄坏主流程）。`pkg_available` 只放
  `url` 以 `assets/pkg/` 开头的那些 ⇒ 自动排除基础设施资产与 `*-oct` 伴随件（实测名单 12 个：
  control, geometry, matgeom, miscellaneous, nan, optim, quaternion, signal, splines, statistics,
  struct, tsa）。
- **`.m` 侧三个只读 helper**（`build/pkgfix/`，宿主可测，已进 `glue-selftest`）：
  `__webassets_info__()`（读账本，坏文件/缺文件都**返回空结构而不报错**）、
  `__webassets_available__()`（全量）、`__webassets_pending__()`（**可加载但未装载的包**）。
- **装完就认识**：`publish()` 的兄弟 `afterLoad()` —— 装载的是**包**（`assets/pkg/*.js`）且页面就绪时，
  顺手跑一次 `__pkgfix_sync_db__()`，让数据库随时反映磁盘现状。**这一条是"能不能用"的关键**：
  实测装完 `statistics` 之后 `pkg list` 列出 `statistics *| 1.7.3`、`pkg load statistics` 成功、
  `normpdf(0,0,1)` = **0.398942**。

**没能做的那一半（如实记，附实测原因）**：**覆写 `pkg` 本身**（好让 `pkg load <未装载的包>`
直接给"它是可加载的 web 资产"这句提示）**做不到**，因为
`which('pkg')` = `/usr/src/octave/m/pkg/pkg.m` 位于 **path 的第 2 位**，而我们所有的资产目录
（webshims P3 / webdoc P4 / webgraphics P5 / oct P6 / plotbridge P7）**都排在它后面**，
加载器又只会 `addpath(...)`（**追加**）⇒ 资产目录**遮不住** `pkg.m`。
两条能走的路（都没做，留给下一轮）：① 给加载器/包格式加"**prepend**"（`addpath('-begin', …)`）
的能力；② 把 `pkg.m` 放进 `m/pkg`（**不行**：pkgfix 的挂载点就是 `/usr/src/octave/m/pkg`，
放同名文件会**覆盖核心 pkg.m** —— 这条差点踩上，靠 `which('pkg')` 实测拦下）。
⇒ 现在"能说清"的入口是 `__webassets_pending__()`（12 个包名一目了然），`pkg load` 对
**已装载**的包完全正常。

**钉子**：新套件 `test/browser/accept-pkgview.mjs`（**17 项**）：账本两侧**数量一致**
（`OctaveAssets.list()` vs `__webassets_available__()`）、待装名单排除基础设施与 `-oct`、
装完从名单消失、`pkg list` 看得到、`pkg load` 成功、`normpdf` 真出数。

**实测**：`accept-pkgview` **17/0**；loader 相关套件全绿（`accept-pkg` 16 / `accept-113-assets` 16 /
`accept-forge` 22 / `accept-forge2` 44 / `accept-forge-oct` 15 / `accept-selftest` 37）；宿主
`glue-selftest` **91/91**（+7：三个 helper 的 `%!test`）。

---

### 5.37 第十二批：`print -dpng` 真出图（**断言翻面**，2026-09-24）

工作令 §3 第 5 条："`print -dpng/-djpg` 走页面 PNG"。开工先弄清那张 PNG 是谁写的：
**真渲染器自己**——`webgl_toolkit.cc` 的 `redraw_figure` → `publish_png` 每次重画都把当前图
写成 `/tmp/p5_fig.png`（常量 `P5_PNG_PATH`）。所以根本不需要"在沙箱里造光栅器"：

- **`-dpng`** = `drawnow()` 之后**逐字节拷贝**那张 PNG。实测与页面那张 `isequal` 为真、
  10,635 字节（不是重编码，连字节都不动 ⇒ 页面里看到的和导出的是同一张）；省略 `-d`、
  靠 `.png` 扩展名也同样走这条路。
- **`-djpg/-dbmp/-dtga`** = 借图像资产（`imread`/`imwrite`，R4）转码：装了 `webimage` 时
  实测 `-djpg` 出 `FFD8`（13,958 字节）、`-dbmp` 705,654 字节、`-dtga` 22,880 字节；
  **没装时给可操作报错**（"load webimage"），而不是 `imfinfo: support for Image IO was
  unavailable…` 那种困惑话。
- **没 GL 的页面**（SVG 回落）那张 PNG 根本不存在 ⇒ `-dpng` 明确报错并指向 `-dsvg`，
  而且**不写半个空文件**。`-dgif/-dtif` 等仍清晰报错并列出可用的。

**两条旧断言翻面**（这正是本仓的规矩：行为变了就改断言，别改检查器）：
`accept-print.mjs` 里"`-dpng` 必须报错、并建议 `-dsvg`"两条 → 改成"必须出图、且与页面那张
逐字节相同"；`probe-core-names.mjs` 的 `print -dpng 清晰报错（无光栅器）` 同样翻面。
**另外顺手翻掉一条一直没跟着 R3 翻的断言**：`probe-core-names` 里 `listfonts()` 还写着
"已知缺口（待 R3）：报结构无成员"，而 R3（fontconfig）早就在线上了 ⇒ 探针当场变红
（`nf=1`），改成"列出 FreeSans"。**这就是那个探针存在的意义**：构建变了、断言没改，它报警。
（也因为它**不在 sweep 里**（sweep 只跑 `accept-*`），这条腐烂一直没被自动发现 —— 记一笔。）

**踩到的两个小坑**：① `accept-print` 的 `evVal()` 的 `want` 是**字符串**（内部走
`wantHit`→`includes`），传正则会抛 `TypeError: First argument to String.prototype.includes…`；
② `accept-p5-fallback` 的 `ev()` 返回 `{rc,out}` 而**不是**字符串 —— 两个套件的 helper
形状不同，别想当然（都是我这次踩的）。

**顺带交底**：`print(...,'-dpng')` 会带出一条 `opengl_texture::create: OpenGL error while
generating texture data` 警告 —— **不是本项引入的**：纯 `drawnow` 也有（实测）。
**实测**：`accept-print` **45/0**（+2）、`accept-p5-fallback` **17/0**（+2）、
`probe-core-names` **23/0**。

---

### 5.38 第十三批（**开工即收口**）：小口子 6/7 都是**重链车道**，不是页面/资产活（2026-09-24）

工作令把这一批列成"不碰 wasm 的小口子"，一量就发现**两条都要重链**：

- **7）IDBFS 持久化**：`Module.FS.filesystems` 实测只有 **`["MEMFS"]`**
  （`IDBFS` 是 `undefined`、`NODEFS` 也是），`FS.mount`/`FS.syncfs` 虽然有，但**没有可挂的
  持久文件系统**。原因：Emscripten 的 IDBFS 在 `library_idbfs.js` 里，**必须显式 `-lidbfs.js`**
  才会编进去，而 `build/113/link-web.sh` 的链接行里没有它。⇒ 要动的是**链接行 + 重链**，
  之后才有页面侧那三件事（`FS.mount(IDBFS, {}, '/home/web_user')`、开机 `syncfs(true)` 读回、
  明确的写回点）。**顺带量到**：`getenv('HOME')` = **`/home/web_user`**、`pwd()` = `/`
  ⇒ 挂载点选它是对的（与计划一致）。
- **6）字体家族 +1（FreeMono ×4）**：字体是**预载**进 MEMFS 的
  （`/src/work/octave-install/share/octave/11.3.0/fonts/FreeSans*.otf` 在预载文件表里，
  见 `link-web.sh` 的 PRELOAD）⇒ 加 4 个 FreeMono 面 = **改预载 + 重链**（顺带 data/js 变大），
  不是"只往 fonts.conf 的 `<dir>` 里丢文件"。

**因此这两条与 JSPI 车道的 G1（要加 `-sJSPI` 重链）是同一趟活** —— 一次重链把
`-lidbfs.js`、FreeMono 预载、`-sJSPI`/`eval_async` 一起做，才是最省的做法。本轮到此为止：
**没有重链**，8761 上的部署件一个字节没动（这是有意的 —— 验收底线优先）。

**下一轮的配方（照抄即可）**：
0. **权威链接命令**（本仓已记录在 §5.26，**别再自己拼**）：批次 D/M2 的那条 + `WITH_FONTCONFIG=1`
   —— 当前部署件就是这么链出来的（把输出目录换个名字即可）：
   ```sh
   sudo docker exec o113 bash -lc 'export PATH=/src/bin:$PATH; cd /src/bin && \
     M_SRC=/src/work/m-prerendered/m GL_LIBS=1 GL_BACKEND=webgl P5_TOOLKIT=1 \
     MAIN_MODULE_LEVEL=2 KEEP_LIST=/src/libwork/keep.txt \
     LIB_FUNCS="emscripten_run_script,__assert_fail,abort,exit" \
     OCT_SCAN_DIRS=/src/octs-site BASELINE_WASM=/src/websrc/out/octave.wasm \
     WITH_FREETYPE=1 WITH_FONTCONFIG=1 bash link-web.sh /src/websrc/<新目录>'
   ```
   （`WITH_FONTCONFIG=1` 一个字都不能省 —— 省掉就是"编得过、链接过、自检全绿，但字体静默没有"，
   与 HANDOFF ① 那条 `WITH_OPENGL=1` 是同一族陷阱。）
1. `docker cp` 改过的 `build/113/link-web.sh` 进容器（**别忘**，本仓为此白跑过两次大重建；
   顺带实测记一笔：容器里那份与仓库只差**一句注释**（`HANDOFF §10.3` → `HISTORY §10.3`），
   功能一致 —— 但**每次改完仍要 cp**）；
2. 链接行加 `-lidbfs.js`；PRELOAD 里加 `etc/fonts/FreeMono{,Bold,Oblique,BoldOblique}.otf`
   （源在 Octave 树里，raw 约 1.04 MB）；
3. `link-web.sh` 重链 → 自检（`FS.filesystems` 里有 IDBFS；`fonts.conf` 的 `<dir>` 覆盖到
   FreeMono；`oct_fonts_dir()` 路径不变）= 产物 sha 与体积记档；
4. 页面：`FS.mount(Module.FS.filesystems.IDBFS, {}, '/home/web_user')` + 开机 `syncfs(true)`
   读回 + **明确写回点**（`Module.webSync()`，并在页面控制台每条命令后做一次去抖写回）；
5. 验收（新套件 `accept-idbfs.mjs`）：`save('/home/web_user/x.mat','v')` → `webSync()` →
   **整页 reload** → `load(...)` 取回 v；**负对照**：写到 `/tmp` 的东西 reload 后**必须不在**
   （证明"真的重载了"、不是假过）；字体：`listfonts()` 里出现 FreeMono（R3 的探针已钉住
   `fontname` 真改像素，这里加一条家族即可）。

---

### 5.39 第十四批：**重链把 6/7 两件真做成了**（IDBFS 持久化 + FreeMono）（2026-09-24）

上一节刚判完"要重链"，接着就把它做了 —— 因为**权威链接命令是现成的**（§5.26 的 M2 那条 +
`WITH_FONTCONFIG=1`，今天部署件就是这么链出来的），改两处、重链 30 秒，比攒着等下一轮便宜。

**改了两处 `build/113/link-web.sh`**：
1. **字体预载 4 → 8 个**（加 FreeMono ×4，raw +1,036,292 字节）；
2. **`-lidbfs.js` + `EXPORTED_RUNTIME_METHODS` 加 `IDBFS`**；
3. 顺手把**自检**补上（这是本轮最值钱的部分）：
   - FreeType 自检从"含 FreeSans"扩成**逐个点名 8 个面**（缺一个就 FATAL）——
     因为"预载成功了"与"四个面都在"是两件事，少一个的表现是"家族名静默落回"；
   - 新增 **IDBFS 自检**（产物里要有 IDBFS 实现 + 运行时导出）——缺 `-lidbfs.js` 时构建期
     **一声不响**，页面里 `FS.mount(IDBFS,…)` 才炸。

**产物账（重链前后）**：`octave.wasm` **sha 逐字节不变**（`4faaa96d…`，29,463,242 B，因为只动
预载与 JS 胶水）；`octave.data` 8,674,824 → **9,712,174**（+1,037,350 ≈ FreeMono 4 个面 +
fonts.conf 的那几条规则）；`octave.js` 454,042 → **461,234**（IDBFS 胶水）。**五条自检全过**。

**页面侧（`bridge/index.html`）**：
- `postRun` 里把注释掉的挂载点**换成真代码**：`FS.mount(IDBFS, {}, '/home/web_user')`
  （挂载点实测 `getenv('HOME')` 就是它）+ 开机 `syncfs(true)` 读回；
- **明确的写回点** `Module.webSync(cb)`；交互路径由 `ev()` 里的**去抖写回**（800 ms 合并）兜住。
- 没有 IDBFS 的产物**不报错、不挂**，只打一行 warn（页面照常可用）。

**实测（8768）**：`FS.filesystems` = `["MEMFS","IDBFS"]`；`save('/home/web_user/persist.mat')` +
`webSync()` + **整页 reload** ⇒ `load` 取回 **x=4242**；**负对照** `/tmp` 那份 reload 后
`exist` = **0**（证明确实重载过）；`listfonts()` = 2 个家族（FreeSans + **FreeMono**）。
新套件 `accept-idbfs.mjs`（9 项）全绿。

**★ 加 FreeMono 顺手炸出的一个真问题（探针当场抓住）**：字体目录里一旦有**第二个**家族，
fontconfig 对"要不到的家族"的兜底从 FreeSans 变成 **FreeMono**（按目录里家族名排序，FreeMono
在前）⇒ `fontname="Arial"`/`"Helvetica"` 这些学生常写的名字会变成**等宽**字体（实测：全都
等于 FreeMono 的像素和）。修法是在我们生成的 `fonts.conf` 里加两条规则：
① 等宽请求（`Courier`/`monospace`）→ FreeMono（这才是对味的替换）；② 其余要不到的家族
**追加一个 weak 的 FreeSans 兜底** ⇒ 回到改动前的默认。重链后复测：
`Courier`/`monospace` = FreeMono、`Helvetica`/乱名字 = **FreeSans**（各与目标字体像素和一致）。
`probe-fontname.mjs` 从 13 项涨到 **19 项**，把这套替换策略钉住。

**教训**：加一个"资源"（这里是字体家族）会**改变兜底路径**，光看目标资源本身没问题。
探针（`probe-fontname`）就是靠"同一段文字换家族名比像素和"这种判别性断言当场抓住的 ——
**凡是"多了一种东西"，都要问一句"没有它的时候走哪条路，现在还走那条吗"**。

**实测**：8768 全量全绿 → promote（`octave.{wasm,js,data}` + `index.html`）→ 8761 全量全绿；
`accept-idbfs` 9 项、`probe-fontname` 19 项、宿主 `glue-selftest` 91/91。

---

### 5.40 一天收束 + 新工作令 `PLAN-jspi.md`（2026-09-24 晚）

**这一天（2026-09-24）的七个提交**（`PLAN-next.md` 的七件小口子全部收口）：

| 提交 | 内容 | 结果 |
|---|---|---|
| `3ffc23e` | 小口子 1 · toolkit 内部属性 | **实测翻案**：与宿主三个 toolkit 逐格 0 差异 ⇒ **不是缺口、未改产品** |
| `f385767` | 小口子 2 · 属性对契约 | 桥不再多记一条、也不再比核心严（8 个 shim 对齐 `__pltopt__`） |
| `26dcd73` | 小口子 3 · waitbar + 挂死族 | **waitbar 真能用**（桥的 `integerhandle` 形态）；5 个名字改成清晰报错 |
| `ed999ee` | 小口子 4 · 可用包可见性 | 账本 + 待装名单（12 个包）+ **装完就认识**（pkg 库自动重对齐） |
| `c271fea` | 小口子 5 · `print -dpng` | **真出图**（逐字节拷页面 PNG）；两条旧断言翻面 |
| `beff412` | 小口子 6/7 改判 | 实测两条都是**重链车道**（IDBFS 未编入、FreeMono 是预载） |
| `8a07bb7` | 小口子 6+7 真做 | **重链一趟**：IDBFS 持久化 + FreeMono（`octave.wasm` sha 不变） |
| `54c96f8` | 探针跟上 | `probe-core-names` 的 `listfonts` 断言跟上"2 个家族" |

收束时 8761 = **39 套 / 1025 项 / 0 失败**（`sweep-logs/20260924-102953`），
三大件 gzip 9,619,254 → **10,260,744**，交付包重打且包内 wasm 与部署件同 sha。

**新工作令**：`build/113/PLAN-jspi.md` —— 旧 `PLAN-next.md` 的 §3 已收口、§2 的 JSPI 顺序并入。
内容包括 **G0 能力门 → G1 `eval_async`（重链）→ G2 `pause`+EH/SjLj 压力矩阵（真正风险点）→
G3 `ginput` → G4 Ctrl-C → G5 `keyboard` → G6 dlopen×挂起压力**，外加**七条收尾债 D1–D7**：
① 文档与产物对齐（README 交付包行、`dist/DEPLOY.md` 的 `-dpng` 行 —— 都是本轮改动造成的矛盾）；
② `probe-*` 纳入定期跑（它们不在 sweep 里，本轮抓到 **2 条**腐烂断言）；③ `sweep.sh` 对
`Target crashed` 自动重跑一次；④ 两站点一致性闸门；⑤ 规则 B 162 处复核；⑥ `pkg load <未装载>`
自动装载（prepend 或同步 XHR）；⑦ IDBFS 边界（写频次 / 配额 / 配额满时的行为）。

**这一轮最值得记住的两条**：
1. **"多了一种东西"就要问"没有它时走哪条路，现在还走那条吗"** —— 加 FreeMono 就把 fontconfig
   对"要不到的家族"的兜底从 FreeSans 改成了 FreeMono（`fontname="Arial"` 会变等宽），
   靠"同文字换家族名比像素和"的判别性断言当场抓住。
2. **探针要定期跑，否则它就是一份会腐烂的账** —— `probe-*` 不在 `sweep.sh` 里，于是
   一条从 R3 起就该翻面的 `listfonts` 断言一直红着没人知道；本轮顺手翻掉，并把它列进 D2。

---

### 5.41 收尾债 D1–D4：把"验收网"的四条洞补上（2026-09-24 晚）

新工作令 `PLAN-jspi.md` 把七条收尾债排在 JSPI 主线**前面**（都无风险）。本轮先做完 D1–D4：

- **D1 文档与产物对齐**（本会话自己造成的两处矛盾，都改了）：
  · `README.md` 交付包行：`…-20260923` / 首包 gzip ≈9.9MB → `…-20260924` / **10.26MB**；
    另补两条新能力行（"等用户动作"一族改清晰报错、`waitbar` 可用）。
  · `dist/DEPLOY.md`：**删掉"`-dpng` 打印清晰报错"**（它现在**真出图**：逐字节拷页面渲的 PNG），
    改写成"位图与矢量两条路"；补上交互族、IDBFS 持久化、两个字体家族的替换规则；
    验收数字 36 套 952 项 → **39 套 1025 项**，并注明逐套表只列主要套件、新版三套与 `probe-*` 的项数。
- **D2 `probe-*` 纳入定期跑**：`PROBES=1 sh sweep.sh <URL>` 会把 `probe-*` 一起跑
  （默认仍只跑 `accept-*`，日常不拖慢）。**理由见 §5.40 的第 2 条教训。**
- **D3 `sweep.sh` 对"页面偶发崩"自动重跑一次**：判据 `Target crashed`（整页/渲染进程崩，
  不是断言失败）；重跑仍崩才算失败，报告里标 `[重跑]`（让人知道这份结果不是一次拿到的），
  崩溃日志留成 `<套件>.log.crashed1` 供事后看。
- **D4 两站点一致性闸门**（新脚本 `build/check-site-parity.sh`）：比
  `octave.{wasm,js,data}` + `index.html` + `assets-loader.js` + `VERSION`，以及**清单引用到的**
  资产包 sha 与清单条目；默认只报告（**差异不一定是错**：8768 本来就允许先改），
  `--strict` 供 promote 之后跑（应当 0 差异）。
  ★ 一个设计细节值得记：第一版把"站点目录里所有 `assets/m/*.js`"都比一遍，于是 8768 上那份
  **没被清单引用的遗留文件**（退役 OSMesa 线的 `p5osmesa.js`）每次都让闸门变红 ——
  **一个总在红的闸门等于没有闸门**。改成"只比清单引用到的 + 遗留文件单独报出、不算差异"，
  现在实测两个站点**完全一致**（`--strict` exit 0）。那份遗留文件我**没有删**（不是我建的，
  删之前该先问）。

---

### 5.42 G0：JSPI 能力门 —— **两个独立 gate**，且现在"不说话"（2026-09-24 晚）

新工作令 `PLAN-jspi.md` 的 JSPI 主线的第一站（**不碰 wasm**，只改页面与测试）。

**为什么是两个 gate**（GPT 复审的红线，照抄）：`typeof WebAssembly.Suspending` **只说明 API 在**，
不说明它在**这个产物 + 这个解释器**上真能用 —— Pyodide 至今仍有 JSPI 稳定性 issue，还提供"禁用
JSPI"的 workaround。所以门有两道：① API 存在性；② **Octave 级冒烟**（真跑一次 suspending 入口：
等一小段 **且** 等待期间页面定时器**还在跑** —— busy-loop 会让 ticks=0，只看"值对"会被骗）。

**做法**（`bridge/index.html`）：`window.__octaveJspi = {api, smoke, entry, note}`，其中
`smoke ∈ pending|pass|fail|no-entry|api-missing`；配一个 `window.__octaveJspiRequire(feature)`：
可用 ⇒ `null`，不可用 ⇒ **一句人话**（点明"需要 JSPI"+ 支持的浏览器版本：Chrome ≥137 /
Firefox ≥153 / Safari ≥27），而不是让用户撞上 `TypeError: WebAssembly.Suspending is not a constructor`。

**两个刻意的克制**：
1. **现在不弹任何提示**。本构建里"等用户动作"一族全是**清晰报错**（`webshims/`），**没有任何功能
   依赖 JSPI** ⇒ 现在弹"你的浏览器不支持"是**假警报**。提示只在 `__octaveJspiRequire()` 被调用时
   才出现 —— 那是 G3/G5 接上以后的事。
2. **冒烟跟着产物走，不跟着愿望走**：产物里还没有 suspending 入口（G1 才加 `eval_async`），
   于是如实记 `smoke=no-entry`；探针里那条断言写成"**有入口就必须 pass**" ⇒
   **G1 落地后它自动变成硬要求，探针不用改**。

**实测**（8768，新探针 `probe-jspi-gate.mjs` **11 项全绿**）：
- 正常 Chromium：`api=true`（`Suspending`/`promising` 都是 function）、`smoke=no-entry`（如实）；
- `addInitScript` 删掉两个 API 之后：`api=false`、`smoke=api-missing`、**产物照样起得来**
  （`eval_string("2+2")` 正常）—— 这就是"单产物 + 运行时能力门"的关键证据；
- 依赖项拿到的是**含浏览器版本的一句话**，全程**没有**裸 `TypeError`。

**8768 全量 39 套 / 1025 项全绿** → promote（只动了 `index.html`）→ 8761 全量全绿。

---

### 5.43 G1 第一次尝试：**失败并回退**，但换来一条产品级教训（2026-09-24 深夜）

按 `PLAN-jspi.md` 做 G1（给主产物加 `eval_async`）。**做出来的东西是坏的，已经全部回退**，
8761 一个字节没动。如实记下来，免得下一轮重踩。

**做了什么**：`main.cc` 加 `emscripten::function("eval_async", &eval_string, async())`
（同步 `eval_string` 一字未改）；`link-web.sh` 加 `JSPI_FLAGS=( -sJSPI -sJSPI_EXPORTS=eval_async )`
（默认开，`WITH_JSPI=0` 可关）。重链成功、**五条自检全过**、`octave.wasm` 29,463,242 → 29,463,132。

**实测（8768，部署后立刻发现）**：
- `typeof Module.eval_async === 'function'` ✅ —— 绑定**在**；
- 但**一调就炸**：`RuntimeError: null function`（`42` / `pause(0.2); 43` / `error("boom")` 三例全炸，
  `ticks`=0）；
- 紧接着的探针**把页面一起卡死**（300 s 未返回）。

**事故（比 G1 本身更值钱）**：G0 的冒烟原本**在开机时自动跑**，而它第一步就是调 `eval_async`
⇒ 那个坏产物一部署，**8768 上每次开页都会卡死**（所有浏览器验收一起挂）。**已改成按需**：
`window.__octaveJspiProbe(timeoutMs)`（开机只记 `unprobed`），配超时兜底与
`pass-blocking/timeout` 三态；探针改为**主动触发**再断言。
**教训一句话**：**"探测一个可能把主线程卡住的东西"不能放在开机路径上** ——
探测器的失败模式要和被探测的东西**解耦**。

**为什么坏（还没查清，只记嫌疑）**：上游 `test/test_other.py::test_embind_jspi` 只用
`-lembind -sJSPI`（**不带** `JSPI_EXPORTS`）⇒ 旗标本身大概率不是问题。嫌疑排序：
① **`MAIN_MODULE=2` 的 DCE 把 async invoker 那个 thunk 削掉了**（embind 的 async 走的是一个
原始 wasm invoker，`createJsInvoker` 里 `invoker(...)` 返回 Promise）；
② JSPI 需要把 **invoker**（不是业务函数）列进 `JSPI_EXPORTS`。
**下一步是小复现，不是大产物**：十几行的 embind async 程序按阶梯加设置
（`{裸, -sJSPI} → +MAIN_MODULE=2 → +SIDE_MODULE/dlopen`）定位是哪一步打坏的；
`--emit-symbol-map`/`wasm-dis` 找 invoker 名；或对照一条 `MAIN_MODULE_LEVEL=1` 的产物。
**机制没在小复现里证明之前，不再动真产物。**

**回退动作（已完成）**：`cp site/octave.{wasm,js,data} siteWebGL/`（`site` = 之前那版好产物），
`check-site-parity.sh` 报**两站点完全一致**，8768 复测：同步 `eval_string('2+2')` 正常、
`feval` 正常、`eval_async` 不存在、`__octaveJspi.smoke = 'no-entry'`（如实）。

---

### 5.44 D8：promote 前的"开机自检" —— 30 秒给出"这个产物能不能上线"（2026-09-24）

**新脚本 `build/check-boot.sh <URL> [上限ms]`**：开页面 → 等 `window.__octaveReady === true`
（默认 30 s）→ 跑一句 `eval_string("2+2")`；**不过就非零退出**。**接进 `promote-webgl.sh` 收尾**
（`DRY=0` 且 8761 有服务时自动跑；不过就 `exit 4` 并提示先回退）。JS 落在
`harness/_bootcheck.mjs`（**自己一个文件名**，不碰 sweep 的 `_run.mjs`）。

**为什么**：G1 那次事故的失败模式是**页面根本起不来**（绑定坏 + 有人在开机路径上调它 ⇒ 卡死），
而当时的验收网只能靠"40 个套件各自超时（每个最多 420 s）"才发现 —— 又慢又吵，
很容易被当成"偶发"忽略过去。30 秒的判据把这类问题**在 promote 那一刻**挡下来。

**三条实测（绿 + 两条红，都是当场跑的）**：
| 用例 | 结果 |
|---|---|
| 现役 8761 | ✅ `BOOT OK: 1.6s 就绪，eval_string("2+2") rc=0` |
| 红①：截断的 `octave.wasm`（1 MB） | ✅ 按时失败：`BOOT FAIL: 10.1s`，线索是 `WebAssembly.instantiateStreaming(): section "Code" extends past end of the module` |
| 红②：**忠实复现事故** —— 那个坏 JSPI 产物 + **当时那个"开机自动冒烟"的页面**（从 git `e71f4ae` 取出） | ✅ 按时失败：`BOOT FAIL: 15.0s`，线索里**正是** `RuntimeError: null function` |

★ **红②还澄清了一件重要的事**：那个坏产物配上**现在**（按需冒烟）的页面**能过开机自检**
（0.8 s 就绪、`2+2` 正常）⇒ 说明当时的楔子**不是"产物不能开机"**，而是**"开机路径上有人去调
那个坏绑定"**。两件事分开看才对：
- 产物层面：`eval_async` 一调就炸 + 把主线程卡住（G1 待查，见 §5.43）；
- 页面层面：**不该在开机路径上调可能卡住的东西**（已改成按需 + 超时，见 §5.42/§5.43）。
⇒ D8 抓的是"页面起不来"这一类；"调了某入口才卡死"那一类由**探针自己**（带超时）负责。

---

### 5.45 G1 复现阶梯 v1–v13：把**旗标/语言层面全部排除**，把机制锁定到"dlopen × JSPI"（2026-09-24 深夜）

容器里写十几行的 embind async 程序（`/src/websrc/embind-repro{,-out}/`，13 个变体），**一次只加一个配料**，
每档都在浏览器里实测（`await Module.f(...)` 能不能 settle）。**逐档结果**：

| 变体 | 内容 | 结果 |
|---|---|---|
| v1 | `-lembind -sJSPI` | ✅ Promise → 42 |
| v2 | `+ -sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1` | ✅ 正常 ⇒ **M2 的 DCE 不是元凶**（原主嫌疑推翻） |
| v3 | **不开** `-sJSPI`（对照） | 返回**同步值**（`isPromise=false`）⇒ `-sJSPI` 就是"返回 Promise"的开关 |
| v4 | `+ -sJSPI_EXPORTS=<不存在的名字>` | ✅ 正常 ⇒ 列不存在的导出名**无害** |
| v5 | `+ std::string` 参数（照抄 `eval_string` 签名） | ✅ 正常 |
| v6 | `+ -fwasm-exceptions` | ✅ 正常 ⇒ JSPI + wasm EH 在最小规模下没问题 |
| v9 | 同一函数、同 arity、**一同步一异步两个名字** | ✅ 都正常 |
| v10 | v9 + **真 side module + `dlopen`**，先调同步绑定 `callSide(1)` | ❌ 同步绑定抛 **`SuspendError: trying to suspend without WebAssembly.promising`**；而 `async_f` 仍正常 ⇒ **链里有 dlopen ⇒ 上游整条入口都可能挂起、不能被同步调** |
| v11a | **异步绑定 + 内部 dlopen** | ✅ Promise → 2；且**先调它之后**，同一产物里的**同步** `callSide` **也不再抛** ⇒ **顺序即机制** |
| v11b / v12 | v11a + 各种冗余/不存在的 `JSPI_EXPORTS`；v12 再把 `EXPORTED_*` 收窄成 `link-web.sh` 口径 | ✅ 正常 ⇒ **旗标层面全部排除** |
| **v13** | **静态初始化里就用同步路径 dlopen**（照抄真产物时序） | ❌ **页面起不来**（`ready=false`），pageerror 正是 `SuspendError` |

**由此得到三条机制**（都写进了 NOTES-jspi）：① dlopen ⇒ 上游入口变"可能挂起"、不能同步调；
② **顺序即机制**（先走一次 promising 入口，之后同步 dlopen 就正常）；③ 启动路径碰 dlopen 会要命。
**顺带实测一笔**：`-sEXPORTED_RUNTIME_METHODS` 写不存在的名字是**编译期硬错**（`undefined exported symbol`），
与 `-sJSPI_EXPORTS` 写不存在的名字（无害）**行为不一样**，别当同一类。

### 5.46 ★ G1 真产物实测：**`-sJSPI` 从来没进过链接**；而 `RuntimeError: null function` **根本不是 JSPI 的问题**（2026-09-24 深夜）

**这一节推翻 §5.43 的两个前提。** 做法：把留档的坏产物（`o113:/src/websrc/m2fc-jspi-out/`，sha `c93c4453…`）
取到宿主起**独立车道**（8769），另做三个变体页（8770 = git `e71f4ae` 那版页、8771 = 现役页 + `execute_interp()`
**之前**插一句同步 `eval_string`、8772 = 同位置插 `eval_async`）。**8761/8768 一个字节没动。**

**发现 ①（真 bug）：`WITH_JSPI=1` 从来没把 `-sJSPI` 传给 em++ ⇒ 那个产物根本不是 JSPI 产物。**
判据是一条 `grep`（见 NOTES-jspi）：`-sJSPI` 产物 `jspi-probe/main.js` 里有
`WebAssembly.promising` + `new WebAssembly.Suspending`；**坏产物 `octave.js` 里 0 处**
（它那 3 个 `jspi` 全是路径串 `m2fc-jspi-out`）。根因：`link-web.sh` 里 `JSPI_FLAGS` 只在
`WITH_JSPI=1` 分支**赋值**，而 `em++` 那条**链接行从来没有引用它** —— 只有 `JSPI_DEF`（宏）用在了
`main.cc` 的**编译**行。浏览器侧佐证：`Module.eval_async('1')` 返回 **`0`（number）不是 Promise**
⇒ embind 的 `isAsync` 被无视（`createJsInvoker` 里 `ASYNCIFY != 2` 时该分支不生成）。

**发现 ②（比 ① 值钱）：`RuntimeError: null function` 与 JSPI 无关 —— 是"在 `execute_interp()` 之前碰解释器"。**
| 车道 | 第一次解释器调用的位置 | 结果 |
|---|---|---|
| 8771 | 早（**同步** `eval_string`） | ❌ `null function`；**boot 之后**再调 `2+2` → rc=0 |
| 8772 | 早（`eval_async`） | ❌ **同样** `null function` |
| 8769 | 正常顺序（postRun 里的 `execute_interp()`） | ✅ `BOOT OK: 1.1s`，随后三例 `eval_async` 全返回数字、解释器存活 |
| 8770 | 早（e71f4ae 开机自动冒烟，**无 try/catch**） | ❌ **逐字复现事故**（不 ready + `null function`） |

⇒ **同步与异步入口炸得一模一样**，所以这不是 JSPI 的性质，而是"解释器还没装配好"。
**事故的真实形状**：冒烟在 postRun 头部调 `eval_async` 且**没有 try/catch** ⇒ 异常打断 postRun 剩下的
所有步骤 ⇒ `__octaveReady` 永远 false ⇒ "页面卡死"。

**改正 §5.43 的说法**：原文"产物层面：`eval_async` 一调就炸"——**不准确**，
它一调就炸的原因是**调用时机**（在 `execute_interp()` 之前），而且在那个产物上它**本来就不是异步的**。
"探测不能放开机路径"这条教训**仍然成立**，但要补一条：**开机路径上的探测必须 try/catch、且不得早于
`execute_interp()`**。

**已落地的修复**：`build/113/link-web.sh` 的 `em++` 链接行补上 `${JSPI_FLAGS[@]}`（默认关闭时是空数组，
**不影响现役产物**）；并在该文件里加了一条**旗标生效自检**（见 §5.46 同日的代码改动）。

**下一步（改写后的顺序）**：① 重链 `WITH_JSPI=1`，先验**胶水里有 `WebAssembly.promising`**（比任何浏览器
断言都便宜）；② 再跑三例（`42` / `pause(0.2); 43` / `error('x')`）；③ 之后才轮到 G2。

---

### 5.47 第二次断电：**提交对象丢了 + 一个被跟踪文件被截成 0 字节**，全部救回（2026-09-25）

昨天（§5.46 那天）收尾到 `git push` 一步时断电。**损伤盘点（全部实测）**：

| 损伤 | 症状 | 补救 | 结果 |
|---|---|---|---|
| **`.git/index` 0 字节 + 昨天的提交对象没落盘** | `git log` 停在 `999f716`；`git cat-file -t eab3883` → **不存在**（`fatal: Not a valid object name`） | `rm .git/index && git read-tree HEAD`（重建索引；**不动历史对象**） | 工作区 6 个文件的改动**全在** ⇒ 原样重提 = `45eb092` |
| **`bridge/index.html` 被截成 0 字节** | `git diff` 显示 451 行全删（`e69de29` = 空文件） | `git checkout -- bridge/index.html`（HEAD 里副本完好） | 26,023 字节，与部署页 `cmp` **逐字节一致** ✓ |
| **容器里 `docker cp` 过去的 `link-web.sh` 也是 0 字节** | `sha256sum /src/bin/link-web.sh` = `e3b0c44…`（空文件的 sha） | 重新 `docker cp`（仓库副本 `e98c2956…` 完好） | 两侧 sha 一致 ✓ |
| 四个容器 `Exited (255)`、8761/8768/8769 服务全掉 | `curl` 000 | `docker start` + 重起三个 `http.server` | 8761/8768 **开机自检绿**（1.6s）；`check-site-parity --strict` **完全一致**；部署 wasm sha 仍是 `4faaa96d…` ✓ |

**教训（比"又断电了"值钱的部分）**：
1. **"提交成功"以 `git log` 能看到为准**——断电打在 commit 中间时，工作区改动还在（写盘在前），
   但提交对象和索引会一起丢；恢复动作是**重建索引 + 重提**，**绝不是** `git reset --hard`。
2. **被 git 跟踪的文件 = 有免费备份**（0 字节一秒恢复且能 `cmp` 部署件验证）；
   **没被跟踪的承重文件没有这层保护** —— 这正是白名单铁律（AGENTS 三条不可违背之③）的另一面。
3. **`docker cp` 也会被断电截断** ⇒ 容器里的脚本副本**每次断电后都要抽查 sha**（这次就是 0 字节，
   不查的话下次重链会直接跑一个空脚本）。

---

### 5.48 G1 落地（B 姿势）：可挂起的解释器入口上线 8761（2026-09-25）

**产物**：`octave.wasm` sha `b40a2b14…`（对现役 +297 字节）；8761/8768 两站点一致，D8 开机自检绿。
**wasm 增量**：`eval_wait(const char*)`（可挂起解释器入口，extern "C" 薄导出，同步 `eval_string`
一字未改）+ `web_pause_ms(int)`（G2 挂起点预埋，转发 JS 库函数 `web_sleep_ms`）+ `webjslib.js`
（`addToLibrary`，返回 Promise，记 `Module.__tick` 供验收证伪 busy-loop）。**胶水零变形**
（不加 `-sJSPI`，B 姿势；`Suspending` 在胶水里 0 处，包装全在页面 `instantiateWasm` 钩子）。

**页面**：钩子只包 `web_sleep_ms` 一个 import（5.0.7 钩子契约=完全接管实例化 ⇒ 自己 fetch+异步
编译+回调）；`Module.eval_async = promising(eval_wait)`（API 名不变 ⇒ G0 门/探针/D9 全沿用）；
probe 加"先等 `__octaveReady`"护栏（§5.46 教训的落地）。

**验收（全绿）**：`probe-jspi-eval` 9/0（rc 语义与同步一致、`error('x')` ⇒ rc 2 + last_error_message、
**plain 栈直调 `_web_pause_ms` 抛 SuspendError 证明钩子生效**、`promising(_web_pause_ms)(120)` ⇒
真挂起/恢复 tick+1）；`probe-jspi-gate` 12/0（smoke=pass-blocking，等 G2 接 pause 自动变 pass；
无 JSPI 浏览器降级为 api-missing + 一句人话，无裸 TypeError）；8768 sweep 39 套/1025/0；
8761 `PROBES=1` 67 套/1125/1（唯一红 = gl4es-smoke，见下）；dist 重打包（包内 wasm 与部署件同 sha）。

**三条新教训（都是当场踩的）**：
1. **"wasm 边界不传 JS 字符串"在产品层重现**：`promising(eval_wait)("42")` 直传 JS 串 ⇒ 指针 0
   ⇒ eval 空串、rc=0 装成功（三例全"通过"但全是空 eval）。修法 = 页面 `malloc` 堆指针 +
   `stringToUTF8` 写串 + settle 后 `free` —— **必须堆分配**（栈分配的指针在挂起期间会被复用）。
   为此 `EXPORTED_RUNTIME_METHODS` 增补 `lengthBytesUTF8,stringToUTF8`、`EXPORTED_FUNCS` 增补
   `_malloc,_free`（都在 `WITH_JSPI=1` 才加）。
2. **promote-webgl.sh 的 GL_OUT 覆盖陷阱**：`GL_OUT ≠ SRC_OUT` 时第 1 步会把 GL_OUT 整个盖到
   SRC_OUT 上 —— 我只传了 `SRC_OUT=m2fc-jspb-out`，**8761 被短暂换成 out-webgl 的 9月23日 旧件**
   （boot 照样绿！唯一露馅 = promote 的"无 FreeType 字体预载"自检警告）。已加防呆：
   GL_OUT 的 octave.js 比 SRC_OUT 旧 ⇒ 当场 FATAL；重链重 promote 后修正。
   **重链确定性实测**：同命令三次产出 `octave.wasm` sha 逐字节相同。
3. **探针腐烂三连（PROBES=1 首跑抓的）**：`probe-gl4es-smoke` 被 sweep 传产品 URL（它只测
   siteGL4ES/8767 独立站）+ 8767 服务断电没拉起 ⇒ 钉死 8767 口径并恢复服务（单跑 16/0）；
   `probe-jspi`/`probe-jspi-b` 的"产物目录"参数被 sweep 传成 URL ⇒ 契约改为忽略 http 参数；
   `probe-jspi-a2` **归档**至 `build/113/probe-jspi/runner-a2.mjs`（A2 已是弃用姿势，其
   SuspendError 陷阱会偶发楔死渲染进程使 harness 挂死；语义锚由 NOTES 表格承担）。
   顺带：gate 冒烟判定从 `indexOf('43')` 改为 `rc===0`（eval 返回的是返回码 ——
   那是 G0 时代没真测过的口径）。

---

### 5.49 G2 落地：`pause` 真让出 + 压力矩阵全绿（2026-09-25）

**wasm 一个字节没动**（纯资产批）：新 `webpause.oct`（2.4KB side module，`DEFUN_DLD(__web_pause_ms__)`
调主模块导出 `web_pause_ms`）+ `webshims/pause.m`（遮蔽内建 `pause` ⇒ 走挂起 import）。
编译配方照 `build/113/build-oct.sh` 的 11.3.0 口径（`-fwasm-exceptions -fPIC -sSIDE_MODULE=1`、
不链任何库，`web_pause_ms` 由主模块导出表在 dlopen 时解析）。

**踩坑一个（当场抓）**：`.oct` 与 shim 各做了一次"秒→毫秒"换算 ⇒ `pause(0.05)` 实际睡 50 秒，
压力矩阵 8 个 HARD-TIMEOUT 假象"挂死"。修法 = **`.oct` 是纯毫秒原语，换算归 shim**（单位只换一次）。

**验收**：新 `accept-jspi-stress.mjs` **11/0** ——
A `pause(0.2)` rc 0 / 墙上 204ms / **tick+1**（真让出）；能力门冒烟自动升格 **`pass`**；
B `unwind_protect` cleanup 恰一次（"TC"）；C `onCleanup` 哨兵恰一次；D pause 后 error 被
try/catch 抓到（跨挂起点异常完好）；E 10 连挂起墙上 602ms/tick=10；F pause↔资产装载交错三轮全稳
（B 姿势下 dlopen 不是挂起点）；G **重入测量（复审第一优先）**：并发第二条 `eval_async` **双双正常
settle**（`{r1:"settled:0", r2:"settled:0"}`）——影子栈危害在本用例未显现，但产品规则仍定为
**串行使用**（页面命令队列天然保证），复审的警告继续记档。事后新页面无跨页污染。
sweep：8768 **40 套/1036/0**（stress 矩阵被收编为第 40 套）、8761 `PROBES=1` **67 套/1174/0**。

**★ 架构规则（第三轮复审判据①的产品层应验，写死）**：`pause` 变成挂起点之后，
**凡可能执行到 pause 的命令必须走 `eval_async`（promising 栈）**；同步 `eval_string`
碰到 Suspending import 会抛 `SuspendError`（accept-audio 的 sound/playblocking 两例当场炸出，
已把该套件驱动切到 eval_async ⇒ 48/0）。同步 `eval_string` 从此**只用于无 pause 的内部自检**。

---

### 5.50 批次 3 落地：G3 取点 + G4 Ctrl-C + D9 门槛 + **部署件 SHA 铁律**（2026-09-25）

**wasm**：sha `45d288b1…`（批次 1 的 +450 字节再 +6 字节：ginput 三原语 / web_suspend_ok /
web_request_interrupt 的导出；main.cc 的 `web_pause_ms` 增加中断投递、`eval_string` 增加
`interrupt_exception` 捕获 ⇒ rc=3 且**复位旗标**）。8761/8768 同步，D8 绿。

**G3 ginput 全链（accept-ginput 10/0）**：上游 `ginput.m` 委托 `__<toolkit>_ginput__` ⇒
提供 `__webgl_ginput__.m`（webgraphics 资产）—— arm→轮询（`__web_pause_ms__(50)` 让出）→
pop→**数据坐标映射**（axes 像素框 + xlim/ylim 线性；y 翻转）。原语链实测：
`pending=1; size=1x5; v=280 210 562 422 b=1; pending2=0`。验收：反算像素点击 ⇒
数据 (5,5) 精确；两次 ginput 各收各的点（arm 先收后保证"stale 点击不串场"）；ginput(2) 按序。
**三个当场坑**：① axes position 默认 **normalized** 单位——不转像素就把所有点当"axes 外"
丢掉 ⇒ 死循环；② 多函数 .oct 必须按 §4.11 建 **aliases** 符号链接（`__web_suspend_ok__`
在 `__web_pause_ms__.oct` 里 ⇒ 不建链接就是 undefined）；③ `.oct` 里**不能**定义
`web_pause_ms`（会引入 `web_sleep_ms`/`octave_interrupt_state` 两个 side module 解析不到的
符号 ⇒ 整个模块 dlopen 失败）——定义在 main.cc，.oct 只声明。

**G4 Ctrl-C**：`web_request_interrupt` 置位 `octave_interrupt_state`；**投递点 =
`web_pause_ms`**（resume 后查旗标抛 `interrupt_exception`；`eval_string` 捕获 ⇒ rc=3 且
复位）。验收：`while(true)`+`pause` 死循环 400ms 后请求 ⇒ **rc=3 收尾**、解释器存活、
后续命令正常。CPU 密集且不含 pause 的循环打不断（没有安全点）——如实记：不是抢占。

**D9 门槛**：`__web_suspend_ok__`（main.cc → webjslib → 页面）——pause.m 没能力时退回
`builtin('pause')` 阻塞（G2 前旧语义，防 busy-loop 冻页）；ginput/keyboard 没能力时清晰报错。
**G5 keyboard v1**：一层 REPL（input 的 prompt + `evalin("caller")`），递归 keyboard 仍是红线。

**★ 部署件 SHA 铁律（用户点名，2026-09-25）**：多次"改完程序用老程序跑"的教训固化成三层判据：
① 磁盘层 `build/check-deploy-sha.sh <站点> <期望sha> <URL>`（站点 wasm == 刚构建产物）；
② HTTP 层（URL 吐的字节 == 磁盘）；③ **页面自证** `window.__octaveWasmSha`
（页面在 instantiateWasm 钩子里对**实际实例化的字节**算 sha）——
`probe-artifact-sha.mjs` 三层断言全绿。已写进 AGENTS.md 批次收尾。

**accept-interactive 断言翻面（D9 计划内）**：ginput/waitforbuttonpress/gtext **不再是
清晰报错**——它们是真交互（同步入口给 SuspendError 信号=可挂起命令标记；全链在
accept-ginput）；keyboard 变 v1 REPL（prompt 无头失败=清晰报错）；ginput 解析回核心
ginput.m（覆写已删）。sweep：8768 **69 套/1187/0**、8761 `PROBES=1` **69 套/1187/0**。

---

### 5.51 批次 4 落地：D6 `pkg load` 自动装载 + D7 IDBFS 边界 + D5 规则 B 复核收口（2026-09-25）

**wasm 一个字节没动**（纯资产批：webshims/pkg.m shim + webpause.oct 增 `__web_run_js__` 原语 + aliases）。

**D6 `pkg load <未装载的包>` 自动装载**（`probe-pkg-d6` 4/0）：webshims/pkg.m shim 只拦
`pkg load <名>` 且包在 `__webassets_pending__()` 名单里 ⇒ `__web_run_js__` 调
`OctaveAssets.load`（页面 fetch + 写盘）+ `__web_pause_ms__` 轮询等落盘 ⇒ **路径手术委托
核心 pkg.m**（把 shim 目录临时摘出路径，跑完按原位置插回、核心新增的包目录按原顺序补回）。
实测 `pkg load statistics` rc=0、896ms、`geomean([1 2 4])`=2；accept-pkg **16/0**（含
"未安装的包清晰报错"——错误传播路径正常）。三个当场坑：① m 文件里不能直接调
`emscripten_run_script`（C 符号）⇒ 走 `.oct` 原语转发；② `__web_run_js__` 忘建 aliases
符号链接 ⇒ undefined（§4.11 再次应验）；③ shim 的 cleanup 引用未赋值的 `newp` 会吞掉
核心的原始错误 ⇒ 先赋初值再 unwind_protect。

**D7 IDBFS 边界**（`probe-idbfs-bounds` 3/0，run.sh 方式连跑两次稳定）：50 个小文件 +
8MB 大文件 + webSync + **同 context reload** ⇒ 全部存活（内容与首尾字节核验）；写回 21ms
（~8MB 脏数据，informational）；配额满行为**无法在测试里可靠触发 ⇒ 如实记未测**（webSync
错误走 callback、页面不崩已由 accept-idbfs 覆盖）。两个坑：IndexedDB 是 **per-context**
（换 context = 换库，必须同 context reload——accept-idbfs 既知约束的再次应用）；读回是
异步的 ⇒ **页内轮询直到全部可读**（只等单个文件会与其余文件竞态，sweep 实测 flaky）。

**D5 规则 B 复核（162 处）**：`check-wants --report` 显示 162 处**全部同类** ——
"单数字 want 对 `exist()`/`rows()`/`numel()` 的计数"，且每处已带**数字边界**正则
（`(?<![\d.])N(?![\d.])`）挡住"计数含该数字"的子串误配；抽样 3 处对照源码确认断言
与被测值一致（如 `disp(exist('fftw'))` want='3'）。**结论：口径有意、风险已控、保留**；
行为级断言（内容/坐标/异常文本）本批新增者均走结构化读取，不再新增裸数字。

**sweep**：8768 **71 套/1194/0**、8761 `PROBES=1` **71 套/1194/0**（新增 probe-pkg-d6 4 项、
probe-idbfs-bounds 3 项收编）。dist/parity/闸门全绿。**PLAN-jspi.md 的 G0–G6 与 D1–D9
至此全部收口**；wasm 最终 sha `45d288b1…`。

---

### 5.52 仓库整理：分支收窄为 main + 可部署站点入库 + 浏览器矩阵（2026-09-25）

**分支收窄（用户指令）**：origin 与本地现在**只剩 main**。退役的 graphics 三个分支先归档：
`graphics-osmesa` 已推到**持久盘镜像**（`mirror/graphics-osmesa`，fb5b265）后删除；
`graphics-osmesa-p5`/`graphics-webgl` 本就只在镜像与本地 ⇒ 本地删除、镜像保留。
mirror 自己的 `main`（分叉旧线 9b211ae）**不动**（规则②禁 force）；镜像里的
`main-20260923/24/25` 三个日期 ref 继续作持久盘备份。HISTORY/AGENTS 里凡引用
"graphics-osmesa 分支"处，现在指**镜像**上的那份。

**可部署站点入库**：`site/`（63MB，110 文件）= 8761 的**逐字节镜像**（wasm `45d288b1…`），
配 `DEPLOY.md`（部署说明 + 三条自检脚本）与 `.github/workflows/pages-deploy.yml`
（**workflow_dispatch 手动触发**，不会 push 即部署；前置一次性步骤 = 仓库
Settings → Pages → Source 选 "GitHub Actions"——留给配 yml 的人）。
以后每批 promote 后 `rsync -a --delete …/site/ site/` 一并提交（AGENTS 已入流程）。

**浏览器矩阵（用户授权的真浏览器实测，全部真浏览器非模拟）**：
| 浏览器 | 引擎 | 结果 |
|---|---|---|
| Chromium 最新（系统） | Blink/V8 | 5/0 全链（pause 206ms/tick+1、冒烟 pass） |
| **Firefox 156 桌面**（playwright 托管 `~/.cache`，未碰系统浏览器） | **Gecko** | **5/0 全链**（pause 204ms/tick+1、冒烟 pass）—— 第二引擎确认 |
| **Firefox 156 Android**（模拟器 Android 15，官方 x86_64 APK） | Gecko 移动 | 29MB 解释器完整启动、**能力门 `pass`**（bilibili 先验浏览器栈完好） |
| **Chromium 123**（`zenika/alpine-chrome:123` 容器 + CDP，**真·无 JSPI**） | Blink/V8 旧 | **7/0 优雅降级**：同一产物照常实例化/解释器可算/画图照常、门如实 `api-missing`、清晰报错 |

工具与坑：playwright 托管 Firefox 装在 `~/.cache/ms-playwright`（未碰系统浏览器——用户约束）；
**境外下载一律走 2080 代理**（直连 60KB/s，代理 1.1MB/s，HANDOFF §3.6 的既有结论再次应验）；
安卓模拟器必须 **setsid 脱离 + `-no-snapshot`** 启动（工具调用取消会连带杀掉子进程模拟器），
Firefox Android 官方 x86_64 APK 从 archive.mozilla.org 直取。
**AGENTS 补记**（当时提交信息说了、正文漏写，本轮补上）：部署件 SHA 检查三层、
M2 车道 `GL_OUT=$SRC_OUT`、测试用例从仓库原路径直跑（勿 cp 到 harness）。

---

### 5.53 线程化/并行度第一批实验：Q4 / E3 / E1 三探针（2026-09-25，branch `Slay`）

**背景**：`/goal 完成所有todo` 收口后，用户转新方向「浏览器内的多线程 Octave 探索」+「把 DOM 这块蛋糕吃了」
（教材站嵌入）。先出**第四轮去身份化评审书**（`build/113/GPT-REVIEW-4-threads.md`，C1–C7 + Q1–Q12），
外部评审回来后**逐条复核并实测**（`build/113/GPT-REVIEW-4-threads-reply.md`），再按 `PLAN-threads.md`
做掉第一批三件。**产物零改动**：8761 全程未动（现役 `45d288b1…`）。

**① Q10 实测（推翻我自己的判断）**：`test/browser/probe-iframe-coi.mjs` 九格矩阵 **6 PASS / 0 FAIL** ——
未 COI 的顶层里，iframe 自己带 COOP/COEP **完全无效**（同源、跨源都一样），`allow="cross-origin-isolated"`
也不起作用 ⇒ **C7（自有 origin 跨源 iframe）否决**（外部评审的判定成立，我原来的判断错了）。
**但实测挖出一条评审没列的路（记为 C8）**：顶层用 **credentialless** 隔离 ⇒ 宿主 COI ⇒ PreTeXt 生成的
**同源 iframe 继承 COI**（SAB 与 iframe 内 worker 的 SAB 都可用），且 credentialless **不拦 CDN**
（同一条无 CORP 跨源脚本：require-corp 下 `ERR_BLOCKED_BY_RESPONSE`，credentialless 下正常加载）。

**② Q4（JSPI × DedicatedWorker）= 6/0**：B 姿势手搓 JSPI 在 worker 里挂起/恢复 **100/100**、tick 真递增、
反向断言（未包 promising 直调）照常抛 `SuspendError` ⇒ **C3 的最后一个未知数清除**。
产物：`build/113/probe-jspi-worker*`、runner `test/browser/probe-jspi-worker.mjs`。

**③ E3（pthread × dlopen）= 6/0**：`-pthread -sSHARED_MEMORY -sMAIN_MODULE=2` + side 同带 `-pthread`，
2 个 pthread 存活时 100 轮 `dlopen/dlsym/dlclose` 全成功、无死锁（totalMs=28），
反向断言（dlopen 不存在的模块）照常失败 ⇒ **emscripten#9582 的"硬互斥"在 5.0.7 已不成立**
（现代官方文档化但仍标 experimental）。产物：`build/113/probe-threads*`、runner
`test/browser/probe-threads.mjs`；runner 必须给**顶层页**注入 COOP/COEP。

**④ E1（`-msimd128`）= 绿**：新脚本 `build/113/build-blas-simd.sh` 只给 refblas/lapack 的**每个 TU** 注入
`-msimd128`（wasm SIMD 是逐 TU codegen，混编是 `wasm-ld` 默认路径），落 `/src/deps/lapack-simd`（**不覆盖 `/usr/local`**）；
重链用权威口径 + `WITH_JSPI=1 WITH_FONTCONFIG=1` + `EXTRA_LDFLAGS="-L/src/deps/lapack-simd/lib"`
（该口子在 `LIBS` 之前 ⇒ 赢搜索顺序）→ `/src/websrc/m2fc-simd-out`，`BASELINE_WASM` 取**现役** `m2fc-jspb-out/octave.wasm`。
**决定性验证**：`llvm-objdump -d | grep -c v128`：SIMD 产物 **4752** vs 基线 **0**（体积 29,632,229 vs 29,464,307）。
DGEMM 中位数（3 次，`test/browser/bench-dgemm.mjs`，独立车道 8771 vs 基线 8768）：
**512² 1.62×、1024² 1.75×、2000² 1.31×**；数值回归 5 套 **97 PASS / 0 FAIL**（boot/libs/hdf5/slicot/ode15）
⇒ 判据"数值全过 且 ≥1 主要尺寸 ≥1.5×"达成。

**本轮踩到的三个新坑（都已在产物注释与 NOTES-threads.md 记档）**：
1. `-sENVIRONMENT=worker` **单独指定会打坏开机**：`initRuntime → _environ_get` 抛
   `RangeError: Maximum call stack size exceeded`（页面对照组同样复现 ⇒ 与 worker 无关）⇒ 用默认环境。
2. **非模块化胶水污染全局**（自带 `run/doRun/Module/FS`）：宿主页/worker 把自己的函数命名成 `run`
   ⇒ 覆盖胶水的 `run()` ⇒ 重入 `initRuntime` ⇒ 同一个 `RangeError`（栈顶显示 `_environ_get`，极具误导性）
   ⇒ 自定义名字必须加前缀。
3. `grep -c simd128 <wasm>` 当 SIMD 判据**无效**（两版都没有 `target_features` 段，命中数都是 0）
   ⇒ 只能反汇编数 `v128`。

**结论与下一步**：C4 是"最便宜的真提速"（不需 COI/SAB/宿主改动，且 SIMD 下限 Chrome≥91/FF≥89/Safari≥16.4
**低于** JSPI 基线 ⇒ 不抬全站下限）；C3 可以动手（只剩 worker 侧 dlopen × preload FS 未测）；
C2（pthread BLAS）前置未知数已清但仍属"COI 环境下的可选增强"；C7 否决、C5 不进计划。
三批的完整数据、复跑命令与判据见 `build/113/NOTES-threads.md`。

### 5.54 C4 落地：SIMD BLAS 上 8761（2026-09-25，branch `Slay`，验证未跑完）

**产物从 `45d288b1…` 换成 `1ed3e528…`**（29,464,307 → 29,632,229 B，v128 指令 0 → 4752）。
走的是固定收尾动作：`glue-selftest 91/91` → **8768 验绿 41 套 / 1047 PASS / 0 FAIL** →
`promote-webgl.sh`（`SRC_OUT=GL_OUT=/src/websrc/m2fc-simd-out EXPECT_FREETYPE=1`）→
站点 sha 两侧一致 + gl4es/FreeType/桥资产自检 ✓ + **D8 开机自检 OK（1.7s，eval_string rc=0）** →
仓库 `site/` 已 rsync 同步（`git status` 只有 `octave.js`/`octave.wasm` 两处）。
**8761 全量 + PROBES=1 跑到 42 套时被用户关机叫停**（真 FAIL = 0；日志已落盘
`sweep-logs/INTERRUPTED-8761-simd-20260925-155420.log`）⇒ **make-dist / parity / 完整汇总行 待补**。
精确回退快照：`/mnt/hdd/octave-wasm-build/site-baseline-45d288b1/`。

**★ 新的重链口径（不改就会静默退回非 SIMD）**：权威命令 = HISTORY §5.26 那条 +
`WITH_JSPI=1`（B 姿势导出：现役 octave.js 必须有 `eval_wait`）+
`EXTRA_LDFLAGS="-L/src/deps/lapack-simd/lib"`（口子在 `LIBS` 之前 ⇒ 赢搜索顺序；依赖
`build/113/build-blas-simd.sh` 产出的 `/src/deps/lapack-simd/lib`，`/usr/local/lib` 那份仍是非 SIMD）。
唯一可靠自检：`llvm-objdump -d <wasm> | grep -c v128`（现役 = 4752）。
过程与数据见 `build/113/NOTES-threads.md` 的「C4 落地」节。

### 5.55 E4 探针 + C6 页面层落地：同页多实例成立（2026-09-26，branch `Slay`）

**E4（C3 的机制未知数清零）**：`probe-jspi-worker` 扩到 dlopen —— worker 里
`dlopen` **两种 FS 来源**都通：运行时 `fetch→FS.writeFile`（产品资产装载形态）与
`--preload-file` 烘进 .data（产品 octave.data 形态）；且 side module **回调主模块的
worker_wait（挂起 import）** ⇒ 挂起**穿透 dlopen 边界**（rt=52/pre=52，tick=102）。
判据 **8 PASS / 0 FAIL**。新坑两个：`docker cp` 到**已存在**目录会把源目录嵌套进去
（side.c "丢失"）；`-Wl,--export=a,b` 逗号列表无效 + `set -e` 管不住管道（emcc 失败被
`| tail` 吞）⇒ 补"产物存在"硬检查。

**C6 页面层（PLAN-threads B1，产物 wasm 不变 `1ed3e528…`）**：宿主层从"页面单例"
改成**实例工厂** —— `createOctaveHost({base,mount,home,id})` + 资产装载器
`createOctaveAssets(module,base,isReady)`；默认实例拿走全部 `window.*` 兼容别名
（**65 个旧套件一个没改**）；G3 取点三原语按实例覆写；IDBFS 按实例挂载。
验收：`glue-selftest 91/91` → **8768 全量 42 套/1060/0（41 套 accept 零改动）** →
promote 8761（D8 开机自检 OK 1.7s）→ **8761 全量 PROBES=1 77 套/1205/0** →
dist 核 sha → parity --strict。新套件 `accept-embed-multi` **13/0**（同页两实例、
交替 100 次 eval 状态隔离、FS 互不可见、资产进对实例、别名不覆盖、坏挂点必须 throw）。

**三个新坑**：① `loadScript` 里 Promise executor 的 `resolve` 参数**遮蔽**了
`resolve(url)` 助手 ⇒ `s.src=undefined` 且 promise 提前 settle ⇒ JS 包"装载成功"但
`__OCT_ASSETS__` 缺席（助手改名 `withBase`）；② 装载器早于 `inst.mod` 创建 ⇒ i2 拿到
null 回退 global.Module = 默认实例（资产写错 FS、addpath 串台）⇒ 工厂末尾再建；
③ 坏挂点在注册表 push **之后** throw ⇒ 幽灵实例（hosts=3）⇒ 挂点解析提前。
**闸门盲区补强**：check-consistency.py 的启动清单正则只认 `OctaveAssets.load(`，
重构后抽成 0 个名字**空转通过** ⇒ 放宽为 `*.Assets.load(`，16 个名字重新核对。

**已知边界（记档，等下次重链）**：非默认实例无图形上屏（publish_png 硬编码
`window.OctaveP5`，canvas 契约同批）；四个队列桥/stdin/Ctrl-C 仍是默认实例单例。
**下一步车道**：B5（C3 真落地：解释器搬 DedicatedWorker + Worker RPC 测试垫片）——
机制未知数已全部清零（Q4/E3/E4）；E2（OpenBLAS）触发条件不成立维持可选；
C8/C2 需要 COI 环境/宿主配合。

### 5.56 B5 phase 1：解释器搬进 DedicatedWorker（2026-09-26，branch `Slay`）

**目标达成一半**：`?worker=1` 下 wasm + 虚拟 FS + 资产 + JSPI 全在 DedicatedWorker 里，
主线程只剩 DOM 与消息转发 ⇒ **长计算不再冻页面**。产物 wasm 不变（`1ed3e528…`），只动页面层。
判据成对出现才有区分力：**worker 里跑 1400² 矩阵乘（约 4.3 s）期间页面 tick=435**，
而**同一段计算在单页模式下 tick=0**。另有：worker 里挂起入口真让出（206 ms）、
**同步** eval 碰挂起点必须失败（`SuspendError`，反向断言）、中断投递 rc=3、
worker 模式下页面 `window.Module` 缺席（主线程真的空着）。新套件 `accept-worker` **11/0**。

**验收链**：`glue-selftest 91/91` → 8768 全量 **43 套/1071/0**（含新套件，零回归）→ promote
（D8 开机自检 OK 1.5 s）→ 8761 全量 **PROBES=1：80 套/1216/0** → `make-dist` 核 sha →
`check-site-parity --strict` 两站点完全一致。**promote 拷贝清单补了 `octave-worker.js`**
（漏了就是部署后 404 —— 正是该脚本当初被写出来要防的事故）。

**坑**：worker 宿主为让 toolkit 的 EM_ASM 不抛异常装了 `document` shim，而资产加载器原来用
`!document` 判断"在 worker 里" ⇒ 判断失效 ⇒ `kind:'js'` 的包走 `<script>` 注入（空操作）⇒
promise 永不 settle，`plotbridge`/`webshims` 静默装不上（连带 ready 不来、中断判据假红）。
修法：显式标记 `self.__octaveWorker`。**教训与 §5.46 同族：探测/判定要用显式契约，别靠环境形状。**

**phase 2 边界**：worker 模式**没有真渲染后端**（图形后端要用 EM_ASM 在 `document` 上建 canvas）
⇒ 绘图报 `get: unknown axes property __legend_handle__`（清晰错误、解释器存活）。
搬 WebGL 进 worker 需改 `webgl_toolkit.cc` + 重链。去身份化的外部咨询请求已发出
（`build/113/GEMINI-ASK-1-worker-webgl.md`：A=worker 里 OffscreenCanvas、B=E2 的 binaryen 阻塞、
C=挑刺验收矩阵）。

**同轮另记**：E2 探针——OpenBLAS **0.3.34** 的 `WASM128_GENERIC` 能编出来（`USE_THREAD=0
NO_LAPACK=1 NO_SHARED=1 CC=emcc FC=emf77`，EXIT=0，`dgemm_` 等符号齐），但**全量重链**在
binaryen 报 `parse exception: popping from empty stack`；已排除 atomics（0 处）、与 LAPACK 的
重复符号（交集 0）、"该库单方问题"（最小链接 wasm-opt 通过）⇒ 记档待二分归档定位。

### 5.57 B5 phase 2：worker 里跑起真渲染后端（**不需要重链**，2026-09-26，branch `Slay`）

**结果**：worker 模式（`?worker=1`）下 `graphics_toolkit()='webgl'`、无 GL 回落信号
（`/tmp/p5_nogl.txt` 不存在）、我们交出的 `OffscreenCanvas` 上确有 WebGL2 上下文（560×420）、
绘图成品经 postMessage 上屏。**C3（解释器搬 Worker）在功能上完成**：主线程不冻 + 真渲染 +
交互原语 + 资产装载 + JSPI 全在 worker 里。

**机制（读 Emscripten 5.0.7 源码得出，不是猜）**：图形后端要 canvas 时走
`findCanvasEventTarget(target)` → `specialHTMLTargets[target] || document.querySelector(target)`，
**拿到对象后由胶水自己 `canvas.getContext('webgl2', attrs)`** —— 而 `OffscreenCanvas.getContext`
在 worker 里可用 ⇒ 只要 worker 宿主的 DOM shim 把 `createElement('canvas')`/`getElementById`/
`querySelector('#…')` 指向一个**真的 `new OffscreenCanvas(w,h)`**，整条链就通。
（`transferControlToOffscreen` 那条路是给 pthread 设计的：主线程 transfer →
`pthread_create` 时把 `GL.offscreenCanvases` 搬过去；我们的 worker 宿主不是 pthread，
那个表不会自动填，**也不需要填**。）
⇒ **原计划的"改 `webgl_toolkit.cc`（canvas 契约）+ 重链"确认不必要**，省掉一次 29MB 重链。

**判据升级**：`accept-worker` 的 H 由"要么上屏要么降级干净"升级为强断言
`tk==='webgl' && nogl===0 && glCtx===true && plots≥1 && imgs≥1`；新增 `diagnose` 消息通道
专门读 **worker 内部**状态（页面读不到 worker 的 FS/GL）。
**顺带澄清**：`get: unknown axes property __legend_handle__` 在单页/worker 两模式**完全一致**
（专门对比）⇒ 既有良性消息，非 worker 回归。

**验收**：8768 全量 **43 套/1071/0** → promote（开机自检 1.7 s）→ 8761 全量 **PROBES=1**
（见本轮 sweep 日志）→ `make-dist` 核 sha → `check-site-parity --strict` 两站点完全一致。
**外部咨询同步更新**：给 Gemini 的需求书已加批注 —— A 节（worker 里 OffscreenCanvas）
**已自解决**，只需回答 B（binaryen 解析失败）与 C（挑刺验收矩阵）。

### 5.58 B5 加固（外部评审挑刺落地）+ E2 根因线索（2026-09-26，branch `Slay`）

**外部咨询（Gemini，去身份化需求书 `build/113/GEMINI-ASK-1-worker-webgl.md`）回音后，逐条实测处理**：

**A 节（worker 里搬 WebGL）**：其方向与我们的实测一致（worker 内自建 OffscreenCanvas、
**不需要** OFFSCREENCANVAS_SUPPORT），但注入方式不同（它主张直接写 `specialHTMLTargets`;
我们让 `document.querySelector` 返回真 OffscreenCanvas）—— 胶水的查找链两条都通，保留现方案。

**B 节（binaryen 解析失败）**：它给的决定性仲裁（WABT `wasm-validate`）**一次就推翻了它自己的主假设**：
- V8（Node 26）编译未优化产物直接报 **产物非法**：函数 `ztrti2_` 块尾栈多 1 个 i32；
  WABT `wasm-validate --enable-all` 给出**三处**类型错 ⇒ **不是 binaryen 的锅**（两个独立裁判背书）。
- 已排除：atomics、与 LAPACK 的重复符号（交集 0）、OpenBLAS 单方、删掉与 f2c 重名的 `z_abs.o`。
- **新线索**：OpenBLAS 的 `{c,z}rotg`（`interface/zrotg.c`）引用 **fp128（`long double`）软例程**
  `__addtf3`/`__getf2` 等；compiler-rt 里有这些符号但链接后类型不符；
  **wasm32 上 `-mlong-double-64` 不被 clang 支持**（实测报错）⇒ 要改只能**源码级**。
- 下一步方向：三处错的调用点定位（WABT 已装 `/mnt/hdd/crossbuild-tools/wabt`）、OpenBLAS 的 CMake 路径、
  源码级把 `zrotg.c` 的 `long double` 换 `double`。E2 仍**未跑通**（按计划本就是可选增强）。

**C 节（挑刺验收矩阵）**：采纳 4 条并落地 —— `accept-worker` 11 → **16 PASS / 0 FAIL**：
重入防护（挂起期间第二条命令**排队**；**修前是真洞**会崩实例）、纯计算下主线程 tick≈满额（34/35）、
stdout 洪泛不丢字 + 主线程仍活（tick=11/222ms，如实记残存争抢）、
`terminate()` 待办 201ms 内 `AbortError` + 重启后仍拿到真渲染后端。
**顺带修掉的真问题**：`octaveUiAppend` 每条读 `scrollHeight`（强制同步布局）+ 页面侧无合批
⇒ 5 万行输出占主线程约 170ms；改为滚动跟随 200ms 节流 + worker 模式上屏 rAF 合批（结果前强制 flush）。
**待办**：MEMFS 产物 unlink 的循环测试、图像/完成信号 FIFO 单调性、worker 崩溃快速失败判据、
多 worker × IDBFS 隔离判据（代码已实现 `opts.home`）。
```
（原文见 git 历史中 HANDOFF 于 2026-09-26 之前的那一版；此处保留其要点：）
- 2026-09-24 做完：R1/R4（§5.30）、R3 fontconfig（§5.31）、R5 探针（§5.32）、
  小口子 1–7（§5.33–§5.39：属性对契约 / waitbar+挂死族 / 包可见性 / `print -dpng` /
  **重链做出 IDBFS 持久化与 FreeMono**）。
- 当时的下一步 = `PLAN-jspi.md` 的 G0→G6 与七条收尾债 D1–D7 —— **该计划已于 2026-09-25 全部收口**
  （HISTORY §5.48–§5.51），故从 HANDOFF 移除。

#### (6) 迁出：§4.1 的完整核实（7.2 时代 dldfcn 不能 dlopen 的根因）

> 2026-09-26 起 `.oct` 走官方 `dlopen`，本节只是**当时**的核实过程（含容器内实测与 fork 旁证）。

```
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

```

#### (7) 迁出：§4.6 CXSparse "too old" 的根因与一行修法

```
### 4.6 CXSparse "too old" —— **已解决（批次 1）**，是假失败
报错文本骗人：库和头都好好的（`cs.h` 里 `CS_VER=3/CS_SUBVER=1`，`libcxsparse.so.3.2.0` 也在）。
真因：`OCTAVE_CHECK_CXSPARSE_VERSION_OK` 走 **`AC_PREPROC_IFELSE`（纯预处理）**，而它**只吃 `CPPFLAGS`**；
本仓的 `-I target/include` 一直只写在 `CFLAGS/CXXFLAGS` 里 → 预处理时找不到 `cs.h` → 判成"太老"。
**修法一行**：configure 时加 `CPPFLAGS="-I$INCDIR"`（已内建在 `build/reconf-pic.sh`），
并恢复 `--with-cxsparse --with-cxsparse-includedir/-libdir` → `HAVE_CXSPARSE_VERSION_OK=1`。
两个行为边界（非缺陷，桌面版同）：`qr(s,0)` 经济模式 CXSparse 不支持；`[Q,R,P]=qr(s)` 的 P 为空
（但 `s=Q*R` 恒等式成立，残差 7e-15——验收用这个判据）。SPQR 本轮未做。

```

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

