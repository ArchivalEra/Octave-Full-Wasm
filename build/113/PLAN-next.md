# PLAN · 下一阶段（2026-09-24 制定）—— JSPI 接交互 + 三块小口子

> **这是一份一次性工作令**：按阶段做，每阶段独立验收；做完全部或提前收口时，
> 结果写进 `HANDOFF.md`（活状态）与 `HISTORY.md`（过程），本文件随之转入历史。
> **纪律照旧**：先在 8768 验绿 → promote 8761 → 全量回归（`sweep.sh`）→ dist 重打 → 六道闸门
> → 提交（不 force-push / 禁 `--no-verify`）→ 推持久盘镜像。**8761 在 promote 前一动不动。**

## 0. 依据与前提（都是实测，不是推理）

- **GPT 对 R0–R5 的复审判定**（用户 2026-09-24 转来）：主路线成立；但对"JSPI + `MAIN_MODULE=2`
  + `SIDE_MODULE`/dlopen + wasm EH/SjLj + 大型 C++ 解释器 + 嵌套 REPL"这一整套，
  **没有找到上游成熟先例** ⇒ 只能记为"locally validated integration"，不许写成"成熟架构"。
- **我已通过的机制探针**（`build/113/probe-jspi.sh` + `test/browser/probe-jspi.mjs`，9/9）：
  `-fwasm-exceptions` + `-sJSPI` + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen 四件一起成立
  （dlopen 的 side module 回调主模块 helper → JS 的 Promise → resume；202 ms / tick +1 / 返回 43）。
  三条实现要求（见 `build/113/NOTES-jspi.md`）：入口必须进 `-sJSPI_EXPORTS`；边界不传 JS 字符串；
  side module 要显式导出符号。
- **Gate 0（本计划新增的关键实测，2026-09-24）**：把 `WebAssembly.Suspending`/`promising`
  从页面里删掉之后，**`-sJSPI` 产物仍能加载**（`Module` 存在、非 JSPI 导出照旧），
  只有被包过的导出**不存在**（`_main_wait is not a function`，并抛一次
  `TypeError: WebAssembly.Suspending is not a constructor`）。
  ⇒ **单产物 + 运行时能力门**这条路可行：不需要抬浏览器下限，也不需要维护两条车道。
- **当前缺口（同日实测）**：`pause(0.5)` 期间页面定时器 **0 次**（页面被完全堵死）；
  `ginput`/`keyboard` **挂死**（8 s 无响应）；`waitbar` 报误导性 `get: invalid handle (2)`；
  `edit` 清晰报错（无 shell）；`legend`/`plotyy`/`movie`(2 帧)/`diary` 可用。
  另：~~`isprop(gca,'__legend_handle__')=0`（`__plotyy_axes__`/`__original_looseinset__`/
  `__axes_limits__` 同），核心 `.m` 里那些 `get` 一律报错（多数被 try/catch 吞掉，
  偶发漏进 `last_error_message()` —— 会污染测试的判定）~~ → **2026-09-24 实测翻案：与宿主
  真 Octave 逐格相同，不是缺口**（见 §3 第 1 条与 HISTORY §5.33）；而"粘连"是
  `last_error_message()` 本身的语义（它是 `main.cc` 的绑定），**测试别拿它当判据**即可。

## 1. GPT 判定表里**直接采纳**的红线

| 结论 | 我们的做法 |
|---|---|
| 🟢 Embind `async()` 是顶层入口的正解；`WebAssembly.promising(Module.eval_string)` **不行**（那不是 raw wasm export） | G1 按 `emscripten::function(..., async())` 做（已核实 emsdk 5.0.7 里有 `emscripten::async`，libembind 明确 `async bindings are only supported with JSPI`） |
| 🔴 **不许**用"JS 往正在跑的 wasm 栈注入 C++ 异常"做 Ctrl-C | G4 走 Octave 自己的中断机制（`OCTAVE_QUIT` 检查点 + interrupt flag），不做抢占式取消 |
| 🟢 没有 JSPI 又没有 Asyncify ⇒ 没有等价 fallback | G0 做成**明确的能力门**（缺失就清晰报错 + 说明支持的浏览器），**不偷偷退 Asyncify**（它与 `-fwasm-exceptions` 互斥，已证伪） |
| 🟡 `keyboard` 的嵌套 REPL 没有成熟先例 | G5 标 **experimental**，第一版只支持**一层**嵌套（不做 keyboard→函数→keyboard） |
| 🟡 Pyodide 至今仍有 JSPI 稳定性 issue、会提供"禁用 JSPI"的 workaround | **能力检测与"Octave 级冒烟测试"必须是两个独立 gate**（G0 第二条），不能只看 `typeof WebAssembly.Suspending` |
| 🟢 COI + pthreads 是成熟技术，但产品代价在 COEP 的资源审计 | **本计划不做**（保持单线程；理由记档：教学/交互优先，29 MB 首包 + 无 COOP/COEP 是部署优势）。将来若做"科学计算工作台"再单开一条车道 |
| 🟢 `pause` 改 suspending import 架构标准；🟡 但 EH/SjLj 组合要自己压 | G2 是**真正的风险点**，用 GPT 给的 T1–T6 矩阵压，不靠推理 |

## 2. 阶段与验收

### G0 · 能力门 + Octave 级冒烟测试（**不碰 wasm**，只改页面与测试）
- **改动**：`bridge/index.html` 加 `hasJSPI = typeof WebAssembly.Suspending === "function" &&
  typeof WebAssembly.promising === "function"`；**两个独立 gate**：
  ① 能力门（API 存在性）；② **Octave 级冒烟**（起一个最小 suspending 探针，端到端返回 43）。
  缺任一 ⇒ 在页面上给出**明确的一行**（"本构建的交互等待需要 JSPI；支持：Chrome/Chromium ≥137、
  Firefox ≥153、Safari ≥27"），并且**禁用那些依赖它的入口**（不是让页面整个不可用）。
- **验收**：`test/browser/probe-jspi-gate.mjs`（新）：① 有 JSPI 时两个 gate 都过；
  ② `addInitScript` 删掉 `Suspending/promising` 后，页面**仍能起 Octave**、`eval_string("2+2")` 正常、
  依赖 JSPI 的入口报**明确**错（不是 `TypeError`）。
- **风险**：低。回退：页面改动单独一个 commit。

### G1 · 顶层入口：Embind `async()`
- **决策（写清理由）**：**新增**一个异步入口，**不**把现有 `eval_string` 改成 async ——
  现有 `eval_string` 被 36 个验收套件与页面命令队列**同步**调用，一旦它恒返回 Promise，
  全体调用点都要改，blast radius 太大且会掩盖 G2 的真实风险。
  ⇒ `main.cc` 里 `emscripten::function("eval_async", &eval_string, async())`（同名 C 函数换绑），
  配 `-sJSPI`；页面新入口 `await Module.eval_async(src)`；**同步 `eval_string` 保留**（无 JSPI 语义）。
- **验收**：`probe-jspi-eval.mjs`（新）三例：
  A `await eval_async("42")` ⇒ 42；B `await eval_async("pause(0.2); 42")` ⇒ Promise pending 期间
  页面 timer 正常 tick、最终 42；C `await eval_async("error('x')")` ⇒ **Promise reject** 且
  错误文本与同步入口一致。
- **风险**：中（链接开关动了主产物）。回退：产物退回 `m2fc-out` 的备份（已在磁盘）。

### G2 · `pause` + `unwind_protect` + EH/SjLj 压力矩阵（**本计划的真正风险点**）
- **改动**：`pause` 的等待从"忙等/阻塞"改成 **suspending import**（`web_pause_ms`），
  走 `-sJSPI_IMPORTS`。
- **验收（GPT 给的矩阵 + 6 条判据，全部要做成断言）**：
  T1 `unwind_protect; pause(0.1); end`；
  T2 `unwind_protect; pause(0.1); error("boom"); unwind_protect_cleanup; disp("cleanup")`；
  T3 `try; pause(0.1); error("boom"); catch; …`；
  T4 C++ 里 `try { suspending_call(); throw; } catch`；
  T5 反过来（`try { suspending } catch`）；
  T6 Promise **reject** ⇒ Octave/C++ 正常收到异常。
  每条必须同时满足：① `unwind_protect_cleanup` **恰好执行一次**；② C++ 析构**恰好一次**；
  ③ Octave 异常可正常 catch；④ Promise 最终 resolve/reject **正好一次**；⑤ 之后再执行一条命令正常；
  ⑥ `dlclose`+`dlopen` 之后再执行正常。
- **失败即回退**：G2 不过 ⇒ **不动 8761**，把观察写进 HISTORY，只保留 G0/G1 的结论。
- **风险**：高。这是"要么过、要么明确记成做不到"的一关。

### G3 · `ginput`（事件队列，GPT 判 🟢/🟡）
- **改动**：DOM 事件 → JS 队列 → resolve pending **Promise** → JSPI resume；**不让 DOM 回调直接进
  Octave 解释器**（避免 reentrancy）。
- **验收**：`tic; [x,y]=ginput(1); toc` 期间 RAF/timer 正常；点一次恢复一次；
  **第二次点击不得误触发下一次 `ginput`**；`ginput(3)` 连续三次顺序正确。
- **附带**：G3 之前，`ginput` 的"挂死"必须先在 G0 里就变成**清晰报错**（安全底线）。

### G4 · Ctrl-C → 协作式中断（GPT 判 🟢，明确不做抢占）
- **改动**：页面 Ctrl-C ⇒ `Module._octave_request_interrupt()`（C 侧置 Octave interrupt flag）；
  依赖既有 `OCTAVE_QUIT` 检查点在**安全点**抛正常 interrupt 异常。
- **如实记限制**：某个原生循环（BLAS/FFTW 大块）中间没有 `OCTAVE_QUIT` 时，Ctrl-C **不会立即生效** ——
  这不是 JSPI 能解决的；硬取消需要"把 Octave 放进 Worker 再 `terminate()`"，**本计划不做**（记档备选）。
- **验收**：`probe-interrupt.mjs`：长循环里 Ctrl-C ⇒ 在若干次检查点内停下、`unwind_protect_cleanup` 执行；
  `pause` 等待中 Ctrl-C ⇒ 停下；中断后再执行命令正常。

### G5 · `keyboard`（experimental，一层嵌套）
- **改动**：`keyboard` 自己成为状态机（进入 → 建嵌套输入上下文 → 等输入时 JSPI 挂起 → 执行 → 再等 →
  退出 → 原栈继续）。**不做**递归嵌套。
- **验收**：`keyboard` 进/出、`keyboard` 内 `pause`、`keyboard` 内报错后能退出。

### G6 · 动态链接 × 挂起的压力
- **验收**：主 → dlopen；side → 主；side → suspending import；side → 主 → suspending import；
  挂起 → 恢复 → `dlclose`；**重复 dlopen/dlclose 若干轮**后仍正常（拿现成的 `.oct` 资产做）。

## 3. 与"三块小口子"的穿插（**先做，不碰 wasm，风险最低**）

放在 G0 之前做，因为它们**立刻**改善可验证性（尤其第 1 条会消掉污染测试判定的"粘连错误"）：
1. **补齐 toolkit 内部属性**：`__legend_handle__` / `__plotyy_axes__` / `__original_looseinset__` /
   `__axes_handle__` / `__colorbar_handle__` / `__mouse_mode__` / `__uiwait_state__` 等（已从
   `scripts/plot|gui|image` grep 出 22 个名字）。验收：`isprop` 逐条为真、`get` 不报错；新探针。
   **✅ 2026-09-24 收口：实测翻案，不是缺口、未做改动。** 宿主**真** Octave 11.3.0 上
   `isprop`/`get` 与我们的 wasm **一样**（这些名字由核心惰性 `addproperty` 现加、读法全在
   `try/catch` 里）；qt/fltk/gnuplot 三个 toolkit × 67 名字 × 2 阶段 **逐格 0 差异**。
   钉子：`test/browser/probe-internal-props.mjs`（11 项）。证据与教训见 HISTORY §5.33。
2. **`plot(…,'parent',hax)` 在桥状态里错记**（实测 `numel(__pstate__().series)` 1 → 2）。
3. **`waitbar`/`uisetfont` 的误导报错** → 清晰报错；`ginput`/`keyboard` **不许挂死**（先报错，G3/G5 再实现）。
4. **可用包可见性**：`OctaveAssets.list()` → `__webassets_available__()`，让 `pkg list` 能说清
   "有哪些可加载但尚未装载"。
5. **`print -dpng/-djpg`** 走页面 PNG（实测 `/tmp/p5_fig.png` 已存在）；`-dpdf/-deps` 保持清晰报错。
6. **字体家族 +1**：预载 FreeMono ×4（镜像里有，`fonts.conf` 的 `<dir>` 天然覆盖），~1.04 MB raw。
7. **持久化**：IDBFS（`index.html` 里有注释掉的挂载点）落 `/home/web_user` + 明确 sync 点；
   验收"写 → 刷新 → 还在"。
8. **`check-wants` 规则 B 的 162 处**人工复核。

## 4. 明确不做（写下来免得下轮又讨论）

- **Asyncify**（与 `-fwasm-exceptions` 互斥，已证伪）。
- **JS 注入异常做硬取消**（GPT 判 🔴；JSPI 是挂起/恢复，不是抢占）。
- **COI + pthreads**（保持单线程；需要时单开"科学计算"车道）。
- **第一版就做递归 `keyboard`**、**Worker 里跑 Octave 做硬取消**（记档备选）。
- **把 JSPI 做成全站硬门**（会抬浏览器下限）—— 走单产物 + 能力门。

## 5. 每阶段结束都要做的（老规矩）

`sh build/glue-selftest.sh`（宿主快回环）→ 8768 全量 `sweep.sh` → promote 8761 → 8761 全量
→ `sh build/make-dist.sh`（核对包内 wasm 与部署件同 sha）→
`update-readme.py --check` / `update-handoff.py` / `check-handoff.py` / `check-consistency.py`
/ `check-wants.py` / `check-whitelist.py` → 提交 → 推镜像；
新文件同步 `.gitignore` 白名单，并 `git status --short --ignored <目录>` 主动看一眼。
