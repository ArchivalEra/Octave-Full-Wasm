# 缺口清单 v2（2026-09-21 实测）—— 全部剩余缺口，按可做性排序

> ## ⚠️ 当前状态（2026-09-22 更新）—— 请先看这张表再往下读
>
> 这份清单是 **2026-09-21 的实测快照**，**不是当前待办**。到今天为止的结果：
>
> | 条目 | 状态（2026-09-22） | 证据 |
> |---|---|---|
> | **A1** 图形栈（薄 toolkit） | ✅ **已完成**（T2） | `web` toolkit 登记+装载；`accept-t2-graphics` 26/26。**没走 Lane B** —— 见 HANDOFF §5.5.1 |
> | **B1** `audiorecorder` | ✅ **已完成**（T7） | 19 个 `__recorder_*` 纯 `.m` + getUserMedia/MediaRecorder 桥；`accept-t7-recorder` 40/40。**`recordblocking` 如实报错**（需 Asyncify，实测不可用，见 G2） |
> | **B2** `audiodevinfo` | ✅ **已完成**（T6） | 静态"浏览器默认设备"模型；`accept-t6-audio-doc` 33/33 |
> | **C1** 文件操作（`copyfile` 等） | ✅ **已完成**（T3） | 无 shell 进程内实现；`accept-fileops` 20/20 |
> | **D1** `help` 渲染 | ✅ **已完成**（T1） | 构建期 makeinfo 预渲染；`accept-help` 12/12。**仍缺**：`.m` 文件的 docstring（`help ode45`）—— 见下方"剩余" |
> | **D2a** `doc` | ✅ **已完成**（T6） | help 文本 + 页面 DOM 落点；见 HANDOFF §5.10 |
> | **D2b** `publish` | ❌ 仍暂缓 | 外部审核判定，会被 graphics/文件/页面 UI 一串拖住 |
> | **E1** `input()` | ✅ **已完成**（T5） | 本就可用，只加官方 `Module.stdin` 扩展点；`accept-input` 9/9 |
> | **E2** `keyboard`/`kbhit`/`pause` | ❌ 仍暂缓 | 需要 Asyncify；而 **Asyncify 已实测不可用**（见 G2） |
> | **G1** `MAIN_MODULE=2` + keep 清单 | ⬜ **仍待做** | Lane B；见下方"剩余" |
> | **G2** Asyncify 最小实验 | ✅ **已实验（T10）—— 结论：不可采用** | `-s ASYNCIFY=1` 与 `-fwasm-exceptions` 互斥，`wasm-opt --asyncify` 直接失败；见 `build/113/NOTES-asyncify.md` |
> | **G3** pkg 语义 | ✅ **已完成**（T4） | `accept-pkg` 16/16 |
> | **H1** `voronoi` 单输出 | ⬜ **仍不可用，且根因变了** | T2 之后已能走到绘图，终点是 plot 桥不支持 `plot(hax,…)` 这类"首参是句柄"的调用形态 |
> | **H2** `uigetfile` | ✅ **已完成（T8）** | 走官方缝 `__fltk_uigetfile__`（必须是 `.oct` —— 中间层门禁 `exist==3`）；**两步**语义（异步/同步硬冲突），`accept-t8-uigetfile` 19/19 |
> | **H3** `getframe`/`movie` | ⬜ 仍暂缓 | 现在报 `failed to capture frame data`（toolkit 的 `get_pixels` 返回空）；属图形线 |
> | **H4** `inputname`/`nargin` 反射 | ⬜ 仍暂缓 | 优先级低，未测 |
>
> ### 剩余（非图形）三件，以及它们为什么还没做
>
> 1. **G1 `MAIN_MODULE=2` + 自动 keep 清单**（Lane B，1–3 d）：体积优化。
>    要点：从每个 `.oct` 的 import 表/dylink 段生成保活集喂主链，
>    **但不要把 import 原样抄成导出清单**（要看 mangling 与 JS 库导入）。
>    验收：体积显著下降 **且** 全量 28 套全绿。
> 2. **D1 的剩余部分：`.m` 文件的 docstring**（约 1010 个）：`help ode45` 仍会撞
>    makeinfo。可行的做法是**构建期预渲染 .m 的 docstring**（与 T1 同一技术），
>    代价是要动 `octave.data`（重链）或走资产车道做 MEMFS 覆写。
>    **`doc-cache` 注入已实测无效，别再试。**
> 3. **H2 `uigetfile`**：走**非标准异步 API**（如 `web_uigetfile()` 两段式/Promise），
>    并如实标注"与 MATLAB 语义不同"。
>
> **不属于本清单的非图形长尾**：control 包 SLICOT 编译件（`ss`/`step`/`tf2ss`）。
> **2026-09-22 探针更正**（见 `build/113/NOTES-slicot.md`）：不是"签名不匹配"而是那些符号
> **根本不存在**；库**能编**（f2c 614/614、emcc 613/613）；真正卡点是控制包手写声明 vs
> f2c 生成的 **CHARACTER 隐藏长度参数**分歧，**static 与 side 都会撞**。做法 = 逐个对齐
> 声明（粗查 47 个候选符号），估 1–3 天。

---

> **用途**：交给外部检索模型（GPT 等）审出方案。
> **与 `GAPS.md` 的关系**：那份是**第一批**需求书（R1–R11），**R1–R10 已全部落地**；
> 这份是**当时没写进计划、或写进"已论证不做"但现在值得重审**的缺口。
>
> **每条的"现状证据"都是浏览器实测输出**（8761 基线，`-O1` + MAIN_MODULE=1 +
> 官方 `.oct` 装载）。凡标"未实测"的会写明。
> 读者不需要本仓上下文。

---

## 0. 先划清"不是缺口"的东西（省得搜）

| 看着像缺口 | 实际 | 证据 |
|---|---|---|
| `ode23t` / `ode23tb` | **上游 Octave 7.2.0 就没有** | 源码树 `scripts/ode/` 只有 ode15i/15s/23/23s/45/decic/odeget/odeset/odeplot |
| `urlread2` / `xlsopen` / `mmread` | Forge 包，需单独装；非核心 | `exist=0`，但它们在 Forge 而非核心发行 |
| `ftp` | 浏览器里无意义（无 FTP 协议栈，且与"纯静态"冲突） | 有意不加 |
| `javaObject`（exist=5） | 内建在，但无 JVM → 调用必失败 | 已在 `GAPS.md` R11 列为不做 |
| 图形句柄（`figure()` 返回 double 而非 handle） | **有意的架构选择**：plot 桥用 spec 文件替代真句柄 | 见 §1.G1 的讨论 |
| `__list_functions__` 内建计数为 0 | 该函数返回的是**全部**函数名（2559 个），不含 `exist` 码语义 | 实测 `numel(__list_functions__())=2559` |

**官方函数索引覆盖**：`GAPS.md` 记录 1477/1512 = 97.7%（其中 35 个"缺"里 13 个是
点号形式的假阴性、9 个是手册示例名）。本轮未重测；若要重测需拉
`docs.octave.org/v7.2.0/Function-Index.html` 在浏览器里逐个 `exist()`。

---

## A. 图形栈：**最大的单块缺口**

### A1. gnuplot 图形工具包完全不可用（`__init_gnuplot__.cc` 未编 + 后端 `.m` 全调 `system`）

- **目标**：让 Octave 的**原生绘图路径**可用——即 `plot(...)` 走真图形句柄
  （`figure()` 返回 `figure` 对象、`gca`/`gcf` 可用、`set(h,'property',v)` 生效），
  由 gnuplot 后端出图。这是桌面版的标准行为。
- **现状证据**（8761 实测）：
  ```
  exist("__init_gnuplot__")        → 0      ← dldfcn 源码里有这个 .cc，但没编
  available_graphics_toolkits()    → {}(1x0) ← 空表：没有任何工具包
  graphics_toolkit()               → (空)
  figure() 的 class                → double  ← 我们的 plot 桥返回假句柄
  get(figure(), "type")            → error: get: invalid handle
  drawnow()                        → 静默无操作
  __gnuplot_version__              → 0      ← 未编
  ```
- **卡在哪**：`scripts/plot/util/__gnuplot_drawnow__.m`、`__gnuplot_print__.m`、
  `__gnuplot_version__.m` **都调 `system()`** 去启动 gnuplot 进程。本构建**无 shell**
  （`system()` 恒失败）。所以即使把 `__init_gnuplot__.cc` 编出来，后端仍会死在这一步。
- **要搜的问题**：
  1. 有没有办法让 gnuplot 后端**不经过 `system()`**？例如把 `__gnuplot_drawnow__.m`
     改成走一个自研内建（像我们的 `webio`/`webimage` 那样）——但它需要**同步**拿到
     gnuplot 的输出，而 gnuplot-wasm 在 JS 侧（本构建无 Asyncify）。
     这是我们当初判断"必须自写 SVG 生成器"的原因，**但值得重审**。
  2. gnuplot 之外的原生后端：Octave 7.2 还支持哪些？`qt`/`fltk`（已判不做）、
     `osmesa`（OpenGL，重）。有没有纯软件渲染的轻后端？
  3. **真图形句柄**是否可能只做一半：句柄对象 + 属性系统（`graphics.cc` 已经在主 wasm 里）
     可用，但**没有渲染后端**。能否做"句柄可用、渲染仍走我们的 spec 桥"？
     这一步能补上 `get/set/gca/gcf` 这类**脚本常写的代码**（很多教学脚本会
     `set(gca,'FontSize',14)`）。
- **验收标准**：`available_graphics_toolkits()` 非空；`h=figure(); get(h,'type')`
  返回 `"figure"`；`set(gca,'FontSize',14)` 不报错；`plot(1:10)` 后 `get(gca,'xlim')` 合理。
- **可行性直觉**（供参考，非结论）：第 3 条最可能落地（不需要真渲染）；
  第 1/2 条要看有没有非进程式后端。

### A2. 图形属性系统的**实测分界**（哪些真能用、哪些不能）

**已逐个调用实测**（不是只看 `exist`）：

| 函数 | exist | 调用结果 |
|---|---|---|
| `gcf()` | 2 | **可用**（返回 1） |
| `gca()` | 2 | `error: get: invalid handle (= 2)` — 差一个真 axes 对象 |
| `figure()` | 2 | 返回 `double`（假句柄），`get(h,'type')` 报 invalid handle |
| `imshow(rand(4,4))` | 2 | `error: get: invalid handle (= 4) called from gca` —— 死在 `gca` |
| `getframe()` | 2 | `error: getframe: no figure to capture` —— **报错文本是清晰的** |
| `movie` / `uicontrol` / `gcbo` / `copyobj` / `hgsave` | 2 | 未逐个调用；都依赖真句柄 |

**这张表说明**：图形句柄系统**部分活着**（`gcf` 能返回、`graphics.cc` 在主 wasm 里），
**缺的是"真 axes/figure 对象"**。所以 A1 的"半真句柄"路线不是空想——
`gca` 只要有一个最小可用的 axes 对象就能不报错，而 `imshow` 这类会跟着活。

- **要搜的问题**：
  1. 造一个"无渲染后端但属性完整"的 axes/figure 对象，需要动 `graphics.cc` 多少？
     能否用**已编入的 `graphics.cc`**（它本来就在主 wasm 里）+ 一个**空的后端**
     （`__init_*` 只注册名字、不做渲染）实现？
  2. `set(gca,'FontSize',14)` 这类**只写属性不读几何**的调用，即使没有渲染也该成功——
     能不能只保这一层？
  3. `getframe` 的报错文本已经很清晰（"no figure to capture"），可以作为"明确报错"的
     样板——其余依赖句柄的函数应照这个标准改（在 Octave 侧覆写 `.m` 加前置检查）。
- **验收标准**：`h=figure(); get(h,'type')` → `"figure"`；`set(gca,'FontSize',14)` 不报错；
  `gca()` 返回对象而非报 `invalid handle`；明确不支持的那些（`getframe`/`movie`）
  报错文本能指导用户。

---

## B. 音频：录制侧（播放侧已做）

### B1. `audiorecorder` / `record` 不可用（`__recorder_*` 19 个符号全缺）

- **目标**：`audiorecorder` + `record` + `getaudiodata` 可用（麦克风录音）。
- **现状证据**（8761 实测）：
  ```
  exist("audiorecorder")             → 2      ← .m 在
  audiorecorder(8000,8,1)            → error: '__recorder_audioplayer__' undefined
  exist("__recorder_record__")       → 0
  exist("audiodevinfo")              → 0      ← 连设备查询都没有
  record(r,1)                        → error（因 r 未建）
  ```
- **卡在哪**：`audiodevinfo.cc` 里除了 18 个 `__player_*`（我们已用纯 `.m` 重写），
  还有 **19 个 `__recorder_*`** 与 `audiodevinfo` 本身。播放侧能用是因为
  `AudioBufferSourceNode` 天然回放已有数据；**录制侧要拿到麦克风流**，需要
  `getUserMedia`（异步 + 权限），而且 Octave 是同步的——这是真难点。
- **要搜的问题**：
  1. `getUserMedia` 的异步性与 Octave 同步模型怎么调和？我们的 WebAudio 桥已有
     "Octave 写队列、页面侧执行"的模式（`bridge/webaudio.js`），录制能否用同一模式
     （页面侧录音 → 写 MEMFS → `getaudiodata` 读文件）？
  2. 权限弹窗与"教学场景"的兼容性（不点允许就没数据）。
  3. `audiodevinfo()` 该返回什么？浏览器里没有设备枚举 API（`enumerateDevices` 需权限）。
     给假数据还是明确报错？
- **验收标准**：`r=audiorecorder(8000,8,1); record(r,1); d=getaudiodata(r);`
  在授予麦克风权限后得到非空数据；未授权时**清晰报错**（不是 `undefined`）。
- **备注**：这一条的现实价值取决于是否接受"要用户授权"。

### B2. `audiodevinfo` 缺失的连带影响

- **现状**：`exist("audiodevinfo")=0`。`audioplayer.m` 的文档说"设备 ID 可用
  `audiodevinfo` 查"；我们的播放侧默认 `DeviceID=-1`。
- **要搜的问题**：是否该提供 `audiodevinfo` 的桩（返回 1 个"浏览器默认设备"），
  让 `audiodevinfo(0)` 这类探测代码不炸？
- **验收标准**：`audiodevinfo(0) > 0` 或**明确报错**，二者之一即可。

---

## C. 系统/文件操作（有内建实现但走了 `system()`）

### C1. `copyfile` / `movefile` / `ls`（shell 类文件操作）

- **目标**：文件操作在浏览器里真能用。
- **现状证据**（8761 实测，含根因定位）：
  ```
  fid=fopen("/tmp/a.txt","w"); ...; copyfile("/tmp/a.txt","/tmp/b.txt")
    → error: system: unable to start subprocess for 'cp -r "/tmp/a.txt" "/tmp/b.txt"'
  ls("/tmp")            → error: get: invalid handle（注意：不是 system 错误）
  which("ls")           → /usr/src/octave/m/miscellaneous/ls.m
  ls_command("")        → "ls -C"        ← 构造出 shell 命令
  ```
  **两条不同的死法**：`copyfile` 死在 `system()`（明确）；`ls` 死在别处
  （`get: invalid handle` —— 需要进一步定位是 `ls.m` 的哪个分支；
  可能是它试图拿到输出流句柄）。
- **全树统计**：`target/share/octave/7.2.0/m/` 下有 **34 个 `.m` 调 `system()`**：
  `copyfile` `movefile` `ls` `pkg` `tar` `zip` `unpack` `print` `publish`
  `edit` `doc` `dos` `unix` `perl` `python` `mkoctfile` `configure_make`
  `__gnuplot_*` `__makeinfo__` `__opengl_info__` `graphics_toolkit` `hgsave`
  `getframe` `listfonts` `uimenu` `uisetfont` `allchild` `copyobj` `tar_is_bsd`
  `ls_command` `__debug_octave__` `printd` 等。
- **已做的**：批次 4 已把 `zip/unzip/tar/untar/gunzip/bunzip2` 改成进程内实现
  （`webio.oct` + `webshell` 覆写）。**其余 28 个没动。**
- **要搜的问题**：
  1. **哪些值得重写**？我的判断（供审核）：
     - 高价值：`copyfile`/`movefile`（教学脚本常写）、`ls`（交互常写）、
       `mkdir` 类、`doc`/`publish`（要 makeinfo，见 D1）
     - 低价值：`perl`/`python`/`dos`/`unix`/`mkoctfile`/`configure_make`
       （宿主专属，明确报错即可）
     - 中价值：`hgsave`/`copyobj`/`allchild`/`uimenu`/`uisetfont`（图形属性，依赖 A1）
  2. `copyfile`/`movefile` 的**递归目录 + 通配符 + 'f' 强制覆盖**语义怎么用纯 `.m`
     实现（Octave 有 `dir`/`readdir`/`rmdir`/`unlink`？本构建里可用吗）？
  3. `ls` 的失败原因是什么（它走 `ls_command` → `system`，但报的是 `get: invalid handle`
     —— 可能是另一个路径）。需要先定位。
- **验收标准**：`copyfile('/tmp/a.txt','/tmp/b.txt')` 成功；
  `copyfile('/tmp/dir1','/tmp/dir2','f')` 递归复制成功；`ls('/tmp')` 列出文件。
  其余（`perl`/`python`/`mkoctfile`）保持**清晰报错**。

---

## D. 文档与帮助（已实测修不了，但值得重审）

### D1. `help` 对所有非平凡输入报 `makeinfo` 子进程错误

- **现状证据**（8761 实测）：
  ```
  help("plot")     → 可用（.m 文件的 docstring 直接可读）★
  help("sin")      → error: system: unable to start subprocess for
                     'makeinfo --no-headers --no-warn --no-validate --plaintext ...'
  help("ode45")    → 同上
  disp(函数对象)    → 同上
  ```
- **已试过的方案（失败）**：注入 `doc-cache`（2MB）+ `built-in-docstrings`（641KB）
  到 wasm FS。效果：错误从"文件缺失"变成"makeinfo 不可用"——
  **因为渲染那一步（texinfo → 纯文本）绕不过去**。
- **三条已知路径都实测堵死**（8761）：
  ```
  help("sin")   → makeinfo 子进程错误
  help sin      → 同上
  help -s sin   → error: help: function called with too many inputs   ← -s 不是这个用法
  ```
- **要搜的问题**：
  1. `__makeinfo__.m` 的**覆写可行性**：它第 155 行是 `system(pipeline)`。
     我们已在批次 4 用"自研内建 + `.m` 覆写"解决过同类问题（`zip`/`tar` 等）。
     **这条最有希望**：写一个 `__makeinfo__.m` 覆写，做**简化的 texinfo → 纯文本**
     （去掉 `@deftypefn`/`@var`/`@code` 这类标记，保留正文）。
     教学场景不需要逐字准确的 texinfo 渲染，**能读就行**。
  2. 覆写点是 `__makeinfo__` 还是 `makeinfo`？两者关系要查清（`help.m` 调哪个）。
  3. texinfo 有没有 **JS/wasm 实现**可用（若简化不够，退路是真的解析器）。
  4. `doc-cache` 的作用到底是什么？我们已经注入但它只影响"找得到文档"，
     **渲染那步仍需 makeinfo**——所以注入了也没用（已实测）。
- **验收标准**：`help("sin")` 返回含 "sine" 的可读文本（不要求与桌面版逐字一致）；
  `disp(@sin)` 不报错；`help("plot")`（本来就能用）**不回归**。
- **优先级理由**：学生第一个会打的命令就是 `help`。而且路线 1 是**纯 `.m` 覆写**，
  与我们已经验证过的 6 个覆写（`zip`/`tar`/`gunzip`/…）**同一模式**——风险低。
- **备注**：这是**最影响"像不像真 Octave"的一条**——学生第一个会打的命令往往就是 `help`。

### D2. `doc` / `publish`（依赖 D1 + 浏览器 UI）

- **现状**：`doc` 在 34 个 `system()` 名单里；`publish` 也是。
- **要搜的问题**：`doc` 在浏览器里应该打开什么？（我们已有站点页面）是否值得做一个
  "把 docstring 渲染到页面 DOM"的桥。
- **验收标准**：`doc sin` 把文档显示到页面（或明确说明不支持）。

---

## E. 交互式输入（无 stdin）

### E1. `input()` / `keyboard` / `menu` 的可用性

- **现状证据**：
  ```
  exist("input")    → 5   （内建在）
  exist("kbhit")    → 5
  exist("menu")     → 2
  ```
  `input()` 是内建（`exist=5`），但**未实测调用时行为**（它会阻塞等 stdin）。
- **要搜的问题**：纯静态页面里 `input()` 该怎么做？
  1. 用 `prompt()`（同步！）——浏览器里 `window.prompt` 是**阻塞式**的，
     理论上能接 `input()`！这是最直接的方案。
  2. 但要改 Octave 的 `input()` 内建或覆写它（`.m` 覆写会破坏"内建语义"）。
  3. `keyboard`（交互式调试）怎么办？
- **验收标准**：`x=input("请输入: ")` 弹出浏览器对话框并拿到返回值；取消时返回空。
- **备注**：价值中等（教学脚本多用硬编码），但 `input()` 是很多示例代码的第一行。

### E2. `pause()` 与 `kbhit`

- **现状**：`pause` 是内建；`kbhit` 存在（`exist=5`）。
- **要搜的问题**：`kbhit` 在无键盘事件循环时该返回什么？`pause` 是否真阻塞？

---

## F. 稀疏/数值长尾

### F1. SPQR 未编（R7 的尾巴）

- **现状证据**：
  ```
  exist("spqr")  → 0
  exist("ichol") → 2（.m 在；它是否需要 SPQR 后端？待查）
  ```
  `config.h` 里 `HAVE_SPQR` **未定义**（configure 带 `--without-spqr`）。
- **要搜的问题**：从 `suitesparse-full-5.4.0.tar.gz` 单独编 SPQR 的配方
  （需 `-fPIC`，且要处理 SuiteSparse 的 `SuiteSparse_config`）；
  交叉编译下是否需要预置 `octave_cv_*`。
- **验收标准**：`spqr(A)` 对稀疏矩阵返回 QR 分解，`Q*R` 残差 < 1e-10。
- **备注**：`GAPS.md` R7 就列了，一直没做。价值中等（`qr` 已可用，SPQR 是稀疏专属）。

### F2. ~~`ichol`~~ —— **实测不是缺口，撤销**

- **实测**（8761）：
  ```
  A=sprand(30,30,0.1); L=ichol(A)
    → error: ichol: encountered a pivot equal to 0
  ```
  **这条错误是数学性的，不是"后端缺失"** —— `ichol` 正常工作，只是随机稀疏矩阵
  的对角有零元（不完全 Cholesky 的固有前提是正定/对角非零）。
  换一个对角占优的矩阵即可用。
- **结论**：从缺口清单移除。这也提醒：`exist=2` + 调用报错的组合里，
  **有些报错是正常的数学错误，不是能力缺失**——审核时要注意区分。

---

## G. 架构层：值得重审的既有决定

### G1. `MAIN_MODULE=2` + 显式导出清单（体积优化）

- **现状**：`MAIN_MODULE=1` 不做 DCE，wasm 44.5MB / js 20.5MB。
  `MAIN_MODULE=2` 能显著压缩，但 **DCE 会删掉 `.oct` 要 import 的函数**（实测崩）。
- **要搜的问题**：能不能生成一份"`.oct` 实际需要从主模块拿的符号"清单
  （用 `wasm-objdump` 读每个 `.oct` 的 import 表），喂给 `MAIN_MODULE=2` 的导出白名单？
  这是**确定性**的工作（import 表是死的），可能一次就能压下来。
- **验收标准**：体积显著下降 **且** 全量 15 套验收全绿。
- **备注**：收益是首包 gzip（当前 ≈11.6MB），对用户体验有实际影响。

### G2. Asyncify 重审（当初判断"不需要"）

- **现状**：R5 已用**同步 XHR** 拿到真同步 `urlread`，没上 Asyncify。
- **要搜的问题**：Asyncify 还能解锁什么？
  1. `__gnuplot_drawnow__` 同步调 JS 侧 gnuplot-wasm（**这可能让 A1 的路线 1 可行**）
  2. `input()` 走异步 UI
  3. `getUserMedia`（B1 录制）
  代价：体积与性能，且与 `MAIN_MODULE=1` 共存的报告不一，**必须实测**。
- **验收标准**：给出"能解锁什么 / 代价多少"的实测表；不要求一定采用。
- **关联**：**如果 A1 走"改 `__gnuplot_drawnow__` 走自研内建"的路线，Asyncify 就是前置**。

### G3. `pkg` 的语义一致性（**实测：机制活着，只是不知道我们的资产**）

- **实测**（8761）：
  ```
  exist("pkg")   → 2
  pkg list       → "no packages installed."        ← 能跑！
  pkg load statistics → error: package statistics is not installed
  ```
  **机制是活的**（`pkg list` 正常返回），只是它的"已装包"记录里没有我们资产车道装的包
  ——因为我们是绕开 `pkg` 直接 `addpath` + 预编译件的。
- **要搜的问题**：
  1. 能不能让 `pkg list` **认识资产车道的包**？两条路：
     (a) 写一个 `pkg` 覆写（`.m`），把 `list`/`load`/`describe` 转发到 `OctaveAssets`；
     (b) 让资产车道在装包时**注册进 Octave 的 pkg 数据库**（需要伪造 `pkg` 的
         install 记录结构——要查它存在哪、什么格式）。
  2. `pkg install` 要不要支持？我们的资产是**预编译好的**（`.m` + `.oct`），
     所以"install"实质是"从站点取资产"——理论上可做，但语义上要讲清楚
     （不是从 Forge 拉源码编译，而是装我们发布好的构建）。
- **验收标准**：`pkg list` 列出已加载的资产包；`pkg load statistics` 与
  `OctaveAssets.load('statistics')` 等价；`pkg install` 对**未知包**给出清晰说明
  （"本构建只能装站点已发布的包"）。
- **备注**：纯**语义一致性**问题，非能力问题。但价值不低——`pkg load` 是
  很多教学脚本/教材示例的第一行。

---

## H. 其它已知但未处理的

### H1. `voronoi` 单输出形式（要画图）

- **现状**：`voronoi` 的两输出形式正常（24 个顶点），单输出形式走 `gca` → 失败。
- **关联**：A1 若落地则自动解决。

### H2. `__fltk_uigetfile__` / `uigetfile` / `questdlg` / `menu`

- **现状**：`exist("uigetfile")=2`、`questdlg`=2、`menu`=2，但都需要真 UI。
- **要搜的问题**：浏览器里 `<input type=file>` 能替代 `uigetfile` 吗？
  （**注意**：纯静态页面里，用户选的文件可以读进 wasm FS——这是**能做**的。）
- **验收标准**：`uigetfile()` 弹出文件选择框，选中的文件可从 Octave 读；
  取消返回 0。
- **备注**：这是"浏览器比桌面版更强"的地方，值得做。

### H3. `getframe` / `movie`（动画）

- **现状**：`exist=2`，但需要渲染后端抓帧。
- **关联**：A1 若落地可部分解决；否则应明确报错。

### H4. `inputname` / `nargin` 类反射

- **未实测**。低优先。

---

## 优先级建议（供审核，非结论）

按"用户感知强度 × 可行性"排。**可行性一列基于本轮实测**，不是猜测：

| 序 | 缺口 | 为什么这个位置 | 可行性信号 |
|---|---|---|---|
| 1 | **D1 `help`** | 学生第一个命令；而且路线是**纯 `.m` 覆写 `__makeinfo__`**——与本项目已验证过 6 次的覆写模式同型 | 高（模式已验证） |
| 2 | **A1 图形句柄半真化** | 实测 `gcf()` **已可用**、只差真 axes 对象；`get/set/gca` 是教学脚本常见写法，**不需要真渲染** | 中偏高（`graphics.cc` 已在主 wasm 里） |
| 3 | **C1 `copyfile`/`movefile`/`ls`** | 教学脚本常写；纯 `.m` 可解（Octave 有 `dir`/`readdir`/`rmdir`/`unlink` 等内建） | 高 |
| 4 | **E1 `input()`** | `window.prompt()` 在浏览器里是**同步阻塞**的，理论上直接对接 | 中（要改内建或用桥） |
| 5 | **H2 `uigetfile`** | 浏览器独有优势（`<input type=file>` → wasm FS），明确可做 | 高 |
| 6 | **G3 `pkg` 语义** | 实测 `pkg list` 能跑、机制活着，只是不认识我们的资产 | 高（但需查 pkg 数据结构） |
| 7 | **G1 `MAIN_MODULE=2` + 导出清单** | 纯体积收益（首包 gzip 11.6MB）；**工作确定性高**（`.oct` 的 import 表是死的，可自动生成白名单） | 中（有实测过的失败先例，但那次是"无清单"） |
| 8 | **B1 `audiorecorder`** | 补完音频侧；但要 `getUserMedia`（异步 + 授权） | 中（本项目已有"队列 + 页面执行"模式可复用） |
| 9 | **G2 Asyncify 重审** | 若 A1 走"同步调 gnuplot-wasm"，Asyncify 是前置；否则不必 | 未知（**必须实测**） |
| 10 | F1 SPQR / H1 / H3 / H4 | 长尾，非阻塞 | 中 |

**请审核并针对每条给出**：
- 可行性判断（有/无现成方案）
- 推荐路线与工作量估计
- 是否需要外部依赖（库/工具/wasm 移植）
- 已知的坑

---

## 附：本轮实测方法与可复现性

上面每条"现状证据"都来自浏览器实测，跑法：

```sh
# 8761 = 现行基线（-O1 + MAIN_MODULE=1 + 官方 .oct 装载）
/mnt/hdd/octave-wasm-build/harness/run.sh <脚本> http://127.0.0.1:8761/
```

盘点脚本（临时，未入库）：在无头 chromium 里 `goto` → 轮询就绪 → 自动装载全部资产
→ 逐条 `eval_string` 取 console 输出。**注意**：本项目的能力大多走**懒加载车道**，
不先装资产就测等于测"没按需加载"，不是测"能力不存在"。

**现有验收套件**（15 套 418 项，全绿）可用于回归对照：
`test/browser/accept-{full,hdf5,forge,forge-oct,forge2,dldfcn,ode15,archive,image,
print,plotv2,plot3d,audio,net,requirements}.mjs`

---

## 附：本轮实测的完整"可用面"清单（作为对照基线）

**已可用**（浏览器实测）：
- 核心：全量 `.m`（2559 个函数名可列出）、classdef、`+containers`/`+matlab` 包
- 线代/稀疏：`lu` `qr`（含 CXSparse 路径）`eigs` `svd` `sparse` `gmres` `pcg` `ichol`
- ODE：`ode45` `ode23` `ode15s` `ode15i` `ode23s` `decic` `odeset` `odeget` `odeplot`
- 优化：`fminsearch` `fminbnd` `fminunc` `fzero` `lsqnonlin` `quadprog` `linprog` `fmincon` + `glpk`
- 统计：完整 `statistics` 包 + `signal` + `control`（纯 `.m` 面）
- I/O：`save/load`（含 `-hdf5` `-v7`）、`imread/imwrite/imfinfo`、`audioread` 系列、
  `jsonencode/jsondecode`、`urlread/urlwrite/webread/websave`（**同步**）
- 压缩归档：`gzip/bzip2/zip/unzip/tar/untar/gunzip/bunzip2`（进程内，无 shell）
- 绘图：plot 桥 v2（2D + 3D）、`print -dsvg`（纯 `.m`）、中文标签、`subplot`、`figure(n)`
- 音频播放：`audioplayer`（18 个符号，WebAudio）
- 几何：`convhulln` `delaunayn` `voronoi`（两输出）`glpk`

**明确不可用**：见上文 A–H。
