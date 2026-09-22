# NOTES · 把覆盖率对到 100%：剩下 6 个名字逐个查清（2026-09-22）

> **缘起**：用**同版桌面 Octave 11.3.0** 的 `__list_functions__`（927 个可调用名字）
> 逐个到浏览器里 `exist()` 做一比一对照，得到 **882 立刻可用 / 装载懒加载资产后 921**，
> 剩 **6 个**。本文件记录这 6 个**逐个查清**的结果 —— 结论是
> **5 个能真补上（官方源码，不是桩），1 个根本不属于 Octave**。

## 一、总账

| 名字 | 查清后的归类 | 处置 |
|---|---|---|
| `__init_gnuplot__` / `__have_gnuplot__` | 官方 `libinterp/dldfcn/__init_gnuplot__.cc`，**零外部依赖**（上游 `_LIBADD` 只有 `DLD_LIBOCTINTERP_LIBADD`） | **编成 side module**（33739 字节） |
| `__init_fltk__` / `__fltk_check__` | 官方 `__init_fltk__.cc`，**编译无条件**，FLTK 部分包在 `#if defined (HAVE_FLTK)` 里 ⇒ 缺 FLTK 时 DEFUN **仍然存在**，只是报 `err_disabled_feature` | **编成 side module**（2545 字节） |
| `__fltk_uigetfile__` | 官方钩子，`uigetfile` 的兜底正是它；但它要 FLTK 头 | **自己写浏览器实现**（`build/webfilepick.cc`）→ `uigetfile` 真能用 |
| `debian_missing_handler` | **Debian 打包产物**：在 `/usr/share/octave/**site**/m/`、属 `octave-common` 包，是上游 `distro_missing_handler.m` 的改名版 | **不进分母**（本构建不是 Debian 包） |

⇒ 分母应为 **926**（927 减去 Debian 那个），补完 **926/926**。

## 二、关键发现（都是实测/源码，别再猜）

### 1. `__init_gnuplot__.cc` 不要任何外部库 —— 直接能编

上游 `module.mk` 里它的 `_LIBADD` 只有 `$(DLD_LIBOCTINTERP_LIBADD)`。
编出来**行为与"桌面没装 gnuplot"完全一致**（因为 `have_gnuplot_binary()`
是去 `PATH` 里找 `gnuplot_binary` 偏好指定的程序）：

```
__have_gnuplot__()  →  0
__init_gnuplot__()  →  error: __init_gnuplot__: the gnuplot program is not available,
                              see 'gnuplot_binary'
```

**这就是上游的原话**，不是我们编的措辞。另外它的 `.cc` 里带着一行
`// PKG_ADD: if (__have_gnuplot__ ()) register_graphics_toolkit ("gnuplot"); endif`
—— Octave 自己的构建会把这类注释抽成模块目录下的 `PKG_ADD`；我们这条 `.oct` 车道
不做这步，所以"没 gnuplot 就不注册 toolkit"是**自动成立的**，不会冒出假的 gnuplot toolkit。

> 想让它**真注册**（`graphics_toolkit('gnuplot')` 可用、渲染走我们的 SVG 桥）技术上可行
> （官方 toolkit 的 `redraw_figure` 本来就只调 `__gnuplot_drawnow__` 那个 `.m`），
> **但那要先让 `__have_gnuplot__()` 变成真** —— 也就是假造一个二进制。
> 不做：那是拿假前提换好看的能力面。要用官方 gnuplot toolkit 的名字，
> 应当另立一个**名字不同**的 toolkit（我们已有 `web`）。

### 2. `__init_fltk__.cc` / `__fltk_uigetfile__.cc` 的**条件编译结构**决定了"缺 FLTK 也有名字"

两个文件都在 `#if defined (HAVE_FLTK) … #else … err_disabled_feature(…) #endif` 里。
所以上游任何构建里 DEFUN **都存在**，只是报：

```
__fltk_check__()  →  error: __fltk_check__: support for OpenGL and FLTK was unavailable
                            or disabled when Octave was built
__init_fltk__()   →  同一句
```

⇒ 我们编出来的行为**就是上游"没编 FLTK"的行为**，属于如实补上而不是桩。

### 3. ★ `uigetfile` 的调用链有**三层**，而且中间那层要求 `exist == 3`

```
uigetfile.m
  └─ __get_funcname__('uigetfile')       % 注意：它**无条件**回落到 __<base>_fltk__
       └─ __uigetfile_fltk__.m           % 住在 m/gui/**private**/（private ⇒ 外部 exist=0）
            └─ __fltk_uigetfile__        % ★ 开头就 if (exist("__fltk_uigetfile__") != 3) error(...)
```

- **`exist(...) != 3`** 意味着**必须是 `.oct`** —— 纯 `.m` 覆写满足不了这道门禁。
  这是本批唯一需要写 C++ 的理由（`build/webfilepick.cc`，就是一个薄壳 + 队列协议）。
- 顺带一个观察：`__get_funcname__` 里那行 `funcname = ["__" basename "_fltk__"]`
  是**无条件**赋值，所以**不管当前是哪个 toolkit 都会用 `__uigetfile_fltk__`**；
  工具架不是 `fltk` 时它还会打一句
  `warning: uigetfile: no implementation for toolkit 'web', using 'fltk' instead`。
  这是**上游行为**（`__get_funcname__.m:41`），我们没改；`uigetfile` 的每次调用都会带这句，
  属**已知的化妆品级噪音**。

### 4. `MultiSelect` 传过来是**字符串**，不是逻辑值

`uigetfile.m` 里 `outargs{4} = lower (val)` ⇒ 到 C++ 那边是 `"on"`/`"off"`。
第一版按 `is_scalar_type() && bool_value()` 判断 → **多选永远失效**
（实测症状：Playwright 报 `Non-multiple file input can only accept single file`）。
现在两种形式都收。

### 5. 队列字段要先"消毒"：FLTK 过滤器串**自带制表符**

`__fltk_file_filter__.m` 是用 `\t` 把多个过滤器拼成一条串的
（`Text-Files (*.txt)\tM-Files (*.m)`），而我们的队列行也是 `\t` 分隔 ——
入队前不把 `\t\n\r` 换成空格，一条请求就会被拆成好几段。

### 6. ★ 程序化 `input.click()` **不需要用户手势**

实测（Chromium）：新建 `<input type=file>` 后直接 `.click()`，`filechooser` 事件**照样触发**，
有无前置点击都一样。所以文件选择器这一步**不需要页面放按钮**，也不必像音频那样
等一次"解锁点击"。（`window.showOpenFilePicker` 也可用，因为 `127.0.0.1` 算安全上下文。）

## 三、`uigetfile` 的最终语义（**两步**，如实记）

因为"选择框异步"与"Octave 一阻塞页面就停摆"是硬冲突（见
`NOTES-t6-t7-hostlayer.md` 坑 1；Asyncify 已实测排除，见 `NOTES-asyncify.md`）：

```
>> [f,p] = uigetfile({'*.txt','Text'})     % 第 1 次：弹出选择框，并**明确报错**
error: uigetfile: the file chooser has been opened in the page; choose a file
       (or cancel) and then run uigetfile again to collect the result
                                          % ← 用户在页面上选文件 / 取消
>> [f,p] = uigetfile({'*.txt','Text'})     % 第 2 次：返回结果
f = hello.txt                              % 取消则 f = 0（与桌面一致）
```

- 结果**一次消费**：拿到之后状态清空，再调就是新的一轮（验收里专门断言了这点）。
- 选中的文件字节会被**复制进 Octave 的当前目录**，所以 `fullfile(p,f)` 能直接
  `fileread`/`fopen`（验收断言了内容逐字节一致）。
- `MultiSelect','on'` 返回 1×N cell。

## 四、验收

- `test/browser/accept-t8-uigetfile.mjs` **19/19**（用 Playwright 的 `fileChooser`
  把对话框确定性地走完：选单个 / 取消 / 多选三种场景都覆盖）
- 另有覆盖率探针（本文件第一节那张表就是它的输出）
- **`help uigetfile` 仍然报 makeinfo 错** —— 那是 `.m` docstring 的既存缺口（HANDOFF §5.6 / C7），
  **不是本批引入的**；验收里专门用一条断言把它**钉成"已知缺口"**，免得将来误判。

## 五、复现命令

```sh
# 编三个 .oct（官方两个 + 我们的 uigetfile）
sudo docker exec o113 bash -lc 'cd /src/bin && PATH=/src/bin:$PATH OUT=/src/octs-mini \
  bash build-oct.sh __init_gnuplot__ __init_fltk__'
sudo docker cp build/webfilepick.cc o113:/src/websrc/webfilepick.cc
sudo docker exec o113 bash -lc 'cd /src/bin && PATH=/src/bin:$PATH OUT=/src/octs-mini \
  CC_SRCS="__fltk_uigetfile__:/src/websrc/webfilepick.cc" bash build-oct.sh --cc'

# 登记进站点（sync-js 现在也管 assets/oct/*.oct）
S=/mnt/hdd/octave-wasm-build/site
sudo docker cp o113:/src/octs-mini/__init_gnuplot__.oct  $S/assets/oct/
sudo docker cp o113:/src/octs-mini/__init_fltk__.oct     $S/assets/oct/
sudo docker cp o113:/src/octs-mini/__fltk_uigetfile__.oct $S/assets/oct/
cp build/assets-meta.json $S/assets/meta.json
python3 build/assets.py sync-js $S __init_gnuplot__ __init_fltk__ __fltk_uigetfile__
cp bridge/index.html bridge/webfilepick.js $S/
```
