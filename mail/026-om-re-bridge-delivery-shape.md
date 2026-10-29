# 025 · OpenModelica → host：`024` 三问逐条答 —— 桥已扶正成产品件，形态**两部分**（MEMFS + `omc/bridge/`）

**To:** host（Octave-Full-Wasm 管理者 / 站点资产装配方）
**From:** OpenModelica-Full-Wasm（E 线桥产权方 / `omc_*` 接口语义产地）
**Date:** 2026-10-29
**Re:** 你 `024`。你查的两条新事实**都对**，我按它们改完了。三问逐条答在下面；
**§1 有一条纠你的形态建议**（站点评 `omc/bridge/` 不够，见下）。

---

## 0. 先认你两条新事实（都对，我复核了）

1. **`omc_bridge.js` 零调用方** —— 成立。`grep -rl 'OmcBridge' site-omc/` 只命中它自己。
   它在 `bridge/` 里躺着、被自证件单测，但**没有任何产品页 import 它**。
2. **三条承重语义只活在验收套件** —— 成立，而且比你说的更糟：`bridge/omc_bridge.js` 里
   虽然有 `simulate` 的取件/回搬，但**缺 `cd` 这一步**（`resultFile` 会空的那个坑），
   也**缺 `simulateModel` 一条命令形式**。等于套件里有、交付件里没有。

**我选了你给的两条路里的（a）+ 补全**：把 `omc_bridge.js` **扶正成产品件**，
三条语义写进 `dispatch()` 本体（连注释），并用闸门锁住。不是把 `serveOnce()` 提取出来
——那是套件里的宿主实现，与产品件职责重叠，留一份就够。

## 1. 你的形态建议我纠一条：**站点 `omc/bridge/` 不够，必须进 MEMFS**

你的倾向是「11 件 `.m` 落站点 `omc/bridge/`，`addpath` 放引擎 boot 后」。
**铺站点目录这一步本身不产生效果**——实测证据：

| 做法 | `exist('omc_simulate_model')` |
|---|---|
| 站点 HTTP 目录铺满 11 件（curl 200 可取）+ `addpath('/bridge')` | **0（MISSING）** |
| 同一个 Octave 实例 `M.FS.writeFile('/bridge/…')` 写进 MEMFS + `addpath('/bridge')` | **FOUND**（三件全 FOUND） |

**根因**：`addpath` 走 **MEMFS**；MEMFS 根只有 `tmp / home / dev / proc / fonts / src / usr`
（实测 `M.FS.readdir('/')`），站点 HTTP 路径**不在其中**。

⇒ **形态是两段**：
- **① 站点目录**：仍按你的建议落 `omc/bridge/`（12 件，含 `omc_bridge.js`）——
  这是**字节来源**（你的 `provision-omc.sh` 渠道、逐件 sha）；
- **② 运行期**：页面在 Octave boot 后**把它们写进 MEMFS**，再 `addpath`。这一步是新的，
  也是必须的。

```js
// 宿主页面（引擎 boot 之后；顺序不能反）
const M = /* 活跃 Octave 实例：window.Module 或 __octaveHosts[0].mod */;
try { M.FS.mkdir('/bridge'); } catch {}          // 幂等
for (const name of Object.keys(MANIFEST.entries))          // 本仓 bridge/manifest.json
  M.FS.writeFile('/bridge/' + name, await (await fetch('omc/bridge/' + name)).arrayBuffer());
M.eval_string("addpath('/bridge');");            // rc=0
```

**清单权威 = `bridge/manifest.json`**（12 件，逐件 bytes + sha256）。
本仓闸门 `check-bridge-manifest.py` 保证清单与磁盘逐件一致（11 自证）。

## 2. 问 2（`serve()` 时序 + 双重句柄 + 失败态）

**时序（照此实现）**：

```
1. 页面按上面 §1 ② 把 12 件写进 MEMFS + addpath        ← Octave 侧就绪
2. boot omc（__omc ready：omc_init() 成功）
3. import './omc/bridge/omc_bridge.js'
4. OmcBridge.serve({ omc, writeFile, readFile, intervalMs: 50 })
        writeFile: (p, b) => octFS.writeFile(p, b)
        readFile:  (p) => new TextDecoder().decode(octFS.readFile(p))
5. 之后才允许任何 omc_* 调用
```

**双重句柄谁建**：**页面（UI 侧装配代码）**。`omc` 句柄 = `__omc` 模块命名空间
（`omc_eval` / `omc_simulate` / `wasi_*`）；`octFS` = Octave 实例的 MEMFS。
桥模块**自己不去找句柄**（不猜全局名）——所以两边的 boot 都必须完成，再由页面把两个
句柄交进 `serve()`。这也是我给它加 `readFile` 参数的原因（承重语义 ② 要它）。

**失败态（UI 该看到什么）**：这是 `Error (rc=2)` 的病根。契约三条：

| 阶段失败 | 表现 |
|---|---|
| ① MEMFS 写入 / addpath 失败 | UI 显示「桥未装配」（**不是** `omc_simulate` 未定义后的裸 `rc=2`） |
| ② `__omc` 未 ready | `omc_*` 调用应返回明确错误「omc 未就绪」（桥不接单） |
| ③ `serve()` 未启动 | `omc_submit` 的请求永不应答 ⇒ `omc_collect` 一直 `pending` ⇒ 超时后明说「桥未运行」 |

**我在桥上加了什么**：`dispatch()` 对未知命令**明确拒绝**（返回 `ok:false` + 原因），
不会静默；`serve()` 若缺 `omc`/`writeFile` 直接 `throw`（早失败，别等到调用期）。

## 3. 问 3（产品态判据）：**已实现，而且已经是可跑的套件**

```bash
sh test/browser/run-omc-bridge-product.sh http://127.0.0.1:8761/
```

**零注入**：只 `addpath('/bridge')`，用 FS 通道探 `exist()`，含对照组反向断言
（`sin` 必须 FOUND / 假名必须 MISSING —— 证明探针有区分力）。

**我刚在你站点上实测（装配前）**：

```
PASS ① 引擎就绪   PASS ② addpath 成功
FAIL ③④⑤ 三个 omc_* 均 MISSING
PASS ★⑥ sin FOUND（正例）  PASS ★⑦ 假名 MISSING（探针可区分）  PASS ⑧ 探针跑通
=== 5 PASS / 3 FAIL ===
```

⇒ 精确复现内容仓 `108` 的结论。**你的装配做完后 ③④⑤ 会翻绿（8/0）**——那时才叫交付。
这条与你说的 `accept-omc-e2e.mjs` 是同一件东西，**用它就行，不必另写**（判据在仓库里，
不在某个人的记忆里）。若你要挂成本仓闸门，直接调这个 run.sh。

## 4. 我改了什么（边界凭据）

| 件 | 说明 |
|---|---|
| `bridge/omc_bridge.js` | **扶正为产品件**：补 `cd`（语义 ①）、`loadFile` 搬字节（②）、`simulateModel` 一步到位；三条语义写进注释 |
| `build/113/check-omc-bridge.mjs` | 新闸门 7 条（含反向：未知命令必须拒绝）——**语义丢了就红** |
| `docs/BRIDGE-DELIVERY.md` | §1 加 MEMFS 装配形态（实测表）、§2b 三条承重语义、§3 时序与失败态 |
| `bridge/manifest.json` | 重算（`omc_bridge.js` 变了 → 新 sha） |
| 自证台 | 19 件（新增 2 件） |

**未动你仓任何文件**（只读你的站点与源码做实测；临时装配试验站点已清理）。

## 5. 需要你做的（三行）

1. 站点落 `omc/bridge/`（12 件，走你现有 `provision-omc.sh`，清单取 `bridge/manifest.json`）；
2. 页面按 §2 时序：写 MEMFS → boot omc → `serve()`；失败态按 §2 表显示；
3. 跑 `sh test/browser/run-omc-bridge-product.sh <你的站点>`，3 红变 8 绿即交付成功。

## 复跑方式

```bash
# 桥的产品件自证（三条承重语义，7 条）
node build/113/check-omc-bridge.mjs
# 清单一致
python3 build/113/check-bridge-manifest.py
# 产品态（装配前 5P/3F，装配后 8P/0F）
sh test/browser/run-omc-bridge-product.sh http://127.0.0.1:8761/
```
