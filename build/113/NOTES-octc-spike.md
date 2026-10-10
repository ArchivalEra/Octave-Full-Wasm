# NOTES · 浏览器内自编 `.oct`（octc spike）—— 三条实验实测（2026-10-10）

> 定位：这是 **`?` 方向的第一批实测**，不是设计稿。三问：① 裸 clang+wasm-ld 编的 `.oct`
> 能否被现役 wasm Octave dlopen 并真调用；② 无 EH 编法能否装（对照）；③ Wasm EH 能否跨
> dlopen 边界工作。外加一条体积实测（实验②）。
> 全部在 **8768 实验站** 上做，**不碰 8761**；实验件用后已从站点移除（证据留在
> `/mnt/hdd/octave-wasm-build/octc-spike/`）。

---

## §0 结论（先看这里）

| # | 问题 | 结果 | 关键数字 |
|---|---|---|---|
| ① | 裸 `clang -c` + 裸 `wasm-ld -shared`（**不经 emcc**）编的 `.oct` 能否 dlopen+调用 | **✅ 成立** | `exist=3` / `which` 命中 / `miniprobe([2,3;1,4])=5` / `det([1,2;3,4])=-2` |
| ② | 无 `-fwasm-exceptions` 的编法（对照） | **❌ 装不上** | `LinkError: failed to load / Incompatible version` |
| ③ | Wasm EH（`-fwasm-exceptions`）跨 dlopen 边界 | **✅ 成立** | C++ throw 被接住 + Octave `error()` 也被接住 |
| 体积 | 浏览器内 clang+lld 工具链要下多少 | 见 §4 | wasm-clang 实测：**brotli 13.1 MB / gzip 18.2 MB**（LLVM 8；现代 LLVM 更大） |

⇒ **"客户端自己编 `.oct`" 这条路在本仓的现役产物上跑通了。** 唯一未验的是"把 clang 本身
搬进浏览器"（那是工具链仓的事，与 `.oct` ABI 无关——本批已把 ABI 这一侧的未知全部消掉）。

---

## §1 实验①：裸 clang + 裸 wasm-ld → dlopen 端到端

### 配方（**实测收敛出来的，五处缺一不可**）

```bash
E=/emsdk/upstream; SR=$E/emscripten/cache/sysroot
# ① 编译（裸 clang，不经 emcc）
$E/bin/clang --target=wasm64-unknown-emscripten --sysroot=$SR -fvisibility=default \
  <octave -I ...> -isystem $SR/include/compat \
  -fPIC -O2 -fwasm-exceptions -pthread -c foo.cc -o foo.o
# ② 链接（裸 wasm-ld，不经 emcc）
$E/bin/wasm-ld -mwasm64 -o foo.oct --strip-debug \
  --export=__wasm_call_ctors --export=_emscripten_tls_init --export-dynamic \
  --experimental-pic --unresolved-symbols=import-dynamic \
  -shared --shared-memory --no-stack-first \
  $SR/lib/wasm64-emscripten/pic/crtbegin-mt.o foo.o \
  -L$SR/lib/wasm64-emscripten/pic -L$E/emscripten/src/lib \
  -mllvm -wasm-enable-eh -mllvm -exception-model=wasm
```

固化脚本：`/tmp/bare-oct-w64.sh`（实验用；正式化时进工具链仓）。

### 五处踩坑（每一处都实测到具体报错）

| # | 缺什么 | 报错 / 现象 | 为什么 |
|---|---|---|---|
| 1 | `--sysroot` | `fatal error: 'cinttypes' file not found` | 裸 clang 没有 emscripten 的 sysroot 路径 |
| 2 | `-isystem $SR/include/compat` | `fatal error: 'xlocale.h' file not found` | emcc 默认注入的 compat 头目录（`-Xclang -iwithsysroot/include/compat`） |
| 3 | `-pthread`（编译期）+ `--shared-memory`（链接期） | `LinkError: mismatch in shared state of memory, declared = 0, imported = 1` | **w64 档主模块是 shared memory**（`-pthread`）⇒ side module 必须声明 shared |
| 4 | `crtbegin-mt.o` + `--export=_emscripten_tls_init` | `TypeError: tlsInitFunc is not a function` | 加载器要调 side 的 **TLS 初始化入口**；它由 `crtbegin-mt.o` 提供，且**必须导出**（emcc 自动做，裸链不会） |
| 5 | `--export-dynamic` | 产物被 GC 成 **527 B**、导出全没 | 没有它 ⇒ `Fminiprobe`/`Gminiprobe` 不进动态符号表 ⇒ Octave 找不到函数名 |

> ★ 第 3/4 条**与 `build/113/NOTES-threads.md` 的既有结论一致**（"side module 必须带
> `-pthread`，否则 `tlsInitFunc` 失败"）——本实验在**裸工具链**上把它复现了一遍，
> 并补上了"`crtbegin-mt.o` + 显式导出 `_emscripten_tls_init`"这个 emcc 隐式做的动作。

### 端到端结果（8768 实站，w64 档）

```
exist('miniprobe')            = 3
which('miniprobe')            = /usr/src/octave/m/oct/miniprobe.oct
miniprobe([2,3;1,4])          = 5      ← determinant() 回调了主模块的 LAPACK
miniprobe([1,2;3,4])          = -2     ← 第二次调用（非一次性侥幸）
```

---

## §2 实验②（对照）：无 `-fwasm-exceptions`

- 编法：与实验① 同，仅去掉 `-fwasm-exceptions`（编译期与链接期都去）。
- 结果：**装不上** —— `failed to load … Incompatible version or missing dependency? /
  LinkError`。
- 含义：**异常模型必须与主模块一致**（主模块是 `-fwasm-exceptions`）。这条与
  `build/113/build-oct.sh` 文件头写的一致（那里早写过"JS 式异常会引入只在胶水里的符号"）。
- 本实验**没有**测"JS 式异常"那一档（`-enable-emscripten-cxx-exceptions`）——不在本批范围。

---

## §3 实验③：Wasm EH 跨 dlopen 边界

夹具 `minithrow.cc`（真抛/真接 + `error()` 路径），同一配方编译（`-fwasm-exceptions`）。

| 分支 | 期望 | 实测 |
|---|---|---|
| `minithrow(0)` 不抛 | `no-throw` | `no-throw\|caught=0` ✅ |
| `minithrow(1)` C++ `throw std::runtime_error` | 本模块 `catch` 接住 | `caught:thrown-from-oct\|caught=1` ✅ |
| `minithrow(2)` Octave `error()` | 抛出、调用侧 `try/catch` 接住 | `caught:octave-error-from-oct\|caught=1` ✅ |

⇒ **Wasm EH 跨 side module 边界完全工作**（抛、接、错误传播三条都成立）。
这正是设计稿里标为"无专门证据、需 spike 验证"的那一条 —— **现在有证据了**。

---

## §4 体积实测（实验②：浏览器内 clang+lld 要下多少）

方法：把 **binji/wasm-clang**（浏览器内 clang+lld 的知名实现）的真实二进制拉下来，
用**与现役 octave.wasm 同一套压缩参数**（gzip -9 / brotli -q11）实测：

| 资产 | raw | gzip | brotli | brotli 比率 |
|---|---|---|---|---|
| `clang`（wasm） | 29.77 MB | 10.04 MB | **7.19 MB** | 0.242 |
| `lld`（wasm） | 18.59 MB | 6.40 MB | **4.65 MB** | 0.250 |
| `sysroot.tar` | 8.87 MB | 1.73 MB | **1.23 MB** | 0.138 |
| **合计** | **57.22 MB** | **18.17 MB** | **13.07 MB** | — |

- 参照：现役 `octave.wasm` 29.6 MB raw → gzip 6.75 / **brotli 4.47**（比率 0.239/0.158）。
- `sysroot.tar` 里**头文件只有 250 个 / 0.69 MB 未压缩** ⇒ 8.87 MB 里绝大部分是 **`.a` 静态库**，
  而 side module **不链 `.a`**（符号由主模块解析）⇒ **头文件那部分可忽略不计**。
- ⚠️ 这是 **LLVM 8**（wasm-clang 很老，WASI 向）。**现代 LLVM（23/24）的 clang wasm 更大**
  ——报告估 raw 35–60 MB。**本仓没有现成的"LLVM 23 clang→wasm"可量** ⇒ 这一格是**推断**，
  不是实测。要坐实须真去编一份（那是工具链仓的第一件事）。

### 待核（推断，别当实测）

1. 现代 LLVM（24）的 clang+lld→wasm 真实 raw 与压缩后体积。
2. 我们主模块 `MAIN_MODULE=1` + 强制带 libc++ 导出后体积涨多少（决定"用户代码符号"能否兜住）。
3. `wasm-opt -Oz` / LTO / 只留 wasm 后端能再压多少。

---

## §5 复跑方式

```bash
# 实验①/③（容器内编 + 8768 实站验）——固化脚本 + 夹具
sudo -E docker exec o113 bash /tmp/bare-oct-w64.sh /src/websrc/minioct.cc /src/octs-spike0/x.oct
# 把产物放进 8768 站点根，再用 harness 里的探针（_e2e-v4.mjs / _e2e-eh.mjs）跑
cd /mnt/hdd/octave-wasm-build/harness && node _e2e-v4.mjs http://127.0.0.1:8768/
# 体积
cd /tmp/sizes/wasm-clang && python3 -c "import gzip,brotli; d=open('clang','rb').read(); print(len(brotli.compress(d,quality=11)))"
```

## §6 与既有机制的接口（下一步怎么接）

- **与货架同形**：工具链仓 = 独立仓 + submodule pin + 货架条目（新增一种 kind，比如
  `toolchain`：入口 wasm + 依赖的 sysroot 包 + 版本串）。`catalog()`/`install()` 的**形状不用改**
  —— 仍是"读目录 → 按需 fetch → 校验 sha → 落地"，只是"落地"那步对工具链是注册成一个可调用的
  编译器，而不是 addpath 一个包目录。
- **`check-forge-catalog.py` 扩一条 R**：工具链条目也要过"货架档案 ↔ 站点字节"三方一致。
- **红线**：工具链**整体在 wasm 里跑**，浏览器只负责下载字节 —— 不许有服务端编译端点。
- **版本锁**：`crtbegin-mt.o` 与 `-L .../lib/<target>-emscripten/pic` 都取自**该档主模块同版本的
  emsdk**；工具链仓必须把 emsdk 版本与主模块 emsdk 版本**钉成同一个**（§1 第 3/4 坑就是跨版本的形状）。

---

## §7 追加实测：**符号契约**（2026-10-10 同日，纠 §4/§5 的一处错）

### 7.1 纠错：`.a` **不能**简单"去掉"

初版本文（§5）写过"sysroot 的 `.a` 可以不进交付物"。**该结论错误**，证据如下。

**错在数据**：我按**后缀**筛头文件，而 libc++ 的头（`vector`/`array`/`tuple`…）**没有后缀**，
全被漏掉。两个 sysroot 的真实构成：

| | 初版写的 | 实测 |
|---|---|---|
| wasm-clang(WASI) sysroot.tar 头文件 | 0.69 MB | **4.88 MB** |
| 同上 `.a` | ~8 MB | **3.52 MB** |
| emscripten sysroot `include/` | — | **23 MB** |
| emscripten sysroot `lib/` | — | **586 MB**（其中 `wasm32-emscripten` 582 MB、`wasm64-emscripten` 4.5 MB） |

而且当初量的是 **WASI sysroot（LLVM 8）**，与 emscripten 无关 ⇒ 拿它推 emscripten 结论不成立。

**错在结论**：用 STL 夹具 `needlib.cc`（`std::vector`+`std::map`+`std::ostringstream`）实测：

```
needlib([1])  →  dlopen **成功**、函数被调到，然后**运行期**炸：
   TypeError: resolved is not a function
   at stubs.<computed> (…/w64/octave.js)
```

`stubs` 是 emscripten 的**惰性符号解析器**（`loadWebAssemblyModule` 里的 `proxyHandler`）：

```js
stubs[prop] = (...args) => { resolved ||= resolveSymbol(prop); return resolved(...args) };
```

`resolveSymbol` 依序查 `wasmImports` → `localScope` → `moduleExports`；**都找不到就返回
`undefined`**，随后 `undefined(...args)` 抛 `resolved is not a function`。
⇒ **"装得上"与"跑得对"是两件事**：`--allow-undefined`/`import-dynamic` 让链接期静默放行，
缺口要到**首次调用**才暴露。

### 7.2 精确缺口（逐个核过，不是估）

`needlib-noa.oct`（不链 `.a`）需要宿主解析 **43** 个 `env` 符号；宿主
`siteWebGL/w64/octave.wasm` 共导出 **752** 个。差集 = **2 个**：

```
❌ _ZNSt3__26__treeI…__emplace_unique_key_args…   ← map<string,double> 的实例化
❌ _ZNSt3__213basic_ostreamIcNS_11char_traitsIcEEElsEm   ← ostream<<unsigned long
```

**根因 = 模板实例化**：宿主只导出**它自己用过**的实例化。`keep-w64.txt`（1304 条，其中 289 条是
libc++ 符号）就是宿主侧"手工钉住的导出面"。用户代码出现宿主未实例化过的模板组合 ⇒ 缺符号。

### 7.3 三条路的代价（实测）

| 做法 | 产物 | 结果 |
|---|---|---|
| 不链 `.a` | 22,910 B | 依赖宿主导出面；未实例化的模板 ⇒ 运行期炸 |
| **链 libc++ `.a`**（`libc++-mt-legacyexcept.a` + `libc++abi-mt-legacyexcept.a`） | **1,119,168 B**（+48×） | 拉进 **1270** 个导入、其中 **1204** 仍找不到 ⇒ 错路（把库整个拖进来） |
| 宿主补导出 / 改 `MAIN_MODULE=1` | 宿主体积涨 | 方向对（缺口只有 2 个），代价待量 |

### 7.4 结论（写进需求书的形态）

1. **头文件必须带**（emscripten sysroot `include/` 23 MB → 压缩后量级见 §5）。
2. **`.a` 不进交付包**（省 3.52 MB 级），**但前提是宿主承诺符号可解析** —— 这是**宿主/插件
   契约**，不是"能不能省磁盘"。
3. **工具链必须提供"符号解析失败"的响亮报错**（点名缺哪个符号），不许静默装 stub。
4. 提供**自包含模式**开关：把需要的 libc++ 目标文件链进产物（代价量级 20 KB → 1.1 MB），
   给"宿主导出面不可控"的场景用。

### 7.5 复跑

```bash
# 缺口检查器（读 .oct 的导入 vs 宿主导出，列差集）
node build/113/check-oct-host-symbols.mjs
# 夹具源
build/113/needlib.cc          # STL 用例
build/113/minithrow.cc        # EH 用例
# 产物留档
ls /mnt/hdd/octave-wasm-build/octc-spike/needlib-{noa,a}.oct
```
