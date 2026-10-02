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
> **状态图例**：✅ = 现有原语已覆盖（接口名给出）；🔜 = 拟由 `bridge/octave-embed.js`
> 薄封装提供（建立在 ✅ 原语之上，不改 wasm）；➖ = 官方有、Web 场景不适用（如实标注，不是漏）。

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
| `interpreter_output(msg)` | stdout 订阅：宿主 `print` 汇 → `octave.on.output(cb)`（页面同时保留 console 上屏语义） | ✅ 原语 / 🔜 订阅器 |
| `display_exception(ee, beep)` | stderr/异常：`printErr` 求值错误经 try/catch 结构化返回（`eval()` 的 `error` 字段 + `on.error(cb)`） | ✅ 原语 / 🔜 订阅器 |
| `update_prompt(prompt)` | 忙/闲状态：`octave.state`（`booting/idle/busy`）+ `octave.on.state(cb)`（以 `eval` 队列进出为界，含 JSPI 挂起语义） | 🔜 |
| `set_workspace(top_level, debug, …)` / `clear_workspace` | `octave.workspace()` → `jsonencode(whos())` 结构化（name/class/size/bytes/value 预览） | 🔜（✅ eval 原语） |
| `set_history / append_history / clear_history` | `octave.history()`（eval `history` 结构化；输入行由 UI 上报追加） | 🔜 |
| `directory_changed(dir)` | `octave.pwd()` + `octave.cd(dir)`（eval 封装，返回结构化） | 🔜 |
| `enter/execute/exit_debugger_event`、`update_breakpoint` | ➖ 调试器事件流：v1 不承诺（wasm 构建含调试器，但 UI 线先不做断点面板；接口位留好） | ➖ |
| `edit_file / prompt_new_edit_file` | 文件面板原语：`octave.fs.read/write/ls/rm`（Module.FS 封装）+ `octave.fs.download(name)` | 🔜（✅ FS） |
| `show_documentation(file)` | `octave.help(name)`（doc-cache 已装，help/doc 文本可达） | 🔜（✅ eval） |
| `show_workspace / show_file_browser / show_command_history` | 这是**窗口管理**语义 —— UI 自己决定把这些渲染成面板/抽屉；数据源 = 上面三行 | ➖ UI 侧 |
| `show_preferences / apply_preferences / gui_preference(key)` | ➖ v1 无偏好系统（`gui_preference` 回落默认值） | ➖ |
| `show_community_news / show_release_notes / focus_window / update_gui_lexer / update_path_dialog` | ➖ Qt 桌面壳专属，Web 不适用 | ➖ |
| `copy_image_to_clipboard(file)` | 图形导出：`octave.figures.export(idx)` → PNG dataURL（`getframe`→canvas，✅ 原语） | 🔜 |
| `start_gui / close_gui / confirm_shutdown` | ➖ 生命周期由页面持有（`createOctaveHost` + `onReady`） | ✅ 原语 |

## 2. 命令（前端 → 解释器）· 对照 `event-manager.h` 的调用面

| 前端动作 | Web 对应 | 状态 |
|---|---|---|
| 执行代码（终端回车 / cell 运行） | `octave.eval(code)` → **Promise**<{ok, value?, output, error?}>：内部走已验证的 evalFile 通道（MEMFS 取回值，不用 printf 匹配）；JSPI 可挂起语义保留 | ✅ 原语 / 🔜 promise 化 |
| 中断（Ctrl-C / 停止按钮） | `octave.interrupt()`（`_web_request_interrupt`；⚠️ 语义 = 到安全点置位，不是抢占 —— 与官方一致） | ✅ 原语 / 🔜 包装 |
| 回答解释器的输入请求（input/dialog） | `octave.on.input(cb)`（订阅 stdin 队列；页面缺省回落 `window.prompt` —— UI 接管后用自己的对话框回 `octave.input(text)`） | ✅ 原语 / 🔜 接管器 |
| 工作区/历史/目录查询 | 见 §1 对应行（都是 eval 的结构化封装） | 🔜 |
| 画图 | `octave.eval('plot(…)')` → 图形经 webgl toolkit 上屏到挂点；`octave.figures.onNew(cb)` 给面板用（挂点 DOM 变更订阅或 getframe 通道） | ✅ 上屏 / 🔜 事件 |
| 文件上传/下载 | `octave.fs.upload(file)`（`webfilepick` 队列桥）/ `octave.fs.download(name)` | ✅ 队列桥 / 🔜 包装 |
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
4. 验收：新探针 `accept-embed-api`（逐接口断言 + **反向断言**：错误码该报的必须报）；
   全量扫描 0 FAIL 不退化；默认实例全局别名语义逐字不变。
