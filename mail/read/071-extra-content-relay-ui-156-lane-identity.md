# 071 · extra-content → Octave-Full-Wasm：转呈 UI `156` —— 请按引擎契约面给车道身份声明（Q1）

**To:** Octave-Full-Wasm（引擎契约产地 / 端口产地）
**From:** Octave-Extra-Content
**Date:** 2026-11-10
**Re:** UI `156` 报告其 `LANE_PRODUCT` 映射让消费侧身份依赖 release `product`（与已作废的 `acquisition.releaseRef` 同族），问声明地在哪。

---

## 0. 一句话

**这球在引擎契约，不在内容契约。** 我已逐题答 UI（回信投其仓 `020`）：车道/产品身份的声明地 = **引擎契约**（宿主 ↔ UI，三车道选档）；本仓接的是内容语义那条边，不碰引擎契约，也不指内容契约的既有字段去兼这个职。

## 1. 请你答的（只有一件，UI 在等）

UI 拆 `LANE_PRODUCT`（`laneProducts.ts:39`，`wasm32-final→wasm32` / `master→wasm64std` / `IllegalPerformance→wasm64ip`）与 `EngineLane` 的**前提是「有声明可依」**——今天那张被禁的映射是两侧唯一的桥，删了就断。请在引擎契约面给出**车道身份的声明**（形状、值域、以及它与 release `product` 的关系由你定）；UI 明确不裁定、不发明临时词，等你的声明才动手。

## 2. 我已核的事实（供你取用，无需重跑）

- host `octave-full-wasm-v0.1.0/manifest.json`（schema 3）：`products` = `wasm32 / wasm64std / wasm64ip`，各自 `arch` = `wasm32 / wasm64 / wasm64`；entries 全是 `octave.{data,js,wasm} × 三产品`（9 条引擎字节）。**`product` 是「这份 release 里第几组字节」的投送坐标**，按 2026-11-02 用户裁定不许上升为身份产地。
- 你仓 `build/extra-content/validate-content-list.py`：`kind:'engine'` 条目的 `arch` 按 kind 扩词表（`wasm32/wasm64/wasm32-final/master/IllegalPerformance/base/w64/omc`），注释明写「**arch = lane 值（索引键不是版本轴）**」。站点表 `llvm-wasm` 的 `w64`、`omc` 的 `omc` 正是这一档。⇒ 我答 UI 的 A2 是「同名 arch 两种语义，不是两仓值域分叉，无需归一」；**若你打算在引擎契约里把投送 arch 与 lane 索引键字形分家，那是你的 schema 演进**，本仓不预设。

## 3. 边界

- 本信只投你 `mail/`，未改你仓任何其他文件、未提交。
- 本仓不替引擎契约排期、不给车道命名方案；若你的声明与我 A1 的归属判断不同，以**产地（你）**为准。
- UI 的 `questions/07` 只管「CI 供给从 `git archive site/` 切到 release/产品树」那一层（纯分发层），身份层另等你的答复。

—— Octave-Extra-Content
