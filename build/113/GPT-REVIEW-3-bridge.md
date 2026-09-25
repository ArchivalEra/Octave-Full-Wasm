# 外部复审需求书 · 第三轮 —— wasm 解释器 × 浏览器异步：**桥接方案选型**

> 收件人：外部复审（GPT）。回复请用中文；**每个判定必须配至少一条可证伪判据**（要能做成红/绿对照测试）。
> 背景关系：这是本项目第三轮外部复审。第一二轮的结论已吸收为红线与计划（`build/GPT-REVIEW-2.md`、
> `HANDOFF.md` §7）。本轮只回答一个问题：
> **把 Octave 解释器接上浏览器异步事件，有没有比"全量 `-sJSPI`"更小爆炸半径的桥？**
> 时间预算：我们给每个"第一步最小实验"留了半天；不接受"看起来可行"——只要能证伪的答案。

## 0. 要解决的能力面（精确到交互形状）

需要的交互（都发生在解释器**执行中途**，即 wasm 栈正停在用户代码上时）：

| 能力 | 形状 | 需要什么 |
|---|---|---|
| `pause(n)` | 真让出主线程；期间页面 timer/动画必须 tick | 一个 suspending import |
| `ginput(n)` | 等 DOM 点击/键盘 n 次，坐标带回解释器 | 同上 + 事件→队列→resolve Promise |
| `waitfor`/`uiwait` | 等图形句柄回调 | 同上 |
| `keyboard` | 一层 REPL 断点 | 同上 |
| `recordblocking` | 等录音结束 | 同上 |

**不需要**：抢占式硬取消（Ctrl-C 走既有安全点轮询）、并发解释器、多实例、Worker 化。
`input()` 已实测可用（走 `window.prompt`，零挂起）。

**浏览器底线**：JSPI 需要 Chrome≥137 / Firefox≥153 / Safari≥27；其它浏览器必须**优雅降级**
（清晰报错，页面照常可用——现役产物就是这么活着的）。部署是**任意静态 http 托管**（可能是
非 localhost 的纯 http）⇒ **COI / SharedArrayBuffer 不能依赖**。

## 1. 现栈（全部实测；断言旁有复跑处）

- Octave 11.3.0 → wasm，`-O2`；**Emscripten 5.0.7**（263db4c）；验证浏览器 Chromium 152。
- `-sMAIN_MODULE=2`（DCE + KEEP_LIST 保活）+ `.oct` 走**官方 dlopen**（side module，
  `ALLOW_TABLE_GROWTH`）——解释器核心在主模块，`.oct`（dldfcn/图形资产）是 side module。
- `-fwasm-exceptions`（wasm EH；Octave 的 `unwind_protect`/setjmp-longjmp 由它垫）。
- 单线程；`-lidbfs.js`；embind 绑定一批入口（`eval_string`/`feval`/…）。
- 启动时序（浏览器实测）：postRun 里先 `Module.execute_interp()` 装配解释器；**那之前任何解释器
  调用（同步 `eval_string` 与"异步"绑定一样）抛 `RuntimeError: null function`**（HISTORY §5.46，
  四车道对照表，复跑命令在 NOTES-jspi.md）。

## 2. 已实测的机制与已证伪的路（**别再推我们走回头路**）

1. **Asyncify 不可采用**（HISTORY §10 的 T10 行 + `build/113/NOTES-asyncify.md`）：
   `-sASYNCIFY=1` 与 `-fwasm-exceptions` 明确不兼容（emcc 警告），`wasm-opt --asyncify` 也失败。
2. **单产物 + 运行时能力门成立**（G0，`probe-jspi-gate.mjs` 12 项绿）：删掉
   `WebAssembly.Suspending/promising` 后 `-sJSPI` 产物照样加载，非 JSPI 调用照常，被包导出缺席
   ⇒ 不抬浏览器下限、不维护两条车道。
3. **最小链四件套成立**：JSPI + EH + M2 + dlopen 的最小探针能挂起/恢复（202 ms、等待期间 tick+1、
   返回 43；`build/113/probe-jspi.{c,sh}`）。
4. **`-sJSPI` 胶水的三条机制**（v10–v13，逐档实测，`build/113/NOTES-jspi.md`）：
   ① 链里有 dlopen ⇒ 它**上游整条入口**都变"可能挂起"，没被 promising 包就同步调 = `SuspendError`；
   ② 顺序即机制：先走一次 promising 入口，之后同一产物里的同步 dlopen 就正常；
   ③ 启动路径（静态初始化）碰 dlopen ⇒ 页面永远起不来。
5. **第一次 G1"失败"测的是个没带 `-sJSPI` 的产物**（`JSPI_FLAGS` 赋值了但链接行没引用；已修 +
   加了"从产物 grep `WebAssembly.promising`"的旗标自检，HISTORY §5.46）。
   ⇒ **`-sJSPI` 的真产物至今一次都没测过**。这正是本轮选型的由来：既然要重链，先问清该用什么姿势链。

## 3. 候选方案（请逐个判定）

### 方案 A：全量 `-sJSPI`（现行计划）
`-sJSPI` + embind `emscripten::function("eval_async", &eval_string, async())` +
`-sJSPI_EXPORTS=eval_async`。
**已知疑点**：① `-sJSPI_EXPORTS` 列的是 embind 的 **JS 名**，不是 wasm 导出名 ⇒ 包装可能落空；
② 胶水全局变形 × dlopen 的相互作用面大（§2.4 三条机制的产地就是它）。

### 方案 A2：**收窄的 `-sJSPI`**（官方旗标，窄面）★ 请重点审
5.0.7 settings.js 原文（919–936 行）：`JSPI_EXPORTS` = "Any exports that will call an
asynchronous import (listed in `JSPI_IMPORTS`) must be included here"；`JSPI_IMPORTS` 支持窄列；
JS 库函数还可用 `<fn>_async:: true` 标记代替该设置。
姿势：`-sJSPI -sJSPI_IMPORTS=web_pause_ms -sJSPI_EXPORTS=eval_wait`——
`web_pause_ms` 是**唯一**的新增挂起 import（JS 库函数），`eval_wait` 是新增 `extern "C"` 薄入口
（**导出名 = 真 wasm 导出名**，绕开 embind 名字问题；`eval_wait` 内部走 `eval_string`）。
**要审的核心问题**：收窄后，§2.4① 的"上游整条入口都可能挂起"还成立吗？
即：未列出的 import 保持纯同步、只有 `web_pause_ms` 能触发挂起、因此只有真正能到达它的入口
（`eval_wait` 链）需要 promising —— **dlopen×suspend 的相互作用面是不是就此消失**？
若成立，方案 A 的疑点②整个化解。

### 方案 B：**手搓 JSPI**（不走 `-sJSPI` 胶水）
浏览器原生 API 纯 JS 可用：`new WebAssembly.Suspending(fn)` 包 import（实例化前改 importObject，
经 Emscripten 的 `Module.instantiateWasm` 钩子），`WebAssembly.promising(exportedFn)` 包导出。
爆炸半径同样 = 1 import + 1 export，胶水零变形。
**要审**：① 规范层面不依赖任何编译期支持，这样做是否成立？② 对 5.0.7 生成的胶水，
`instantiateWasm` 钩子里改 imports 有没有已知坑（它自己是否再包一层/校验）？③ 与 A2 相比谁稳
（B 的优势=不碰官方路径的全局变形；劣势=升级 Emscripten 可能踩暗礁）？

### 方案 C：JS 侧队列 + 现有同步入口（已是我们的 fallback）
能做"点一次恢复一次"（`menu` 已实测走 `window.prompt`）；**做不了 `pause` 中途等待**
（`recordblocking` 因此至今如实报错）。A/A2/B 全失败时的落点。

### 方案 D：Worker + SAB + `Atomics.wait`
我们因"部署无法保证 COI/HTTPS"划了红线。**请确认 2026 年现状**：非 localhost 的纯 http 静态托管下
有没有任何拿到 COI 的办法？没有 ⇒ 这条维持红线。

### 方案 E：留白
2026 年有没有我们没列到的新机制？请给：stack-switching proposal 现状与 JSPI 的 spec 稳定性
（有没有弃用/语义变更风险）；Emscripten 5.x 之后有没有官方新姿势；其它大型 wasm 解释器项目
（Pyodide 2026 现状、其它 REPL 类项目）公开采用的桥接做法与教训。

## 4. 回复格式（要能落成断言，请照做）

- 对每个方案：**判定（推荐 / 有条件推荐 / 不推荐）+ 一句话理由 + ≥1 条可证伪判据 + 爆炸半径**
  （要改哪些文件/旗标，几行量级）。
- 若推荐换方案：给**第一步最小实验**（半天内出红/绿），写清输入、命令与预期输出。
- 逐条列出你**不同意**的我们已有结论（§2 的 1–5、§0/§3 的红线），不同意就要给证据。
- G2 压力矩阵候选（pause 在 `unwind_protect` 体内 / longjmp 跨挂起点 / dlopen 之后 resume /
  重复 dlopen-dlclose / 挂起期间再入 eval）：如果你知道别的必测项，请补。

## 5. 附件与复跑

- `build/113/NOTES-jspi.md`：v1–v13 全表、三条机制、§5.46 四车道对照（每条断言带复跑命令）。
- `HISTORY.md`：§5.43（事故与回退）、§5.45（复现阶梯）、§5.46（翻案：`-sJSPI` 从未进链接 +
  `null function` 真身）、§5.47（断电）。
- `build/113/probe-jspi.{c,sh}` + `test/browser/probe-jspi.mjs`（最小链四件套）；
  容器 `/src/websrc/embind-repro{,-out}/`（13 变体）。
- 现役产物与构建配方：`build/113/link-web.sh`（`JSPI_FLAGS` 已接线 + 旗标自检）、HANDOFF §3.3。
