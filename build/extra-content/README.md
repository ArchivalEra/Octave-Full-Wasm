# build/extra-content/ · 额外内容**端口**（权威产地）

> **这是什么**：三仓（`Octave-Full-Wasm` / `Octave-Extra-Content` / `LLVM-wasm`）之间
> 那条接缝的**形状定义**。设计判决 = `build/113/NOTES-extra-content-seam.md`
> §2（记录形状）/ §4（产地）/ §5（增量路径）；**产地 = 本目录**（2026-10-14 裁决，
> 见 §8.1：端口是应用核心的**接受面**，宿主已有 R1–R4 判据范式，UI 读的是宿主站点的表）。
>
> **一句话**：**缝在「记录」上，不在「方法」上** —— 生产者发布**同一种表**，宿主作为
> 消费适配器读它；宿主的方法名是它内部的事。

## 目录

```
content-list.schema.json     唯一权威形状（枚举的单一产地 —— 校验器从这里读词表）
validate-content-list.py     纯 stdlib 校验器：--list F [--producer ID] [--site] ／ --selftest
golden/                      三个真样件（**必须过**校验）
  shelf.json                 货架（内容仓 `--emit` 的**真输出**，13 包）
  toolchain.json             LLVM-wasm 工具链（能力层 = form:"tree"）
  runtime.json               Pyodide 运行时（能力层 = form:"tree"，symbolic 靠 deps 边指向它）
bad/                         反向夹具（**必须红**；每类一条）
  sha-missing.json           sha256 缺失
  unknown-form.json          未知 form（不在词表）
  unknown-axis.json          未知键且未声明 optional ⇒ 撤下该条目（协商规则）
  empty.json                 空表（零值守卫）
  absolute-url-site.json     站点态用了绝对 URL（--site 模式必须红）
check-content-port.py        ★ 闸门：golden 全过 + bad 全红 + schema/校验器一致（自证三档）
```

## 表长什么样（规范键）

```json
{ "schema": 2, "octave": "11.3.0",
  "producer": { "id": "octave-extra-content", "pin": "submodule:<sha>" },
  "entries": [ { "name": "optim", "version": "1.6.3", "sha256": "<64hex>",
                 "url": "assets/forge/optim-1.6.3.tar.gz",
                 "form": "pkg", "content": ["m","src"], "deps": ["statistics"] } ],
  "optional_keys": [] }
```

- **`entries`** 是规范键；**`packs`** 是兼容别名（现役站点目录用 `packs`）——**只许出现一个**。
- **`form`** = 投送形态（`pkg`/`tree`/`oct`/`octdir`/`file`/`js`）；**`content`** = 内容构成（`m`/`src`/`oct`）；
  `kinds` 保留为兼容视图（= `content` 的旧名）。
- **能力层（Pyodide / clang）= 一条 `form:"tree"` 的普通条目**，进同一张 `deps` 图
  —— **不加新字段**（接缝 §2 判决；翻案 `R-015`/`R-016` 记着这条曾被我写错）。

## 两条纪律

1. **`url` 有两种合法形态，由模式区分**：
   - **生产者态**（默认）：可以是上游绝对 URL（"重取入口"，见 `docs/FORK-PIPELINE.md` §3）；
   - **站点态**（`--site`）：**必须同源相对**（COEP 拦跨域，实测）。
2. **未知键默认 fail-closed**：不在 schema 词表里、又没被表的 `optional_keys` 显式声明为
   可选的键 ⇒ **撤下该条目**（"忽略"是礼遇，不是默认）。

## 用法

```bash
# 生产者自证（不要求宿主在场 —— 这是"生产者能自证"的关键）
python3 build/extra-content/validate-content-list.py --list <你出的表.json> --producer <你的id>

# 站点态检查（交付前）
python3 build/extra-content/validate-content-list.py --list <表.json> --site

# 端口自身的闸门（golden 全过 + bad 全红 + 自证三档）
python3 build/extra-content/check-content-port.py
python3 build/extra-content/check-content-port.py --selftest
```

## 三裁决（2026-10-14，回应内容仓 `mail/007` 的缺口上报）

| 缺口 | 裁决 | 落地 |
|---|---|---|
| ① `content` 对能力层无合法取值 | **不扩枚举**；能力层 `content: []`（`content` 只对包有意义） | schema 描述 + 校验器**反向断言**（`form:tree` 带非空 content ⇒ 必红） |
| ② 消费面无处声明（OM 提出） | **加 `consumer`**（可选，`["octave","omc"]`，缺省 `octave`） | schema + 校验器取值校验 + 正反自证 |
| ③ `pin` 指向"未发布"无判据 | **建议前缀形态**（`release:`/`commit:`/`submodule:`，不强制） | schema 描述；**核 release 存在性登记为悬案**（待办见下） |

> 缺口③ 的实测背景：LLVM-wasm 的表写 `pin:"v0.1.2"` 而该版本**四处皆无**
> （本地 tag / 远端 tag / `gh release` / 磁盘 bundle）—— 形状合法但**无判据可拦**。

## 待办（本产地）

- [ ] **核 `pin` 的 `release:` 存在性**（要网络 + 各生产者仓可达性；新活，未做）
- [ ] 生产者推广进度（内容仓在做）：LLVM-wasm 已出表待修两处；OM 缺席（合法）

## 与内容仓的关系（2026-10-14 裁决后）

- **产地 = 宿主（本目录）**；内容仓**符合**它并**共发布副本**（`Octave-Extra-Content/port/README.md`
  是那份副本，它写着"两侧不一致时以宿主为准"）。
- **内容语义**（四态含义 / `content` 诚实 / 版本策略 / 许可台账）归**内容仓**；
  **形状与校验**归**宿主**（本目录）。
- **归属 ≠ 投送**：内容仓 private、UI 仓 public ⇒ UI 无法直读内容仓；内容语义的**归属**在内容仓，
  而**投送**（UI 实际拿到的表）走**宿主站点**。
