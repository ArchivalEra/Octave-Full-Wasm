# 65 · clang-wasm 工具链 ↔ 本仓宿主的接入缺口（DELIVERY §4 的实测复核）

**Status:** ready-for-agent
**Settling:** node test/browser/probe-toolchain-gap.mjs <URL> <模块目录> —— rc=0 ⇒ 两条缺口都已修（模块 dlopen 成功且 probe_add(20,22)==42）；rc=1 ⇒ 缺口 1（TLS `_emscripten_tls_init` 未定义）仍在；rc=2 ⇒ 缺口 2（基本类型 typeinfo `_ZTIi` 不可解析）仍在；rc=3 ⇒ 环境问题（宿主自带 w64 夹具都装不上 / 页面没起来），不是缺口结论。结算件尚未存在 —— **本工单的第一交付物就是造它**（四条判据已按上表写在工单里）。

## 背景

邻仓 `/mnt/hdd/zcode-projects/LLVM-wasm` 交付（`DELIVERY.md`，2026-10-12），
其 §4「宿主侧必须承诺的」列了三条。**按它的接入说明实跑一次**，三条里两条已满足、
但发现**两条驱动侧缺口**（工具链自己的 M0 手工路径能过，走驱动 `compile()` 不能过）。

## 已满足（实测）

| DELIVERY §4 要求 | 本仓实测 |
|---|---|
| ① 宿主导出面基线可读 | 四条产物的 `_cpp_exception`/`__cxa_*` 全在（IP-w64 750 导出 / w64-base 719 / master-w64 749 / w32-product 714，**无缺**） |
| ② tag + `__cxa_*` 进 keep-list | `keep-6012-w64.txt` 与 `keep.txt` 各含 8 条（`__cpp_exception` / `__cxa_begin_catch` / `__cxa_throw` …） |
| ③ `MAIN_MODULE=2` 可行 | 现役四档全是 MM=2，dlopen 正常（w64 档自带 `minioct.oct`/`dldprobe.oct` 实测 `dlopen OK`） |

## 缺口 1：驱动没传 `-D__EMSCRIPTEN_SHARED_MEMORY__=1`

**症状**：`compile({target:'wasm64', abi:{pthread:true, memory64:true}})` 产出的模块，
`dlopen` 报 `TypeError: tlsInitFunc is not a function`（本仓 `check-oct-lane.py` 记录的
正是这个符号——线程档 side module 必须带 TLS 初始化入口）。

**定位（差分实测）**：
- 邻仓 `m0/build-wasm64/minifn.so`（**手工 em++ 路径**）导出 `_emscripten_tls_init` ✓
- 走 `driver/toolchain.mjs` 的 `compile()` 编出的模块**不导出**（`--export=_emscripten_tls_init`
  确实传了，但符号不存在 ⇒ 是**没定义**，不是没导出）
- 两边的 clang 命令行差一处：`m0/run-m0.sh:43` 有 `-D__EMSCRIPTEN_SHARED_MEMORY__=1`，
  `driver/abi.mjs` 全线没有这个宏

## 缺口 2：基本类型 typeinfo（`_ZTIi` 等）不在宿主导出面

**症状**：模块里只要有 `throw 42;`（int 抛出），`dlopen` 报
`TypeError: Cannot read properties of undefined (reading 'value')`
（= 本仓 NOTES 记录过的「加载器 `reportUndefinedSymbols()` 读 `undefined.value`」形态）。

**定位**：`check-oct-imports.py` 实扫该模块 ⇒ 唯一不可解析导入 = `('GOT.mem', '_ZTIi')`；
本仓 w64 宿主有 40 条 `_ZTI*`（全是 Octave 自己的类型：`_ZTI10boolMatrix` 等），
**缺基本类型**（`_ZTIi` / `_ZTId` / `_ZTIc` / `_ZTIb` / `_ZTIf` 实测全 False）。

**注意（避免误判为回归）**：本仓现役 44 个 `.oct` **没有一个**导入基本类型 typeinfo
⇒ 对**今天的 Octave 宿主**无影响；这是**面向下游第三方 .oct** 的缺口。

## 最小复现（可复跑）

```sh
# ① 编两个探针（一个带 throw、一个不带）
cd /mnt/hdd/zcode-projects/LLVM-wasm
R=$PWD/release/out
node -e "import('./driver/toolchain.mjs').then(async ({Toolchain})=>{
  const tc=new Toolchain({clangBin:'$R',clangJs:'clang.js',lldBin:'$R',lldJs:'lld-wasm-only.js',
    bundle:{tarPath:'$R/sysroot-headers.tar',manifestPath:'$R/manifest.json'}});
  const fs=require('fs');
  for (const [n,src] of [['throw','extern \"C\" int f(int x){ if(x<0) throw 42; return x; }'],
                         ['nothrow','extern \"C\" int f(int x){ return x; }']]) {
    const r=await tc.compile({source:src,target:'wasm64',abi:{exceptions:'wasm-legacy',pthread:true,memory64:true}});
    if(r.ok) fs.writeFileSync('/tmp/p-'+n+'.oct',Buffer.from(r.moduleBytes));
  }})"

# ② 放进站点 → 浏览器 dlopen（宿主 = 8761 的 w64）
#    预期：throw 版 ⇒ reading 'value'；nothrow 版 ⇒ tlsInitFunc is not a function
#    对照：w64 档自带 minioct.oct / dldprobe.oct ⇒ dlopen OK ✓
```

## 建议修法（供邻仓选择）

1. **缺口 1**：`driver/abi.mjs` 的 compile 旗标在 `abi.pthread` 为真时补
   `-D__EMSCRIPTEN_SHARED_MEMORY__=1`（与 `m0/run-m0.sh:43` 对齐）。**一行**。
2. **缺口 2**：两种口径，选一并写进 DELIVERY §4：
   - (a) 宿主侧承诺：keep-list 加入基本类型 typeinfo（本仓可加，但只对自家宿主有效）；
   - (b) 工具链侧：驱动把 `-fno-rtti` 或 typeinfo 定义打进 side module（下游零改）。
   倾向 (b) 更符合「宿主只承诺导出面」的分工，但需邻仓确认 wasm/emscripten 下
   `_ZTIi` 的定义来源（libc++abi？）。

## 事实纪律

- 本工单所有数字都是本轮实测；`probe-wasm64.oct` / `probe-nothrow64.oct`（562–1156 B）
  仍在 `/mnt/hdd/octave-wasm-build/site/` 与 `site-6012-w32/` 供复跑（**试验件，非部署资产**）。
- ⚠️ 复跑时**每次用全新页面**：同一页连续 `loadDynamicLibrary` 两次会因加载器状态
  给出不一致结果（本轮先踩到：第二次误报 OK）。
