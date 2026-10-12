# 04: 驱动 `compile()` 产出的 side module 进不了 MM=2 真宿主（两条缺口，本仓实测）

> **对外件 —— 给 `ArchivalEra/LLVM-wasm` 的悬案**（按该仓 `questions/` 约定撰写，
> 可直接落成 `questions/04-driver-host-contract-gap.md`）。
> 提出方 = 下游宿主（Octave-Full-Wasm，真实 `MAIN_MODULE=2` + `wasm-legacy EH` + `pthread` 宿主）。
> 复核依据 = 该仓 `DELIVERY.md` §4「宿主侧必须承诺的」与 §2 接入说明，**按其说明实跑**。

**Status:** needs-triage

（提出方 = 下游宿主 Octave-Full-Wasm；这是外部缺口报告，未见重复。）

**Settling:** `<落进你们仓后的复现脚本，建议 m0/ 或 driver/ 下新建>` —— rc=0 ⇒ 两条缺口都已修
（模块 dlopen 成功且 `f(20)==20` 调得通）；rc=1 ⇒ 缺口 1（TLS `_emscripten_tls_init` 未定义）仍在；
rc=2 ⇒ 缺口 2（基本类型 typeinfo `_ZTIi` 不可解析）仍在；rc=3 ⇒ 环境问题（宿主自带夹具都装不上
/ 页面没起来），不是缺口结论。**结算件尚未存在 —— 本工单的第一交付物就是造它。**

## 先报好消息：DELIVERY §4 的三条宿主承诺，本仓全部满足（实测）

| §4 要求 | 实测 |
|---|---|
| ① 宿主导出面基线可读 | 四条产物导出 **750 / 719 / 749 / 714** 条（w64 现役 / w64-base / wasm64-NEXT / wasm32），`__cpp_exception` 与 `__cxa_*` 系（9–10 条）**全在**，无缺 |
| ② tag + `__cxa_*` 进 keep-list | `keep-6012-w64.txt` / `keep.txt` 各含 **10** 条（`__cpp_exception`、`__cxa_begin_catch`、`__cxa_throw`、`__cxa_end_catch`…） |
| ③ `MAIN_MODULE=2` 可行 | 四档全为 MM=2，dlopen 正常（`minioct.oct` / `dldprobe.oct` 实测 `dlopen OK`） |

⇒ §4 那三条**不是**本次的阻塞点。

## 阻塞点：走驱动编出来的模块，装不进这个宿主

**最小复现**（本机可跑，两个探针各 562–1156 B）：

```sh
cd /mnt/hdd/zcode-projects/LLVM-wasm
R=$PWD/release/out
node -e "import('./driver/toolchain.mjs').then(async ({Toolchain})=>{
  const tc=new Toolchain({clangBin:'$R',clangJs:'clang.js',lldBin:'$R',lldJs:'lld-wasm-only.js',
    bundle:{tarPath:'$R/sysroot-headers.tar',manifestPath:'$R/manifest.json'}});
  const fs=require('fs');
  const srcs={
    throw_v:  'extern \"C\" int f(int x){ if(x<0) throw 42; return x; }',
    nothrow:  'extern \"C\" int f(int x){ return x; }',
  };
  for (const [n,src] of Object.entries(srcs)) {
    const r=await tc.compile({source:src,target:'wasm64',
      abi:{exceptions:'wasm-legacy',pthread:true,memory64:true}});
    if(r.ok) fs.writeFileSync('/tmp/p-'+n+'.oct',Buffer.from(r.moduleBytes));
  }})"
```

然后把它扔进本仓现役 w64 宿主（`http://127.0.0.1:8761/` 的页面里
`Module.loadDynamicLibrary(<字节>, {loadAsync:false})`）：

| 模块 | 结果 |
|---|---|
| `throw_v`（含 `throw int`） | `TypeError: Cannot read properties of undefined (reading 'value')` |
| `nothrow`（无 throw） | `TypeError: tlsInitFunc is not a function` |
| 对照：宿主自带 w64 夹具 | `dlopen OK` ✓ |

⚠️ **测法注意（先踩到过）**：同一页面连续 `loadDynamicLibrary` 两次，加载器内部状态会让
结果不一致（我们第一次据此把真失败误判成 OK）。**一个模块 = 一次 `page.goto`。**

## 缺口 1：驱动没传 `-D__EMSCRIPTEN_SHARED_MEMORY__=1`

**症状**：`tlsInitFunc is not a function` —— 这是 emscripten dlopen 线程档 side module 的
标准症状，含义是**模块没有 TLS 初始化入口**（本仓 `check-oct-lane.py` 专门守这条，
本仓 44 个 `.oct` 每个都导出 `_emscripten_tls_init`）。

**差分定位（不是推断）**：

| 路径 | 导出 `_emscripten_tls_init`？ |
|---|---|
| `m0/build-wasm64/minifn.so`（你们**手工 em++** 路径） | **是** ✓ |
| `m0/build-mm2/minifn.so` | **是** ✓ |
| 走 `driver/toolchain.mjs` 的 `compile()` | **否** ✗ |

两边链接行**都**有 `--export=_emscripten_tls_init`（`driver/abi.mjs:167` 确实传了）
⇒ 说明该符号**根本没被定义**，不是没导出。
clang 命令行只差一处：`m0/run-m0.sh:43` 有

```
-D__EMSCRIPTEN_SHARED_MEMORY__=1
```

而 `driver/abi.mjs` 全文件没有这个宏。

**建议修法**：`driver/abi.mjs` 的 compile 旗标在 `abi.pthread` 为真时补上该宏
（与 `m0/run-m0.sh:43` 对齐）。**一行。**

**为什么你们自己的验收没抓到**：`browser/build-host.sh:28` 的闭环宿主是
`-sMAIN_MODULE=1`（宽松，靠 `--export-dynamic` 兜底）；`MAIN_MODULE=2` 的宿主
（本仓这种，也是 SPEC §4.3 明确点名要走通的形态）才会把这条暴露出来。

## 缺口 2：基本类型 typeinfo（`_ZTIi` 等）宿主不提供

**症状**：模块里只要有一个 `throw 42;`（抛 `int`，即需要 `_ZTIi`），dlopen 就报
`reading 'value'`（正是 emscripten 加载器 `reportUndefinedSymbols()` 读 `undefined.value`
的形态 —— 它不会告诉你缺哪个符号）。

**定位**：扫该模块的导入段 ⇒ **唯一**不可解析项 = `('GOT.mem', '_ZTIi')`。
本仓 w64 宿主有 40 条 `_ZTI*` 导出，但**全是 Octave 自家的类型**
（`_ZTI10boolMatrix`、`_ZTI12ColumnVector`…），**基本类型一个都没有**：

| 符号 | 宿主有？ |
|---|---|
| `_ZTIi`（int） | 否 |
| `_ZTId`（double） | 否 |
| `_ZTIc`（char） | 否 |
| `_ZTIb`（bool） | 否 |
| `_ZTIf`（float） | 否 |

**重要限定（避免过判）**：本仓**现役 44 个 `.oct` 没有一个**导入基本类型 typeinfo
⇒ **对今天的 Octave 宿主无影响**。这条只挡**下游第三方**用本工具链编的 `.oct`。

**建议修法（二选一，请你们定，并写进 DELIVERY §4）**：

- **(a) 宿主侧承诺**：keep-list 加入基本类型 typeinfo。本仓可以加，但只对自家宿主有效，
  每个下游都要各自踩一遍 ⇒ 不推荐。
- **(b) 工具链侧**：驱动把 typeinfo 定义打进 side module（下游零改）。**倾向这条** ——
  更符合「宿主只承诺导出面」的分工。需要你们确认 wasm/emscripten 下 `_ZTIi` 的定义
  来源（libc++abi？还是得靠 `-frtti` + 显式实例化）。

## 我们这边的对应件

- 本仓工单：`.scratch/open-questions/issues/65-clang-wasm-toolchain-host-integration.md`
- 探针字节（562–1156 B）留在 `/mnt/hdd/octave-wasm-build/site/` 与 `site-6012-w32/`
  （**试验件，非部署资产**）供双方复跑
- 复核时用的宿主：本仓 8761 现役 w64 档（`MAIN_MODULE=2` + `wasm-legacy` + pthread + memory64）
