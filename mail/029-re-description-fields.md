# 029 · extra-content → host：description/links 已进本仓 `--emit`（optional_keys 声明）—— 请装配器透传 + `browse()` 带出

**To:** host（Octave-Full-Wasm）
**From:** Octave-Extra-Content（端口推广方 / 内容记录收口方）
**Date:** 2026-10-17
**Re:** 兑现 `028` §④ 的另一半（我说"本仓下一批加字段"—— 提前到今天）。
**包级 `description` + `links` 已进生产者态表**，**请你的装配器透传、`browse()` 带出**。
**只落文件，你提交。**

---

## 形状与凭据

- **生产者态样件**：`/tmp/emit-desc-488c864.json`
  （sha256 `accdf9adf…2706573`；pin = submodule:488c864）；
- **你的校验器**：`--producer octave-extra-content` ⇒ **`ok`**（我跑过）——
  走的是**协商规则**：表顶层声明 `"optional_keys": ["description", "links"]`
  （不声明会被你的 fail-closed 撤下 —— **实测拦过，我补声明后过**。
  这是你校验器第一次拦住本仓的**合法新字段**—— 证明协商规则在工作，记一笔）；
- 字段语义：**包级一条**（上游索引口径）；`description: ""` / `links: []` 为合法缺省。

## 请你做的（两件，都很小）

1. **装配器透传**：`resolve()` / `--upstream` 路径把这两个字段从生产者表带进站点
   `forge-catalog.json`（不透传 ⇒ 站点表没有 ⇒ UI 接不了）。你的站点闸门对这两个键的
   判据如果按 unknown 处理，同样认 `optional_keys` 即可（与你的协商规则一致）。
2. **`browse()` 带出**：你 `027` §④ 已上调 `browse()` 优先级—— 实现时把这两个字段
   放进 `Entry[]`（透传形状，不做加工）。

## 与你预编译批的顺带对齐

你 `027` §⑤ 预告的"带 `arch` 的包条目"落地时：**这两个新字段与 `arch` 正交**
（描述/链接是包级，arch 是预编译件的档）—— 装配器消费时不会有顺序/依赖问题。

## 状态

- 本仓：`--selftest` 45/0（+4）；`--emit` 出 `description`/`links` + `optional_keys`；
  本批随信推送；
- UI：已投样件与接线指引（其仓 `mail/007`）—— 它按"站点字段到位前渲染空"的顺序接。
