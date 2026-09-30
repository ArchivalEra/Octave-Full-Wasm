# 23: 页面资产漂移 + 选档器与"站点有哪些档"的耦合（今天由 promote-pages 首次发现）

**What to build:** `octave-core.js` 与 `lane.js` 两份页面资产在**仓库 + 8848（w64 站）是新版**、
在 **8761/8768/仓库镜像还是旧版**（工单 18 的 w64 改动只在 w64 站上线）。
`octave-core.js` 可以安全同步（向后兼容，且已在 8848 用 **wasm32 两条车道**跑过回归）；
**`lane.js` 不能盲同步** —— 新版四格矩阵的优先级是
`COI+m64 ⇒ w64`，而 **8761 没有 w64 文件** ⇒ 同步后 8761 会选到 `w64` 并 **404**，
**直接弄坏验收底线**（这正好是 AGENTS.md 那条"顺手 cp 页面把 8761 弄坏"的同族危险）。

**Blocked by:** None

**Status:** resolved

**Settling:** 让选档器**存在性感知**（"能力上最优 **且** 站点真有这一档"才选它），然后：
- 把新 `lane.js` + 新 `octave-core.js` 同步到 8761/8768（用 `build/promote-pages.sh`）后，
  `SITE_DIR=<站点> PROBES=1 sh build/sweep.sh <URL> probe-lane` ⇒ 8761 上仍 **17 PASS / 0 FAIL**
  （带头选 `threads`、不带头落 `base`）—— **不许**选 `w64`（那档不在）；
- 8848 上仍 **30 PASS / 0 FAIL**（四格全在时，能力优的 `w64` 照旧被选中）；
- **反向断言**：把某站的 `threads/` 目录临时改名 ⇒ 选档器必须**退到 `base` 并把这件事喊出来**
  （console 一条清晰告警），而**不许**404；`base` 也缺 ⇒ 响亮失败（红线：base 是任何静态托管的底线）。

**Type:** task

## 为什么这条值得修（而不是"把 lane.js 也一起 promote 就行"）

- 今天已经证明**手抄页面清单会漂**：promote-pages 第一次 `--dry-run` 就抓出
  `octave-core.js` + `lane.js` 两处漂移（而 `recover-113.sh` 的清单**根本没有 `lane.js`**
  —— 照它重建站点会漏掉选档器本身）；
- "选档器假设站点一定有某几档"是个**隐形契约**：站点少一档就 404 且**没有任何闸门**会拦
  （parity 只比三处一致，不比"档是否齐全"）；
- 修好之后，`lane.js` 就能**同一份**服务"四格站 / 双档站 / 只有 base 的站"
  —— w64 上线的产品决定也就不再被页面资产耦合卡住。

## 交付标准

1. `bridge/lane.js`：选档前先问"这一档的文件在不在"（同步判据：`octaveLaneFiles()` 表 +
   站点清单/探测）；**缺档退下一优** + 一条清晰告警（**不是**静默）；
2. `build/promote-pages.sh` 的清单**补上 `lane.js`**，并注明 `recover-113.sh` 的清单缺它
   （顺手修 `recover-113.sh` 或在注释里点名）；
3. `probe-lane.mjs` 加"缺档退档"的格子（上条反向断言），并登记进 manifest 的 inputs；
4. 同步页面资产 → 8768 全量 → 8761 全量 + PROBES=1 → parity（走批次收尾那套）。

## Answer（2026-09-30）：第三轴落地 —— 选档 = 能力 ∩ 站点清单；三站实测通过

**交付物**：
1. `build/gen-lanes.sh <站点目录>` —— 生成 `lanes.js`（按磁盘真实部署写 `__octaveLanes`；
   **base 缺失 ⇒ 红**，红线）。自证 4 PASS / 0 FAIL。
2. `bridge/lane.js` —— 第三轴：清单没声明的档不选；缺档退下一优并说明原因；
   **无清单**退回历史形态 `[base,threads]`。宿主侧纯函数自检
   `build/113/lane-pick-selftest.mjs` **9 PASS / 0 FAIL**（含"双档站 + m64 不许选 w64"、
   "worker 宿主必须落 base"、"清单只有 w64 但引擎无 m64 ⇒ base"）。
3. `bridge/lanes.js` —— 入库的**默认清单**（`["base","threads"]`）；
   ⚠️ 它必须入库：`check-consistency.py` 的"页面引用的文件必须在 git 里"**当场抓到我没入库**
   （先加了 `<script src="lanes.js">`），补 `.gitignore` 放行后转绿 —— 这条闸门第二次证明自己有用。
4. 接线：`bridge/index.html`（在 `lane.js` **之前**）+ `bridge/octave-worker.js` 的 `importScripts`。
5. `build/promote-pages.sh` —— 页面资产批的受管辖入口（工单 20 的交付物）：
   `--dry-run` / `--verify` / `--selftest`；清单含 **`lane.js`**（`recover-113.sh` 原来漏了它，
   已一并补上），并校验 `lanes.js` 的**声明与磁盘一致**（声明的档不存在 ⇒ 红）。
   自证 3 PASS / 0 FAIL。**它第一次 dry-run 就抓出了本文开头那两处漂移** —— 这就是它的价值。
6. `test/browser/probe-lane.mjs` —— 新增 3 条**运行期**断言（清单已加载 / **选中的档在清单里** /
   双档站清单不许含 w64）。已登记 `.mjs` 分派进 `build/gates-selftest.sh`（29 个闸门全绿）。

**实测（三站，都是浏览器侧）**：
| 站点 | 清单 | probe-lane | 选中档 |
|---|---|---|---|
| 8768（双档） | `["base","threads"]` | **20 PASS / 0 FAIL** | 带头 `threads` / 不带头 `base`（**不选 w64**） |
| 8761（双档，基线） | `["base","threads"]` | **20 PASS / 0 FAIL** | 同上；开机自检 1.3s OK；部署件 SHA 磁盘/HTTP 两层 ✓ |
| 8848（四格） | `["base","threads","w64","w64-base"]` | **33 PASS / 0 FAIL** | 带头 `w64` / 不带头 `w64-base`（能力最优照旧） |

**同步走的是受管辖入口**（`promote-pages.sh`，三大件逐字节未动），三站各带 `page-bak-<时间戳>/` 备份。
**教训**：**"同一份页面资产铺到所有站点"是有限度的** —— 与"站点部署了什么"耦合的那部分
必须是**生成物**（`lanes.js`），否则"同一份"这件事本身就是错的。
