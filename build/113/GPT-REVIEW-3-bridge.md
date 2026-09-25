# 桥接方案选型评审（wasm 解释器 × 浏览器异步）

> 请用中文回答。**每个判定必须配至少一条可证伪判据**（要能做成红/绿对照测试的那种）。
> 时间预算：每个"第一步最小实验"我们只留半天；不接受"看起来可行"，只要能证伪的答案。

## 0. 我们是谁、要什么

我们有一个**大型成熟 C++ 解释器**（数十万行、大量使用 setjmp/longjmp 语义的非局部退出 +
C++ 异常），编译成 WebAssembly 跑在浏览器页面主线程上。现在要让解释器**在执行用户代码的中途**
等待外部异步事件。需要的能力：

| 能力 | 形状 | 需要什么 |
|---|---|---|
| sleep/yield（如 `pause(0.2)`） | 真让出主线程；等待期间页面定时器/动画必须照常跑 | 一个 suspending import |
| 等鼠标/键盘事件（图形取点、点几下返回坐标） | 等 DOM 事件 n 次，结果带回解释器 | 同上 + 事件→队列→resolve Promise |
| 等图形对象回调 / 等录音结束的阻塞 API | 等 Promise 落地再继续 | 同上 |
| REPL 断点调试（进一层交互式子会话） | 解释器停在语句上等输入 | 同上 |

**不需要**：抢占式硬取消（打断走既有的安全点轮询）、并发解释器、多实例、Worker 化。
（"读一行输入"类交互已经走 `window.prompt` 解决，不需要任何挂起。）

**环境与底线**：
- Emscripten **5.0.7**；`-O2`；主模块 wasm 约 29 MB；验证浏览器 Chromium 152。
- **单线程**，无 pthreads。部署在**任意静态 http 托管**（可能是非 localhost 的纯 http）
  ⇒ **COI / SharedArrayBuffer 不能依赖**。纯客户端，没有任何服务端执行端点。
- JSPI 需要 Chrome≥137 / Firefox≥153 / Safari≥27；**其它浏览器必须优雅降级**
  （清晰报错、页面其余功能照常）——不能抬全站浏览器下限。

## 1. 现栈（全部实测过）

- 链接模型：`-sMAIN_MODULE=2`（可重定位主模块 + DCE + keep-list 保活），**运行时 `dlopen` 装载
  若干 side module**（可选功能库；`ALLOW_TABLE_GROWTH`）。解释器核心在主模块。
- 异常：`-fwasm-exceptions`（wasm EH），解释器的 setjmp/longjmp 由 wasm EH 垫。
- JS 面有一批 **embind** 绑定（如把字符串表达式送进解释器的 eval 入口），import 走 Emscripten
  JS library 机制。
- 启动时序（浏览器实测）：运行时 postRun 先调一个"完成解释器装配"的入口；**装配完成之前**
  调任何解释器入口（同步也一样）会抛 `RuntimeError: null function`（空表项间接调用）
  ⇒ 任何预热/探测都必须放在装配完成之后。

## 2. 已实测的机制与已证伪的路（别推我们走回头路）

1. **Asyncify 死路**：`-sASYNCIFY=1` 与 `-fwasm-exceptions` 不兼容（emcc 明确警告、链接失败），
   `wasm-opt --asyncify` 也失败。不要推荐。
2. **单产物 + 运行时能力门可行**（实测）：把 `WebAssembly.Suspending/promising` 从浏览器里
   "删掉"后，带 `-sJSPI` 的产物照样加载、非 JSPI 调用照常、被包的导出缺席 ⇒ 可以不做双车道、
   不做全站硬门。
3. **最小链四件套成立**（`-fwasm-exceptions + -sJSPI + MAIN_MODULE=2 + dlopen side module` 的
   最小探针）：挂起/恢复、等待期间 JS tick、跨模块返回值都正常。
4. **`-sJSPI` 胶水的三条机制**（逐档实测，最小复现程序）：
   ① 调用链里一旦有 dlopen，它**上游整条入口**都变成"可能挂起"：一个内部会 dlopen/dlsym 的
   **同步**绑定，直接调就抛
   `SuspendError: trying to suspend without WebAssembly.promising`；
   ② **顺序即机制**：先走一次被 promising 包装的入口，之后同一产物里同步走这条 dlopen 路就正常；
   ③ **静态初始化期间**碰 dlopen ⇒ 模块初始化就抛 SuspendError ⇒ 页面永远起不来。
5. 我们还没用真 `-sJSPI` 产物做过端到端测试（第一次尝试因旗标没真正传进链接行而测了个空）。
   **既然反正要重链一次，想先把姿势选对**——这是本次评审的由来。

## 3. 候选方案（请逐个判定）

### 方案 A：全量 `-sJSPI`（我们原计划）
`-sJSPI` + embind 的 `emscripten::function("eval_async", &eval_string, async())` +
`-sJSPI_EXPORTS=eval_async`。
**已知疑点**：① `JSPI_EXPORTS` 里列的 `eval_async` 是 embind 的 **JS 侧名字**，不是 wasm 导出名
⇒ 包装可能落空；② 胶水全局变形 × dlopen 的相互作用面大（§2.4 三条机制的产地就是它）。

### 方案 A2：**收窄的 `-sJSPI`**（官方旗标、窄面）★ 请重点审
5.0.7 settings.js 原文：`JSPI_EXPORTS` = "Any exports that will call an asynchronous import
(listed in `JSPI_IMPORTS`) must be included here"；`JSPI_IMPORTS` 支持窄列；JS 库函数也可以用
`<fn>_async:: true` 标记。
姿势：`-sJSPI -sJSPI_IMPORTS=web_pause_ms -sJSPI_EXPORTS=eval_wait` ——
`web_pause_ms` 是**唯一**的新增挂起 import（JS library 函数，返回 Promise），
`eval_wait` 是新增 `extern "C"` 薄入口（**导出名 = 真 wasm 导出名**，绕开 embind 名字问题；
内部转调既有 eval 入口）。
**要审的核心问题**：收窄之后，§2.4① 的"上游整条入口都可能挂起"还成立吗？即：
未列入 `JSPI_IMPORTS` 的 import 是否保持纯同步、只有 `web_pause_ms` 能触发挂起、因此只有真正
能到达它的入口（`eval_wait` 链）需要 promising —— **dlopen × 挂起的相互作用面是否就此消失**？
若成立，方案 A 的疑点②整个化解。另外请确认：Emscripten 的收窄实现是否可靠（胶水会不会仍然
"顺手"包了别的东西）。

### 方案 B：**手搓 JSPI**（不走 `-sJSPI` 胶水）
浏览器原生 API 纯 JS 可用：实例化前改 importObject（经 Emscripten 的 `Module.instantiateWasm`
钩子），把那**一个** import 包成 `new WebAssembly.Suspending(fn)`；对那**一个**导出用
`WebAssembly.promising(exportedFn)` 包一层再暴露给页面。爆炸半径同样 = 1 import + 1 export，
胶水零变形。
**要审**：① 规范层面完全不依赖编译期支持，这样做是否成立？② 对 5.0.7 生成的胶水，
在 `instantiateWasm` 钩子里改 imports 有没有已知坑（胶水自己是否再包/校验一层）？
③ 与 A2 相比哪个更稳？（B 优势 = 完全不碰胶水的全局变形；劣势 = 绕开官方路径，
将来升 Emscripten 可能踩暗礁。）

### 方案 C：JS 侧队列 + 现有同步入口（我们的 fallback）
"点一次、恢复一次"可以做（已实测一类交互）；**做不了执行中途的等待**（sleep/等事件都做不了）。
A/A2/B 全失败时的落点。

### 方案 D：Worker + SAB + `Atomics.wait`
我们因"部署无法保证 COI/HTTPS"划了红线。**请确认 2026 年现状**：非 localhost 的纯 http 静态
托管下有没有任何拿到 COI 的办法？没有 ⇒ 这条维持红线。

### 方案 E：留白
2026 年有没有我们没列到的新机制？请给：stack-switching proposal 现状与 JSPI 的 spec 稳定性
（有没有弃用/语义变更风险）；Emscripten 5.x 之后有没有官方新姿势；其它大型 wasm 解释器/
REPL 项目公开采用的桥接做法与教训。

## 4. 回复格式（我们要落成断言，请照做）

- 对每个方案：**判定（推荐 / 有条件推荐 / 不推荐）+ 一句话理由 + ≥1 条可证伪判据 + 爆炸半径**
  （要改哪些文件/旗标，几行量级）。
- 若推荐换方案：给**第一步最小实验**（半天内出红/绿），写清输入、命令与预期输出。
- 逐条列出你**不同意**的我们已有结论（§2 的 1–5、§0 的红线），不同意就要给证据。
- 挂起 × 异常的必测项，除我们已列的这几条外请补充：
  挂起点落在 setjmp/longjmp 保护块内；longjmp 跨越挂起点；dlopen 之后 resume；重复
  dlopen/dlclose 循环后再挂起；挂起等待期间同页再入 eval 入口（重入）。
