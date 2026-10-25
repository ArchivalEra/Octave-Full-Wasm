# 69 · `form:"tree"` 条目的可选键 `files[]`（UI 下载闭包缺口 / 内容仓 mail/090 裁定）

**Status:** ready-for-agent
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
