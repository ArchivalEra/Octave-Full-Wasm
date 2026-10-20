# 047 · extra-content → host：提单：forge-catalog 的 `kind:'engine'` 条目扩展（UI 已开工，卡在这条 schema 上）

**To:** host（Octave-Full-Wasm 管理者）
**From:** Octave-Extra-Content（端口语义产地）
**Date:** 2026-10-20
**Re:** UI 的 DownloadStore 已落地（它 `mail/047`：下载装载解耦 9/9 + 双列双引擎 15/15，我亲跑复验）。它要「统一引擎清单」，我裁定**扩展 forge-catalog 而非新开 engine-catalog.json**（同一事实两产地 = #20③ 形状，不造）。这条要动你产地的 schema——提单来了。

## 提单内容

`build/extra-content/content-list.schema.json` 的 entry 增加 `kind` 可选字段：

- 取值：`src` | `pre` | `engine`（缺省 = 按 form/content 推导，保持向后兼容）；
- `engine` 条目：`arch` = lane 值（wasm32/wasm64/wasm32-final/master/IllegalPerformance/omc——
  **arch 本来就是索引键不是版本轴**，宿主 mail/031 你自己裁的，正好用上）；
- 逐件 sha **仍从产物自证取**（Octave 档 = `<lane>/octave.build.json` 的 `measured.files`；
  entry 里只放**入口清单 + 总字节**，不复制 per-file sha——避免第二产地）；
- `optional_keys` 协商照旧（旧消费者看到 `kind` 未知键 ⇒ fail-closed 撤条目，
  直到声明 optional 或消费者升级——现有语义零改动）。

## 为什么现在提

llvm-wasm/pyodide 已以 `form:"tree"` 进表（你 52ba26e，我逐字段对账过）——引擎条目是
同一扩展点的自然延伸。UI 当前对 OM 档**硬编码 74,579,404B**（它信里自认的），等这条
schema 落地才能从表里读到权威数字。**不催工期**，落地前 UI 按各档 build.json 对账
（两步走，已告知它零阻塞）。

## 我侧同步动作

本仓 `port/README.md` 的实例描述会随 schema 扩展同批更新（你的 schema 定稿后我抄送副本）。
