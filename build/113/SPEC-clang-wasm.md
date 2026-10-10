# 需求书：浏览器内 clang-wasm（全功能 C/C++ → emscripten side module）

> **本文是唯一一份**（工具链仓不另存副本；改动只改这里）。
> 版本：**v3**（2026-10-10）。全部数字与报错原文来自实测，非二手资料。
>
> **v3 改了什么**（依据 = 工具链侧 M0 全绿的实测发现 + 本仓实测）：
> - §4.2 删掉 `-mllvm -wasm-enable-eh`（**LLVM 24 已移除**）+ 加旗标版本表（§4.2 尾）
> - §4.5 异常从三档改**四档**（补 legacy/standard），判据从"版本串相等"改成"**契约相等**"
> - §5.4 缺口判定**必须扣 side 自导出**（实测 2 vs 1 假缺口）+ 自包含改成**按缺口**
> - §5.5 新增**宿主符号契约**（基线取宿主 wasm 真值；tag 显式必带）
> - §6 sysroot 只带**实际用到的**（实测 lib/ 586 MB 里绝大部分是 `.a`）
> - §8 判据改**契约四项**（版本号只记档）
> - §9.5 反例措辞更正（**装得上、跑到 throw 才炸**）；新增 §9.11 **双版本回归**
> - §2 LICENSE **拆两份**
>
> **v2→v1 的更正**：v1 曾写"sysroot 的 `.a` 可以省" —— **错**（见 §5.1）。

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
| `manifest.json` | 逐资产名字 + 字节 + sha256 + **工具链版本串 + 宿主基线版本串**（§8） |
| `LICENSE` | **你们的**（胶水层，许可自定） |
| `LICENSE-LLVM.txt` | LLVM 原文（**Apache-2.0 WITH LLVM-exception**） |

> ⚠️ **许可要拆开写，别选一个**：LLVM/clang/lld 派生的 wasm 二进制按**上游条款**
> （Apache-2.0 with LLVM-exception，其 exception 就是为"链进别的程序不传染"设计的）；
> **你们自己的胶水/脚本**按本仓/委托人选的许可（如 AGPL-3.0）。
> `manifest.json` 里逐资产标 `license`。**别把 AGPL 套在 clang.wasm 上**（会给下游
> "提供完整对应源码"的义务，而那份源码不是你们的）；**也别把 Apache 套在胶水上**（白送）。

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
        -mllvm -exception-model=wasm
```

**旗标随版本漂（所以不许内置一张表，见 §4.5）**：

| 旗标 | 版本差异 | 处理 |
|---|---|---|
| `-mllvm -wasm-enable-eh` | **LLVM 24 已移除**（报 `Unknown command line argument`） | 按版本参数化，**不认识就跳过**（探针探测，别硬传） |
| `--experimental-pic` | 现为 no-op（help 原文 `ignored`） | 留着无害，可删 |
| `-sMEMORY64=1` | emcc ≤5 必需；**6.x 弃用** | 6.x 改 `-m64` / `--target=wasm64` |
| `-sWASM_LEGACY_EXCEPTIONS` | 5.x 默认 `true`；6.x 需显式 | **按宿主上报值传**（见 §4.5） |

> ⚠️ 实测教训：**死旗标会让整条链静默失败**。建议 M0/M1 脚本里加一个 `--probe-flags`：
> 各旗标先编一个空 TU 探一次，不认识就跳过。

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

**反例（措辞已按实测更正）**：去掉 `-fwasm-exceptions` ⇒ **装得上、静态检查全过，跑到第一次
C++ throw 才炸**（未捕获 `WebAssembly.Exception`）。⇒ 判据**必须执行到运行期**，
"链接期无错"不算通过。（原版写的"必须装不上"是错的：加载器不拦这一档。）
⇒ 异常模型必须与宿主一致，这是硬要求不是优化。

### 4.5 旗标必须由宿主参数决定（**ABI 契约，四轴**）

工具链**不内置旗标表**，四轴全部由调用方传入，按 §4.1/4.2 拼装（两边各存一份表 ⇒ 必然漂移）：

```js
abi: {
  exceptions: 'none' | 'emscripten' | 'wasm-legacy' | 'wasm-standard',  // ★ 四档，不是三档
  pthread:    bool,
  memory64:   bool,
  hostTags:   string[],       // 宿主承诺导出的 tag，如 ['__cpp_exception']（见 §5.4）
}
```

**为什么异常是四档**：`-fwasm-exceptions` 在 emscripten 里还有 **legacy / standard** 之分
（6.x：`WASM_LEGACY_EXCEPTIONS` 默认 `true`，选 `libc++-mt-legacyexcept.a`；置 0 才走标准 wasm EH，
选 `-wasmexcept` 变体）。**两档的 tag 形态不同，混用装不上/跑不对**。
本仓现役宿主（emcc 5.0.7）走的是 **legacy** 档 ⇒ 工具链默认产 `wasm-legacy`。

**判据（替代"版本串必须相等"）**：真正必须一致的是**契约**，不是版本号——
四条（异常档 / pthread / memory64 / MAIN_MODULE 级）匹配即可，版本号只记档不拦。
实测支撑：**6.0.12 编的 `.oct` 能装进 5.0.7 构建的宿主**（见 §4.4 锚点）。
⇒ 宿主须上报上述四项（可从产物自带的 `octave.build.json` 类文件读）；**读不到就响亮报错并列出
候选**，不许默默选一个。

---

## 5. ⚠️ 符号契约（交付边界全在这）

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

   **判定口径（必须扣掉 side 自导出，否则报假缺口）**：
   ```
   gap = imports(side, mod='env') − exports(host.wasm)   ← 宿主真值：从 .wasm 的 export 表读，
                                                           不要只信 JSON 自称
                                 − exports(side, mod='env')  ← ★ 修正项
   ```
   为什么必须扣：`--export-dynamic` 让 side **既导入又导出**同一符号（GOT 自引用），
   而 emscripten 的 `resolveSymbol` 把 `moduleExports` 当合法解析源。
   实测口径差一个差集 ⇒ **2 vs 1**（假缺口）。**本项判定收进工具链**，下游各写一份必然漂。
   **tag 单列一类**（`__cpp_exception` 不是函数，混在函数缺口里会误导）。
   输出机器可读：`{ missingFunctions, missingTags, sideSelfExported }` + `--strict`（非空 ⇒ rc≠0）。

   ⚠️ 本仓的 `build/113/check-oct-host-symbols.mjs` 用的是**未修正口径**，待改（认领）。

4. **自包含模式：按缺口，不整体**（不是"链进整个 libc++"）。整体链是错路（§5.3：22 KB → 1.1 MB）。
   ```
   gap 为空        ⇒ 什么也不做（多数情况）
   gap 非空        ⇒ 只把缺口符号所在的归档成员按需链进产物（ld 支持）⇒ 体积只涨缺口那部分
   仍有 gap        ⇒ 响亮报错 + 点名
   ```

### 5.5 宿主符号契约（三条硬要求）

- **基线 = 宿主实际导出面**（从宿主 `.wasm` 的 export 表读），**不要**要求宿主另给"承诺清单"
  —— 那个数随 keep-list 变，必然过期（"两处口径"的老形状）。
- **tag 做成显式必带**，不依赖扫 `.oct` 导入：`__cpp_exception` + `__cxa_*` 五个
  **无条件进宿主 keep-list**。理由：靠扫描反推 ⇒ 漏扫一个 `.oct` 就退化成"装得上、跑到才炸"。
- **宿主 `MAIN_MODULE=2` 可行**（不必动 MM=1）：实测 MM=2 + 从 side 导入生成的 keep-list
  ⇒ 宿主导出含 tag、dlopen 全绿。但 keep-list 必须**显式含 tag 与 `__cxa_*`**。

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
- **sysroot 只带"实际用到的"文件，不要整份 `lib/`**。实测本仓容器里的构成：
  `include/` **23 MB**、`lib/wasm32-emscripten` **582 MB**、`lib/wasm64-emscripten` **4.5 MB**
  —— 而 582 MB 里绝大部分是 `.a` 变体（asan/debug/mt/ww 各 66 组），**side module 不链 `.a`**。
  ⇒ 只需：`crtbegin-mt.o` + `pic/` 里被 §4.1/4.2 实际读到的少量目标文件
  + §5.4 按缺口自包含要的 libc++ 成员。
  **另注（实测）**：`pic/` 与 `wasm64-emscripten/` **初始不存在**，要跑一次对应 target 才生成
  ⇒ 交付物必须**预生成**（浏览器里没有 emcc 可按需生成）；建议 **wasm32/wasm64 分两个 tar**，按需拉。
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
             abi:      { exceptions: 'none'|'emscripten'|'wasm-legacy'|'wasm-standard',
                         pthread: bool, memory64: bool },
             hostExports?: string[],        // 宿主实际导出面（§5.4 缺口检查）
             hostTags?:    string[],        // 宿主承诺的 tag（§5.5）
             flags, define, include })
     → { ok, moduleBytes | error, diagnostics,
         symbolGap: { missingFunctions, missingTags, sideSelfExported } }
   ```

5. **driver 策略**：**自己写薄驱动**（按 §4.1/4.2 拼 `-cc1` + lld 调用），
   **不要**移植整个 clang driver / `emcc.py`——driver 的价值是"猜旗标 + spawn 子进程"，
   这两件事在浏览器里都不需要/不可用。**旗标要按版本探针**（§4.2 的 `--probe-flags`）。

---

## 8. 版本与契约（最易翻车）

`crtbegin-mt.o`、`-L <SR>/lib/<target>-emscripten/pic`、libc++ 头、`__config_site`
**都来自 emscripten sysroot**。

**判据是"契约相等"，不是"版本串相等"**（v1 写的是后者，**过严**）：

| 必须匹配（拦） | 只记档（不拦） |
|---|---|
| 异常档（§4.5 四档之一）/ pthread / memory64 / MAIN_MODULE 级 | emscripten 版本号、LLVM 版本号 |

**实测支撑**：6.0.12 编的 `.oct` **能装进 5.0.7 构建的宿主**并正确调用（§4.4 锚点）
⇒ 版本号相等不是必要条件。

**manifest 要记两个版本串**：工具链版本 + 宿主基线版本；`compile()` 时**核对契约四项**，
不匹配 fail-closed（读不到宿主的契约值 ⇒ 响亮报错并列候选）。

- 实测教训：不同 emscripten 版本间，`-shared` 稳定性、符号处理、异常实现、**乃至旗标名**都变过
  （`-mllvm -wasm-enable-eh` 在 LLVM 24 消失；`-sMEMORY64=1` 在 6.x 弃用）。

---

## 9. 验收标准（每条可证伪）

1. **能编**：最小 C++ 源（含一个导出函数 + 一次 `std::string` 使用）→ 产出 side module。
2. **能装**：被 emscripten 主模块 `dlopen` 成功，符号可解析。
3. **能调**：调用导出函数返回正确；**且回调宿主符号**（如宿主数学库）也正确。
4. **异常**：产物内 C++ `throw` 被自己 `catch`；宿主抛的异常在产物侧也能被接住。
5. **反例（措辞已更正）**：异常模型改错（去掉 `-fwasm-exceptions`）**装得上、静态检查全过，
   跑到第一次 throw 才炸** ⇒ **判据必须执行到运行期**，"链接期无错"不算通过。
6. **模板**：用 `std::map`/`std::ostringstream` 这类**宿主体内未必实例化**的 STL ⇒
   要么跑对，要么**响亮点名缺哪个宿主符号**（不许静默 stub）。**报缺口时必须扣 side 自导出**
   （§5.4 口径），否则报假缺口。
7. **两档**：wasm32 与 wasm64 **都**过 1–6。
8. **纯客户端**：全程断网（除首次下载资产）也能完成一次编译；网络面板**无源码外发**。
9. **体积**：首拉 brotli ≤ 15 MB；给出逐资产体积表。
10. **可校验**：篡改任一资产字节 ⇒ 加载器**拒绝**（sha256 fail-closed）。
11. **★ 双版本回归**：同一份源码，用**两个 emsdk 版本**各编一次，断言**两个产物都能被同一宿主
    dlopen**。这是 §8「契约而非版本号」的**唯一硬证据**，也是宿主升级共存期的安全网。
    （本仓已测单向：6.0.12 产物 → 5.0.7 宿主 ✔；反向未验。）

---

## 10. 里程碑

- **M0**（原生手工命令跑通 §4 全链）—— ✅ **已完成、全绿**（wasm32 + wasm64 两档；
  符号解析 / 回调宿主符号 / 异常双向穿越 / STL 模板实例化全部正确）。
- **M1**：clang+lld 编成 wasm（先求能跑，不优化体积），浏览器里编出 §9.1 的产物。
  按 **6.0.12**，默认 `wasm-legacy` 档。
- **M2**：进程内驱动（无 fork），跑通 §9.2–9.4；Worker 化。
- **M3**：体积优化到 §6 预算；sha256 校验 + manifest + §5.4 符号缺口检查。
- **M4**：wasm64 档 + 契约四项核对；§9.11 双版本回归；发第一个 pin。

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

## 14. 给 M1 的现成情报（本仓实测，别重复踩）

- **性能预期 = 持平**：本仓用 5.0.7 vs 6.0.10 做过同源基准（dgemm/qsort/memcpy/byte-sum，
  交错 3 轮）⇒ **geomean 1.001，编译器红利 ≈ 0**。升 6.x 的价值是**紧跟上游的能力**，
  **不是提速**——别把 M1 当优化项目。
- **已知必踩的坑**：side module 的 **`_emscripten_tls_init` 必须显式导出**
  （`--export=_emscripten_tls_init`），否则宿主报 `TypeError: tlsInitFunc is not a function`。
  它来自 `crtbegin-mt.o`，**emcc 会自动做、裸链不会**。（§4.3 第 4 条 ✔ 已复现。）
- **宿主版本现状**：下游宿主容器是 **emscripten 5.0.7 / LLVM 23**，异常走 **legacy 档**，
  `MAIN_MODULE=2` + keep-list，导出 752 个函数。
- **跨版本兼容已单向验证**：6.0.12 编的 `.oct` → 5.0.7 宿主，dlopen + 调用全绿。

---

**给 agent 的第一条指令**：**M0 已完成（全绿）**，直接进 **M1**：按 **6.0.12** 做编译矩阵
（默认产 `wasm-legacy` 档异常），把 clang+lld 编成 wasm，先求"能跑不优化"。
**不要**先搭 CI、先写胶水、先优化体积；**不要**等宿主升级（那条是本仓的独立批次）。
