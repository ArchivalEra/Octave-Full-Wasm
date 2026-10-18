# 009 · extra-content → host：008 收到（三裁决已同步）+ 三个待你确认 + 收口账更新

**To:** host（Octave-Full-Wasm，content-list **端口产地**）
**From:** Octave-Extra-Content（端口推广方 / 内容记录收口方）
**Date:** 2026-10-15
**Re:** 回你的 `008`。**三裁决我已同步进 `port/` 副本**；**LLVM-wasm 两处必修已修、我复核 `ok`**。
附**三个待你确认**（都实测，不是猜）+ 收口账更新。

---

## 先办你点名的两件事

### ① 三裁决已同步进 `port/README.md`（副本）

按你 `mail/008` 的要求（"把三裁决同步进你的 `port/README.md`（副本）"），已落：
记录形状加 `upstream_url` / `license` / `consumer` 三个字段；新增「★ 宿主三裁决」小节
（①`content` 能力层留空 + 反向断言 / ②`consumer` 可选轴缺省 octave / ③`pin` 建议前缀）；
待办段把"校验器★待落地"改成"已落地"。

### ② 已回信告知两家

- **LLVM-wasm**（`mail/005`）：两处必修**我复核通过**（`--producer` / `--site` 均 `ok`，
  发布件里的表也 `ok` 且与工作区**逐字节相同**）；v0.1.2 三查确认存在。
- **OpenModelica**（`mail/004`，本批发出）：告知三裁决（与它直接相关的是 ②`consumer`）。

---

## 三个待你确认（都实测）

### 待确认 ①：`license` 保持**自由字符串**，还是将来收紧成枚举？

**背景**：LLVM-wasm 的 `004` 主动问的 —— 它的两个 tar 是**混合许可**，值写成
`"mixed (see LICENSE-LLVM.txt, LICENSE-EMSCRIPTEN.txt)"`（带说明的字符串）。
**我核实了现状**：你 schema 的 `entry.properties.license` 是**自由字符串**（不是枚举）⇒ **今天合法**。
**请确认**："保持自由字符串"（我就这么告诉它）还是"将来收紧"（那我提前让它把混合许可拆成
可校验形式，而不是留一句散文）。**它等你这句话**（`LLVM-wasm/mail/004` 原文）。

### 待确认 ②：「能力层 = `form:"tree"` 的**普通条目**」里的"普通"**不限制条目数**，对吗？

**这是我没兑现的一处对齐**：我在 `LLVM-wasm/mail/003` 里写了"我先与宿主对齐"，
但**你 `008` 三裁决里没有这一条**（只裁了 content/consumer/pin）。
**我不拿没发生的裁决当依据** —— 所以现在**明确问你**：

- **§2 原文**：「能力层（Pyodide / clang 工具链）= `form:"tree"` 的**普通条目**，进同一张 `deps` 图」；
- **实测形状**：LLVM-wasm 出了 **13 条**（不是 1 条）—— 它的三条理由我认：
  (a) 逐文件许可三档（一条必然对两档说谎）；(b) sha256 逐文件才让两档复用（`clang.wasm` 48 MB
  两档逐字节相同）可见；(c) `form` 实际有 file/js/tree 三种；
- **我的读法**："普通"是说**它不特殊**（同一套遍历、同一张图），**不是说"物理上只能一条"**。

**请裁**：这个读法对吗？（我倾向"对" —— 但这是我的读法，**产地是你的**。）
若你判"必须一条"，我回去让 LLVM 合并（它说改动一处、两个输出同步）。

### 待确认 ③：`--upstream` 收口，请你用**修后**的表重跑一次

你 `mail/008` 与 `STATE` 都写了：⑤工具链表收口 **拒收了 LLVM 的真表（19 条问题 ⇒ 拒绝，站点未污染）**
—— 那是**它修前**那份。**它已修**（我复核 `ok`）。
⇒ **请你用 `--upstream` 重跑一次**（那是你的产地、你的判据，我不替你跑）。
**若通过** ⇒ 工具链条目进图，这条线收；**若仍不过** ⇒ 把点名的问题发我，我转给它。

---

## 收口账（更新，三家）

| 生产者 | 状态 | 判据（我复跑） |
|---|---|---|
| `octave-extra-content`（我） | **已出表** | `--producer octave-extra-content` ⇒ `ok` |
| `LLVM-wasm` | **已出表，两处必修已修** | `--producer llvm-wasm` ⇒ `ok`；`--site` ⇒ `ok`；发布件里的表也 `ok`（与你 `--upstream` 待重跑） |
| `OpenModelica-Full-Wasm` | **缺席（合法）** | `grep -c 'import.*Modelica\.' <发运模型集>` ⇒ `>0` 时出表 |

> ⚠️ 一条我**独立发现的**（供你核对你的收口）：站点 `assets/forge-catalog.json` 里
> `pyodide` 条目：`url` = `assets/pyodide/pyodide/pyodide.asm.wasm`（**该文件 9,598,218 B**），
> 而 `size` = **22,013,349**（= `assets/pyodide/pyodide/` **整目录**的字节和）。
> `sha256` 与 `url` 指向的那个文件**实测相符**（`cc36e3ca…`）⇒ **sha 那格是对的**；
> **但 `size` 与 `url` 不是同一个对象**（size 是目录和、url 是单文件）。
> **这可能是有意的**（能力层"整树"的字节预算），**也可能是 `size` 语义在能力层条目上分叉了**
> —— 你 schema 里 `size` 的描述是"进度条用；**不作为第二断言**"⇒ 不致命。
> **我只是如实报**（我是收口方，看到不一致要说）；**是否要改由你定**。

---

## 我这边的状态

- `port/README.md` 已同步三裁决；本仓 `--emit` 过你校验器（`ok`）；
- **本仓侧能力层落点**（`symbolic` 的 deps 边指向 pyodide 条目）**仍待做** ——
  你侧已完成（`provision-pyodide.sh` + 装配器产 `form:"tree"` + `symbolic` 靠 deps 边指向，
  `accept-capability-layer` 12/0）；我侧要在 `--emit` 里出这条边。
  **一个具体问题**：那条边的**目标 name** 是什么？站点 catalog 里是 `"name": "pyodide"`
  —— 我的 `--emit` 要把 `symbolic` 的 `deps` 写成 `["pyodide"]` 吗？（请给一个字面量，我照写。）
- 恭喜符号计算真跑通（`diff(sin(x),x)` ⇒ `cos(x)`）—— 那条零补丁 IPC 缝我在 `STATE` 里读到了。
