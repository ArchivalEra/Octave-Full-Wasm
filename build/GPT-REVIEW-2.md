我把这份 v2 当成正式的“技术方案审查稿”重新过了一遍，并对关键点查了 Octave 7.2 源码/文档、SuiteSparse 和 Emscripten 的实现资料。

先说一个很重要的审查结果：**F1 的 `spqr` 应该直接从缺口表删除**。`spqr` 这个 Octave 函数早在 3.6.0 就被移除了，替代品就是 `qr`；现在稀疏 `qr` 才是通过 SPQR/CXSparse 后端实现的。因此你当前 `exist("spqr")=0` **不是 WASM 缺口**。([Octave Documentation][1])

你现在的基线确实已经相当完整：2559 个函数名可见，线代/ODE/优化/统计/I/O/压缩/2D+3D 绘图桥/音频播放等都已经实际跑通；当前真正剩下的是“浏览器环境语义”以及少数系统后端缺失，而不是数学能力缺失。

# 总体审核结论

按照“投入以后能明显提高这个东西像不像真正 Octave”的角度，我会把它改成：

**第一梯队，值得直接做：**

`D1 help` → `A1 真 graphics handle（先做半真化）` → `C1 copyfile/movefile/ls` → `G3 pkg 语义` → `E1 input`

**第二梯队，有明确路线但不要现在啃：**

`H2 uigetfile` → `B1 audiorecorder` → `G1 MAIN_MODULE=2`

**第三梯队，先做实验再决定：**

`G2 Asyncify`

**暂缓/明确不做：**

`D2 publish`、`E2 keyboard/kbhit/pause`、`H3 movie/getframe`、`H4`。

而且 **A1 不应该从“把真正 gnuplot 后端复活”开始**。正确路线是：

> **先让 Octave 原生 graphics object / figure / axes / get / set / gca / gcf 活起来；渲染继续走你已经验证成功的 gnuplot-wasm bridge。**

这是两件不同的事情。

---

# A1 / A2：图形句柄半真化

### 审核结论：**可做，而且比你原稿里想的更值得做**

你当前实测是 `gcf()` 能返回、`graphics.cc` 已经存在，但 `gca()` 落到 invalid handle；这说明图形管理器并没有整体死掉，主要缺的是对象/工具包初始化路径。

Octave 7.2 的 graphics toolkit 本身就是一个独立的抽象层。官方的 `gnuplot_graphics_toolkit` 继承 `base_graphics_toolkit`，而核心图形对象管理在另一层；`__init_gnuplot__.cc` 最重要的工作实际上就是创建 toolkit 对象并挂进 `gtk_manager`。([Octave Documentation][2])

更关键的是，官方 gnuplot toolkit 的 `redraw_figure()` 最终只是调用：

```text
__gnuplot_drawnow__
```

而不是把所有图形逻辑都实现进 toolkit。([Octave Documentation][3])

所以你的路线可以直接拆成：

```text
Octave 原生 graphics.cc
        ↓
真正 figure / axes / line / text 对象
        ↓
get / set / gca / gcf / subplot / ...
        ↓
Web toolkit
        ↓
你的现有 plot bridge
        ↓
gnuplot-wasm / SVG
```

而不是：

```text
graphics.cc → 真正 gnuplot 进程
```

后者才会撞到 `system()/pipe/同步输出` 那堵墙。官方文档也确认 gnuplot toolkit 本身就是通过单向 pipe 与外部 gnuplot 通信。([Octave Documentation][4])

### 推荐实现

新建一个类似：

```text
__init_web__.cc
```

或者你自己的 `.oct`：

```text
__init_web__.oct
```

核心只做：

```cpp
class web_graphics_toolkit
    : public octave::base_graphics_toolkit
```

然后：

* `initialize()`：允许 figure
* `update()`：先只处理必要属性
* `redraw_figure()`：第一版甚至可以 no-op
* `show_figure()`：no-op
* `get_canvas_size()`：返回固定默认值
* `print_figure()`：暂时交给现有桥或明确不支持

这样首先把：

```matlab
h = figure();
gca();
gcf();
get(h,"type");
set(gca,"FontSize",14);
xlim(...)
ylim(...)
title(...)
xlabel(...)
```

从“invalid handle”层面救回来。

### 工作量

**半真化：1–3 天。**

如果随后还要把原生 graphics object 自动翻译成你现在的 plot spec：

**再加 2–5 天。**

真正做到 `drawnow + print -dsvg + getframe` 全语义一致：

**这是另一个项目，至少 5–10 天级别。**

### 外部依赖

**没有。**

只复用你自己的 WASM/`.oct`/JS bridge。

### 最大坑

最大坑不是 graphics.cc，而是：

> **原生 graphics object → 你现有 spec bridge 的映射。**

如果当前 `plot` bridge 是直接拦截 `plot(x,y,...)` 参数生成 spec，而不是遍历 figure 对象，那么恢复原生 graphics 后，两套状态模型会并存。

因此我建议：

**第一阶段不要碰完整 plot 重构，只恢复 object semantics。**

这样风险最低。

---

# B1：audiorecorder / record

### 审核结论：**可以做，但“record”和“recordblocking”必须分开**

你当前的判断是对的：Octave 的 recorder 后端是一组 PortAudio 相关内部函数，而浏览器录音必须经过 `getUserMedia()`。

官方源码也证实 `__recorder_record__`、`__recorder_recordblocking__` 等符号全部依赖 `HAVE_PORTAUDIO`；没有 PortAudio 时就是 disabled feature。([Octave Documentation][5])

浏览器这边 `getUserMedia()` 返回的是 Promise，而且需要用户授权；只能在 secure context 下使用。([MDN Web Docs][6])

### 最合理的方案

**不要去移植 PortAudio。**

直接：

```text
audiorecorder.m
      ↓
web_audio_recorder.oct / JS bridge
      ↓
getUserMedia()
      ↓
Web Audio
      ↓
PCM buffer
      ↓
MEMFS / JS shared buffer
      ↓
getaudiodata()
```

而且可以不动 core。

### 一个很重要的语义问题

Octave 的：

```matlab
record(r, 5)
```

本来就是启动录音，并非“同步等待 5 秒再返回”。

真正需要同步等待的是：

```matlab
recordblocking(r, 5)
```

所以：

**非阻塞 `record()` 不需要 Asyncify。**

而：

**`recordblocking()` 才需要 Asyncify 或重新定义浏览器 API 语义。**

这会让 B1 的难度明显下降。

### 工作量

`record + stop + getaudiodata`：

**1–2 天。**

再做 `recordblocking`：

**+1–3 天。**

### 外部依赖

**无。**

直接 Web Audio / MediaDevices。

### 坑

最大坑是权限：

`getUserMedia()` 永远需要用户授权，而且 HTTPS/localhost 等安全上下文是前提。([MDN Web Docs][6])

所以这里应该明确设计：

```text
允许 → 正常录音
拒绝 → Octave 可读的明确错误
没有安全上下文 → 明确错误
```

而不是模拟一个永远存在的麦克风。

---

# B2：audiodevinfo

### 审核结论：**容易，值得做，但不要假装成完整设备枚举**

Octave 的 `audiodevinfo()` 本来就返回 input/output 两组设备，包含 Name、DriverVersion、ID。([Octave Documentation][7])

但浏览器的 `enumerateDevices()` 也是异步 API，而且非默认设备的信息受权限控制。([MDN Web Docs][8])

### 推荐

提供一个**最小浏览器设备模型**：

```text
input:
  Name = "Browser microphone"
  DriverVersion = "Web MediaDevices"
  ID = 0

output:
  Name = "Browser default output"
  DriverVersion = "Web Audio"
  ID = 0
```

然后只保证：

```matlab
audiodevinfo(0)
audiodevinfo(1)
```

以及最常见的查询不炸。

对不支持的真实设备枚举/驱动查询，给明确错误。

### 工作量

**半天以内。**

### 外部依赖

无。

### 注意

这应该被定位成**兼容性 shim**，不要追求 PortAudio 的全部设备语义。

---

# C1：copyfile / movefile / ls

### 审核结论：**非常值得做，而且比原稿还适合纯 `.m` 重写**

你当前的根因已经确认：`copyfile` 掉进 `system("cp ...")`；`ls` 又碰到了另一条 shell/输出路径。

而 Octave 本身已经有：

```text
dir
readdir
glob
stat
mkdir
rmdir
unlink
```

这套基础能力。7.2 文档中 `dir` 本身已经直接返回文件结构数组，因此完全可以构成浏览器版文件操作的底层。([Octave Documentation][9])

### 推荐

直接覆盖：

```text
copyfile.m
movefile.m
ls.m
```

内部全部基于：

```text
dir / readdir / fopen / fread / fwrite / mkdir / unlink / rmdir
```

实现。

### copyfile

分三层：

```text
file → file
file → dir
dir  → dir 递归
```

通配符：

```text
glob()
```

`'f'`：

```text
允许覆盖
```

### ls

不要努力复刻：

```text
ls -l
ls -a
ls -h
```

所有 Unix 格式细节。

第一版只把：

```matlab
ls
list = ls(...)
```

做正确。

### 工作量

**1–2 天。**

### 外部依赖

无。

### 坑

真正需要测试的是：

* 通配符
* 递归目录
* 空目录
* 覆盖
* `/tmp`
* 相对路径
* `.` / `..`

另外 MEMFS 本身并不是一个真实操作系统文件系统，因此不要追求权限位、inode、符号链接等宿主 OS 语义。

---

# D1：help / makeinfo

### 审核结论：**整张表里 ROI 最高的一项**

你现有实测已经把根因钉死了：

```text
help("plot") → 可用
help("sin")  → makeinfo 子进程错误
```

而且你已经验证“塞 doc-cache”只能解决找到文档，解决不了 Texinfo → plain text 的渲染。

这里有一个很好的官方事实：

Octave 有独立的：

```matlab
get_help_text(name)
```

它可以直接取得**原始 help text**，格式可能是 Texinfo / HTML / plain text。([Octave Documentation][10])

因此没必要把 GNU makeinfo 整套搬到 WASM。

### 最推荐路线

**覆写 `__makeinfo__.m`。**

输入：

```text
Texinfo
```

输出：

```text
plain text
```

只支持教学需要的宏：

```text
@deftypefn
@var
@code
@emph
@example
@item
@itemize
@seealso
```

把不了解的 `@foo{...}` 做降级剥离。

### 更好的做法

其实我会再进一步：

**先做离线预处理。**

构建期间把核心函数帮助文本预转成：

```json
{
  "sin": "...",
  "cos": "...",
  "ode45": "...",
  ...
}
```

浏览器里的 `help` 优先直接读预处理结果。

这样运行时根本不需要 Texinfo parser。

### 两条路线分别适合什么

```text
离线预处理
    ↓
核心内置函数
```

最高效。

```text
__makeinfo__.m 简化 parser
    ↓
用户自己写的 .m 文档
```

解决动态文档。

所以我建议**两者并用**。

### 工作量

核心 help：

**0.5–1 天。**

覆盖绝大多数 Texinfo：

**1–3 天。**

### 外部依赖

无。

### 最大坑

不要试图“正确实现 GNU Texinfo”。

教学场景完全没必要。

你的验收标准：

```matlab
help sin
help ode45
help plot
```

可读即可。

---

# D2：doc / publish

### 审核结论：**doc 值得做，publish 不值得现在做**

`doc` 可以直接依赖 D1。

建议：

```matlab
doc sin
```

转成：

```text
help text → HTML → 站点 DOM
```

### 工作量

`doc`：

**0.5–1 天。**

`publish`：

**2–4 天起步**，而且会被 graphics / 文件 / 页面 UI 一大串东西拖住。

因此：

> **D2 应该拆成 D2a doc 和 D2b publish。**

D2a 可以做。

D2b 暂缓。

---

# E1：input()

### 审核结论：**可做，而且浏览器其实比你想象的友好**

你注意到 `window.prompt()` 是关键，这个判断是对的。

Octave 的 `input()` 本来就是一个**同步等待用户输入**的 API。([Octave Documentation][11])

因此它与：

```javascript
window.prompt()
```

的模型非常匹配。

### 最重要的区别

不要走现代：

```text
input UI → Promise → await
```

直接走：

```text
Octave
  ↓
同步 JS bridge
  ↓
window.prompt()
  ↓
字符串
  ↓
Octave
```

因为 `prompt()` 本身就是浏览器提供的同步 modal API。

### 两种实现

优先实验：

```text
input.m 覆写
```

如果能成功 shadow 内建，就可以做到完全不重编 core。

否则才考虑改 input 内建。

### 工作量

**0.5–1.5 天。**

### 坑

`input("x = ")` 和：

```matlab
input("x = ","s")
```

语义不同。

前者需要把用户输入当 Octave expression 求值。

所以不能只简单：

```matlab
x = prompt(...)
```

必须保留：

```text
expression evaluation
```

这一层。

---

# E2：pause / kbhit / keyboard

### 审核结论：**暂缓**

这几个 API 的真正难点都是：

> 浏览器主线程不能像 Unix 进程一样随便同步睡眠然后继续活着等事件。

Emscripten 文档明确说明浏览器是 cooperative event model；同步代码长时间占着主线程会阻塞事件循环。([Emscripten][12])

所以：

```text
pause(1)
keyboard
kbhit
```

一旦要求真正“等待浏览器事件后继续执行”，Asyncify 才开始有价值。

### 建议

现在：

```text
pause(0) → 尽可能兼容
pause(n) → 明确 browser limitation / 或 Asyncify build 才支持
keyboard → 不做
kbhit → 不做
```

不要为这几个函数单独开一个大工程。

---

# F1：SPQR

### 审核结论：**删除整个条目**

这个是本轮审核里最明确的纠错。

Octave 官方 obsolete function 表：

```text
spqr → qr
```

删除版本是 **3.6.0**。([Octave Documentation][1])

因此：

```text
exist("spqr") == 0
```

完全正常。

真正值得检查的是：

```matlab
A = sparse(...)
[Q,R,E] = qr(A)
```

是不是走到了 SPQR/CXSparse 后端。

Octave 的 sparse QR 类实现确实在 `HAVE_SPQR + HAVE_CHOLMOD` 条件下使用 SPQR，否则退回 CXSparse。([Octave Documentation][13])

而你现在已有：

```text
qr
eigs
svd
sparse
```

并且实测通过。

所以 **F1 不仅不用做，应该从缺口表永久删除。**

---

# F2：ichol

你的撤销判断正确。

当前这个：

```text
pivot equal to 0
```

属于矩阵数学条件，不是 WASM 后端能力问题。

**永久删除。**

---

# G1：MAIN_MODULE=2 + import 白名单

### 审核结论：**值得做，但是一个“工程优化项目”，不是功能缺口**

你的基本判断是对的：

```text
MAIN_MODULE=1
→ 不做 DCE
→ 主模块胖
```

而：

```text
MAIN_MODULE=2
→ DCE
→ side module 需要的符号必须手工保活
```

Emscripten 官方文档明确说明了这一点；`MAIN_MODULE=2` 下，需要由你保证 side module 依赖的主模块符号被保留。([Emscripten][14])

所以你的：

```text
wasm-objdump import table
      ↓
符号集合
      ↓
自动生成 export/keep list
```

思路是合理的。

### 但有一个关键坑

不能简单认为：

```text
所有 import
=
EXPORTED_FUNCTIONS 原样抄过去
```

要验证：

* wasm symbol naming
* C/C++ mangling
* JS library imports
* Emscripten runtime imports
* side module 的真正 unresolved dependency

因此应该自动生成**最小保活集合**，然后跑你现有 418 项测试。

### 工作量

**1–3 天。**

### 外部依赖

无。

### 收益

这是一个很适合工程化做的项目：

```text
输入：
全部官方 .oct

输出：
keep-symbols.txt

然后：
MAIN_MODULE=2
```

只要收益显著，就非常漂亮。

---

# G2：Asyncify

### 审核结论：**不要现在直接全量打开；先做“最小实验”**

Asyncify 本来就是用来让同步 C/C++ 代码等待异步 JS 操作的。Emscripten 现在仍明确支持这一模式，而且 dynamic linking 场景也有专门的 Asyncify 配置说明。([Emscripten][15])

它确实能解决你列出的：

```text
gnuplot-wasm 同步等待
input 的异步 UI
uigetfile
getUserMedia
recordblocking
pause
```

但代价是代码尺寸和运行性能。

Emscripten 文档明确指出 Asyncify 会产生明显的代码体积/速度成本，现代文档给出的典型量级是“约 50% 左右”的开销，但你的实际基线是 **3.1.24 + Octave 7.2**，因此这个数字只能当方向性参考，不能拿来当项目预算。([Emscripten][15])

### 最正确的实验

不要：

```text
整个 Octave → ASYNCIFY=1
```

先做：

```text
当前 build
  ↓
ASYNCIFY
  ↓
最小 bridge
  ↓
一个 Promise
```

分别测：

```text
wasm
js
gzip
启动
plot
eigs
全量验收
```

再决定。

### 一个好消息

Asyncify 有针对性的：

```text
ASYNCIFY_IMPORTS
ASYNCIFY_ONLY
ASYNCIFY_REMOVE
```

可以限制插桩范围。([Emscripten][15])

所以最终完全有可能不是：

> “整个 Octave 都 asyncify 化”

而是：

> “只有 browser bridge 上的那几条调用链是 Asyncify-aware。”

### 我的建议

**把 G2 定义成一个 0.5–1 天的实验，不定义成采用方案。**

实验成功后，才决定是否用于：

```text
H2 uigetfile
B1 recordblocking
A1 native drawnow
```

---

# G3：pkg 语义

### 审核结论：**这项比原稿里更好做，不建议先写 pkg.m 覆盖**

你实测：

```text
pkg list → 正常
pkg load statistics → 找不到包
```

这已经证明 package manager 本身活着。

官方 pkg 机制本来就有：

```text
local_list
global_list
prefix
```

并通过 package database 记录已安装包。([GitHub][16])

更关键的是，官方 package database 本质上就是一个 Octave `save` 出来的结构数据，里面记录：

```text
name
version
date
author
...
dir
```

等包信息。([GitHub][17])

### 因此最推荐

**不要改 pkg。**

直接在你的 assets 安装阶段生成：

```text
.octave_packages
```

让：

```matlab
pkg list
```

天然看到这些包。

然后：

```matlab
pkg load statistics
```

继续走官方 pkg 逻辑。

这比：

```text
写一个 pkg.m
```

更接近真正 Octave。

### 工作量

**0.5–2 天。**

### 最大坑

要把：

```text
资产车道目录
```

正确映射成：

```text
package dir
archprefix
local_list
```

尤其要验证：

```text
pkg load
pkg unload
pkg describe -verbose
```

是否一致。

### pkg install

我反而建议：

**第一版不要实现。**

因为你这里不是：

```text
源码 → configure → make → install
```

而是：

```text
站点 → 预编译资产
```

可以等 `pkg load` 稳定后再决定是否提供一个“浏览器资产包安装器”。

---

# H1：voronoi 单输出

### 审核结论：**不单独修**

你的判断正确：

```text
两输出
→ 纯数学
→ 正常

单输出
→ 需要画图
→ gca 崩
```

因此它是 A1 的自然派生收益。

**A1 半真 handle 做成以后再测。**

---

# H2：uigetfile

### 审核结论：**浏览器确实非常适合，但比你原稿里写的“高可行”多一个 Async 问题**

你提出：

```text
<input type=file>
      ↓
MEMFS
```

这个方向完全正确。

但 `uigetfile()` 的问题和 `window.prompt()` 不一样：

```text
window.prompt()
→ 同步

<input type=file>
→ change/event/Promise
→ 异步
```

所以：

### 路线 A

有 Asyncify：

```text
uigetfile()
  ↓
打开浏览器 file picker
  ↓ suspend
用户选文件
  ↓ resume
返回文件名
```

非常漂亮。

### 路线 B

不使用 Asyncify：

把 API 改成：

```text
web_uigetfile()
```

异步工作流。

但是这已经不再是 MATLAB/Octave 原生语义。

### 所以

我把它由：

> 高

调整为：

> **中高**

因为技术上很好做，**语义同步问题是唯一主要障碍**。

### 工作量

有 Asyncify：

**1–2 天。**

无 Asyncify，做非标准异步 API：

**1–2 天。**

---

# H3：getframe / movie

### 审核结论：**暂缓**

你现在没有真正 graphics backend，因此：

```text
getframe
```

缺的是一个真正的 framebuffer。

但你的架构其实留有一个很有意思的未来路径：

```text
gnuplot-wasm
→ SVG
→ browser DOM
```

之后可以考虑：

```text
SVG
→ OffscreenCanvas / Canvas
→ RGB
→ getframe
```

而 `movie` 则可以：

```text
frame[]
→ SVG/Canvas sequence
→ browser animation
```

这已经不是 Octave 核心数学问题。

**等 A1 + plot bridge 稳定后再看。**

---

# H4：inputname / nargin 类反射

### 审核结论：**继续低优先**

完全不是当前项目的瓶颈。

---

# 我建议你把清单直接改成下面这个版本

| 顺序 | 项目                          | 审核结论   | 推荐路线                                                 |       工作量 |
| -- | --------------------------- | ------ | ---------------------------------------------------- | --------: |
| 1  | **D1 help**                 | ✅ 直接做  | `__makeinfo__.m` + 可选离线预转换                           |   0.5–3 d |
| 2  | **A1/A2 graphics handle**   | ✅ 直接做  | 小型 `web_graphics_toolkit`，先 no-op renderer           |     1–3 d |
| 3  | **C1 文件操作**                 | ✅ 直接做  | `dir/glob/fopen/mkdir/unlink` 纯 `.m`                 |     1–2 d |
| 4  | **G3 pkg**                  | ✅ 直接做  | 生成 `.octave_packages`，不要先覆写 pkg                      |   0.5–2 d |
| 5  | **E1 input**                | ✅ 直接做  | 同步 `window.prompt()` bridge                          | 0.5–1.5 d |
| 6  | **H2 uigetfile**            | ⚠️ 做   | file input + Asyncify 或非标准异步 API                     |     1–2 d |
| 7  | **B1 audiorecorder**        | ⚠️ 做   | Web Audio + getUserMedia；record 先做，recordblocking 后做 |     1–4 d |
| 8  | **B2 audiodevinfo**         | ✅ 顺手做  | 浏览器默认设备 shim                                         |    <0.5 d |
| 9  | **G1 MAIN_MODULE=2**        | ⚠️ 做   | 自动分析 `.oct` import → keep list                       |     1–3 d |
| 10 | **G2 Asyncify**             | 🔬 先实验 | 最小 async bridge benchmark                            |   0.5–1 d |
| 11 | **H1 voronoi**              | ↔ 随 A1 | 不单独改                                                 |         — |
| 12 | **D2 doc**                  | ✅ 顺手做  | help → DOM                                           |   0.5–1 d |
| 13 | **H3 getframe/movie**       | ⏸ 暂缓   | 等 graphics 成熟                                        |         — |
| 14 | **E2 keyboard/kbhit/pause** | ⏸ 暂缓   | 等 Asyncify 实验                                        |         — |
| 15 | **D2 publish**              | ⏸ 暂缓   | 后期                                                   |     2–4 d |
| —  | **F1 SPQR**                 | ❌ 删除   | `spqr` 已于 3.6.0 被 `qr` 替代                            |         — |
| —  | **F2 ichol**                | ❌ 删除   | 正常数学错误                                               |         — |
| —  | **H4**                      | ⏸ 暂缓   | 低优先                                                  |         — |

---

# 最后一个架构层面的建议

你现在真正有价值的方向，其实已经不是“继续把 Octave 的桌面组件搬进 WASM”。

你的体系正在自然地变成：

```text
                    GNU Octave 7.2
                          │
             ┌────────────┼─────────────┐
             │            │             │
          数值核心      graphics      系统 API
             │            │             │
        C/Fortran        objects       browser shim
             │            │             │
             │       Web toolkit       │
             │            │             │
             └────────────┼─────────────┘
                          │
                  browser-native layer
                          │
       ┌──────────────┬───┴────┬──────────────┐
       │              │        │              │
    gnuplot-wasm    WebAudio  DOM         MediaDevices
       │
      SVG
```

这条路线比“把 `__init_gnuplot__.cc` 原样复活”干净得多。

官方的 `__init_gnuplot__.cc` 本身就已经证明 toolkit 层是一个相对薄的适配层，而真正复杂的是它下面的外部 gnuplot 进程通信；你恰好已经在浏览器侧把 gnuplot 本身解决掉了。([Octave Documentation][3])

所以我的最终判断是：

**这份 v2 值得继续做，但不要照原来的优先级机械推进。最应该动手的是 `D1 → A1 半真句柄 → C1 → G3 → E1`。**

其中 **A1 不要碰“完整原生绘图”这个大坑，先把真正的 graphics object 生命周期和属性系统救活**；这一步成功后，`gca/gcf/set/get/subplot/voronoi` 会出现一串连锁收益。
