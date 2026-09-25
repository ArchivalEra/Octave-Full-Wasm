# PLAN · JSPI 接交互（G0–G6）+ 收尾债（2026-09-24 制定）

> **这是一份一次性工作令**：按阶段做，每阶段独立验收；做完全部或提前收口时，结果写进
> `HANDOFF.md`（活状态）与 `HISTORY.md`（过程），本文件随之转入历史。
> **这是当前唯一的工作令** —— 旧 `PLAN-next.md` 的 §3（七件小口子）已全部收口，其 §2 的
> JSPI 顺序并入本文件（依据与红线照抄，不再重复调研）。
> **纪律照旧**：先在 8768 验绿 → promote 8761 → 全量回归（`sweep.sh`）→ dist 重打 →
> 六道闸门 → 提交（不 force-push / 禁 `--no-verify`）→ 推持久盘镜像。**8761 在 promote 前一动不动。**

## 0. 依据（都是实测，别再调研一遍）

- **机制探针 9/9**（`build/113/probe-jspi.sh` + `test/browser/probe-jspi.mjs`）：
  `-fwasm-exceptions` + `-sJSPI` + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen 四件一起成立
  （dlopen 的 side module 回调主模块 helper → JS 的 Promise → resume；202 ms / tick +1 / 返回 43）。
- **Gate 0**：把 `WebAssembly.Suspending`/`promising` 删掉后 `-sJSPI` 产物**仍能加载**，
  只是被包过的导出不存在 ⇒ **单产物 + 运行时能力门**可行（不抬浏览器下限、不维护两条车道）。
- **重链配方已验证**（本会话刚用它链出 IDBFS + FreeMono，见 HISTORY §5.38/§5.39）：
  命令 = HISTORY §5.26 那条 M2 命令 + `WITH_FONTCONFIG=1`；自检 5 条；判据 `octave.wasm` sha
  是否变化（只动预载/胶水时它**逐字节不变**）。**G1 的重链直接复用它。**
- **三条实现要求**（`build/113/NOTES-jspi.md`）：① 每个"可能间接挂起"的入口都要在
  `-sJSPI_EXPORTS` 里；② JSPI 边界**不传 JS 字符串**（要 `ccall`/`cwrap`，否则 NULL →
  `dlopen(NULL)` 拿到主模块句柄）；③ side module 要**显式导出**符号。
- **红线**（GPT 复审，已写进 HANDOFF §7）：不许用"JS 往正在跑的 wasm 栈注入异常"做 Ctrl-C；
  不许退 Asyncify（与 `-fwasm-exceptions` 互斥，已证伪）；不许把 JSPI 做成**全站硬门**；
  **`pause` 那一步没过就不许宣称"交互可用"**。

## 0.5 现在的状态与**下一步顺序**（2026-09-24 深夜更新；先读这一节）

| 阶段 | 状态 |
|---|---|
| D1–D4 | ✅ 文档对齐 / `PROBES=1` / sweep 偶发崩重试 / 两站点闸门 |
| **G0** 能力门 | ✅ 完成（两个 gate，**按需**触发；`probe-jspi-gate.mjs` 12 项绿） |
| **G1** `eval_async` | ⛔ 第一次尝试**失败并已回退**；**2026-09-24 深夜查明那次根本没测到 JSPI**（§5.46：`-sJSPI` 从未进链接；`null function` 是「在 `execute_interp()` 之前碰解释器」）⇒ **`JSPI_FLAGS` 已接进链接行 + 加了旗标自检**，**重链真测还没做** |
| G2 `pause` 压力矩阵 | ⬜ 未开始（**真正的风险点**；依赖 G1） |
| G3–G6 | ⬜ 未开始（都依赖 G1） |
| D5–D7 | ⬜ 未开始 |

**★ 关键路径 = G1 的机制问题**：没有可用的"挂起入口"，`pause` 就没法改成 suspending import，
`ginput`/`keyboard` 也没法等浏览器事件 ⇒ **G2–G6 全部排在它后面**。

**★ 2026-09-24 深夜修正（HISTORY §5.46，取代下面 2/3/4 的措辞）**：真产物实测证明
**那次「失败」测的是个不含 `-sJSPI` 的产物**（`JSPI_FLAGS` 赋值了却没被链接行引用），而
`RuntimeError: null function` = **在 `execute_interp()` 之前调用解释器**（同步入口一样会炸），
**与 JSPI 无关**。⇒ 下一步不再是 (a)/(b)/(c) 三选一，而是：

1. **先重链一版真带 `-sJSPI` 的产物**（`link-web.sh` 已修 + 已加旗标自检），
   **先验胶水**：`grep -o 'WebAssembly\.promising' out/octave.js` 必须命中 —— 一条命令、最便宜；
2. 再跑三例（`42` / `pause(0.2); 43`（页面 timer 要 tick）/ `error('x')` ⇒ reject）；
3. **只有这一步做完**，v1–v13 的三条机制与 (a)/(b)/(c) 才有资格被讨论 ——
   `-sJSPI_EXPORTS=eval_async` 要不要换成真导出名，属于「真测之后」的问题。

**★ 2026-09-25 更新 2：回音已到，A2 最小实验已跑完 —— 结论改写了选型**：
- 复审判定：**A2 有条件推荐 ★（核心）、B 有条件推荐（备选/并行）**、A 不推荐、C 保底、D 红线维持
  （回音全文：`build/113/GPT-REVIEW-3-bridge-reply.md`）。
- **A2 三判据实验（`NOTES-jspi.md`「A2 最小实验」）**：判据1 红✅（漏标入口当场炸，运行期可恢复）；
  **判据2/3 意外红** —— 根因钉死到胶水逐字：5.0.7 里 `__dlopen_js.isAsync=true`
  （`-sJSPI` ⇒ ASYNCIFY=2 ⇒ `_dlopen_js__async:'auto'` 生效）+ `instrumentWasmImports` 的
  `original.isAsync ||` ⇒ **`dlopen` 无条件是挂起点，`-sJSPI_IMPORTS` 收窄管不住**。
  ⇒ A2 的隐藏代价 = **"一切可能 dlopen 的代码都必须跑在 promising 栈上"**
  （用户命令、开机资产装载、`execute_interp` 全在内，开机序列要整体异步化）。
- **B 升格为"应当先测的方案"**：不加 `-sJSPI` ⇒ `ASYNCIFY` 假 ⇒ `dlopen` 走同步分支、
  永不是挂起点 ⇒ 爆炸半径回到真正的 1 import + 1 export，开机序列不用动。
  **★ 2026-09-25 更新 3：B 实验跑完 —— 13 PASS / 0 FAIL，产品姿势定案 = B**：
  同一份 C 代码不加 `-sJSPI`，页面钩子包 import + 按需 promising ⇒
  plain 栈 dlopen 新模块绿（A2 红的那格）、跨模块链挂起/恢复真成立、
  不需要 JSPI_EXPORTS 名单、**无需热身无需全异步开机**、胶水里 0 个 Suspending。
  **G1 重链按 B 姿势做**（改动清单见 `NOTES-jspi.md`「B 方案对照实验」§定案：
  main.cc 加 `eval_wait` 薄导出、link-web.sh 去掉 `-sJSPI*` 并把旗标自检翻面、
  页面上钩子 + promising 包装 + probe 改走新入口）。B 的已知代价：钩子与 5.0.7 胶水耦合，
  **升 emsdk 必须重跑探针**（B1/B2/B6/B7 最低集）。

**下面这段是原计划（保留为历史口径；顺序已被上面取代）：**

**按这个顺序做**（前两条都很便宜，先做）：

1. **D8 · promote 前的"开机自检"**（30 秒，**这次事故直接教出来的**）：新脚本
   `build/check-boot.sh <URL>` —— 开页面、等 `window.__octaveReady === true`（≤30 s）、
   跑一句 `eval_string("2+2")`；**不过就不许 promote**。
   为什么必须有：坏产物的失败模式是**页面根本起不来**，而现有网只能靠"40 个套件各自超时
   （每个最多 420 s）"才发现 —— 又慢又吵（这次就这么撞上的）。这个自检要**接进 promote 流程**：
   `promote-webgl.sh` 末尾 + 手动 promote 的收尾清单里各加一步。
2. **G1 最小复现**（**别直接动 29MB 产物**）：容器里写一个十几行的 embind async 程序，
   按阶梯加设置，**定位是哪一步打坏的**：
   ```
   ① em++ -lembind -sJSPI            → 期望：Module.f(…) 返回 Promise 且能 settle
   ② 再加 -sMAIN_MODULE=2            → 怀疑点：DCE 把 async invoker 那个 thunk 削掉
   ③ 再加 SIDE_MODULE/dlopen          → 我们的真实组合
   ```
   **⚠️ 这一档已经做过了（2026-09-24 深夜，见 NOTES-jspi 的"G1 复现阶梯"）**：
   ①/②/③/④/⑤/⑥ **全部正常** —— **M2 不是元凶**（主嫌疑被推翻），
   `JSPI_EXPORTS` 写不存在的名字无害、`-fwasm-exceptions`、`std::string` 签名、
   "同函数 sync+async 双绑定"都不是。⇒ 范围收窄到**我们那条链独有的结构**，按序试：
   **① dlopen / SIDE_MODULE 的参与**（最强嫌疑：embind 的 async invoker 是 table 里的间接函数，
   而启动时的 `dlopen` 会让表增长 ⇒ JSPI 包装的引用可能失效成 `null function`）——
   **⚠️ ② ③ 也已经排除了**（v11/v12：异步+dlopen 正常、收窄的 `EXPORTED_*` 也正常），
   而 **v13 复现了"页面起不来"那一类**：**静态初始化里用同步路径 dlopen** ⇒
   `SuspendError: trying to suspend without WebAssembly.promising` ⇒ ready 永远不来。
   ⇒ 三条实锤机制：① 链里有 dlopen ⇒ 上游整条入口变"可能挂起"，不能被同步调；
   ② **顺序即机制**（先走一次 promising 入口，之后同步 dlopen 就正常）；
   ③ 启动路径上碰 dlopen 会直接要命。**修法候选（下一步，按便宜排序）**：
   **(a)** 用 `--emit-symbol-map` 找出**真正被同步调用的 wasm 导出名**（`_main`/`_eval_string`/
   `_execute_interp`…）列进 `-sJSPI_EXPORTS`（而不是 embind 的 JS 名 `eval_async`），重链试三例；
   **(b)** 把启动期的 `.oct` 装载挪到"首次 promising 入口之后"（先 `await eval_async("1")` 预热）；
   **(c)** 都不行 ⇒ 回到 §0.5 那个要人拍板的分叉。
3. **按复现结论更新 `build/113/NOTES-jspi.md`**：那三条要求是从**原始导出**的探针推的，
   embind 这条路要不要列 invoker 还是未知数 —— 查清后**把结论写回 NOTES**（别只留在脑子里）。
4. **⚠️ 需要人拍板的分叉**：若结论是"JSPI + embind + `MAIN_MODULE=2` 这条路走不通"，
   按红线**没有等价 fallback**（Asyncify 已证伪）⇒ 只能退到"**JS 侧队列 + 现有同步入口**"
   （能做"点一次恢复一次"，**做不了"命令中途停下来等"** ⇒ `pause`/`recordblocking` 放弃），
   或者为它单开一条 `MAIN_MODULE=1` 车道（产物更大）。**这两条哪条都行，但得人来定**。
5. **G2**（`pause`+EH/SjLj 压力矩阵，T1–T6 × 6 判据）→ 之后才是 **G3/G4/G5/G6**。
6. **D5–D7**（规则 B 162 处 / `pkg load` 自动装载 / IDBFS 边界）。

**门本身还差一步接线**：`__octaveJspiProbe()` / `__octaveJspiRequire()` 目前**只有探针在调** ——
G3/G5 落地时必须让**依赖 JSPI 的入口先问门**（否则门是摆设）。这条记在 G3/G5 的验收里。

## 1. 阶段与验收

### G0 · 能力门 + Octave 级冒烟（**不碰 wasm**，只改页面与测试）
- **改动**：`bridge/index.html` 加 `hasJSPI` 判定；**两个独立 gate**：① API 存在性；
  ② **Octave 级冒烟**（起一个最小 suspending 探针，端到端返回 43）。缺任一 ⇒ 页面上给
  **明确一行**（支持的浏览器版本）并**只禁用依赖它的入口**，不是整页不可用。
- **验收**：新 `test/browser/probe-jspi-gate.mjs`：① 有 JSPI 时两个 gate 都过；
  ② `addInitScript` 删掉 `Suspending/promising` 后，页面**仍能起 Octave**、`eval_string("2+2")`
  正常、依赖 JSPI 的入口报**明确**错（不是 `TypeError`）。
- **风险**：低（页面+测试）。回退：单独一个 commit。
- **✅ 2026-09-24 收口**：`bridge/index.html` 加了 `window.__octaveJspi`（`api` + `smoke`
  = `pending|pass|fail|no-entry|api-missing` + `note`）与 `window.__octaveJspiRequire(feature)`；
  冒烟**跟着产物走**（有 suspending 入口就必须 `pass`，现在还没入口 ⇒ 如实写 `no-entry`，
  G1 之后那条断言**自动变成硬要求，探针不用改**）。**现在不弹任何提示**（没有任何功能依赖它）。
  实测 8768：`probe-jspi-gate` **11 项全绿**，含"删掉 API 后产物照样起（`2+2` 正常）"与
  "依赖项得到含浏览器版本的一句话、全程没有裸 `TypeError`"。

### G1 · 顶层入口：Embind `async()`（**重链**）
- **决策**：**新增** `eval_async`，**不**把 `eval_string` 改成 async（它被 39 个套件与页面命令
  队列**同步**调用，改它 blast radius 太大且会掩盖 G2 的真风险）。
- **改动**：`main.cc` 加 `emscripten::function("eval_async", &eval_string, async())`；
  `link-web.sh` 加 `-sJSPI` + `-sJSPI_EXPORTS=eval_async`（按 NOTES-jspi 的三条要求）；
  页面加 `await Module.eval_async(src)`。
- **验收**：`probe-jspi-eval.mjs` 三例：A `await eval_async("42")` ⇒ 42；
  B `await eval_async("pause(0.2); 42")` ⇒ Promise pending 期间**页面 timer 正常 tick**、最终 42；
  C `await eval_async("error('x')")` ⇒ **Promise reject** 且文本与同步入口一致。
- **风险**：中（动了链接开关）。回退：产物退回 `m2fc-fonts-out` 的备份（已在容器里）。
- **⛔ 2026-09-24 第一次尝试失败（已回退，8761 一字节未动）**：
  `main.cc` 的绑定与 `link-web.sh` 的 `-sJSPI -sJSPI_EXPORTS=eval_async` 都加好了、五条自检全过、
  `eval_async` 也**存在**（`typeof === 'function'`），但**一调就炸**：
  `RuntimeError: null function`（三次调用全部如此，`ticks`=0）；随后的探针**把页面一起卡死**
  （300 s 未返回）。**事故与教训**：G0 的冒烟原本**在开机时自动跑**，它会去调 `eval_async`
  ⇒ 那个坏产物一部署，**8768 每次开页都卡死**（所有验收一起挂）。**已改成按需**
  （`window.__octaveJspiProbe(timeoutMs)`，开机只记 `unprobed`），并加超时兜底与
  `pass-blocking` 三态 —— **"探测一个可能把主线程卡住的东西"不能放在开机路径上**。
  8768 已回滚到 `site` 的产物（两站点重新一致、全绿）。
- **下一次怎么做（先小后大，别直接动 29MB 产物）**：
  1. **容器里做最小复现**：一个十几行的 embind async 程序，按阶梯加设置
     `{裸, -sJSPI} → 再加 -sMAIN_MODULE=2 → 再加 SIDE_MODULE/dlopen`，看**哪一步**把它打坏
     （上游 `test/test_other.py::test_embind_jspi` 只用 `-lembind -sJSPI`，**不带 JSPI_EXPORTS**，
     所以旗标本身大概率不是问题；嫌疑最大是 **M2 的 DCE 把 async invoker 那个 thunk 削了**，
     或者 JSPI 需要把 **invoker** 而不是业务函数列进 `JSPI_EXPORTS`）。
  2. 若确认是 M2 相关：先试把 invoker 的导出名列进 `JSPI_EXPORTS`（用 `--emit-symbol-map`
     或 `wasm-dis` 找名字），或**对照一条 `MAIN_MODULE_LEVEL=1` 的产物**看它在 M1 下是否正常。
  3. 机制在小复现里**证明**之后，才回来重链真产物；否则记成"这条路需要更多调查"，
     把交互能力留在 G3/G5 的替代方案里（例如 JS 侧队列 + 现有同步入口的组合）。

### G2 · `pause` + `unwind_protect` + EH/SjLj 压力矩阵（**本计划的真正风险点**）
- **改动**：`pause` 的等待从"忙等/阻塞"改成 **suspending import**（`web_pause_ms`），走 `-sJSPI_IMPORTS`。
- **验收（GPT 的矩阵 + 6 条判据，全部做成断言）**：T1 `unwind_protect; pause(0.1); end`、
  T2 `unwind_protect; pause(0.1); error("boom"); unwind_protect_cleanup; disp("cleanup")`、
  T3 `try; pause(0.1); error("boom"); catch; …`、T4 C++ 里 `try { suspending; throw; } catch`、
  T5 反过来、T6 Promise reject ⇒ Octave/C++ 正常收到异常。每条同时满足：
  ① `unwind_protect_cleanup` **恰好一次**；② C++ 析构**恰好一次**；③ 异常可正常 catch；
  ④ Promise 恰好 settle 一次；⑤ 之后再执行一条命令正常；⑥ `dlclose`+`dlopen` 之后仍正常。
- **失败即回退**：G2 不过 ⇒ **不动 8761**，把观察写进 HISTORY，只保留 G0/G1 的结论。
- **风险**：高。这是"要么过、要么明确记成做不到"的一关。

### G3 · `ginput`（事件队列）／ G4 · Ctrl-C 协作式中断 ／ G5 · `keyboard`（一层）／ G6 · dlopen×挂起压力
- **G3**：DOM 事件 → JS 队列 → resolve pending Promise → resume；**不让 DOM 回调直接进解释器**。
  验收：`tic; [x,y]=ginput(1); toc` 期间 RAF/timer 正常；点一次恢复一次；**第二次点击不得误触发
  下一次 `ginput`**；`ginput(3)` 连续三次顺序正确。
- **G4**：页面 Ctrl-C ⇒ `Module._octave_request_interrupt()`（C 侧置 interrupt flag），依赖既有
  `OCTAVE_QUIT` 检查点在**安全点**抛正常中断异常。**如实记限制**：原生大块循环（BLAS/FFTW）
  中间没有检查点时**不会立即生效**。验收：长循环里 Ctrl-C 在若干检查点内停下、
  `unwind_protect_cleanup` 执行；`pause` 等待中 Ctrl-C 也停；中断后命令正常。
- **G5**：`keyboard` 自己成状态机（进入→嵌套输入上下文→等输入时挂起→执行→退出→原栈继续），
  **只支持一层**。验收：进/出、里面 `pause`、里面报错后能退出。
- **G6**：主→dlopen；side→主；side→suspending import；挂起→恢复→`dlclose`；**重复
  dlopen/dlclose 若干轮**仍正常（拿现成 `.oct` 资产做）。
- **顺带**：G3/G5 落地后**删掉** `build/webshims/{ginput,keyboard,uisetfont,uiwait,waitfor}.m`
  里对应的那几个（现在它们把挂死变成清晰报错），并翻 `accept-interactive.mjs` 的断言。

### 收尾债（**先做，都是无风险的**；穿插在 G0 前后）
- **D1 文档与产物对齐**（本会话遗留的真实矛盾）：
  · `README.md` 交付包行：`…-20260923` / 首包 gzip ≈9.9MB → `…-20260924` / **10.26MB**；
  · `dist/DEPLOY.md`：删掉"`-dpng` 打印清晰报错"（**它现在真出图**），只留 `-dpdf` 那条；
    并补上本轮新增：`webshims` 交互族的清晰报错、IDBFS 持久化（`/home/web_user` + `Module.webSync()`）、
    两个字体家族。
- **D2 把 `probe-*` 纳入定期跑**：它们不在 `sweep.sh` 里 ⇒ 断言会腐烂（本会话抓到 **2 条**：
  一条从 R3 起没翻的 `listfonts`、一条我加 FreeMono 后没翻的）。做法：`sweep.sh` 加
  `PROBES=1` 开关（默认仍然只跑 `accept-*`，避免拖慢日常），或在 HANDOFF §8 的"快回环"里
  写成"每批 promote 后跑一遍 probe-*"并用一条命令固化。
- **D3 `sweep.sh` 对"页面偶发崩"重试一次**：本会话 `accept-forge` 出现过一次
  `Error: page.evaluate: Target crashed`（整页崩，非断言失败），单独重跑 22/0。判据：日志里出现
  `Target crashed` 就**自动重跑该套件一次**，仍崩才算失败（并在报告里标"重跑过"）。
- **D4 两站点一致性闸门**：现在靠人工 `sha256sum`。加一个脚本/闸门核对
  `site` 与 `siteWebGL` 的 `octave.{wasm,js,data}` + `index.html`（以及 `assets/m/*.js` 的清单 sha），
  不一致就**明确报告**（不一定是错误 —— 实验期允许不同，但必须**说清**，别让人猜）。
- **D5 小口子 8**：`check-wants` 规则 B 的 **162 处**人工复核（`--report` 列出）。逐条判断
  "这个 want 会不会被别处的数字满足"，把高危的改成自识别串（`disp(sprintf('npatch=%d', …))`）。
- **D6 `pkg load <未装载的包>` 自动装载**：现在只能"清晰报错 + 告诉你去 `OctaveAssets.load`"。
  两条路：① 给加载器/包格式加 **prepend**（`addpath('-begin', …)`）能力，好让资产遮住
  `/usr/src/octave/m/pkg/pkg.m`；② 复用 R5 的**同步 XHR** 在 Octave 侧同步拉资产。
  验收：`pkg load statistics`（未装载）**自己把它装上**并成功；负对照：不存在的包仍然报"没有"。
- **D7 IDBFS 边界测量**：写频次（去抖 800 ms 的实际合并率）、大批量写的耗时、
  IndexedDB 配额下的失败行为（配额满要**明确报错**而不是静默丢文件）。
- **D8 promote 前的"开机自检"**（30 秒；**2026-09-24 事故直接教出来的**）：
  新脚本 `build/check-boot.sh <URL>` —— 开页面、等 `__octaveReady`（≤30 s）、跑一句
  `eval_string("2+2")`；**不过就不许 promote**，并接进 `promote-webgl.sh` 的收尾与手动 promote 清单。
  为什么必须有：坏产物的失败模式是**页面根本起不来**，而现有网只能靠"40 个套件各自超时
  （每个最多 420 s）"才发现 —— 又慢又吵（这次就是这么撞上的）。
- **D9 门接线**（随 G3/G5 一起做）：`__octaveJspiProbe()`/`__octaveJspiRequire()` 现在只有探针在调；
  依赖 JSPI 的入口**必须先问门**，否则门是摆设。

## 2. 明确不做（写下来免得下轮又讨论）
- **Asyncify**（与 `-fwasm-exceptions` 互斥，已证伪）。
- **JS 注入异常做硬取消**（GPT 判 🔴）；**Worker 里跑 Octave 再 `terminate()`**（记档备选）。
- **COI + pthreads**（保持单线程；将来要做"科学计算工作台"再单开车道）。
- **第一版就做递归 `keyboard`**。
- **把 JSPI 做成全站硬门**（会抬浏览器下限）—— 走单产物 + 能力门。

## 3. 每阶段结束都要做的（老规矩）
`sh build/glue-selftest.sh` → 8768 全量 `sweep.sh` → promote 8761 → 8761 全量 →
`sh build/make-dist.sh`（核对**包内 wasm 与部署件同 sha**）→
`update-readme.py --check` / `update-handoff.py` / `check-handoff.py` / `check-consistency.py`
/ `check-wants.py` / `check-whitelist.py` → 提交 → 推镜像；
新文件同步 `.gitignore` 白名单并 `git status --short --ignored <目录>` 主动看一眼；
重活用 `setsid nohup … &` 后台跑 + 短轮询，别用长 `sleep` 阻塞。
