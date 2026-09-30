# 30: **w64（四格）上线** —— 把 8848 的形态发运到 8761（用户已拍板，2026-09-30）

**What to build:** 用户决定（2026-09-30）：**w64 目标形态上线**。即把 `site-w64` 的**四格**
（`base`/`threads`/`w64`/`w64-base`，含生成的 `lanes.js`）发运到 **8761**，替换现在的双档清单
（`["base","threads"]`）。选档第三轴（工单 23）已保证：无 memory64 的引擎会自动落 `threads`/`base`，
**不会**选到不存在的档。

**Blocked by:** None（`w64_verdict=ok`；8848 四格矩阵 33/0；8761 现役双档与本批不冲突——`base`/`threads`
两档的产物 sha 完全不变，只是**多出两档**）

**Status:** ready-for-agent

**Settling:** 走标准批次收尾全套，判据逐条：
1. 8768 验绿（先把四格发到实验车道并跑 `PROBES=1` 全量）；
2. promote → **8761 开机自检**（带头 ⇒ `__octaveLanes` 含 `w64` 且选中 `w64`）；
3. **SHA 三层**（磁盘/HTTP/页面层）——注意 `base`/`threads` 两档 sha **必须不变**（`1ed3e528`/`e570905e`），
   只**新增** `w64/`、`w64-base/` 两档与 `lanes.js`；
4. `sh build/sweep.sh http://127.0.0.1:8761/`（43 套）+ `PROBES=1`（含 `probe-lane`，
   期望从 17 PASS 涨到四格版的 PASS 数）；
5. `site/` → dist → `parity --strict` → 六道闸门 → 提交推送。
**反向断言**：无 memory64 的引擎（Chromium 125 可作替身——它 `mem64=false`）在 8761 上必须
**落 `threads`** 而不是 404（`probe-lane` 的清单格 + 工单 23 的第三轴保证）。

**Type:** task

## 坑（照抄，别重撞）

- **别手 cp**：8761 只由 `promote-webgl.sh` 改（AGENTS 铁律）；页面资产批走 `promote-pages.sh`；
  两者都要跑（产物批 + 页面批），顺序：先产物后页面（页面含 `lanes.js` 生成）。
- `gen-lanes.sh` 必须在**两个站点**都跑（8768 与 8761），且 `base` 缺失会红（红线）。
- 换产物批次之后必须有一条**运行期**套件（工单 28/29 的教训）：`accept-help` + `probe-lane`。
- 三列 `parity --strict` 与六道闸门是**提交前**的硬要求。
