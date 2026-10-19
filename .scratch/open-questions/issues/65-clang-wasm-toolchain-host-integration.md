# 65 · clang-wasm 工具链 ↔ 本仓宿主的接入缺口（DELIVERY §4 的实测复核）

**Status:** resolved
（2026-10-19，用户点令「那就干」—— 重链落地并全量验绿，结案。判据与过程见下方「结案判据全部翻面」段。）
**结案判据全部翻面（实测）**：
- `probe-toolchain-gap` **rc=2 → rc=0**（两模块 dlopen OK 且 `probe_f(22)==22`）；
- `accept-compile-extension` **16/0**，其中 C2c/C8e 从"如实记边界"**翻成硬绿**：
  `cell2cell({1,2},1)=1x1`、`partint(4)` 不变式成立（PARTINT_OK=1，5x4 分拆矩阵）；
- 8768 全量 `PROBES=1` 96 套 / 1576 PASS / 0 FAIL；8761 promote verify 全绿
  （w64 `c994bdad…` / w64-base `35ef50dc…`，台账同步）。
**落地三件**：
1. `-6012` 车道全套重链（keep-6012-* 补 7 条 typeinfo + link-web 新增 `TI_TYPEINFO_FLAGS`
   = `-Wl,-u,_ZTIi` **强引用** + export-if-defined 成对 ×7 —— 实测光靠 keep 的
   export-if-defined 拦不住 DCE：树代码不 import 基本类型 typeinfo ⇒ 归档成员被删 ⇒
   符号不存在 ⇒ 静默忽略，§7.4 同形状的放大版）；
2. ★ C2c 真根因**不是** typeinfo（旧推断被本批证伪）：**Octave 头按档分叉** ——
   wasm32 树 `mxtypes.h` 的 `mwSize/mwIndex=int32_t` vs wasm64 树 `int64_t`
   （`f77-fcn.h` 同分叉）。octinc 之前只供 wasm32 树的头 ⇒ 索引宽度错位 ⇒
   "Invalid resizing operation"。修：provision 按**目标档**供两份头
   （octave-headers.tar.gz / octave-headers.wasm64.tar.gz，含"两份必须真分叉"的反向断言），
   worker/本地台按 target 选。
3. purity 回退格修正：w64-base 无专属 .oct 目录是设计形状（现役 8761 同样没有），
   既存误报已修（自证 10/0：回退格空目录不报 / 产品格仍零值守卫 / 回退格有 .oct 仍判架构）。
**重链批实录（2026-10-19）**：
- 第一轮 `relink.sh link w64`（默认 keep-w64.txt，已含 7 条）被**保活闸门**拦：
  `★ 新缺导出: _Unwind_CallPersonality ← __bfgsmin.oct 等 5 个`。追因 = **NOTES-emsdk-upgrade
  §7.3/§7.5 的已知 ABI 演进缺口**：现役扫描目录（octs-w64*/）的 `.oct` 是 clang 23 编的
  （import 旧名 `_Unwind_CallPersonality`），6.0.12 主模块只有新名 `__gxx_wasm_personality_v0`
  （libunwind wasm64 实测**零库定义**旧名；emscripten 源码 grep 亦无）。
  SOP 修法 = 连 `.oct` 车道一起用 6.0.12 重编 ⇒ 走 `LANE_TAG=-6012` 全套（octs-6012-w64
  17 个 + octs-6012-w64-pkg 27 个 = 6.0.12 新代，已盘点在容器）。
- 补齐：keep-6012-w64.txt / keep-6012-w32.txt / keep-6012m-w64.txt 各 +7 条 typeinfo
  （工单的追加当时只补到 keep-w64.txt/keep.txt 两个现役文件，**漏了 -6012 系**——
  这正是"追加知识要覆盖全部 keep 产地"的教训）。
- 第二轮被**前缀守卫**拦（正确）：`-6012` 树需 `octave-install-6012-w64` 前缀重建
  （防"链得过但 help 坏"的工单 28 同族盲区）⇒ `rebuild w64 --out /src/websrc/w64-6012-out`
  执行中（全树重配+重编）。
- 容器脚本漂移一并修：relink.sh / link-web.sh / check-oct-imports.py 的容器拷贝是旧版
  （LANE_TAG 的 -w64 新形状没有）⇒ docker cp 同步，relink 自证 23/0。
**进展（2026-10-17，LLVM-wasm mail/026 归属答复后）**：判 **A**（支持基本类型 throw）——
`_ZTIi` 是任何正确编译器对 `throw 42` 的必然产物（emcc 官方路径同样）、定义在宿主 sysroot
的 `libc++abi-mt-legacyexcept.a`（D 段实测在）、`__cxa_*` 同族先例已导出。LLVM 信里的
第三种情况成立：两边今天都不存在这个定义、现役生态零使用（11,663 个 .oct 全量 = 0）。
**已落**：keep 生成器追加 7 条基本类型 typeinfo（+容器内现役 keep-w64.txt/keep.txt 同步补 7 条）；
**待做 = 重链**（keep 只在终链消费；无真实用例不急于本批 —— ready-for-human 的含义：
终链重链与否是产品决定）。
**为什么 needs-info**（2026-10-16）：缺口 1 已修并复验；缺口 2（`_ZTIi`）仍开，
且**归属待邻仓确认**（宿主 keep-list 加 ／ 工具链把 typeinfo 打进 side module）—— 见文末 §实测复核。
**Settling:** `sh test/browser/run.sh test/browser/probe-toolchain-gap.mjs <URL> <模块目录>` —— rc=0 ⇒ 两条缺口都已修（两模块 dlopen + `probe_f(22)==22`）；rc=1 ⇒ 缺口 1（TLS）仍在；rc=2 ⇒ 缺口 2（typeinfo `_ZTIi`）仍在；rc=3 ⇒ 环境问题（页面没起来 / 夹具缺失）。**结算件已存在**（2026-10-16 造）；
**当前判决 = rc=2**（见下 §实测复核）。
⚠️ **夹具编在 `/tmp`，机器重启就丢**（2026-10-19 实测：断电后 sweep 里本探针报 rc=3
NO-SUMMARY，看着像回归、其实是环境 —— rc 契约设计正确，它明说了是环境不是缺口）。
重造用 §复跑 里那条 `node -e` 命令（生产者 `Toolchain` + **per-arch sysroot**）。

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


---

## ★ 实测复核（2026-10-16，结算件已造 + 实跑）

**结算件 = `test/browser/probe-toolchain-gap.mjs`**（本工单的第一交付物，已落）。
复跑（**必须 per-arch sysroot** 编夹具，见下）：

```bash
# 编夹具（**per-arch 形态**：单 tar 会被驱动 precheck 拒 —— 那是 issue #1 之后的正当行为）
cd /mnt/hdd/zcode-projects/LLVM-wasm && R=$PWD/release/out
node -e "import('./driver/toolchain.mjs').then(async ({Toolchain})=>{
  const tc=new Toolchain({clangBin:'$R',clangJs:'clang.js',lldBin:'$R',lldJs:'lld-wasm-only.js',
    bundle:{tars:{wasm32:{tarPath:'$R/sysroot-headers.tar',manifestPath:'$R/manifest.json'},
                  wasm64:{tarPath:'$R/sysroot-headers.wasm64.tar',manifestPath:'$R/manifest.json'}}}});
  const fs=require('fs');
  for (const [n,src] of [['throw','extern \"C\" int probe_f(int x){ if(x<0) throw 42; return x; }'],
                         ['nothrow','extern \"C\" int probe_f(int x){ return x; }']]) {
    const r=await tc.compile({source:src,target:'wasm64',abi:{exceptions:'wasm-legacy',pthread:true,memory64:true}});
    if(r.ok) fs.writeFileSync('/tmp/p-'+n+'.oct',Buffer.from(r.moduleBytes));
  }})"
# 跑判据（宿主 = 8761 的 w64 档）
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm
sh test/browser/run.sh test/browser/probe-toolchain-gap.mjs http://127.0.0.1:8761/ /tmp
```

### 结果：**缺口 1 已修（复验通过）** / **缺口 2 仍开**

```
── ① 不带 throw（p-nothrow.oct）—— 只看缺口 1（TLS 入口）──
   lane=w64 dlopen=OK probe_f(22)=22 err=null          ← ✅ 缺口 1 消
── ② 带 throw（p-throw.oct）—— 走缺口 2（typeinfo）──
   lane=w64 dlopen=null err=Cannot read properties of undefined (reading 'value')   ← ❌ 缺口 2 仍在
=== rc 2 ===
```

**缺口 1 为什么是"已修"（两处独立证据）**：
1. **形态变了**：驱动现在**拒绝**用单 tar 编 wasm64（`Refusing rather than linking a module
   without the TLS init entry`）—— 即本工单建议的"响亮失败"方向已被邻仓采纳（v0.1.1，
   见 `build/113/ISSUE-1-verify-comment.md` 的下游复验）。**per-arch sysroot 是正确用法**：
   `{tars:{wasm32:…,wasm64:…}}` ⇒ 模块带上了 `_emscripten_tls_init`（`llvm-readobj` 实测 1 个）。
2. **端到端**：新编 nothrow 模块在 8761 w64 宿主上 **`dlopen=OK` 且 `probe_f(22)==22`**
   （真调用，非"装上了"）。⇒ 本工单缺口 1 **结案（已修）**。

**缺口 2 为什么仍开**（判据两条，都是本轮实测）：
- `build/113/check-oct-imports.py` 对**新编的** throw 探针：`★ 新缺导出: _ZTIi`（宿主 750 导出里没有）；
- 浏览器侧 `dlopen` 报 `reading 'value'`（= 本仓 NOTES 记录的 `reportUndefinedSymbols()` 形态）。

**⇒ 归属待邻仓确认（`needs-info` 的由来）**：工单原列两口径 —— (a) 宿主 keep-list 加基本类型
typeinfo（只对自家宿主有效）／(b) 工具链侧把 typeinfo 定义打进 side module（下游零改）。
**本轮实测偏向 (b) 的可行性待定**：`throw 42` 会引用 `_ZTIi`（int 的 typeinfo），它是
**libc++abi 的一部分**，而 side module 用 `--unresolved-symbols=import-dynamic` 把它**留给宿主**。
要 (b) 成立得确认 wasm/emscripten 下 `_ZTIi` 的定义能否静态进 side（`-fno-rtti` 会改 ABI 语义 ⇒ 需邻仓判断）。
**⇒ 请邻仓确认口径**（这是 `needs-info`，不是缺证据）。

### 夹具注意事项（本轮踩到，写给下次）

- **导出名必须与文件名对应**（`Octave` 按「函数名.oct」找模块）：夹具导出的符号名要能被消费侧
  按预期取到 —— 本轮第一版导出 `f` 而不是 `probe_f`，`exist==3` 但调用报 `undefined`。
- **取导出的正确姿势**（实测）：`loadDynamicLibrary` 返回**布尔**（不是模块实例）；
  导出在**第三个参数 `localScope`**（`{global:false}` 时 emscripten 把 `dso.exports` 赋进它）。
  `global:true` 走 `mergeLibSymbols`（本构建下取不到 `probe_f`）。
- **一个模块 = 一次全新页面**（工单原纪律，本轮结算件照做）。
