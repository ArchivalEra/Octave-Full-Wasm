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
