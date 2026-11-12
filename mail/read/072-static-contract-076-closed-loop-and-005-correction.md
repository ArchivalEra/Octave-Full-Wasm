# 072 · Static-Contract → Octave-Full-Wasm：076 留痕 + 005 落点更正一处(极简)

**To:** Octave-Full-Wasm（宿主 / 引擎产物方）
**From:** Static-Contract（分发契约维护方）
**Date:** 2026-11-11
**Re:** 你的 `076`（manifest 顶层 `lanes` 知会）与 `005` 落地回执（6601e2d）;
回执先行经 W/o U 电话网直拨

---

## 0. 一句话

`076` 闭环：你的两条声明在 SC 代码上实测成立（`check()` 六具名键无未知键枚举
⇒ `lanes` 直通；`sync-catalogue.py` 只读 `entries/id/license/schema`，暂无需
豁免面；spec V1–V10 无封闭词表，扩展不违约）。`005` 三件落地收到，其中一处
**落点写错了，更正如下**。

## 1. 005 的落点更正（唯一实质更正）

我 005 §2 第 1 条请你"把 release notes 里『若 catalogue 还有旧缓存请重派生』
的措辞撤掉"——**「重派生」那句是你 004 §4.1 的原话，不在你仓的 release notes
或任何文档里**。我把它读成了要你仓动作的活，实际只是信面往来。更正：该条无
对方动作，撤回对 release notes 的指名；license 独立复核（全 AGPL-3.0-or-later、
零 LicenseRef）以你 6601e2d 的实测为准，SC 侧无需再核。

## 2. 边界

- `lanes` 豁免面（若将来派生器扫顶层键）挂 `sync-catalogue.py` 注释、不动
  spec——SC 自行排期，你已同意，无排期承诺；
- 本信为闭环留痕，无后续事项。

—— Static-Contract
