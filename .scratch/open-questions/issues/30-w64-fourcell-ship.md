# 30: **w64（四格）上线** —— 把 8848 的形态发运到 8761（用户已拍板，2026-09-30）

**What to build:** 用户决定（2026-09-30）：**w64 目标形态上线**。即把 `site-w64` 的**四格**
（`base`/`threads`/`w64`/`w64-base`，含生成的 `lanes.js`）发运到 **8761**，替换现在的双档清单
（`["base","threads"]`）。选档第三轴（工单 23）已保证：无 memory64 的引擎会自动落 `threads`/`base`，
**不会**选到不存在的档。

**Blocked by:** None

**Status:** resolved （2026-10-01）

**Settling:** 走标准批次收尾全套，判据逐条： —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
1. 8768 验绿（先把四格发到实验车道并跑 `PROBES=1` 全量）；
2. promote → **8761 开机自检**（带头 ⇒ `__octaveLanes` 含 `w64` 且选中 `w64`）；
3. **SHA 三层**（磁盘/HTTP/页面层）——注意 `base`/`threads` 两档 sha **必须不变**（`1ed3e528`/`e570905e`），
   只**新增** `w64/`、`w64-base/` 两档与 `lanes.js`；
4. `sh build/sweep.sh http://127.0.0.1:8761/` + `PROBES=1`（含 `probe-lane`，期望从 17 PASS 涨到四格版）；
5. `site/` → dist → `parity --strict` → 六道闸门 → 提交推送。
**反向断言**：无 memory64 的引擎（Chromium 125——它 `mem64=false`）在 8761 上必须**落 `threads`** 而不是 404。

**Type:** task

## Answer（2026-10-01，全部实测）

**判据 1 —— 8768 先验**：四格发到 `siteWebGL` 后 `PROBES=1` 全量 **72 套 / 1343 PASS / 0 FAIL**；
`probe-lane` **33 / 0**（双档时 17；四格多 16 条：Cell 1–4 各多 2 条、Cell 6/7 各多 1 条，
清单格 + 覆盖格各多 1 条）。日志 `sweep-logs/20261001-080742/`。

**判据 2 —— promote → 开机自检**：`sh build/check-boot.sh http://127.0.0.1:8761/` = **1.3 s 就绪**；
带头页面 `__octaveLanes = ["base","threads","w64","w64-base"]` 且
`octaveLaneState.lane = w64`（`probe-lane` 日志里 `dir=/mnt/hdd/octave-wasm-build/site`
——**跑的就是 8761 那份**，不是别的站点冒充）。

**判据 3 —— SHA 三层**：
· 磁盘：`base` `1ed3e528…`、`threads` `e570905e…`（**与批前逐字节相同**）、
  `w64` `d34d3217…`（== 台账 `w64_wasm_sha`）、`w64-base` `091c3500…`（== 台账 `w64_base_wasm_sha`）；
· HTTP：四档逐档与磁盘同 sha（`curl http://127.0.0.1:8761/<lane>/octave.wasm`）；
· 页面层：`probe-artifact-sha` **4 PASS / 0 FAIL** —— 页面实例化的字节 = `d34d3217…`
  = `w64/octave.build.json` 身份证记的 sha。
  ⚠️ 顺手补了这条探针的 **③a 身份证层**：老逻辑遇到非基础档会把"期望层"**整条跳过**
  ⇒ 四格站点上"页面实例化的不是身份证说的那份产物"**没人拦**。

**判据 4 —— 8761 全量 + `PROBES=1`**：全绿（`sweep-logs/20261001-084427`；台账
`accept_suites` / `accept_pass` 已刷新到这一轮，`probe_lane_pass` = 四格版、`probe_lane_fail` = 0）。

**判据 5 —— 收尾**：`site/`（仓库镜像）rsync → `parity --strict` **三处完全一致**；
`make-dist.sh` 包 **四档 sha 与部署件逐档相同**；六道闸门 + `gates-selftest`（30 个闸门全绿）。

**引擎矩阵（2026-10-01 补测，上键 `floor_matrix_*`）**：Chromium 154 / **Firefox** / **WebKit** 三台
都 `mem64=true` ⇒ 落 `w64` 且 JSPI 门开；**Chromium 125 落 `threads`**。日志 `w64-logs/floor-8761-*.log`，
台账键 `floor_matrix_engines` / `floor_matrix_pass` / `floor_matrix_fail`（FAIL 必须 0）。

**反向断言（真引擎实测，不只模拟）**：
· Chromium 125（`mem64=false`，`/mnt/hdd/crossbuild-tools/pw-browsers/chromium-1117`，配旧 playwright 1.44.1）
  在 8761 上 `lane=threads`、页面 ready、D9 门关 → **4 PASS / 0 FAIL**，日志
  `w64-logs/floor-8761-old-chromium.log`（该探针的 ④ 判据本批被**加强**为
  「(COI × memory64 × 站点档清单) 三元一致」——老判据 `/threads|w64/` 分辨不出 w64 与 threads，
  "无 memory64 却选了 w64"**恒绿**）；
· 现代 Chromium（`mem64=true`）同一条判据期望 `w64` → 4/0，日志 `w64-logs/floor-8761-chromium.log`。

## 顺带结清的四个缺陷（都带自证，都在本批提交里）

1. **`check-build-manifest.py`**：`--out-dir DIR` 的 `DIR` 被当成位置参数 `declared.json` 打开
   ⇒ 按文档单独用**必 rc=2**（`relink.sh` 恰好同时传了真 declared 才一直没露馅）。自证 21/0。
2. **`check-site-parity.sh`**：只核 `threads` 档，**w64 整档不在闸门里**（"8761 有 w64/ 而它的
   `.oct` 是旧件"没人拦）。现按磁盘**动态**纳入 `threads`/`w64`/`w64-base` + 两套车道 `.oct`，自证 9/0。
3. **`probe-browser-floor.mjs`**：选档判据 `/threads|w64/` 分辨不出两档（见上）。
4. **`sweep.sh` + `handoff_facts.py`**：记簿文件 `.inputs-error.log` 被当成"缺汇总行的套件"
   ⇒ 全绿的 `PROBES=1` 扫描被判 `clean=False` ⇒ HANDOFF 的 AUTO:STATE **静默退回上一轮旧扫描**
   （表现为同一份文档里 AUTO:STATE 写 8848/1077 而 AUTO:FACTS 写 8761/1084）。现已改 `.txt`
   且消费侧跳过点文件；判据 = `handoff_facts.sweep_facts()` 在 8761 那轮上 `clean=True`。

## 坑（本批新踩与沿用）

- **四格批不能走 `promote-webgl.sh`**：它会从容器 `m2fc-threads-out` 重推线程档，而那份已漂到
  `c2899a71…`（现役 `e570905e…`）⇒ 会把"base/threads 不许变"这条判据直接踩掉。
  ⇒ 新入口 `build/promote-w64-lane.sh`（`--dry-run`/`--verify`/`--selftest`，自证 7/0，已进
  `gates-selftest` 名单），把"只许新增两档"做成**反向断言**。
- 站点档清单 `lanes.js` 是**生成物**：两个站点都要 `gen-lanes.sh` 重生成（`base` 缺失即红）。
- 换产物批次之后必须跑**运行期**套件（工单 28/29 的教训）：本批跑的是全量 `PROBES=1`
  （`accept-help` / `accept-113-oct` / `probe-lane` 都在里面）。
- 三列 `parity --strict` 与六道闸门仍是**提交前**的硬要求。
