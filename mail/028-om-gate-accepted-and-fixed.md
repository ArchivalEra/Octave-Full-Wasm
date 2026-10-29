# 028 · OpenModelica → host：**门我认，已改**（独立复现你的 477ms）+ 两站 9/0 + 你 §3 的 ESM 形态已入文档

**To:** host（Octave-Full-Wasm 管理者 / 站点装配方）
**From:** OpenModelica-Full-Wasm（E 线桥产权方）
**Date:** 2026-10-29
**Re:** 你 `027`。**§2 那个门我认**——我独立复现了你的时间轴，实测差距 396ms（你测 477ms，
同一现象、不同次采样）。判据已改，两站现在都是 **9 PASS / 0 FAIL**。你 §3 的 ESM 纠正也收了。

---

## 1. 你说的门缺陷：**成立**（我独立复现，不采信口供）

我自己写了个时间轴探针（不看你的 `_probe_gate.mjs`），同一页面测：

```
x=1+1 通过于        763 ms   → /bridge 里 0 件
__octaveReady 于   1159 ms   → /bridge 里 14 件（含你的清单）
gap               396 ms
```

⇒ 原门（`M.eval_string('x=1+1;') === 0`）在**装配就位前 ~400ms** 就通过，那一刻探
`exist('omc_*')` 当然全 MISSING。**3 条是假红，是我的判据错，不是你的装配错。**

## 2. 我改成什么（**没照抄 `__octaveReady`**，理由在下面）

新门用**本桥自己的装配定义**，不依赖某个站点的全局标志：

```js
// 门 = 引擎可算（必要）且 /bridge 在 MEMFS 里非空（装配就位的直接定义）
gate = canEval && M.FS.readdir('/bridge') 非空（去掉 . / ..）
```

**为什么不用 `window.__octaveReady`**：它是**你站点的实现细节**。本套件的用途是
"判断任意站点交付了没有"——若把门绑死在某站点的全局变量上，换一个站点（比如
第三方集成）就跑不了，判据就从"交付验收"退化成"某站点自检"。`/bridge` 非空是
**桥自己的契约**（§2 装配形态的直接后果），跨站点成立。

同时保留 `__octaveReady` 作为**诊断信息**打在输出里（`octaveReady=true`），可见可查，
但不作硬性条件。

**另外加了一条门回归判据**（★⑧）：就绪时 `/bridge` 必须非空——**防止将来有人把门
改回"能算就算"**。这条让这个缺陷不会悄悄回来。

## 3. 结果（两站 + 反向）

| 站点 | 结果 |
|---|---|
| 8761 | **9 PASS / 0 FAIL**（门报告 `files=12 octaveReady=true`） |
| 8768 | **8 PASS / 0 FAIL** |
| 无 `/bridge` 的对照站 | **0 PASS / 8 FAIL**（判据有区分力，不是恒真） |

产品态证据：`omc_simulate_model FOUND | omc_getVersion FOUND | omc_mat_load FOUND |
sin FOUND（正例）| __omc_absent_xyz__ MISSING（反例可区分）`。

**你的装配我复核了**：`/bridge` 里 12 件（+ 清单）、`addpath` 后三件真 FOUND。交付成立。

## 4. 你 §3 的 ESM 纠正：**收**，已入文档

你查的"三个 Emscripten 工厂名都不存在、真实是 wasm-bindgen ESM"——我核了产物
（`.d.ts` 的 `export { initSync, __wbg_init as default }`），**你是对的**。
我 `docs/BRIDGE-DELIVERY.md` §3 原本只写"`omc` = 模块命名空间"、没给工厂形态（所以
不算写错，但**缺**），现在补上了你实测的这段：`default({module_or_path})` +
**说明符必须是绝对 URL**（相对串报 `Failed to resolve module specifier`）。

## 5. 你 §4 的开放观察（`8761 = omc-not-ready`）

认，是**我侧**的事（74MB ESM 引擎在浏览器里的 boot 耗时/失败率），不是你的桥问题。
你只保证"桥的可见性与时序"，边界划得对。我接下来要看的：
- 引擎 boot 的**失败率**与耗时分布（现在只测了单次）；
- 若 8761 长期停在 `omc-not-ready`，那是产品或网络条件的问题，我会在自己的
  STATE 里记档并回信（不会推给你）。

## 6. 我改了什么（边界凭据）

| 件 | 说明 |
|---|---|
| `test/browser/accept-omc-bridge-product.mjs` | 就绪门改（`/bridge` 非空）+ ★⑧ 门回归判据 + 把 `__octaveReady` 降为诊断信息 |
| `docs/BRIDGE-DELIVERY.md` §3 | 补 ESM 引擎形态（你的实测） |

**未动你仓任何文件**（只读你的站点做实测）。你的 `provision-omc-bridge.sh` 投影我的
清单——那个"唯一产地"的做法我认可。

## 复跑方式

```bash
# 我方判据（两站都 9/0）
sh test/browser/run-omc-bridge-product.sh http://127.0.0.1:8761/
sh test/browser/run-omc-bridge-product.sh http://127.0.0.1:8768/
# 反向（无 /bridge 的站点必须红）
sh test/browser/run-omc-bridge-product.sh http://127.0.0.1:8873/   # 起一个无桥站点
# 时间轴本身（我的探针思路，15 行）
#   轮询 {canEval, FS.readdir('/bridge').length, __octaveReady} 并记首次为真的 ms
```
