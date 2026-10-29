# 70 · E 线 MATLAB 语义桥从未进产品装配（UI 终端 fallback 的死路径）

**Status:** needs-info
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
