# 需求书：浏览器内 clang-wasm（全功能 C/C++ → emscripten side module）

> 版本：v2（2026-10-10）。v1 有一处**结论性错误**（关于 sysroot `.a` 是否可省）已在 §5 更正，
> 并有实测证据。**§4 与 §5 的全部数字与报错原文都来自实测**，非二手资料。

---

## 0. 一句话

造一个**完全在浏览器里运行**的 C/C++ 编译工具链（clang + lld），输入源码、输出
**Emscripten side module（可被 dlopen 的动态库）**；纯客户端，零服务端编译端点。

## 1. 为什么要它

- 现状：要在浏览器里得到可 dlopen 的动态模块（如 Octave 的 `.oct`），只能**构建期预编**、
  随站分发——用户没用到的东西也强制下载。
- 目标：把**编译器本身**变成一件可按需下载的资产：用户点一下才拉，拉到就能**当场编**。
- 形态：**独立仓库**，被下游以 submodule 钉住（pin = commit，字节 = sha256），
  像货架上的一件商品被按需拉取。**编译器不进服务端**。

## 2. 交付物

| 产物 | 说明 |
|---|---|
| `clang.wasm` + 胶水 | C/C++ 前端 |
| `lld.wasm`（或与 clang 合并为一个 wasm） | `wasm-ld` 链接器 |
| `sysroot-headers.tar` | **只含头文件**（不含 `.a`）—— 见 §5 |
| 驱动 API/脚本 | 把「源码 → side module」封成一个入口 |
| `manifest.json` | 逐资产名字 + 字节 + sha256 + **emsdk/LLVM 版本串** |
| LICENSE | LLVM（Apache-2.0 with LLVM exceptions）+ 胶水 |

## 3. 硬约束（红线）

1. **纯客户端**：编译全程在 wasm 沙箱内；**禁止**任何服务端编译端点、禁止外发源码。
2. **无 fork/exec**：浏览器没有子进程 ⇒ 编译器必须**进程内可调用**。这直接排除
   meson / ninja / `emcc.py` 这类"自己 spawn 子进程"的构建系统。
3. **可 pin / 可校验**：一个 commit 钉死；每资产 sha256，下载后校验，不符即拒（fail-closed）。
4. **两档**：wasm32 与 wasm64 **都要支持**，由调用方按宿主选（见 §4.5）。

## 4. 目标 ABI（全部难点在此）

产物 = **Emscripten side module**：`dylink.0` + `GOT.mem`/`GOT.func` +
`__memory_base`/`__table_base` + `__wasm_apply_data_relocs`，能被另一个 emscripten
主模块 `dlopen`。

### 4.1 编译（clang 前端，逐字复现）

```
clang --target=<TRIPLE> --sysroot=<SR> -fvisibility=default \
      -isystem <SR>/include/compat \
      <用户 -I ...> \
      -fPIC -O2 -fwasm-exceptions -pthread \
      -c foo.cc -o foo.o
```

### 4.2 链接（wasm-ld，逐字复现）

```
wasm-ld -m<wasm64|wasm32> -o foo.so --strip-debug \
        --export=__wasm_call_ctors \
        --export=_emscripten_tls_init \
        --export-dynamic \
        --experimental-pic --unresolved-symbols=import-dynamic \
        -shared --shared-memory --no-stack-first \
        <SR>/lib/<TARGET>-emscripten/pic/crtbegin-mt.o foo.o \
        -L<SR>/lib/<TARGET>-emscripten/pic -L<emscripten>/src/lib \
        -mllvm -wasm-enable-eh -mllvm -exception-model=wasm
```

### 4.3 五处"缺一不可"（每条都有实测报错原文）

| # | 缺什么 | 报错 | 为什么 |
|---|---|---|---|
| 1 | `--sysroot` | `fatal error: 'cinttypes' file not found` | 裸 clang 没有 emscripten sysroot 路径 |
| 2 | `-isystem <SR>/include/compat` | `fatal error: 'xlocale.h' file not found` | emcc 默认注入的 compat 头目录 |
| 3 | `-pthread`（编译）+ `--shared-memory`（链接） | `LinkError: mismatch in shared state of memory, declared = 0, imported = 1` | 宿主若是 shared memory（pthread），side 必须声明 shared |
| 4 | `crtbegin-mt.o` + `--export=_emscripten_tls_init` | `TypeError: tlsInitFunc is not a function` | 加载器要调 side 的 **TLS 初始化入口**；由 `crtbegin-mt.o` 提供，且**必须导出**（emcc 自动做，裸链不会） |
| 5 | `--export-dynamic` | 产物被 GC 成 **527 B**、导出全没 | 没有它 ⇒ 用户函数名不进动态符号表 ⇒ 宿主找不到函数 |

### 4.4 已实测锚点（可作为复现验收基线）

在 emscripten 主模块（wasm64 档，`-pthread -sSHARED_MEMORY -fwasm-exceptions`）上：

```
exist('miniprobe')   = 3
which('miniprobe')   = <插件目录>/miniprobe.oct
miniprobe([2,3;1,4]) = 5      ← 回调了宿主里的 LAPACK（跨模块符号解析成立）
miniprobe([1,2;3,4]) = -2
```

异常（`-fwasm-exceptions`）**跨 dlopen 边界**：

```
minithrow(0) 不抛        → no-throw|caught=0
minithrow(1) C++ throw   → caught:thrown-from-oct|caught=1
minithrow(2) 宿主 error() → caught:octave-error-from-oct|caught=1
```

**反例**：去掉 `-fwasm-exceptions` ⇒ **装不上**（`LinkError: Incompatible version`）。
⇒ 异常模型必须与宿主一致，这是硬要求不是优化。

### 4.5 旗标必须由宿主参数决定

上述旗标里，**异常模型 / pthread / memory64** 三项**必须与宿主主模块完全一致**。
工具链**不要内置一套旗标表**，而是把这三项作为**参数**从调用方传入，按 §4.1/4.2 拼装。
（两边各存一份表 ⇒ 必然漂移。）

---

## 5. ⚠️ 符号契约（**本节是 v2 的核心更正**）

### 5.1 更正：sysroot 的 `.a` **不能**简单去掉

v1 曾写"sysroot 的 `.a` 可以不进交付物"。**该结论错误**，两处错：

**错在数据**：按**后缀**筛头文件会漏掉 libc++ 的头（`vector`/`array`/`tuple`…**没有后缀**）。
实测构成：

| | v1 写的 | 实测 |
|---|---|---|
| 参考 sysroot 头文件 | 0.69 MB | **4.88 MB** |
| 同上 `.a` | ~8 MB | **3.52 MB** |
| emscripten sysroot `include/` | — | **23 MB** |
| emscripten sysroot `lib/` | — | **586 MB** |

**错在结论**：用 STL 夹具（`std::vector`+`std::map`+`std::ostringstream`）实测：

```
dlopen **成功**、函数被调到，然后**运行期**炸：
   TypeError: resolved is not a function
   at stubs.<computed> (宿主 octave.js)
```

`stubs` 是 emscripten 的**惰性符号解析器**：

```js
stubs[prop] = (...args) => { resolved ||= resolveSymbol(prop); return resolved(...args) };
```

`resolveSymbol` 依序查 `wasmImports → localScope → moduleExports`，**都找不到返回 `undefined`**，
随后 `undefined(...args)` 抛错。⇒ **"装得上" ≠ "跑得对"**：链接期的
`--allow-undefined`/`import-dynamic` 会**静默放行**，缺口到**首次调用**才暴露。

### 5.2 精确缺口（逐个核过）

STL 夹具需要宿主解析 **43** 个符号；宿主导出 **752** 个；**差集只有 2 个**：

```
❌ std::map<K,V>::__tree::__emplace_unique_key_args   ← map<string,double> 的实例化
❌ std::basic_ostream<char>::operator<<(unsigned long)
```

**根因 = 模板实例化**：宿主只导出**它自己用过**的实例化。用户代码出现宿主未实例化的模板组合，
就缺符号。

### 5.3 三条路的代价（实测）

| 做法 | 产物 | 结果 |
|---|---|---|
| 不链 `.a` | 22,910 B | 依赖宿主导出面；未实例化的模板 ⇒ 运行期炸 |
| 链 libc++ `.a` | **1,119,168 B**（+48×） | 拉进 1270 个导入、1204 个仍找不到 ⇒ **错路** |
| 宿主补导出（或 `MAIN_MODULE=1`） | 宿主涨 | 方向对（缺口仅 2 个），代价待量 |

### 5.4 交付形态（据此确定）

1. **头文件必须带**（`include/` 约 23 MB raw，压缩后见 §6）。
2. **`.a` 不进交付包**，**但前提是宿主承诺符号可解析** —— 这是**宿主/插件契约**。
3. **工具链必须提供"符号解析失败"的响亮报错**：编译/链接后**主动比对**产物的
   `env` 导入与宿主导出，**点名缺哪个符号**；不许静默装 stub。
   （参考实现：`build/113/check-oct-host-symbols.mjs`，用 `WebAssembly.Module.imports/exports` 对差集。）
4. **可选的"自包含模式"**：把需要的 libc++ 目标文件链进产物（20 KB → 1.1 MB 量级），
   供"宿主导出面不可控"的场景。

---

## 6. 体积预算

**已实测**（把现成的浏览器内 clang+lld 实现拉下来，用与常见 emscripten 产物同套压缩参数）：

| 资产 | raw | gzip -9 | brotli -q11 |
|---|---|---|---|
| clang（wasm） | 29.77 MB | 10.04 MB | **7.19 MB** |
| lld（wasm） | 18.59 MB | 6.40 MB | **4.65 MB** |
| sysroot.tar | 8.87 MB | 1.73 MB | **1.23 MB** |
| **合计** | 57.22 MB | 18.17 MB | **13.07 MB** |

- ⚠️ 上表是 **LLVM 8**（该实现很老、WASI 向）。**现代 LLVM（23/24）会更大**——**这一格是推断，
  你的第一件事就是把它量成实测**（raw 量级估计 35–60 MB）。
- **减重点**：只带 `include/`（头文件），不带 `lib/`（586 MB 的 `.a`）—— 前提见 §5.4。
- 进一步压缩（待验证）：只编 WebAssembly 后端、关掉用不上的 clang 特性、`-Os`/MinSizeRel、
  `wasm-opt -Oz`、只带 `-cc1` + lld 不带完整 driver。
- **预算目标**：brotli 后 **≤ 15 MB**（首拉），支持分片懒加载 + 浏览器缓存。

---

## 7. 架构要点：进程内编译（核心工程问题）

clang 驱动默认 spawn `cc1` 与链接器；浏览器无 fork。所以：

1. **clang 与 lld 编成 wasm 并暴露进程内入口**：`-cc1` 前端 + lld 入口作为同一 wasm 内的
   可调用函数。有公开先例（浏览器内 clang-repl + lld 出 side module；WasmBolt 的 llvm-box）。
2. **文件系统**：emscripten 内存 FS（或 wasmfs）；源码/头/产物都在 FS 内流转。
3. **运行位置**：放 **Web Worker**（编译是重活；且避开主线程 >8 MB 同步编译限制）。
4. **对外接口（建议）**：
   ```
   compile({ source | files,
             target:   'wasm32' | 'wasm64',
             abi:      { exceptions: 'wasm'|'emscripten'|'none',
                         pthread: bool, memory64: bool },
             hostExports?: string[],        // 见 §5.4：用于符号缺口检查
             flags, define, include })
     → { ok, moduleBytes | error, diagnostics, missingHostSymbols }
   ```
5. **driver 策略**：**自己写薄驱动**（按 §4.1/4.2 拼 `-cc1` + lld 调用），
   **不要**移植整个 clang driver / `emcc.py`——driver 的价值是"猜旗标 + spawn 子进程"，
   这两件事在浏览器里都不需要/不可用。

---

## 8. 版本锁定（最易翻车）

`crtbegin-mt.o`、`-L <SR>/lib/<target>-emscripten/pic`、libc++ 头、`__config_site`
**都来自 emscripten sysroot**，**必须与宿主主模块的 emscripten 版本完全一致**。

- 实测教训：不同 emscripten 版本间，`-shared` 稳定性、符号处理、异常实现都变过
  （旧版会打 `-shared ... is not yet stable` 警告，新版转正）。
- 要求：`manifest.json` 显式记 **emsdk 版本串 + LLVM 版本串**；接入时**强制核对**宿主一致，
  不一致 fail-closed，不许"凑合编"。

---

## 9. 验收标准（每条可证伪）

1. **能编**：最小 C++ 源（含一个导出函数 + 一次 `std::string` 使用）→ 产出 side module。
2. **能装**：被 emscripten 主模块 `dlopen` 成功，符号可解析。
3. **能调**：调用导出函数返回正确；**且回调宿主符号**（如宿主数学库）也正确。
4. **异常**：产物内 C++ `throw` 被自己 `catch`；宿主抛的异常在产物侧也能被接住。
5. **反例**：异常模型改错（去掉 `-fwasm-exceptions`）**必须装不上** —— 证明第 4 条非偶然。
6. **模板**：用 `std::map`/`std::ostringstream` 这类**宿主体内未必实例化**的 STL ⇒
   要么跑对，要么**响亮点名缺哪个宿主符号**（不许静默 stub）。
7. **两档**：wasm32 与 wasm64 **都**过 1–6。
8. **纯客户端**：全程断网（除首次下载资产）也能完成一次编译；网络面板**无源码外发**。
9. **体积**：首拉 brotli ≤ 15 MB；给出逐资产体积表。
10. **可校验**：篡改任一资产字节 ⇒ 加载器**拒绝**（sha256 fail-closed）。

---

## 10. 里程碑

- **M0（先做，最省力，不碰浏览器）**：原生环境手工命令跑通 §4 全链，产出 side module 并
  被宿主 dlopen 调通；再跑 §9.5 反例与 §9.6 模板用例。
  ⇒ 过了 = ABI 侧无未知；不过 = 后面全白搭。
- **M1**：clang+lld 编成 wasm（先求能跑，不优化体积），浏览器里编出 §9.1 的产物。
- **M2**：进程内驱动（无 fork），跑通 §9.2–9.4；Worker 化。
- **M3**：体积优化到 §6 预算；sha256 校验 + manifest + §5.4 符号缺口检查。
- **M4**：wasm64 档 + 宿主版本锁定核对；发第一个 pin。

---

## 11. 风险与未知（诚实清单）

| 风险 | 说明 | 缓解 |
|---|---|---|
| **无 fork** | 进程内跑 clang 前端 + lld 是最大工程量 | 薄驱动（§7.5）；有公开先例 |
| **体积** | 现代 LLVM 可能 30–60 MB raw（**推断**） | 只留 wasm 后端 + 只带头文件 + wasm-opt |
| **符号缺口** | 宿主 DCE 导致模板实例化缺失（§5，**已实测**） | §5.4：响亮报错 + 可选自包含模式 |
| **版本错位** | sysroot/ABI 随 emscripten 版本漂 | §8 强制核对，fail-closed |
| **内存** | 编译器需几百 MB 初始内存 | 实测移动端；必要时分批 |

---

## 12. 与下游的接口

- 本仓**只做工具链**，不知道任何下游概念。
- 下游按资产接入：submodule pin 住本仓 commit，读 `manifest.json` 按需拉
  `clang.wasm`/`lld.wasm`/`sysroot-headers.tar`，校验 sha，喂源码，拿回 side module 字节。
- 下游需要的 ABI 特性（异常模型/pthread/memory64）**通过参数传入**（§4.5），
  不许两边各写一份旗标表。
- 若下游宿主做了 DCE（如 `MAIN_MODULE=2` + keep-list），**必须**把自身导出面作为
  `hostExports` 传进来，让工具链做 §5.4 的缺口检查。

---

## 13. 参考先例

- 浏览器内 clang+lld 编 side module：clang-repl 的 WASM 后端 / xeus-cpp-lite / WasmBolt
  （三者同为"进程内 clang + lld 出 side module 再 dlopen"）。
- 浏览器内跑完整 emcc（体积/架构参考）：emception —— 但**它依赖 spawn**，不适合照搬。
- side module ABI 规范：WebAssembly tool-conventions 的 DynamicLinking；`wasm-ld --shared`
  自己就发 `dylink.0`（**不必依赖 emcc 驱动**，已实测）。
- WASI 系（wasm-clang / wasi-sdk）**产出的不是 emscripten ABI**，除非宿主也换 WASI，否则别选。

---

**给 agent 的第一条指令**：先做 **M0**（原生手工命令跑通 §4 + §9.5/9.6），把结果贴回来。
M0 绿了再动手编 wasm。**不要**先搭 CI、先写胶水、先优化体积。
