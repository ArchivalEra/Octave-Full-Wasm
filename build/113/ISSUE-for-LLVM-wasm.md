# 04: 发布包把 sysroot 装成了 wasm32 那档 ⇒ 同一份包编不出可用的 wasm64 产物（下游实测）

> **对外件 —— 给 `ArchivalEra/LLVM-wasm` 的悬案**（按该仓 `questions/` 约定撰写，
> 可直接落成 `questions/04-release-ships-wasm32-sysroot-only.md`）。
> 提出方 = 下游宿主（Octave-Full-Wasm：真实 `MAIN_MODULE=2` 宿主，且**两条主线是 wasm64**）。
> 复核依据 = 该仓 `DELIVERY.md` §2 接入说明 + §3「`target='wasm64'` 也支持」，**按其说明实跑**。

**Status:** needs-triage

**Settling:** rc=0 ⇒ 发布包已含对应档 sysroot（`_hasCrt('wasm64')===true`）；rc=1 ⇒ 发布包仍只有 wasm32 档（`_hasCrt('wasm64')===false`、产物缺 TLS 入口）；rc=2 ⇒ `hasCrt=false` 时 `compile()` 没硬失败（静默返回装不上的模块）；rc=3 ⇒ 环境问题（宿主夹具装不上），不是结论。结算件尚未存在 —— **本工单的第一交付物就是造它**：扩 `driver/acceptance-wasm64.mjs` 一条（判据从"对象是 64 位"升级为"模块能装进 MM=2 宿主"）。

<!-- 上一行即 Settling 的机器可读形态（该仓闸门只取首行）；下面是同一条的人读展开：
     · 结算件 = driver/acceptance-wasm64.mjs 扩一条端到端判据
     · 为什么升级：现有断言只测"对象是 64 位"（:103），发布件 sysroot-headers.tar 从不经过它
-->

---

## 结论先说：**wasm64 本身是真支持的，缺口只在"发布时挑了哪份 sysroot"**

先把好消息说清楚，免得误判成"wasm64 不可用"：

| 实测 | 结果 |
|---|---|
| `package/out/sysroot-wasm32.tar` | 存在，含 `lib/wasm32-emscripten/pic/crtbegin-mt.o` |
| `package/out/sysroot-wasm64.tar` | **也存在**，含 `lib/wasm64-emscripten/pic/crtbegin-mt.o` ✓ |
| 用 **wasm64 tar** 编 wasm64 | `hasCrt('wasm64')=true`、`ok=true`、946 B |
| 该产物装进下游真宿主（MM=2 + wasm-legacy + pthread + memory64） | **`dlopen OK` ✓** |
| 用 **发布包**（内含 wasm32 tar）编 wasm64 | `hasCrt('wasm64')=false`、542 B、**导出里没有 `_emscripten_tls_init`** |
| 该产物装进同一宿主 | ✗ `TypeError: tlsInitFunc is not a function` |

⇒ `-mwasm64`、64 位对象、真宿主 dlopen **全通**。问题出在发布件把它关掉了。

## 缺口：`release/make-release.sh` 只装 wasm32 那份 sysroot

```sh
# release/make-release.sh
SYSROOT_TAR="$ROOT/package/out/sysroot-wasm32.tar"   # ← 硬编码单档
cp "$SYSROOT_TAR"               "$OUT/sysroot-headers.tar"
```

发布出的 `manifest.json` 据此写 `toolchain.targets_built: ['wasm32']`，注释理由是：

> `wasm64 tar not shipped in this bundle because its crtbegin is generated on demand (SPEC §6)`

**这句描述的机制在代码里不存在**：`driver/` 全文只有"**检查** crt 是否存在"
（`toolchain.mjs:117 _hasCrt`、`:118-120`），没有任何**生成**路径。
⇒ 实际行为：`hasCrt=false` ⇒ `driver/abi.mjs:172` 静默跳过 crt ⇒
`compile()` **仍返回 `ok:true`**，但产物缺 TLS 入口 ⇒ 下游 dlopen 才炸。

## 为什么这最坏：三个信号互相矛盾

1. `DELIVERY.md` §3 写 "`target='wasm64'` 也支持（同一个工具链）"；
2. `manifest.targets_built` 写 `['wasm32']`（自相矛盾）；
3. `compile({target:'wasm64'})` 返回 `ok:true`（既不报错、也不说降级）。

下游照 §3 用 wasm64、拿到 `ok:true`、然后在**浏览器里**撞 `tlsInitFunc is not a function` ——
症状完全不指向"包内少一个 crt 文件"。

现有 `driver/acceptance-wasm64.mjs` 抓不到这条：它读的是
`package/out/sysroot-${target}.tar`（两档都在）且只断言"对象是 64 位"（`:103`）——
**发布件 `sysroot-headers.tar` 从不经过这条验收**。

## 最小复现（本机可跑）

```sh
cd <this repo>
R=$PWD
# A) 错误姿势：用发布包（内含 wasm32 tar）
node -e "import('./driver/toolchain.mjs').then(async ({Toolchain})=>{
  const tc=new Toolchain({clangBin:'$R/release/out',clangJs:'clang.js',
    lldBin:'$R/release/out',lldJs:'lld-wasm-only.js',
    bundle:{tarPath:'$R/release/out/sysroot-headers.tar',
            manifestPath:'$R/release/out/manifest.json'}});
  const r=await tc.compile({source:'extern \"C\" int f(int x){return x;}',target:'wasm64',
    abi:{exceptions:'wasm-legacy',pthread:true,memory64:true}});
  console.log('hasCrt=',tc._hasCrt('wasm64'),'ok=',r.ok,'bytes=',r.moduleBytes.length);})"
#   ⇒ hasCrt= false ok= true bytes= 542     ← ok:true 但缺 TLS 入口

# B) 正确姿势：用 wasm64 那份 tar
node -e "import('./driver/toolchain.mjs').then(async ({Toolchain})=>{
  const tc=new Toolchain({clangBin:'$R/release/out',clangJs:'clang.js',
    lldBin:'$R/release/out',lldJs:'lld-wasm-only.js',
    bundle:{tarPath:'$R/package/out/sysroot-wasm64.tar',
            manifestPath:'$R/package/out/manifest-wasm64.json'}});
  const r=await tc.compile({source:'extern \"C\" int f(int x){return x;}',target:'wasm64',
    abi:{exceptions:'wasm-legacy',pthread:true,memory64:true}});
  console.log('hasCrt=',tc._hasCrt('wasm64'),'ok=',r.ok,'bytes=',r.moduleBytes.length);})"
#   ⇒ hasCrt= true  ok= true  bytes= 946     ← 这份能进真宿主 dlopen
```

判据（导出表）：前者 `['__wasm_call_ctors','f']`，后者另含 **`_emscripten_tls_init`** ——
就是这一个符号决定能否进线程档宿主。

## 建议修法（请你们选口径）

**口径 A（推荐）**：发布包**同时带两档 sysroot**，并由驱动按 `target` 自选（下游零配置）：

```
release/out/sysroot-headers.tar           → wasm32（保持向后兼容的默认）
release/out/sysroot-headers.wasm64.tar    → wasm64
```

**口径 B（改动更小，但下游要自行判断）**：维持单档发布，但既然
`manifest.targets_built` 已写 `['wasm32']` ⇒ **`compile({target:'wasm64'})` 必须硬失败**，
错误信息点名"本 bundle 未含 wasm64 sysroot"。

**无论选哪个，都请加这条反向断言（比上面两条更要紧）**：

```js
if (!this._hasCrt(target)) {
  return { ok: false, error: `sysroot for ${target} missing in this bundle` };
}
```

现在 `hasCrt=false` 会让 `ok:true` 的坏产物流到下游 —— 正是"声称支持 + 静默降级 +
自检全绿"的形状。

## 我们这边（下游）的现状与打算

- 我们的线划分（按本仓决定）：**`master` 线出 wasm64 产物、只编 wasm64；
  `wasm32-final` 线出 wasm32 产物、只编 wasm32**（8761 现役的 w64 档属 wasm64 侧）。
  ⇒ 若你们走**口径 A**，我们两线各取各的 tar，零特判；走**口径 B**，我们除 32 线外要
  自带 wasm64 tar（从你们 `package/out/` 取）—— 但那样每个下游都要自己搬一次，不如 A。
- 本仓工单：`.scratch/open-questions/issues/65-clang-wasm-toolchain-host-integration.md`
- 探针字节留在 `/mnt/hdd/octave-wasm-build/site/`（**试验件，非部署资产**）供复跑

## 附：我上一版归因有误，此处更正

上一版把缺口 1 归因成"驱动忘了传 `-D__EMSCRIPTEN_SHARED_MEMORY__=1`"。**那个归因是错的**：
真因是**发布包内含的是 wasm32 档 sysroot ⇒ 不含 wasm64 的 crt ⇒ 没有 TLS 定义**。
（那个宏在 `m0/run-m0.sh:43` 有、`driver/abi.mjs` 无 —— 属实，但**不是**本症状的因；
是否补它，与本次缺口正交，你们自定。）
