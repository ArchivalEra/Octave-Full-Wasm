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
golden/                      真样件（**必须过**校验）
  shelf.json                 货架（内容仓 `--emit` 的**真输出**，13 包）
  toolchain.json             LLVM-wasm 工具链样件（能力层 = form:"tree"，单条示意）
  toolchain-llvm.json        ★ LLVM-wasm 的**真输出**（release/content-list.json，13 条，2026-10-15）
                             —— 把「能力层可以多条」「license 自由字符串」两裁决钉在真数据上
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
- **能力层（Pyodide / clang）= `form:"tree"` 的普通条目**，进同一张 `deps` 图
  —— **不加新字段**（接缝 §2 判决；翻案 `R-015`/`R-016` 记着这条曾被我写错）。
  ★ **「普通」= 它不特殊（同一套遍历、同一张图），不是「物理上只能一条」**（2026-10-15 裁决）：
  LLVM 的 clang 工具链出 **13 条**合法（逐文件许可三档 + 逐文件 sha 才让两档 sysroot 复用可见）。
  `golden/toolchain-llvm.json` 就是那份真输出。
- **`license` = 自由字符串/对象**（2026-10-15 裁决）：真实产物**逐文件混合**（Apache-2.0 WITH
  LLVM-exception / MIT OR NCSA / AGPL）⇒ 不收紧成 SPDX 枚举（枚举会逼生产者说谎或拆条）。
  校验器只查**类型**；「写对了没」**没有机器判据**（如实记，不假称有）。
- **`size` 口径由 `form` 决定**（2026-10-15 裁决）：单文件 = `url` 指的那个文件的字节；
  **`form:"tree"` = 整树字节预算**（`url` 只是树里的一个锚；两者**不是同一个对象，都是有意的**）。
  站点闸门 R8 据此判 sanity；`size` **不参与 fail-closed**（唯一依据是 `sha256`）。

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

## 三裁决②（2026-10-15，回应内容仓 `mail/009` 的三个待确认）

| 待确认 | 裁决 | 落地 |
|---|---|---|
| ① `license` 保持自由字符串还是收紧成枚举 | **保持自由字符串/对象**（逐文件混合许可表达不成枚举；枚举会逼生产者说谎或拆条） | schema 描述 + 校验器**类型检查**（string\|object）；"写对了没"**无机器判据**（如实记） |
| ② 「能力层 = 普通条目」的"普通"限不限条数 | **不限**（"普通"= 它不特殊，不是"物理上只能一条"）；LLVM 13 条合法 | schema 描述 + 校验器"多条能力层⇒不报"正向断言 + `golden/toolchain-llvm.json`（真数据） |
| ③ 用 LLVM 修后的表重跑 `--upstream` | **已重跑，并入干净**（双模式 `ok`，13 条；`v0.1.2` 实测已真发布） | 隔离站端到端：并入+stage ⇒ 站点闸门 `ok`；**新增 `--upstream-bytes`**（stage 字节，R7b 拦 404） |

> 附件裁决（内容仓独立发现的 `size`/`url` 不一致）：**由 `form` 决定** —— 单文件 = 该文件字节；
> `form:"tree"` = 整树字节预算（pyodide：size 22,013,349 = 整目录，url 指树里主 wasm 9,598,218，
> **两者不是同一个对象、都是有意的**）。站点闸门加 **R8** sanity（`size` 不参与 fail-closed）。
>
> **顺手修了宿主自己两处门里的债**（并入 LLVM 才暴露）：站点闸门对非货架条目跑货架口径（R2/R4）
> ⇒ **26 条假红** ⇒ 改为**按 `url` 前缀分域**（货架包走 R2–R5；能力层/生产者表走 **R7**）；
> 旧 R6 要求"能力层**必需** consumer"与裁决②"**可选**"**自相矛盾** ⇒ **翻面**。

## 待办（本产地）

- [ ] **核 `pin` 的 `release:` 存在性**（要网络 + 各生产者仓可达性；新活，未做）
- [x] 生产者推广进度（内容仓在做）：**LLVM-wasm 两处必修已修、宿主复跑并入 `ok`**；OM 缺席（合法）

## 与内容仓的关系（2026-10-14 裁决后）

- **产地 = 宿主（本目录）**；内容仓**符合**它并**共发布副本**（`Octave-Extra-Content/port/README.md`
  是那份副本，它写着"两侧不一致时以宿主为准"）。
- **内容语义**（四态含义 / `content` 诚实 / 版本策略 / 许可台账）归**内容仓**；
  **形状与校验**归**宿主**（本目录）。
- **归属 ≠ 投送**：内容仓 private、UI 仓 public ⇒ UI 无法直读内容仓；内容语义的**归属**在内容仓，
  而**投送**（UI 实际拿到的表）走**宿主站点**。
