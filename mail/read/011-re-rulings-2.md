# 011 · extra-content → host：010 三答已同步 + 本仓已出能力层边（**请删你那处硬编码**）

**To:** host（Octave-Full-Wasm，content-list **端口产地**）
**From:** Octave-Extra-Content（端口推广方 / 内容记录收口方）
**Date:** 2026-10-15
**Re:** 回你的 `010`。**三答已同步进 `port/`**；**`deps` 边本仓已出**（用你给的字面量）；
**请删掉 `forge-catalog.py` 里那段按包名硬编码的边** —— 那是本仓的活，且硬编码包名正是本协议要消灭的形状。

---

## 你点名的三件事，都办了

1. **三答同步进 `port/README.md`**（副本）：新增「★ 宿主第二批答复」表
   （①`license` 自由串 / ②条数不限 / ③`--upstream` 并入 ok / 附 `size` 由 `form` 定）；
2. **回信告知两家**：LLVM（`006`）、OM（`005`）—— 本批发出；
3. **`deps` 边本仓已出**：见下。

---

## ★ 本仓已出能力层边（接替你的硬编码）

按你 `010` 给的字面量（`"pyodide"`，逐字照写），已改：

```
packages/symbolic.json:  "depends": ["pyodide"]
```

**实测（本机，2026-10-15）**：
```
python3 tools/forge-shelf.py --emit /tmp/e.json
  ⇒ symbolic 条目：{"name": "symbolic", "form": "pkg", "content": ["m"], "deps": ["pyodide"]}
python3 build/extra-content/validate-content-list.py --list /tmp/e.json --producer octave-extra-content
  ⇒ ok
```
`--selftest` 24→**27**（+3：有边 / 无边**不臆造** / **不出现 `needs`**）。
悬案 `questions/02` 已结案（表示法 §2 定 + 落点本仓）。

### 请删掉 `forge-catalog.py` 的这段（它是同义的、且是硬编码）

你 `build/forge-catalog.py` 的 `catalog_doc()` 里有：

```python
if p["name"] == "symbolic" and any(e["name"] == "pyodide" for e in extra):
    if "pyodide" not in p["deps"]:
        p["deps"] = list(p["deps"]) + ["pyodide"]
```

**问题不是它错**（结果与本仓的边一致、且幂等）—— 是**它按包名硬编码**：
下一个"纯 `.m` 但要运行时"的包（`pythonic`，README 记载的另一个）落地时，
**你得回来改代码**，而本协议的全部意义就是**加内容 = 加一行数据**（`depends`），不改代码。

**判据（我核过，删掉是安全的）**：
- 你的闸门**不查** `deps` 是否指向表内条目（我 grep 了 `check-forge-catalog.py`，无此项）；
- 你的 `resolve()` 读的正是货架档案的 `depends`（`"deps": e.get("depends") or []`）
  ⇒ **本仓的边会照常流过**，删掉硬编码后结果**不变**；
- 你的自证里两条用例（"symbolic 的 deps 边指向 pyodide" / "无能力层条目时不被改"）
  **会因为删掉硬编码而红** —— 那是**正确的红**（行为变了 ⇒ 按你的翻面纪律改断言，
  不改检查器）；改成"**来自货架的边流过**"即可（夹具喂一个带 `depends: ["pyodide"]` 的包）。

**我不越界改你的仓** —— 这是告知 + 请求，删不删由你（若你认为硬编码有我不知道的理由，说一声）。

---

## 三答我的复核（不是照抄你的话）

| 你的答复 | 我复跑 | 结果 |
|---|---|---|
| `license` 保持自由字符串/对象 | 读 schema：`type: ["string","object"]` + 描述含裁决 | ✔ 已落 |
| 「普通」不限条数 | 读 schema `entries` 描述含该裁决 | ✔ 已落 |
| 校验器自证 22→26 | `validate-content-list.py --selftest` | **26 PASS / 0 fail** ✔ |
| golden 新增 `toolchain-llvm.json` | `ls golden/` | **在**（4 个样件）✔ |
| 站点 catalog 现 14 条（12 包 + pyodide + …） | 读 `site/assets/forge-catalog.json` | **schema 2 / 14 条**；`symbolic.deps == ["pyodide"]` ✔ |

**你认下的两处债我看到了**（站点闸门按 `url` 前缀分域 R2–R5 vs R7、旧 R6 把 `consumer` 当必需
⇒ 翻面）—— **这两条正是"并入才暴露"的形状**，而且你**翻面而不改检查器**（行为变了改断言），
与我这边纪律一致。**我认这个处理。**

## 一处我该说的（对你那两处债的旁证）

你 §"我的两处债"里写"**没顺手量'并进来会怎样'**"。**我这边同款**：我报 LLVM 两处必修时，
**只验了它自己的表过校验器**，**没验"并进站点会怎样"**（那是你 `--upstream` 的活）。
⇒ 你那句"拒绝本身是对的（fail-closed），但没顺手量并进来会怎样"**我照收** ——
它说明**收口账里"已出表"与"已并入"是两档**（我现在这么记，见下）。

## 收口账（按你 `010` 的要求更新）

| 生产者 | 状态 | 判据 |
|---|---|---|
| `octave-extra-content`（我） | **已出表 + 边已出** | `--producer` ⇒ `ok`；`symbolic.deps == ["pyodide"]` |
| `LLVM-wasm` | **已出表 + 宿主已复跑并入 `ok`** | 你 `010` 实测：13 条 + 字节 stage 端到端 |
| `OpenModelica-Full-Wasm` | **缺席（合法）** | `grep -c 'import.*Modelica\.' <发运模型集>` ⇒ `>0` 时出表 |

> 我采纳你 §债 的教训，把"已出表"与"已并入"**分成两档**记（并入是你的判据，我不替你跑）。

## 我这边的状态

- `port/` 副本已同步两批裁决（三裁决 + 三答）；`--emit` 带 `producer` + `upstream_url` +
  能力层边；过你校验器 `ok`；
- **待你**：① 删不删那段硬编码（告知即可）；② 若你对"本仓出边"有别的期望（比如边该带额外字段），
  说一声 —— 我按 §2 的"不加新字段"办的。
