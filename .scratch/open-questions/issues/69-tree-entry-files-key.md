# 69 · `form:"tree"` 条目的可选键 `files[]`（UI 下载闭包缺口 / 内容仓 mail/090 裁定）

**Status:** resolved

**结算（2026-10-28）**：两条结算判据都 rc=0 ——
`python3 build/extra-content/validate-content-list.py --selftest` ⇒ **63 PASS / 0 fail**
（含 files 的六条正反：tree 合法 map 不报 / `form:"file"` 带 files 必报 /
bytes 非整数 / sha 非 hex64 / 值对象带多余键 / 空 map 零值守卫）；
`python3 build/113/check-forge-catalog.py --site <站点>` ⇒ **ok ×3**（8761 / 8768 / 仓库镜像）。
★ **依赖已解**：OM 侧 JS 台账键其实早已上账（OM 仓 `b217f1a`，`omc_web_js_sha` +
`omc_web_js_bytes`，注记原文写明"files[] 投影的产地"）⇒ 投影的是**完整两件**
（bg.wasm 74,579,404 + JS 56,586），不是原先预计的"只 bg.wasm"。
四步落地记录：
① schema `$defs/entry` 加 `files`（map，值恰为 `{bytes:int≥0, sha256:hex64}`），描述写死
   五条绑定 + "与 `$defs/artifact.files`（数组）同名非同义"；
② `validate-content-list.py` 类型检查 + 六条自证（57→63/0）；
③ `forge-catalog.py` 的 omc 条目投影 `files`（读 OM FACTS 的 `omc_web_*`，**不手写、不另算**；
   拿站点字节**核对**，不一致是红不是重写；台账读不到 ⇒ `[omc]` 致命，自证 40→44/0）；
④ 站点闸门 **R15** 逐件对账 + 三用例（正常 / 篡改 sha 必红 / 列缺件必红），40→43/0；
   浏览器侧 `browse()` 以 `detail.files` 带出，`accept-market-browse` 17→21/0
   （B11a 恰为两件下发件 / B11b 值 = OM 台账投影 / B11c **闭包和 ≠ size 是有意设计** /
   B11d 无 files 的 tree ⇒ `detail.files === null`）。
**Settling:** `python3 build/extra-content/validate-content-list.py --selftest` —— 自证里必须含
`files[]` 的**正反各一条**（合法 map 不报 / 形态错配必报），且**真仓三站表**过校验器 `ok`；
再跑 `python3 build/113/check-forge-catalog.py --site <站点>` 验 `files[]` 与站点字节逐件 sha 一致。
rc=0 ⇒ 键已落地且投影正确；rc=1 ⇒ 校验器/闸门红（逐条点名）；rc=2 ⇒ 读不到（fail-closed）。
**结算件不存在 —— 本工单的第一交付物就是造它**（把上面两条断言落进两个既有自证里）。

## 缺口（UI `085-ui` 实测抓的，内容仓 `090` 裁定方案 A）

omc 条目无逐件 sha —— JS 胶水件（`OpenModelicaCompiler.js`，`56c399bd…`，56,586 B）在表里
**没有 sha**；表 `size` = 目录和（74,735,455）≠ **下载闭包**（两件和 74,635,990）。
宿主「逐件权威走产物自证」在**运行期消费端（浏览器）够不着**——只有表能带过去。
UI 因此硬编码了两个 sha（值逐字正确，但**无产地**：OM 台账没有 JS 那个键）。

## 裁定（内容语义，内容仓 `090` §2，五条绑定）

1. **可选键、`form:"tree"` 专属**。`form:"file"` 不需要（条目 sha 即文件 sha —— MSL 无缺口）。
2. **值 = 下发闭包清单**（消费者会下载的文件 → `{bytes, sha256}`）。非下发件（`.d.ts`）
   **不列** ⇒ `files-sum ≠ size` 是**有意设计**：`size` = 目录和（R14 站点不变量，**不变**），
   files-sum = 下载闭包预算（消费端自算，**不存第二个总量**）。
3. **产地纪律**：逐件 sha 唯一产地 = **生产者台账**，装配时**投影**进表
   （omc 的 bg.wasm ← OM `omc_web_wasm_sha`；JS 件 ← OM 待补键，其 `091`）。
   生产者不手写、宿主不另算 —— **不造第二产地**。
4. **缺省兼容**：无 `files[]` 的 tree 条目合法（llvm-wasm / pyodide 现状不动）。
5. **校验器配套**：类型检查（map：文件名 → `{bytes:int≥0, sha256:hex64}`）+ golden/bad 各一。
   ★ **待裁的一点**：`form:"file"` 条目带 `files` ⇒ 我倾向**也红**（形态错配）。
   本仓判 = **红**（理由：`files` 的语义是"tree 的下载闭包"，file 形态没有闭包概念；
   静默忽略 = 让一个错的键看起来合法，与 fail-closed 纪律相反）。若不红必须写明
   「file 条目忽略之」的语义 —— 我们选红。

## 落地清单（四步，每步独立可验）

1. `build/extra-content/content-list.schema.json`：`$defs/entry` 加 `files`（object，
   `additionalProperties: {bytes:int≥0, sha256:hex64}`），描述里写死上述五条；
2. `validate-content-list.py`：类型检查 + 两条自证（合法不报 / file 带 files 必报）；
3. `build/forge-catalog.py`：omc 条目装配时**投影** `files`（值从 OM 台账读，不手写）；
4. 三站 rebake + 浏览器验收（`browse()` 的 omc 条目带 `files`，UI 可自算闭包预算）。

## 依赖

- **OM 侧待补 JS 台账键**（内容仓 `091` 已请求，值它已替 OM 亲测好 `56c399bd…`）；
  在它补上之前，`files` 只能投影 bg.wasm 一件 —— 那也算落地（缺省兼容允许部分投影），
  但**完整形态**等 OM 补键。
