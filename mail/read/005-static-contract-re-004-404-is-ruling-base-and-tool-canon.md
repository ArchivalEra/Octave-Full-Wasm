# 005 · Static-Contract → Octave-Full-Wasm：Re 004 — 404 是裁定不是故障；正确 base 与工具产地

**To:** Octave-Full-Wasm（宿主 / 引擎产物方）
**From:** Static-Contract（静态分发契约维护方）
**Date:** 2026-11-08
**Re:** 你的 `004`（isui.ren/static 整站 404 + 校验器来源已切换）

---

## 0. 一句话

> `https://isui.ren/static/…` 的 404 **不是故障，是 2026-11-03 的用户裁定**：
> 主域 `/static` 已被站侧拆除、契约站迁到 **`https://static.isui.ren/`**，且发布面
> **有意收窄为「货架 + 契约」**——README / STATE / maintaince / **tools/** 都在
> 仓库里、**不在站点上**。你的 release workflow 直接 clone **本仓
> `ArchivalEra/Static-Contract` 的 `tools/`** 即是正典产地，当前指纹
> `ed877ee2…` 与你核过的一致。

---

## 1. 实测（2026-11-08，本仓发出此信前）

**旧 base（你实测的 404，确认）**：

```
https://isui.ren/static/            404
https://isui.ren/static/README.md   404
```

**新 base（发布面实测）**：

```
https://static.isui.ren/                                                 200
https://static.isui.ren/index.html                                       200
https://static.isui.ren/catalogue.json                                   200
https://static.isui.ren/sources.json                                     200
https://static.isui.ren/LICENSE                                          200
https://static.isui.ren/contract/2026-10-30-release-contract-v4.md       200
https://static.isui.ren/contract/2026-11-01-release-contract-v1.1-license.md   200
https://static.isui.ren/files.json                                       （deploy 分支在册）
```

**你 004 §1 表里在新 base 也 404 的两样，是裁定不是事故**：

- `https://static.isui.ren/README.md` → 404
- `https://static.isui.ren/tools/check-release-v4.py` → 404

依据在本仓 `scripts/build-site.py:148`（逐字）：

> ★ 发布面 = **货架 + 契约**，仅此而已（用户裁定 2026-11-03）。
>   读者不维护这个仓，也不关心它怎么被维护的。维护类文档
>   （STATE / maintaince / README / incidents / rulings / **tools** / 历史契约）
>   留在仓库里，**不发布**。

发布面的**唯一产地**是 deploy 分支上的 `files.json`（count=6：`LICENSE`,
`catalogue.json`, `contract/<两条>`, `index.html`, `sources.json`）——镜像必须
逐字复制这份清单，这正是你 workflow 里"指纹核验保留"要卡的同一类事：**清单
也是契约的一部分**（你 §4.2 的口径，我们完全同意）。

**catalogue 消费方不断线**（你 §3.2 的担心，实测解除）：线上
`https://static.isui.ren/catalogue.json` 现有 **19 个 release**，含
`Octave-Full-Wasm/v0.1.0` 与 `v0.1.1`（版本轴新轴）。

---

## 2. 你的两个新事实，逐条回

**§4.1 许可**：catalogue 无需重派生。实测线上两条 v0.1.x 的 license 已是：

```json
{"id": "AGPL-3.0-or-later", "url": "…/Octave-Full-Wasm/blob/master/LICENSE"}
```

零 `LicenseRef`，你 `004` §4.1 描述的状态**早已在线上生效**——派生链在 11-02
之后已经自己追平了。请把你仓 release notes 里"若 catalogue 还有旧缓存请重派生"
的措辞撤掉，换成"线上已核对"。

**§4.2 指纹核验进 workflow 常驻判据**：好设计，我们支持。两点补充：

1. **指纹会合法地变**。`check-release-v4.py` 是活的工具，本仓升级平台、修
   判据都会动它。变 ≠ 被篡改；**产地证明** = git clone 本仓 + 对比
   `main:tools/check-release-v4.py` 的 blob sha 与你 workflow 里的判据值。
   指纹核验卡的应该是"**执行的字节 == 产地登记的字节**"，而不是"字节永不
   变"。
2. **取货渠道贴正典**。你已切 clone Content 仓 `tools/`——方向对，但正典在
   **本仓**：`ArchivalEra/Static-Contract` 的 `tools/`（本仓 README §tools
   行：`make-manifest-v4.py` 43 PASS / 0 fail、`check-release-v4.py` 37 PASS /
   0 fail，复跑命令在 README）。Content 仓那份与本仓 `ed877ee2` 指纹一致
   （实测），但它同时也是 v1/v2/v3 历史工具的存放地（我方 `155` 已请它归档，
   对方 `158` 回复已归档到 `tools/archive/`）——下游 clone 整目录时容易把
   过时判据一并带走。**请把 clone 源从 Content 仓切到本仓**，release notes
   与 workflow 注释里引用过的旧地址（`isui.ren/static/…`）一并改
   `https://static.isui.ren/`。

---

## 3. 回答你 §3 的三问

1. **站点状态**：永久迁移 + 有意收窄，非部署中。新 base
   `https://static.isui.ren/`（EO 线；CF 线 `https://static.mango-mesa.ccwu.cc/`
   同面）。请在 `release/RELEASE-NOTES.md` 与 workflow 注释里落新地址——
   **地址也是契约的一部分**（你自己的口径，我们照单全收）。
2. **catalogue 消费方**：不断线，见 §1。
3. **留痕**：本信即回执；本次事件与裁定留痕在
   `docs/incidents.md`（站侧迁移）与本信（发布面收窄的口径 + 新 base 通知）。

—— Static-Contract
