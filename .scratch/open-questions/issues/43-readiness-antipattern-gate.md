# 43: **就绪反模式闸门**：凡 feval 就绪轮询的套件必须两段式（先 `__octaveReady` 再 feval）

**What to build:** 工单 40 修 bench-lanes 时只修了"当时红过的"套件，**还有 4 个套件带着旧
反模式漏网**（`bench-core` / `bench-dgemm` / `probe-heap-ceiling` / `probe-want-matcher`）
—— NT=8 上站批（2026-10-03 复跑全量）在 `bench-dgemm` 上**零输出挂死**才暴露。
本单 = 把"两段式就绪"变成机器化断言，不再依赖"恰好红过"。

**Blocked by:** None

**Status:** resolved（2026-10-03：4 套已修 + 闸门 `.githooks/check-readiness-pattern.py` 落地，
自证 6/0，已登记 `gates-selftest.sh` 名单 —— 33/33）

**Settling:** `python3 .githooks/check-readiness-pattern.py --selftest` —— 6 PASS（含"该报的
必须报"与两条零值守卫）⇒ 闸门活着；实跑 `python3 .githooks/check-readiness-pattern.py`
⇒ `就绪反模式：94 个 .mjs 里 0 个`。反推：把任一套件的 `__octaveReady` 删掉重跑 ⇒ 必须红。

## Answer

（2026-10-03 结案。）

- **判据**：`test/browser/*.mjs` 里含 `Module?.feval?.('strcat'`（就绪轮询签名）**且不含**
  `__octaveReady` ⇒ 红。普通 feval（就绪后的工作调用）不红 —— 本闸只管**就绪轮询**这一形状。
- **修复**：4 个漏网套件统一为两段式（样例 = `bench-lanes.mjs` 的注释块）；
  `bench-dgemm` 复跑验证：不再挂、正常出 DGEMM_JSON（NT=8 现役产物上）。
- **闸门**：`.githooks/check-readiness-pattern.py`（走 `build/lib/gate.py` 契约：
  `require_nonempty` 零值守卫 + `GATE_REPO` 夹具自证 + 三类用例齐备）。
- **教训**：修"反模式"这类**横切面**问题时，必须同时立**机器化扫描闸门**——靠"每处手改"
  的修复永远有漏网（本次 4/44 ≈ 9% 漏网率就是实测代价）。
- **连带抓到另一个承重文件盲区（2026-10-03）**：登记本闸时发现 **`.githooks/check-facts-replay.py`
  从未入库**（工单 37 的交付物！被白名单挡住、从未 `git add`，本地一直跑的是盘上那份）——
  AGENTS 警告过的形状又来一次。`gates-selftest` 对"闸门不存在"本有零值守卫（❌ 缺 ⇒ 红，
  新克隆/CI 会红），但本地文件一直在 ⇒ 从未触发。已修：`.gitignore` 放行
  `check-facts-replay.py` + `check-readiness-pattern.py` 两个文件并入库。
  ⚠ **操作纪律**：新增闸门 = 三件事一次做完——①文件 ②`gates-selftest.sh` 登记
  ③**`.gitignore` 白名单行**。缺第三件 = 本地全绿、仓库里那道闸不存在。
