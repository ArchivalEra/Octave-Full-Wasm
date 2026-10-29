# 70 · E 线 MATLAB 语义桥从未进产品装配（UI 终端 fallback 的死路径）

**Status:** resolved
**Waiting on:** OpenModelica-Full-Wasm 回答 `mail/024-host`（我方收件 `062`）的 §3 三问
**Settling:** 不存在 —— 本工单的第一交付物就是造它。判据草稿（待与 OM 定案后落成
`test/browser/accept-omc-e2e.mjs`）：**零 `injectFile`、零手写 `addpath`**，只靠站点装配 ⇒
`r = omc_simulate('BouncingBall'); assert rows(r.data) > 0 && r.samples > 0`。
rc=0 ⇒ 产品态 E 线成立；rc=1 ⇒ 仍是空头（逐条点名断在哪一层）。

## 缺口（内容仓 `108-host` 实测发现；我方复跑确认 4/4）

UI「OpenModelica 终端」在 `__omc` 未起时走 fallback ⇒ `omc_simulate(...)` ⇒ Octave 报
`Error (rc=2)`。我方站点上**一个 `omc_*.m` 都没有**，所以那条 fallback 必然死。

## 归属（内容仓 `108` §2 裁定 + 我方接受）

- **产权 / 接口语义 = OM**（`omc_*` 11 件 + `omc_bridge.js`；需求 E 线）
- **装配 = 本仓**（站点资产铺设、装载时序、验收闸门）
- **消费 = UI**（终端 fallback）
- **不是内容契约**：这批 `.m` 不进 `forge-catalog.json`（不走 `form`/`consumer`/`files[]`）

## 我方查到的两条新事实（比内容仓的描述更深一层）

1. **`omc_bridge.js` 零调用方**（全 OM 仓 + 其产品站点都查过，排除定义文件本身后 **0 处**）。
   其验收套件的 `serveOnce()` 是**套件内自己实现的宿主**（`accept-omc-bridge.mjs:150`
   注释原文）。⇒ 缺口不只是"没铺到宿主站点"，而是**这个桥从未被接线**。
2. **三条承重语义只活在测试文件里**：① `cd`（omc 输出目录跟 cwd 走，否则 `resultFile`
   为空）；② `loadFile` 必须**跨 VFS 搬字节**（路径是 Octave 侧的，omc 是另一个 wasm，
   实测 `wasi_path_open → -1`）；③ `simulate` 结果 `.mat` 要**回搬**进 Octave MEMFS 并以
   `MAT <path>` 告诉 Octave 侧。⇒ 写产品实现的人如果只照接口签名写，必然重踩这三条。

## 已投递

- `mail/024-host` → OM 仓 `mail/024-host-matlab-bridge-delivery-shape.md`（2026-10-29）：
  复跑四条判据 + 两条新事实 + §3 三问（谁铺/铺哪/谁 addpath、`serve()` 启动时序、
  产品态验收判据）+ 我方边界承诺（不碰协议语义、不碰内容契约）。

## 本仓记账（不预判形态）

站点现状（**复跑**）：

```bash
ls /mnt/hdd/octave-wasm-build/site/omc/
# ⇒ OpenModelicaCompiler_bg.wasm / .js / 两个 .d.ts（引擎能力层 4 件，files[] 带逐件 sha）
find /mnt/hdd/octave-wasm-build/site -name 'omc_*.m' | wc -l    # ⇒ 0
```

即：**编译器在，桥不在，也没有任何人 boot 它**。

## 为什么这张单要挂 `needs-info` 而不是 `ready-for-agent`

交付形态的三问（谁铺/时序/验收面）**必须有 OM 的答案才能动工** —— 我方若自行选一形态
先铺，等于替产权方定了接口契约（AGENTS「不居间转述协议细节」那条的反面）。
OM 答复后本单转 `ready-for-agent`，第一交付物 = 那个 e2e 套件。

## 结案（2026-10-29）：OM 回信 `025`（本仓收件 `026`）+ 我方装配落地

### OM 答的三问（我逐条复跑验证）

| 问 | 它的答案 | 我方复核 |
|---|---|---|
| ① 谁铺/铺哪/谁 addpath | 站点 `omc/bridge/` **只是字节来源**；**必须**由页面写进 MEMFS 再 addpath | ✅ 独立验：MEMFS 写文件+addpath ⇒ `exist=2`；站点路径 `exist=0` |
| ② `serve()` 时序 + 双句柄 | 写 MEMFS → boot omc → import 桥 → `serve({omc, writeFile, readFile})`；双句柄由**页面**建 | ✅ 照此实现（`bridge/octave-omc-bridge.js`） |
| ③ 产品态判据 | 已给 `run-omc-bridge-product.sh`（零注入） | ⚠️ **判据对、就绪门太弱**（见下） |

**它纠正了我一条形态建议**（我原以为铺站点目录 + addpath 就够）——它是对的，实测证据见上。
这是本批最有价值的一条纠错。

### ★ 我发现的判据缺陷（OM 的套件假红的真因）

它的就绪门是 `M.eval_string('x=1+1;') === 0`。**实测**：

```
x=1+1 通过于 877ms   → __octaveReady=false, /bridge 不存在, 装配未初始化
__octaveReady 于 1354ms → /bridge 14 件, exist('omc_getVersion')=2
```

⇒ 它在 **477 ms 的空窗**里探 `exist()`，那时 MEMFS 还空 ⇒ 3 条必然假红。
**用 `__octaveReady` 门重探同一页面 ⇒ ③④⑤ 全 FOUND（8/8 绿）**。

这不是装配缺陷，是判据的时序缺陷。本仓 76 套验收的统一就绪门就是 `window.__octaveReady`，
所以本仓的结算件用那一条（判据内容与 OM 那份逐字同源：同样三个名字、同样对照组、同样零注入）。

### 落地物（本仓侧）

| 件 | 说明 |
|---|---|
| `build/113/provision-omc-bridge.sh` | 12 件字节供给（从 OM `bridge/manifest.json` 投影，逐件 sha+bytes 核，反证清单外文件）；自证 **4/0** |
| `bridge/octave-omc-bridge.js` | 四步装配 + 三档失败态 + 两段式句柄（`.memfs` / `.ready`）；ESM `import()` 真实形态（不是 Emscripten 全局工厂——我第一版猜错了，产物自证纠正） |
| `bridge/octave-core.js` | 把 `.memfs` 那一段**串进 boot 链**（`st.ready = true` 之前，实测 39 ms）；omc 引擎 boot 仍在后台（74 MB 级，不进开机路径） |
| `site/omc/bridge/` | 13 件（12 交付 + 清单）；两站各 13 |
| `test/browser/accept-omc-e2e.mjs` | **本单的结算件**：6 条含两条反向（E5 摘掉 `/bridge` ⇒ 必须 MISSING） |

### 结算

```bash
sh test/browser/run.sh test/browser/accept-omc-e2e.mjs http://127.0.0.1:8761/   # ⇒ 6 PASS / 0 FAIL
sh test/browser/run.sh test/browser/accept-omc-e2e.mjs http://127.0.0.1:8768/   # ⇒ 6 PASS / 0 FAIL
```

E1 清单 12 件全可达 / E2 状态机终态 / **E3 零注入下三个 `omc_*` 全 FOUND** /
E4 对照组有区分力 / **E5 反向：摘掉 /bridge ⇒ 三项 MISSING** / E6 状态机带如实说明。

**验收**：两站全量 **1253 PASS / 0 FAIL**（55 套）；开机仍 1.3 s（后台 boot 没拖慢）；
三处 parity 完全一致。

### 仍开放（不在本单）

`omc_simulate('BouncingBall')` **端到端跑出数据矩阵**需要 omc 引擎真正 boot 完成 +
`serve()` 起来（E2 在 8761 上是 `omc-not-ready`、8768 上是 `ready`——时序差异）。
桥的 `.m` 可见性已交付（本单判据）；引擎 boot 的稳定性归 OM 侧（它的引擎是 74 MB ESM）。
