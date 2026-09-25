# NOTES · JSPI 组合探针（R5）—— `-fwasm-exceptions` + `-sJSPI` + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen

> 2026-09-24。**结论：这个组合在 Chromium 上成立**（实测的判据与三条实现要求见下）。
> 产物：`build/113/probe-jspi.{c,sh}` + `build/113/probe-jspi/` + `test/browser/probe-jspi.mjs`。
> **注意**：本文件只证明"机制可用"；**把 `pause`/`kbhit`/`recordblocking` 接上去（外部审核说的 P4）没做**。

## 为什么先做这个（外部审核的原话）

JSPI 本身已经进生产浏览器（Chrome 137+ / Firefox 153+ / Safari 27+），**JSPI 与 wasm EH 在规范层面
也兼容**（Promise 的 reject 按 wasm EH 的 JS API 传播）；但
**"JSPI + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen" 找不到公开的大型项目先例** ⇒
**探针没通过之前不许宣称可用**，更不许据此改 `pause` 那族函数。

## 探针形状（对应我们真实的调用链）

```text
JS: await Module._run_side(200)            ← 必须是 JSPI_EXPORTS 里的入口（promising）
  └─ wasm 主模块 run_side()                ← 主模块导出的普通函数
       ├─ dlopen("/side.wasm") / dlsym("side_wait")   ← 复刻 `.oct` 的装载方式
       ├─ 调用 side_wait()（**side module 里**，它自己没有任何 JS 环境）
       │    └─ 回调主模块的 main_wait()
       │         └─ browser_wait_ms()      ← --js-library 提供的 **suspending import**
       │              └─ return new Promise(resolve => setTimeout(resolve, ms))
       └─ resume：从**同一条栈**继续（不是 Asyncify 的 unwind/rewind）
```

判据两条，缺一不可（只看墙上时间会被 busy-loop 骗过）：
1. 墙上时间 ≥ 请求毫秒数；
2. **等待期间 JS 的 tick 计数增加**（`setTimeout` 落地过）—— 这才是"让出了事件循环"的证据。

## 实测（Chromium 152，2026-09-24）

| 用例 | 墙上时间 | tick 增量 | 返回值 | 结论 |
|---|---|---|---|---|
| ① `Module._main_wait(200)`（主模块 helper） | 201 ms | 1 | 42 | ✅ 挂起/恢复成立 |
| ② `Module._run_side(200)`（dlopen → side → 主模块 → JS） | 202 ms | 1 | **43** | ✅ **完整链成立** |
| 能力检测 | `typeof WebAssembly.Suspending === "function"` 且 `typeof WebAssembly.promising === "function"` | | | ✅ |

②的 wasm 侧日志（证明调用真的穿过了两层模块）：
```
[wasm] 调用 side_wait(200)（经 dlopen/dlsym 指针）
[wasm] main_wait(200) 进入 → [wasm] main_wait(200) 返回
[wasm] side_wait 返回 43
```

## 三条实现要求（都是实测撞出来的，将来接 `pause()` 时要照做）

1. ★ **每一个"可能间接挂起"的 JS 入口都要列进 `-sJSPI_EXPORTS`**。
   只列 `main_wait` 时，从 `run_side` 进来的链抛：
   ```
   SuspendError: trying to suspend without WebAssembly.promising
   ```
   V8 要求**挂起点所在的整条入口**都包了 `WebAssembly.promising()`。⇒ 将来页面要调的
   `pause` 包一层，那个入口名必须出现在 `JSPI_EXPORTS` 里。
2. ★ **JSPI 边界不要传字符串**。`Module._run_side("/side.wasm", 200)` 里的 JS 字符串
   **不会**被 marshal 成 C 指针（要 `ccall`/`cwrap`/`allocateUTF8`），wasm 收到的是 `NULL`
   ⇒ `dlopen(NULL)` 返回**主模块自己的句柄** ⇒ dlsym 报
   `Tried to lookup unknown symbol "side_wait" in dynamic lib: __main__`
   —— 症状极像"side module 没导出符号"，其实是"路径没传进去"。
   ⇒ 探针把路径写死在 C 里（真实链路里路径也由 C/C++ 自己解析）。
3. ★ **side module 必须显式导出自己的符号**：不写 `-sEXPORTED_FUNCTIONS=_side_wait`
   （或 `-Wl,--export=side_wait`）时，`-O2` 会把没人引用的函数 DCE 掉，产物只剩 **64 字节**
   的 dylink 壳，`strings` 里连名字都没有。与本仓 `.oct` 的既有经验同源。

## 怎么跑

```sh
# ① 容器内编产物（几秒；emcc 会警告 `-sJSPI (ASYNCIFY=2) is still experimental`，属正常）
sudo docker cp build/113/probe-jspi.sh o113:/src/probe-jspi.sh
sudo docker cp build/113/probe-jspi o113:/src/probe-jspi
sudo docker exec o113 sh -c 'export PATH=/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:$PATH; \
  cd /src && sh probe-jspi.sh /src/libwork/jspi'
# ② 产物取到宿主（探针自己起一个静态服务，不需要站点）
for f in main.js main.wasm side.wasm run.html; do
  sudo docker cp o113:/src/libwork/jspi/$f /mnt/hdd/octave-wasm-build/jspi-probe/$f; done
# ③ 跑（必须在 harness 目录下，才能解析 playwright-core）
cp test/browser/probe-jspi.mjs /mnt/hdd/octave-wasm-build/harness/_jspi_run.mjs
cd /mnt/hdd/octave-wasm-build/harness && node _jspi_run.mjs /mnt/hdd/octave-wasm-build/jspi-probe
```
退出码：0 = 通过；1 = 有断言失败；**2 = 该浏览器没有 JSPI 的 JS API（未做判定，不是失败）**。

## 还没做的（如实）

- **P3/P4 没做**：把主模块 side module 换成**真的 `.oct`**、把 `pause`/`kbhit`/`keyboard`/
  `recordblocking` 改成"经 JSPI 等浏览器"。那要动 Octave 本体（`pause` 是内建），
  以及页面侧的调用形态（入口要 promising）—— **是独立的一批，且要重新全量回归**。
- **浏览器下限**：本探针在 Chromium 152 上通过；按外部审核给的矩阵，
  部署要求 Chrome/Chromium ≥137、Firefox ≥153、Safari ≥27；**更老的浏览器没有 JSPI
  的 JS API**（探针会以退出码 2 如实说"未做判定"，而不是假绿）。
- **不要**回退到 Asyncify：本仓已实测它与 `-fwasm-exceptions` 互斥（HISTORY §5.11）。

---

## G1 复现阶梯（2026-09-24 深夜）：**五个嫌疑全部排除**，范围收窄到"dlopen/side module"

**背景**：G1 把 `eval_async`（`emscripten::function("eval_async", &eval_string, async())`）链进主产物后，
`typeof Module.eval_async === 'function'` 但**一调就炸** `RuntimeError: null function`，
随后把页面卡住（见 HISTORY §5.43）。

**做法**：容器里写十几行的 embind 程序（`/src/websrc/embind-repro/`），**一次只加一个"我们独有的配料"**，
每一档都在**浏览器**里实测（`-lembind` + `async()` 绑定，看 `await Module.f(...)` 能不能 settle）：
```
① -lembind -sJSPI                      → v1
② + -sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0   → v2
③ + -sJSPI_EXPORTS=asynced（**不存在的 wasm 导出名**，模拟我们的 eval_async） → v4
④ + std::string 参数（照抄 eval_string 的签名）                            → v5
⑤ + -fwasm-exceptions（JSPI + wasm EH 组合）                              → v6
⑥ 同一函数、同 arity、**两个名字**（一同步一异步，照抄 main.cc 的 eval_string 写法）→ v9
```

| 变体 | 结果 |
|---|---|
| v1 `-sJSPI` | ✅ `asynced(40)` → **Promise → 42** |
| v2 `+ MAIN_MODULE=2` | ✅ **同样正常** ⇒ **M2 的 DCE 不是元凶**（我原来的主嫌疑被推翻） |
| v4 `+ JSPI_EXPORTS=<不存在的名字>` | ✅ 正常 ⇒ **列一个不存在的导出名无害** |
| v5 `+ std::string` 参数 | ✅ `aStr('abcd')` → Promise → 4 |
| v6 `+ -fwasm-exceptions` | ✅ 正常 ⇒ **JSPI + wasm EH 在最小规模下没问题** |
| v9 同函数 sync+async 两名字 | ✅ `sync_f('abcd')`=4、`async_f('abcd')` → **Promise → 4** |
| v3（**不开** `-sJSPI`，对照） | `asynced` 返回的是**同步值**（`isPromise=false`）⇒ 确认 `-sJSPI` 就是"返回 Promise"的那个开关 |

**结论**：最小复现**复现不出**那个坏 —— 也就是说，坏的不是 embind/JSPI/M2/wasm-EH/string 签名/双绑定
这些**语言与旗标层面**的东西，而是**我们那条链里独有的结构**。剩下的差异（下一步按序试）：
1. **dlopen / SIDE_MODULE 的参与**（`MAIN_MODULE=2` + 动态链接 + `ALLOW_TABLE_GROWTH=1`）——
   最强的嫌疑：embind 的 async invoker 是一个**间接函数（table 条目）**，而我们的启动会
   `dlopen` 若干 `.oct`（**表会增长**）⇒ 若 JSPI 包装的是"早先拿到的那个引用"，增长之后可能就
   `null function` 了。**下一步实验**：在 v9 上加一个真 side module + `dlopen`（复用
   `build/113/probe-jspi/` 的 side.c 那套），看是否当场坏。
2. `KEEP_LIST` / `-Wl,--export-if-defined=…` / `BASELINE_WASM` 那套保活与差分机制。
3. `-sEXPORTED_FUNCTIONS=["_main"]` + `-sEXPORTED_RUNTIME_METHODS=["FS","MEMFS","IDBFS"]`
   （注意：**`EXPORTED_RUNTIME_METHODS` 里写一个不存在的名字会直接让 em++ 报错并中止**
   —— 实测 `undefined exported symbol: "IDBFS"`，所以那几个名字必须与 `-lidbfs.js` 等
   library 开关配套，别单独抄）。
4. `--preload-file` 的一大堆文件 / `--post-js`（理论上无关，但列上）。

**顺带实测记一笔**：`-sEXPORTED_RUNTIME_METHODS` 里的名字**必须真实可用**，
写错是**编译期硬错**（`undefined exported symbol`）而不是运行时忽略 —— 与 `-sJSPI_EXPORTS`
写不存在的名字（无害）行为**不一样**，别把两者当同一类。

### 再进一步：**加上真 dlopen / SIDE_MODULE**（v10，2026-09-24 深夜）

在 v9 的基础上加一个真 side module（`side_add`，`EMSCRIPTEN_KEEPALIVE`）+ `dlopen("/side.wasm")`，
并且**先调一次会走 dlopen 的同步绑定 `callSide(1)`，再调 `async_f('abcd')`**：

| 调用 | 结果 |
|---|---|
| `callSide(1)`（同步绑定，内部 dlopen + dlsym） | ❌ **`SuspendError: trying to suspend without WebAssembly.promising`** |
| `sync_f('abcd')` | ✅ 4 |
| `async_f('abcd')` | ✅ **Promise → 4**（embind 的 async 这条路仍然正常） |

★ **这就是"要求①"的现场演示**：一旦产物带 JSPI 且链里有 dlopen，**任何一个"可能间接挂起"的
入口**（这里就是那个会调 dlopen 的同步绑定）在**没被 promising 包装**的情况下被调用，V8 就抛
`SuspendError` —— 换句话说，**动态链接的存在会把它上游的整条入口都变成"可能挂起"**，
而这与入口是不是 embind 的 async 绑定**无关**。

**对我们那个坏产物意味着什么**：`eval_string`（`eval_async` 背后的 C 函数）在真产物里会走到
**dldfcn / `oct-shlib` 那套动态装载**（`.oct` 的 dlopen 就在这条路上）⇒ 它的**同步入口
`eval_string` 与异步入口 `eval_async` 都处在"可能挂起"的链上**。而我们的
`-sJSPI_EXPORTS=eval_async` 里那个名字**不是 wasm 导出**（embind 的名字在 JS 侧），
所以被 promising 包装的**不是真正需要它的那个 invoker** ⇒ 症状可以理解成"包装落空"。
（v4 里"bogus 名字无害"是因为那个最小程序**不碰 dlopen**，整条链本来就不可能挂起。）

**下一个实验（v11，写死在这里免得下一轮重新想）**：把 v10 的 `async_f` 换成一个**内部会 dlopen
的函数**（即 `async_f = call_side`），看它给出的是
① 同样的 `SuspendError`、② 我们真产物那个 `RuntimeError: null function`、还是 ③ 正常工作。
按结果分派：
- 若是 ①/③ ⇒ 真产物那次的 `null function` 另有原因（继续查 `KEEP_LIST`/`EXPORT_IF_DEFINED`/
  `BASELINE_WASM` 那套，或直接用 `--emit-symbol-map` 找出真产物里 embind async invoker 的
  **导出名**，把它列进 `-sJSPI_EXPORTS`）；
- 若是 ② ⇒ 机制确认，修法是把**真正会挂起的那些入口**（含 embind invoker 的实际导出名）
  列进 `-sJSPI_EXPORTS`，或者让 `eval_async` 走一条**不经过 dldfcn 的**受控路径。

**另一个可用的对照**：`MAIN_MODULE_LEVEL=1` 产物没有 side module/DCE 那套，若它在 M1 下
`eval_async` 正常，就进一步把范围钉死在"动态链接 × JSPI"上。

### v11 / v12 / v13：**"顺序即机制"**，以及一个能复现"页面起不来"的最小例子（2026-09-24 深夜）

| 变体 | 内容 | 结果 |
|---|---|---|
| v11a | **异步绑定 + 内部 dlopen**（`async_callSide`） | ✅ **Promise → 2**；而且**先调它之后**，同一产物里的**同步** `callSide` 也不再抛 SuspendError（v10 里会） |
| v11b | v11a + `-sJSPI_EXPORTS=sync_f,async_f,callSide,async_callSide` | ✅ 同上（列不存在的/多余的名字都无害） |
| v12 | v11a + **收窄的** `-sEXPORTED_FUNCTIONS=_main -sEXPORTED_RUNTIME_METHODS=FS,MEMFS`（照抄 link-web.sh 口径） | ✅ 同上 ⇒ **旗标层面全部排除** |
| **v13** | **启动期（静态初始化器）就用同步路径 dlopen**，之后再调 async —— **照抄我们真产物的时序** | ❌ **页面起不来**（`ready=false`），pageerror 正是 **`SuspendError: trying to suspend without WebAssembly.promising`** |

**由此得到的关键机制（三条，都是实测）**：
1. **带 JSPI 的产物里，凡"可能间接挂起"的入口都不能被同步调用** —— 而**只要链里有 dlopen/dlsym，
   它上游的整条入口就变成"可能挂起"**（v10：同步 `callSide` ⇒ SuspendError）。
2. **顺序决定成败**：**先**走一次被 promising 包装的入口（v11a 的 `async_callSide`），
   同一个产物里**之后**的同步 dlopen 调用就正常了（v10 会抛、v11a 不抛，唯一差别是这个顺序）
   ⇒ dylink 的首次初始化是"会挂"的那一段，之后不再挂。
3. **启动路径上碰 dlopen 会直接要命**（v13）：静态初始化里 dlopen ⇒ 模块初始化期间抛
   SuspendError ⇒ **页面永远到不了 ready**。

**对我们真产物的解释**（与两个实测现象的对应）：
- `main.cc` 的启动序列会用**同步**入口（`eval_string`）装载那些 `.oct`（= dlopen）——
  这正是 v13 的形状（在"任何 promising 入口"之前碰 dlsym）⇒ 与"页面卡死"这一类现象同源；
- 而 `eval_async` 的 `RuntimeError: null function` 说明**它的 invoker 那条路也没接好**
  （我们给的 `-sJSPI_EXPORTS=eval_async` 是 **embind 的 JS 名字、不是 wasm 导出名**，
  真正需要包装的是别的名字 —— 见下面的下一步）。

**下一步（按便宜程度排序，写死免得重想）**：
1. **给真产物找"真正会挂起的那些导出名"**：`--emit-symbol-map` + 查 `wasm` 导出表，
   把 `_main`/`_eval_string`/`_execute_interp`/… 这类**真正被同步调用的入口**列进
   `-sJSPI_EXPORTS`（而不是 embind 的 JS 名字 `eval_async`），再重链试 `eval_async` 三例。
2. **把启动期的 `.oct` 装载挪到"首次 promising 入口之后"**（v11a 的顺序）——例如启动序列先
   调一次 `await eval_async("1")` 预热，再走同步装载；这条即使第 1 条不成也能单独试。
3. 若两条都不行 ⇒ 回到工作令 §0.5 那个**要人拍板的分叉**（JS 队列 / 单开 M1 车道）。

---

## G1 真产物实测（2026-09-24 深夜，候选 (b) 那一轮）：**两个发现 —— 旗标从未生效；"null function" 跟 JSPI 无关**

**做法（不重链、不碰 8761/8768，独立车道）**：把留档的坏产物
（`o113:/src/websrc/m2fc-jspi-out/octave.{wasm,js,data}`，sha `c93c4453…`）取到宿主
`site-jspi-bad`，起 8769；另做三个变体页起 8770/8771/8772。

### 发现 ①（真 bug）：`WITH_JSPI=1` **从来没有把 `-sJSPI` 传给 em++** ⇒ 那个产物根本不是 JSPI 产物

**判据（可复跑，一条命令）**：
```sh
grep -o 'WebAssembly\.promising\|WebAssembly\.Suspending' <octave.js>
# 已知 -sJSPI 产物 jspi-probe/main.js → 1×promising + 1×new Suspending
# 坏产物 octave.js               → **0 处**（它里面 3 个 "jspi" 全是路径串 m2fc-jspi-out）
```
- **根因**：`build/113/link-web.sh` 里 `JSPI_FLAGS=( -sJSPI -sJSPI_EXPORTS=eval_async )` 只在
  `WITH_JSPI=1` 分支**赋值**，而那条 `em++ --bind …` **链接行里从来没有引用 `${JSPI_FLAGS[@]}`**
  （只有 `JSPI_DEF` 用在了 `main.cc` 的**编译**行）⇒ 宏进了 C++、**旗标没进链接**。
- **浏览器侧佐证**：坏产物上 `Module.eval_async('1')` 返回 **`0`（typeof `number`）**，不是 Promise
  ⇒ embind 的 `isAsync` 被无视（`libembind_shared.js` 的 `createJsInvoker`：`ASYNCIFY != 2` 时
  `isAsync` 那个 `rv.then(onDone)` 分支**根本不生成**，函数就是普通同步 invoker）。
- **⇒ G1 第一次"失败"测的是一件不存在的东西。** 之前记的"嫌疑①②"（M2 的 DCE 削掉 async thunk /
  invoker 要进 `JSPI_EXPORTS`）**没有被证伪，只是从来没被测到** —— 它们的验证要等旗标真传进去。

### 发现 ②（比 ① 更值钱）：`RuntimeError: null function` **与 JSPI 无关** —— 是"在 `execute_interp()` 之前碰解释器"

同一产物、四个页面，**唯一变量 = 第一次解释器调用发生在什么时候**（全部实测，Chromium 152）：

| 车道 | 页面 | 第一次解释器调用 | 结果 |
|---|---|---|---|
| 8771 | 现役页 + 在 `execute_interp()` **之前**插一句 `Module.eval_string("42")` | 早（**同步** `eval_string`） | ❌ `THROW: RuntimeError: null function`；**boot 之后**再调 `eval_string('2+2')` → **rc=0** |
| 8772 | 同上，插的是 `Module.eval_async("42")` | 早（`eval_async`，实为同步） | ❌ **`RuntimeError: null function`**（一模一样） |
| 8769 | **现役页原样**（第一次解释器调用 = postRun 里的 `execute_interp()`） | 正常顺序 | ✅ `BOOT OK: 1.1s`；之后三例 `eval_async`（`42`/`pause(0.2); 43`/`error("boom")`）**全返回数字**（`0`/`0`/`2`），解释器存活 |
| 8770 | **e71f4ae 那版页**（开机自动冒烟，第一步就调 `eval_async`，**无 try/catch**） | 早 | ❌ **逐字复现事故**：30 s 不 ready、`pageerror: RuntimeError: null function`、连同步 `eval_string(42)` 也 `null function` |

★ **机制**：解释器入口（`eval_string` / `eval_async` / `feval`）在 **`Module["execute_interp"]()` 之前不可调用**
—— 那之前 Octave 的 `interpreter` 还没装配，被调到的函数指针是空的 ⇒ `null function`。
**同步入口与异步入口炸得一模一样** ⇒ **这条不是 JSPI 的性质**。
★ **事故的真实形状**：e71f4ae 的冒烟在 postRun **头部**调 `eval_async` 且**没有 try/catch**
⇒ 异常打断 postRun **剩下的所有步骤** ⇒ `__octaveReady` 永远 false ⇒ "页面卡死"。
原来记的"JSPI 绑定坏 + 探测不能放开机路径"：**前半句错了**（绑定根本没编进去），
**后半句仍然成立**；正确的教训要多一条：**开机路径上的任何探测都必须 try/catch，且不得早于 `execute_interp()`**。

### 对下一步的影响（据此改写 `PLAN-jspi.md §0.5` 的顺序）

1. **先修旗标**：把 `${JSPI_FLAGS[@]}` 真正接进 `link-web.sh` 的链接行，重链一版 `WITH_JSPI=1`，
   先验**"胶水里出现 `WebAssembly.promising`"**（比任何浏览器断言都便宜，而且正是这次漏掉的一环）。
2. **再谈机制**：旗标真进去之后再跑三例（`42` / `pause(0.2); 43` / `error('x')`）。
   **v1–v13 那十三档复现仍然有效**，但它们排除的是"最小规模下旗标组合的问题"，
   **从来没有排除"我们真产物里旗标没生效"**这一档。
3. 页面侧顺手两件事：冒烟/预热类调用**一律 try/catch**；**不得早于 `execute_interp()`**
   （真要预热，就放在 postRun 里 `execute_interp()` **之后**、第一批资产装载**之前**）。
4. **页面侧的护栏有意推迟到本批之外**：`__octaveJspiProbe` 里"先等 `__octaveReady` 再调"那 6 行
   **改好又回退了** —— 因为改 `bridge/index.html` 必须走完整 promote 周期（否则两站点
   一致性闸门直接红），而它对**现役产物**是**零影响**（现役没有 `eval_async`，走 `no-entry` 那条早退路）。
   ⇒ **并进 G1 重做那一批一起部署**。

---

## A2 最小实验（2026-09-25）：**dlopen 在 5.0.7 是无条件挂起点**；机制② 改写为"装载缓存"

**做法**：按第三轮外部复审（`GPT-REVIEW-3-bridge-reply.md` §2）的三条判据扩展最小探针
（`build/113/probe-jspi/` 新增 `main_wait_unmarked` / `run_ctor_unmarked` / `run_ctor_marked`
+ `side_ctor.c`（带全局构造函数做间接调用的 side module）；runner =
`test/browser/probe-jspi-a2.mjs`，每阶段独立浏览器、每次调用 10 s 硬超时）。

**结果（Chromium 152，9 PASS / 2 fail，两条 fail 是"预期绿、实测红"的如实记录）**：

| 用例 | 预期 | 实测 |
|---|---|---|
| 判据1：未列 `JSPI_EXPORTS` 的同步入口直达挂起 import | **红** | ✅ **红**：`SuspendError: trying to suspend without WebAssembly.promising`，tick=0；**且炸完运行期还活着**（随后的 promising 调用正常） |
| 判据2：plain 栈上 dlopen 带构造函数的新模块 | 绿 | ❌ **红**：同一个 SuspendError —— **VTK 案例复现**，但根因比"构造函数"更底层（见下） |
| 判据3：promising ↔ 同步 dlopen 交替三轮 | 观察是否需要热身 | **新模块的同步 dlopen 每轮都炸**（3/3）⇒ **"热身"救不了新模块** |
| 补测A：**promising 栈**上 dlopen 带构造函数的**新模块** | 绿（推论） | ✅ 绿（`ctor_ping` 返回 7，构造函数间接调用无碍） |
| 补测B：模块**已装载**后 plain 栈再 dlopen | 绿（推论） | ✅ 绿 —— **"机制②"的真身 = 装载缓存**（已装载 ⇒ 不再走 `__dlopen_js`），不是什么 V8 热身 |

### 根因（胶水逐字，5.0.7 263db4c）

```js
// 生成胶水 main.js 里的 instrumentWasmImports：
var importPattern = /^(browser_wait_ms|invoke_.*|__asyncjs__.*)$/;
let isAsyncifyImport = original.isAsync || importPattern.test(x);   // ★ .isAsync 优先于名单
if (isAsyncifyImport) imports[x] = new WebAssembly.Suspending(original)
```
而 `_dlopen_js` 在 `libdylink.js` 里是 `_dlopen_js__async: 'auto'` + `#if ASYNCIFY ⇒ {loadAsync:true}`；
**`-sJSPI` 就是 `ASYNCIFY=2`** ⇒ 生成胶水 `__dlopen_js.isAsync = true` ⇒ **任何 `-sJSPI` 产物里
`dlopen` 一律是 Suspending 挂起点，`-sJSPI_IMPORTS` 收窄管不住它**。

### 三条机制改写（取代 §"v11/v12/v13"里的旧口径）

1. ① 不变但表述更准：**"漏标入口"不是被自动标记，而是真踩到挂起点才炸**（判据1；炸完运行期仍可用）。
2. ② **作废，改为**：`dlopen` 的 SuspendError 只在**装载新模块那一刻**发生；同一模块第二次 dlopen
   走 LDSO 缓存不再调 `__dlopen_js` ⇒ 表现为"先 promising 过一次就正常"。**不是可依赖的契约，
   连"热身"都救不了新模块**（判据3 实测 3/3 炸）。
3. ③ 不变且更宽：启动期任何 `__wasm_call_ctors`/静态初始化路径若触 dlopen 必死（同根因）。

### 对产品架构的直接结论（A2 的隐藏代价）

**在 5.0.7 上选 A2（`-sJSPI`），就等于接受"一切可能 dlopen 的代码都必须跑在 promising 栈上"**：
- 用户命令必须全部走 promising 的 eval 入口（否则命令里一次懒加载 `.oct` 就当场炸）；
- **开机期的资产装载也必须走 promising**（CORE_DLDFCN 那一批就是开机 dlopen 的）；
- `execute_interp()` 是否触 dlopen 要单独实测，触了也得 promising 化。
这正是原候选 (b) 的形状，但现在**从"可选优化"变成了"强制架构"**。

### ⭐ 由此浮出的 B 方案新优势（需求书里没人列过）

**手搓 JSPI（方案 B）不加 `-sJSPI` ⇒ `ASYNCIFY` 为假 ⇒ `_dlopen_js` 走 `{loadAsync:false}` 同步分支、
没有 `.isAsync` ⇒ `dlopen` 永远不是挂起点**。爆炸半径回到真正的 1 import（`web_pause_ms`）+ 1 export
（promising 的 eval 入口），开机序列**不需要**改成全异步、plain 栈上的 dlopen 照常。
⇒ A2 实验的最大产出：**B 从"备选"升格为"应当先测的方案"**——下一步实验就是它
（同一份探针 C 代码，只换包装方式，见复审 §3 的判据）。

---

## B 方案对照实验（2026-09-25）：**13 PASS / 0 FAIL —— 定案，产品姿势 = B**

**做法**：同一份探针 C 代码（main.c / side.c / side_ctor.c 一字未改），**唯一变量 = 包装方式**：
`build/113/probe-jspi-b.sh` **不加 `-sJSPI`**（其余旗标 `-fwasm-exceptions + MAIN_MODULE=2 + dlopen` 不变），
挂起能力全部来自 `run-b.html` 的 `instantiateWasm` 钩子（把 `browser_wait_ms` 包成
`WebAssembly.Suspending`，其余 import 原样透传）+ 页面按需 `WebAssembly.promising`。
runner = `test/browser/probe-jspi-b.mjs`。

| 用例 | 结果 |
|---|---|
| **B1 plain 栈 dlopen 新模块（带构造函数）** | ✅ 绿（7）—— **A2 在这一格是红**，B 的决定性优势 |
| B2 `promising(main_wait)(100)` | ✅ 42，tick+1，墙上 ≥100ms —— 手包 Suspending import 的挂起/恢复真成立 |
| B3 `promising(main_wait_unmarked)(100)` | ✅ 43，tick+1 —— **不需要任何 JSPI_EXPORTS 名单**：想包谁页面就包谁，"漏标=当场炸"变成"页面自己选" |
| B4 完整链 `promising(run_side)(200)` | ✅ 43 = 42+1，tick+1，≥200ms —— 跨模块链成立 |
| B5 promising 栈 dlopen 新模块 | ✅ 绿 |
| B6 反证：直调未包装入口 | ✅ 预期红：`SuspendError`，且事后运行期存活 —— 穷举语义不变，但名单在页面手里 |
| B7 sync dlopen ↔ promising 交替三轮 | ✅ **全绿，无需热身、无需全异步开机** |

**产物自证**：B 胶水里 `Suspending` 出现 **0 次**（全部包装在页面层，emscripten 胶水零变形）。

### 定案与理由（写死，免得重想）

1. **产品姿势 = B（手搓 JSPI，不加 `-sJSPI`）**。理由：A2 在 5.0.7 上有隐藏代价
   （`dlopen` 无条件是挂起点 ⇒ 开机序列与一切可能 dlopen 的路径都要 promising 化）；
   B 没有这个问题（`ASYNCIFY` 假 ⇒ `dlopen` 走同步分支），爆炸半径 = 页面里一个钩子 +
   一个 promising 的 eval 入口，embind/`JSPI_EXPORTS` 命名问题整体消失。
2. **B 的已知代价（接受并记档）**：`instantiateWasm` 钩子与 5.0.7 胶水的耦合 ——
   **升 emsdk 必须重跑本探针**（B1/B2/B6/B7 四条是最低集）；复审提示的
   "side module 缓存旧表项绕过包装"风险在本探针的 B4（跨模块回调链）上**未观察到**，
   G2 压力矩阵里继续盯（双向调用 + table 增长）。
3. **G1 重链改动清单（B 姿势）**：
   - `main.cc`：加 `extern "C" int eval_wait(const char*)` 薄导出（内部转调 eval_string）；
     embind 的 `eval_async` 绑定**不再需要**（`JSPI_EVAL_ASYNC` 宏可以退役）。
   - `link-web.sh`：`WITH_JSPI=1` 时**不再加任何 `-sJSPI*` 旗标**；`JSPI_FLAGS` 分支删除或置空；
     `eval_wait` 进 EXPORTED_FUNCTIONS；★ 2026-09-24 加的那条"grep 胶水里的 promising"自检
     **要翻面**（B 下胶水里恰好应该是 **0** 个 Suspending，自检改为断言 0 + 页面钩子存在）。
   - 页面（G1 批次一起上）：`instantiateWasm` 钩子（**产物没有 web_pause_ms 时无害**）+
     `eval_wait` 的 promising 包装 + `__octaveJspiProbe` 改走新入口；
     `pause` 的接线（web_pause_ms import + m 侧 shim）是 G2 的活。
4. **复盘一句话**：复审的判定"A2 核心/B 备选"建立在"两者机制相同"上；实验证明**机制并不相同**
   —— A2 因 `-sJSPI` 连带把 dlopen 变成挂起点。这正好演示了为什么判据必须可证伪。
