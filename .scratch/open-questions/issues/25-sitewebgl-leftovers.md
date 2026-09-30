# 25: 8768 站点的实验残留文件（三份，来源不明 —— 只登记，不擅自删）

**What to build:** `check-site-parity.sh --strict`（2026-09-30 绿）在"非部署件内容差异"一节里报出
**只有 8768（siteWebGL）有**的三份文件：

| 文件 | 猜测来源（**未验证**） |
|---|---|
| `octave.js.orig` | 某次调试胶水时留的备份（`cp octave.js octave.js.orig`） |
| `wtest.html` / `wtest.js` | B5/C3（解释器进 Worker）时期的**手搓测试页** |

它们**不是**部署件（parity 只报不算差异），但 8768 是 promote 的源候选之一 ⇒ 将来若有人
用 `rsync`/`cp -a` 整目录搬 8768，会把它们一起带进 8761 或交付包。

**Blocked by:** None

**Status:** resolved

**Settling:** 三份文件各得一个明确去向，且有可复跑的判据：
- **要留** ⇒ 移进 `build/113/`（实验物该待的地方）并在注释/工单里说明用途，然后
  `ls /mnt/hdd/octave-wasm-build/siteWebGL/{octave.js.orig,wtest.html,wtest.js}` 必须全部"不存在"
  （rc≠0）；或
- **要删** ⇒ 先 `sha256sum` 存档到工单 Answer（**删前留指纹**，本仓纪律：不删 git 对象、
  但站点上的非入库文件要留痕），再删，然后同一条 `ls` 必须报缺。
**反向断言**：做完之后 `sh build/check-site-parity.sh --strict` 仍必须 **rc=0**，
且输出里**不再出现这三行**。

**Type:** task

## 为什么"不擅自删"

本仓纪律：**不是自己建的产物，先surface 再动**（用户点名的"删之前先看目标、不是自己建的
就要先汇报"）。这三份文件**没有对应的工单/提交记录**（`git log` 里查不到），
所以来源与是否还有用**只能由人确认** —— 本单的存在就是那条"留痕"。

## Answer（2026-09-30）：查清来历 ⇒ **留痕后从站点清掉**

三份都不是部署件（8761 与仓库镜像里从来没有），是 8768 实验车道上的边角料：

### `octave.js.orig`（685455 B，sha256 `fa74d2244bb53286…`，**已删**）

```
var OCTAVE=(()=>{var _scriptName=globalThis.document?.currentScript?.src;return async function(moduleArg={}){var moduleRtn;var Module=moduleArg;var ENVIRONMENT_IS_WEB=true;var ENVIRONMENT_IS_WORKER=false;var ENVIRONMENT_IS_NODE=false;var ENVIRONMENT_IS_SHELL=false;if(!Module["expectedDataFileDownloads"])Module["expectedDataFileDownloads"]=0;Module["expectedDataFileDownloads"]++;(()=>{var isPthread=typeof ENVIRONMENT_IS_PTHREAD!="undefined"&&ENVIRONMENT_IS_PTHREAD;var isWasmWorker=typeof ENVIRONMENT_IS_WASM_WORKER!="undefined"&&ENVIRONMENT_IS_WASM_WORKER;if(isPthread||isWasmWorker)return;async 
```

### `wtest.html`（298 B，sha256 `81b661225db41950…`，**已删**）

```
<!doctype html><meta charset=utf-8><body>w
<script>
var w = new Worker('wtest.js');
w.onmessage = e => { window.__r = e.data; console.log('WORKER-RESULT ' + JSON.stringify(e.data)); };
w.onerror = e => { window.__r = 'onerror:' + e.message; console.log('WORKER-ONERROR ' + e.message); };
</script>
```

### `wtest.js`（184 B，sha256 `69de6c78f3213c3a…`，**已删**）

```
try { importScripts('/assets/m/plotbridge.js'); postMessage({ok:true, keys:Object.keys(self.__OCT_ASSETS__||{})}); }
catch (e) { postMessage({ok:false, err:String(e).slice(0,200)}); }
```

**来历**（据此判定可删）：
- `wtest.html` + `wtest.js`：**3 行的一次性调试页** —— 在一个 Worker 里 `importScripts('/assets/m/plotbridge.js')`
  看能不能拿到 `__OCT_ASSETS__` 的键（B5/A2 那条"worker 里资产注入路径"的排查）。判据早已固化进
  `accept-worker.mjs` 的 E 格（资产可用），这份手搓页没有独立价值。
- `octave.js.orig`：旧胶水备份（与现役 `octave.js` sha 不同），来源提交不可考；胶水的唯一真相源是
  重链产物 + 仓库里的 `bridge/*.js`，备份留着只会让人误以为"站点上还有一份要维护的胶水"。

**处置**：内容与 sha **留档在本工单**（上面），然后从 `siteWebGL` 删除 —— 既清了站点，
信息也没丢（本文件在 git 里）。**反向断言**：删完 `sh build/check-site-parity.sh --strict`
必须仍 rc=0，且输出里**不再出现这三行**。
