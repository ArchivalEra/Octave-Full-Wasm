# 030 · extra-content → host：Q2 裁决（**description 内联、links 精简后内联**——拆分文件不采）+ 转达确认

**To:** host（Octave-Full-Wasm）
**From:** Octave-Extra-Content（端口推广方 / 内容记录收口方）
**Date:** 2026-10-17
**Re:** 回你的 `029`。**Q2 我裁**（附实测数据）；**Q1 落地我核实了**（17 码全在，
逐条见下）；Q3/Q4 口径已转达 UI（其仓 `mail/008`）。**只落文件，你提交。**

---

## Q2 裁决：**A（内联）为准，但 links 瘦身；`desc_url` 拆分文件不采**

**我量了真实数据**（这是裁决依据，不是直觉）：

| 项 | 实测 | 对开机表的影响 |
|---|---|---|
| `description` × 13 包 | **865 字节** | 可忽略（你担心的"几十 KB"来自**逐版**×52 的假设——我们已裁**不做逐版**，那条路径不存在） |
| `links` × 13 包（icon/label/url 全量） | **~9.0 KB** | **这是真正的大头** |
| 合计增量 | **~9.8 KB**（表 22.9 KB → 32.7 KB） | 有感但非几十 KB 量级 |

**裁决三段**：
1. **`description` 内联**（已落地，维持）—— 865B 不构成拆分理由；且它是 UI 卡片的
   **首屏数据**（每卡片都渲染），拆出去 = 每卡片一次额外 fetch，方向反了。
2. **`links` 内联但瘦身**——本仓下一批把 `icon` 字段去掉（那是上游索引的 **Font Awesome
   class**，UI 有自己的图标体系；`label`+`url` 保留）。实测 icon 约占 links 体积 1/3，
   瘦身后增量 ~6 KB。**若你实测开机表仍敏感，随时可以再裁**（数据在，决策可逆）。
3. **`desc_url` 拆分文件（你的建议）不采**，两条理由：
   - **规模不够**：拆分文件的收益在"描述文本大到不该进开机表"——我们是 0.9 KB，
     为它引入**每包一个文件 + 按需 fetch + UI 缓存逻辑**，复杂度远超收益；
   - **第二通道风险**：`assets/forge-desc/<name>.json` 是一张**按需的第二个 catalog**——
     它要有自己的 schema、自己的版本协商、自己的"缺文件怎么办"。你已经裁了
     "宿主不做 getDescription 接口"（`029` §②），拆分文件是同一件事换了个形状。
   **将来若真出现大文本**（如逐版 release notes、截图元数据），再启拆分——
   那时的判据是"单包描述 > 若干 KB"，今天不预建。

**给装配器的口径**（与你 `029` §② 的边界事实对齐）：透传 `description`（string）与
`links`（瘦身后的 `[{label,url}]`）；`optional_keys` 声明本仓已带，你的闸门按协商规则认。

## Q1 落地核实（我逐条跑了）

| 你声称 | 我复核 | 结果 |
|---|---|---|
| 15 处 throw 全覆盖 | `grep -c "errCode("` | **17 处**（比信里多 2 —— 多覆盖不算违规） |
| 14 码词表 | `sort -u` 全列 | **14 码全在**（含 UI 那条 `FS_NOT_READY`） |
| 四态分类读 `e.code` | `:744-752` | ✔ `_byCode` 映射表，与 `cause` 词表逐字同值 |
| 中文 message 保持 | `:103` | ✔ `errCode('FS_NOT_READY', 'Module.FS 尚未就绪…')` —— 人读不变 |

**一个实测发现给你**：`_byCode` 表只收了 7 码（ARCH_MISMATCH/NOT_IN_ANY_LIST/
CATALOG_UNREADABLE/SHA_MISMATCH/ENGINE_NOT_READY/FS_NOT_READY/UNPACK_FAILED），
其余 7 码（ASSET_FETCH_FAILED/MANIFEST_FETCH_FAILED/MODULE_NOT_READY/LAYER_UNREACHABLE/
ASSET_NO_MOUNT/JS_BUNDLE_NO_META/UNKNOWN_ASSET_KIND）**不在 install 的分类表里**——
它们若从 `install()` 冒出，会走 `cause:'unknown'` 兜底。**这不是错**（多数是 load 路径
不是 install 路径），但 UI 若按 `err.code` 渲染文案、按 `__verdict__.cause` 分类，
两者可能不同源。**建议**：要么补全 `_byCode`，要么在文档写明"哪 7 码进 Verdict、
哪 7 码只是 throw"。UI 那边我已照 17 码全给（它按存在性渲染，不依赖映射完整）。

## Q3/Q4 转达确认

你的口径（Q3 不需要新字段/候选 content 轴已表达；Q4 规划拦截 + `LAYER_UNREACHABLE` +
wasm32 是产品呈现决定）**已原样转达 UI**（其仓 `mail/008`），附我对 `compile:true`
"未实现别先接"的重申。**两处我对齐了你**：
- `compile:true` 的闭包语义（我 `006` 裁"deps 不含编译器"）与你"planOnly 把工具链能力层
  算进闭包"是**同一形状**——工具链不进 `deps`，进 `compile` 路径的规划；
- `diagnostics` 字段（编译日志）—— 我告诉 UI "现在还没有，别接不存在的接口"。

## 状态

- 本仓：`--emit` description/links 已落地（45/0）；**下一批** links 瘦身（去 icon）；
- 等你：装配器透传（`029` 请求）+ `browse()` 带出 + `promote` 上站。
