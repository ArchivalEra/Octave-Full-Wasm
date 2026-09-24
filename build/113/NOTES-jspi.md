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
- **不要**回退到 Asyncify：本仓已实测它与 `-fwasm-exceptions` 互斥（HANDOFF §5.11）。
