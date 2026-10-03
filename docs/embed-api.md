# Embed API · Web 前端的官方接口表（给 UI 开发者的契约）

> **定位**：本项目把 Octave 11.3.0 完整跑在浏览器 wasm 里。前端（无论是 REPL、教学页还是
> Notebook）**不需要碰 wasm/胶水** —— 它面对的是这一张接口表。
> **表的来源**：照抄 **Octave 官方前端接口**（Qt GUI 与解释器之间的那套事件/命令契约），
> 逐条映射到 Web 原语。不是发明，是翻译。
> **权威出处**（11.3.0 源码，容器 `o113` 内，路径可复跑）：
> · 事件接口（解释器 → 前端）：`/src/work/octave-11.3.0/libinterp/corefcn/event-manager.h`
>   （Qt 前端的实现 = `/src/work/octave-11.3.0/libgui/src/qt-interpreter-events.h`）
> · 提取命令：`docker exec o113 grep -E '^\s*virtual .*\(' <头文件路径>`
>
> **状态图例**：✅ = 现有原语已覆盖（接口名给出）；**✅e = 已由 `bridge/octave-embed.js` 实现**（工单 38，2026-10-02；建立在 ✅ 原语之上，不改 wasm）。
> 🔜（原拟）项已全部落地为 ✅e；接口表保留 🔜 字样的历史行由实现行取代；➖ = 官方有、Web 场景不适用（如实标注，不是漏）。

## 0. 分层（前端 agent 需要知道的全部结构）

```
┌─ 你的 UI（REPL / 教学页 / Notebook）────────────────────────┐
│  只面对本表：octave.* 命令 + octave.on.* 事件订阅             │
├─ bridge/octave-embed.js（🔜 拟新增：promise 化薄封装，本表实现层）─┤
├─ bridge/octave-core.js（✅ 内核：Module 配置/启动链/资产/IDBFS/能力门）─┤
├─ createOctaveHost（✅ 页面适配器工厂：print/stdin/clicks/doc 9 件接口）─┤
├─ wasm 四档（base/threads/w64/w64-base；选档由 bridge/lane.js 自动）────┤
└──────────────────────────────────────────────┘
```

规则：**embed 层不许绕过 core 直接摸 Module 内部件**（那条纪律与闸门一致：从产物读证据，
不从旗标推结论）；core 的默认实例全局别名（`window.__octaveReady` 等 77 个验收套件的契约）
一字不动。

## 1. 事件（解释器 → 前端）· 对照 `qt-interpreter-events.h`

| 官方方法（Qt GUI） | Web 对应 | 状态 |
|---|---|---|
| `interpreter_output(msg)` | stdout 订阅：`octave.on.output(cb)`（挂点 DOM 观察器；页面同时保留 console 上屏语义） | ✅e |
| `display_exception(ee, beep)` | `evalJSON` 的 `error` 字段（Octave 异常消息）+ `octave.on.error(cb)` | ✅e |
| `update_prompt(prompt)` | `octave.state`（`booting/idle/busy`）+ `octave.on.state(cb)`。⚠ 同步 eval 的 busy 对页面不可观察（worker 模式才可观察）—— 如实边界 | ✅e |
| `set_workspace(top_level, debug, …)` / `clear_workspace` | `octave.workspace()` → `whos()` 结构化（name/class/size/bytes；经值通道 JSON） | ✅e |
| `set_history / append_history / clear_history` | `octave.history()`（rc 通道；历史文本走 on.output） | ✅e |
| `directory_changed(dir)` | `octave.pwd()` / `octave.cd(dir)`（值通道） | ✅e |
| `enter/execute/exit_debugger_event`、`update_breakpoint` | ➖ 调试器事件流：v1 不承诺（wasm 构建含调试器，但 UI 线先不做断点面板；接口位留好） | ➖ |
| `edit_file / prompt_new_edit_file` | `octave.fs.read/write/ls/rm/download`（Module.FS 封装；upload 用 UI 的 file input + write） | ✅e |
| `show_documentation(file)` | `octave.help(name)`（doc-cache 已装） | ✅e |
| `show_workspace / show_file_browser / show_command_history` | 这是**窗口管理**语义 —— UI 自己决定把这些渲染成面板/抽屉；数据源 = 上面三行 | ➖ UI 侧 |
| `show_preferences / apply_preferences / gui_preference(key)` | ➖ v1 无偏好系统（`gui_preference` 回落默认值） | ➖ |
| `show_community_news / show_release_notes / focus_window / update_gui_lexer / update_path_dialog` | ➖ Qt 桌面壳专属，Web 不适用 | ➖ |
| `copy_image_to_clipboard(file)` | `octave.figures.export()` → PNG dataURL + `octave.on.figure(cb)`。⚠ **embed 页面 GL 纹理边界**：自带 mount 的 boot 形态下 plot 的 drawnow 会在纹理路径打死 wasm 实例（opengl_texture::create，FS 随之不可用）—— 根因在 wasm 侧 webgl_toolkit 的 GL 线（E6/图形线，待查）；shipped index.html 形态图形正常（accept-p5-graphics 覆盖） | ✅e / ⚠ 边界 |
| `start_gui / close_gui / confirm_shutdown` | ➖ 生命周期由页面持有（`createOctaveHost` + `onReady`） | ✅ 原语 |

## 2. 命令（前端 → 解释器）· 对照 `event-manager.h` 的调用面

| 前端动作 | Web 对应 | 状态 |
|---|---|---|
| 执行代码 | `octave.eval(code)` → Promise<{ok, rc}>（rc 通道）；`octave.evalJSON(expr)` → Promise<{ok, value?, error?}>（MEMFS 写回值通道） | ✅e |
| 中断（Ctrl-C / 停止按钮） | `octave.interrupt()`（`_web_request_interrupt`；语义 = 到安全点置位，不是抢占 —— 与官方一致） | ✅e |
| 回答解释器的输入请求 | `octave.input(text)`（预填 stdin 队列 —— 默认实例的 stdinLine 先读队列再 prompt）；实时对话框接管 = UI 提供自己的 host（进阶，docs/embed-api §3） | ✅e |
| 工作区/历史/目录查询 | 见 §1 对应行（✅e） | ✅e |
| 画图 | `octave.eval("plot(…)")` → 上屏（⚠ embed 页面 GL 边界见 §1 copy_image 行）；`octave.on.figure(cb)` + `octave.figures.export()` | ✅e / ⚠ 边界 |
| **画图（数据驱动，推荐）** | **`octave.figures.geometry()`** → Promise<{ok, geometry}>：**直接走图形对象树导出**（xlim/ylim/标题/轴标 + line 的 x/y/color/linewidth/linestyle/marker + text），**不过 drawnow/GL** ⇒ embed 页 GL 边界对本通道不适用；UI 用 WebGPU/任何渲染器自绘。实测 14 断言全绿（`probe-figures-geometry`，GPU 回读 red=777/blue=573）；参考渲染器 `bridge/embed-wgsl.html`（WGSL line-strip，站点页 `wgsl-demo.html`） | ✅e（工单 50） |
| 文件上传/下载 | `octave.fs.download(name)`（Blob 下载）；上传 = UI 的 file input → `octave.fs.write`（webfilepick 队列桥仍在） | ✅e |
| 音频播放/录音 | 队列桥现成（`webaudio`/`webaudiorec`）；embed 层透传即可 | ✅ |
| 网络（urlread 等） | 同步 XHR 桥现成（`webnet`；注意 COI 下跨源需 CORP/CORS —— 已实测约束） | ✅ |
| 选档（w64/threads/base…） | **UI 不用管**：`bridge/lane.js` 按 COI×memory64×清单自动选，embed 层透传实例 | ✅ |

## 3. 多实例与嵌入（`createOctaveHost` 的已知边界，UI 必须知道）

- 同页多实例**支持**（`accept-embed-multi` 13/0），但每个实例必须拿到选档计划 + 独立 `home`
  （IDBFS 命名空间）；embed 层会把这些做成默认正确。
- **已知边界**：非默认实例的图形上屏与四个队列桥仍是单例（分派在 wasm 侧 webgl_toolkit，
  与下一次重链合并 —— PLAN-threads E6）。v1 embed API 按"单实例多面板"设计最稳。

## 4. 交付物与验收（本接口线的"完成"定义）

1. `bridge/octave-embed.js`：本表 🔜 项全部落地（零依赖、ES5 兼容、不破坏 77 套验收契约）。
2. `docs/embed-api.md`（本文）：表 + 用法；每个 🔜 实现后改 ✅（带复跑命令）。
3. UI agent 上手页：`embed-demo.html`（每个接口一个可点按钮 + 输出面板，即"接口活文档"）。
4. 验收：`accept-embed-api` **13 PASS / 0 FAIL**（2026-10-02，8854 实测；含 4 条反向断言）。
   复跑：`sh test/browser/run.sh test/browser/accept-embed-api.mjs <部署了 embed-demo.html 的站点>`。
   逐条断言：A create/state、B eval+on.output、C evalJSON（数值/字符串/矩阵/反向）、D workspace、
   E pwd/cd、F fs 回环+反向、G input、H interrupt、I figures（接口面+GL 边界）、J 反向 reject。

## 5. 开发者注记（工单 48，2026-10-03）：页面适配器是 **TypeScript 源**

`bridge/octave-page.js` 现在是 **`bridge/octave-page.ts` 的编译产物**（无打包器、ES5 全局脚本，
类型只在源码里）。改页面适配器**改 `.ts`**，然后：

```sh
npm install --prefix /mnt/hdd/crossbuild-tools/npm-ts typescript@5   # 一次性（仓库外，不污染白名单）
sh build/build-embed-ts.sh                                          # → bridge/octave-page.js
```

**重写动机**：旧版把三件不相干的事揉在一处，重画成三道**类型化的缝**：
① **Host 契约** = `CoreHooks`（内核/页面之间唯一的接口面）；② **输出** = 可替换的 `OutputSink`
（默认 `createCoalescedPreSink`：合并刷新，行为兼容旧页）；③ **输入捕获** = 独立小函数。

**为什么合并刷新**（实测，`test/browser/probe-output-cost.mjs` + 纯净 sink 基准）：
旧 sink 每行一次 DOM 写 ⇒ 一次 1.4MB 输出 = **27000 次插入**；合并后 **167 次（−99%）**、
原始 `createTextNode+appendChild` 耗时 107ms → **4.5ms（−96%）**。纯净 sink 基准（无 wasm）：
27000 行/321KB 逐行追加 **12.8ms**、合并 **≈0ms（425×）**。
⇒ **DOM 不是瓶颈**（compute ~2.4s vs DOM 几十 ms 量级），但削减 99% 插入去掉了
强制布局/重排的抖动量；且 `OutputSink` 这道缝让**富 UI 换自己的渲染器**（终端网格/ANSI/
行号/高亮）而不动内核。**⚠ 不要把输出挪进 wasm**：wasm 碰不到 DOM，每写一次反而多一次边界穿越；
成本在布局，只有 DOM 侧能治。

⚠ 兼容硬约束：产物逐名兼容旧版对外面（`window.createOctaveHost` / `__octaveHosts` /
`__octaveClicks` / `__octaveRequestInterrupt` / 两个全局监听器）—— `accept-embed-api`
（13/0）、`accept-embed-multi`（13/0）、`probe-embed-inventory`（14/14）在重写后全绿。

## 6. 几何通道参考页（工单 50，2026-10-03）

`bridge/embed-wgsl.html`（站点 `wgsl-demo.html`）：embed 就绪 → plot 三条线 →
`figures.geometry()` → **WGSL line-strip 渲染**（数据坐标→clip 映射、逐线颜色）。
验收：`test/browser/probe-figures-geometry.mjs`（A 组=几何结构断言；B 组=WebGPU，
B3 的 GPU 回读需 `xvfb-run -a env HEADLESS_GPU=1`——plain headless 的 SwiftShader
不支持 mapAsync/合成器截图，环境限制如实记档）。
