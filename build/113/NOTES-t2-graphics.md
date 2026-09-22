# NOTES · T2/A1 图形句柄半真化（`web` graphics toolkit）—— **已完成**（2026-09-22）

## 一句话
给本构建挂上一个**最小的 `web` graphics toolkit**，让 `figure/gcf/gca/get/set/title/
allchild/close` 这些**图形对象句柄语义**真正可用。
**主 wasm 零改动** —— toolkit 是**资产车道的 side module + 一份 `PKG_ADD`**，
计划里原记的 "Lane B（重链）" **不需要**（下面第一节讲为什么）。

## 一、为什么不是重链：探针查出来的关键事实

先跑**零重链探针**（`test/browser/probe-t2-graphics.mjs`）量现状，得到：

| 问 | 改动前 |
|---|---|
| `available_graphics_toolkits()` | `{}`（空） |
| `graphics_toolkit()` | 空 |
| `figure(1)` | `get: invalid handle (= 1)` —— **建不出图形对象** |
| `gcf()` / `gca()` | 同一个 invalid handle |
| `plot(1:10)` | plot 桥能画（SVG 出来），但 `gca/get` 全废 |
| 纯 `.m` 注册一个 toolkit | ❌ `graphics_toolkit: web toolkit is not available` |

最后一条本来是"Lane B 的必要性"证据（`graphics_toolkit.m:86` 的门禁）。但**读源码**发现：

- `available_graphics_toolkits()` **不是编译期清单**，而是运行时注册表：
  ```cpp
  DEFMETHOD (available_graphics_toolkits, interp, , , …)
  { return ovl (gtk_mgr.available_toolkits_list ()); }        // graphics.cc:13411
  ```
- 而且有一个**内建**能往注册表里加名字：
  `register_graphics_toolkit("web")`（`DEFMETHOD (register_graphics_toolkit, …)`，
  文档原话："No input validation is done on the input string; it is simply added to the
  list of possible graphics toolkits."）。`gtk_manager::register_toolkit` 在
  **默认库为空时还会顺手把它设为默认库**（`gtk-manager.cc:66`）。
- `gtk_manager::load_toolkit(const graphics_toolkit&)` 是**头文件里的 inline**，
  `register_toolkit` 虽非 inline，但符号由 `MAIN_MODULE=1` 的主模块导出。
- `base_graphics_toolkit`（`graphics-toolkit.h`）与 `gtk_manager.h`/`interpret.h`
  **都在安装树里**（`$INST/include/octave-11.3.0/octave/`），side module 能直接 include。

⇒ 于是 T2 做成**资产**：一个 `.oct`（`__init_web__`）+ 一份 `PKG_ADD`。

## 二、做出来的东西

| 文件 | 作用 |
|---|---|
| `build/113/web_graphics_toolkit.cc` | toolkit 本体 + `DEFUN_DLD(__init_web__)`。登记 + 装载，一步到位 |
| `build/webgraphics/PKG_ADD` | Octave 在 `addpath` 时自动执行：先 `register_graphics_toolkit("web")`（登记名字、顺带设为默认），再 `graphics_toolkit("web")` 触发 `__init_web__` 装载实例 |
| 站点 `assets/oct/__init_web__.oct` | side module 产物（19 KB） |
| 站点 `assets/m/webgraphics.js` | 由 `build/assets.py bundle-m` 生成（PKG_ADD 单独一个文件，`bundle_m` 本来就支持） |
| `bridge/index.html` | 把 `webgraphics` 加进**启动装载清单**（与 plotbridge 并列）—— 否则用户第一个 `figure` 就撞 "no graphics toolkits are available!" |
| `build/plotbridge/figure.m` | **它以前是假的**：只记"当前图号"、不建对象。现在补 `__go_figure__(n, props{:})` + `set(0,"currentfigure",h)`，try/catch 兜底 |
| `build/plotbridge/{title,xlabel,ylabel}.m` + `__pb_mirror_text__.m` | 文本**同步写进真 axes 属性**，让 `get(get(gca,'title'),'string')` 能读回来（渲染仍走桥的状态） |

### `base_graphics_toolkit` 的契约（读头文件得到的，别凭印象写）
- 基类每个 virtual 的**默认实现都会 `gripe_if_tkit_invalid()`**，而它只在
  `is_valid()` 为真时才不报错；**基类 `is_valid()` 默认返回 false**。
- ⇒ 一个能用的 toolkit 至少要：`is_valid()` 返回 **true**、`initialize()` 返回 **true**
  （否则图形对象建不出来）、`redraw_figure()` 不做事（渲染交给 plot 桥）。
- 其余给稳妥默认值：`get_canvas_size` = 560×420（Octave figure 默认尺寸）、
  `get_screen_size` = 1024×768、`get_screen_resolution` = 72。

### ⚠️ 命名空间（编译期实测，写错编不过）
`graphics_object` 在 `octave::` 里；而 **`Matrix` / `uint8NDArray` / `graphics_handle` /
`octave_value_list` 都在全局**命名空间 —— 写成 `octave::Matrix` 会报
"no type named 'Matrix' in namespace 'octave'"。

## 三、半真化的**边界**（如实记录，别当 bug）
- ✅ 真的图形对象存在：`ishandle`/`get(h,'type')`/`allchild`/`findall`/`close` 都对。
- ✅ 属性可读写往返：`set(gca,'xlim',[0 5])` → `get` 得 `[0 5]`。
- ✅ `line(...)` 建出真 line 对象、`title/xlabel` 写进真属性。
- ❌ **plot 画的序列仍在 plot 桥自己的状态里**（渲染走桥 → SVG），所以
  `get(gca,'children')` **不会**列出 plot 的那条线，`xlim` 也不会自动跟随数据。
  这是计划里"**只救活句柄语义、不碰绘图重构**"的直接后果。

## 四、踩过的坑（都花了时间，记下来省得重走）

1. **`figure(n)` 带号却建不出对象** —— 我第一版把**原始 `varargin`** 透传，
   于是 `figure(1)` 变成 `__go_figure__(1, 1)`，多出来的 `1` 被当成属性名 → 抛异常 →
   被 catch 吞掉 → 退回纯编号模式。**`figure()` 无参时不带多余实参所以一直是好的**，
   于是现象是"无参能建、带号不能建"。修法：参数分两半，图号**吃掉**，其余按属性对收进
   `props` 再透传（核心 `figure.m` 也是 `varargin(1) = []` 这么干的）。
2. **side module 里 `fprintf(stderr, …)` 打不出来** —— 诊断用的日志一条都看不到，
   一度误判成"虚函数没被调度"。改用 Octave 自己的 **`octave_stdout <<`** 就看得见了。
3. **浏览器会缓存 `.oct`** —— 重新部署后仍跑旧模块，表现为"改了没反应"，更容易误判。
   诊断脚本里对 `**/*.oct` 强制 `cache-control: no-cache` 才可靠。
4. **`get(ax,'title')` 返回的是文本对象句柄，不是字符串** —— 要再取一层
   `get(...,'string')`。第一版直接 printf 句柄，打出空串，又被误判成"镜像没生效"。
5. `build/113/build-oct.sh` 的 `--cc` 分支**原来没接 `OCT_DEFS`**（只有 dldfcn 分支接了），
   所以 `-DWEBTK_DEBUG` 一度不生效。已补上（`EXTRA`/`EXTRA_LIBS` 两个分支都用）。
6. 诊断开关留在源码里、默认关：`WEBTK_DEBUG`（打印每次虚函数调用）、
   `WEBTK_TEST_INIT_FALSE`（让 `initialize` 返回 false，用来**验证 override 真的被调到**
   —— 这是不依赖日志的判据）。

## 五、验收
- `test/browser/accept-t2-graphics.mjs`：**26/26**（8761 与 8762 各跑一遍）。
  覆盖：toolkit 注册/装载/默认 → `figure(n)` 真对象 → `gcf/gca` →
  `set/get` 属性往返 → `line()` → `title/xlabel` 读回 → `allchild/findall/close` →
  与 plot 桥共存（`print -dsvg` 仍出图）→ 无 trap。
- 探针留档：`test/browser/probe-t2-graphics.mjs`（零重链现状量测，含"纯 .m 路线被门禁挡住"
  的实证）、`probe-t2-figure.mjs`、`probe-t2-run.mjs` + `fixtures/t2-graphics-probe.m`。
- 回归：全量 26 套（含本套）在 8761 上重跑，见 HANDOFF §10.1。
