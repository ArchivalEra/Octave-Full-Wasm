# NOTES · 「额外内容市场」架构设计判决（design-it-twice，2026-10-16）

> **触发**：用户点令 ——「先 codebase-design 设计个**真正好的市场架构**」。
> **方法**：`codebase-design` 的 **design-it-twice**（四子代理独立出**激进不同**的接口 →
> 对比 depth / locality / seam 位置 → 判决）。四份原始设计在会话里；**本文是判决 + 可执行路径**。
> **前置纪律**：每条"现在如此"旁注复跑方式；推断标注；**未落实现的都在 §5**。

---

## §0 ★ 先摆四条实测缺陷（它们改变了设计的前提）

**用户给的那条"真例"经四子代理 + 我独立复核，是错的**——而真相比它更硬：

### N5 · 逐版本声明**已经漂了**，而核验只覆盖被选中的那一版

```
$ python3 -c "import tarfile;tf=tarfile.open('/mnt/hdd/octave-wasm-build/third_party/forge/statistics-1.7.3.tar.gz');
              n=tf.getnames();print('oct 数',sum(1 for x in n if x.endswith('.oct')),'src 数',sum(1 for x in n if '/src/' in x))"
oct 数 0 src 数 13                                    ← 1.7.3 真字节里**没有** .oct

$ python3 -c "…shelf/tools/forge-shelf.py 的 detect_kinds…"
detect_kinds(statistics-1.7.3.tar.gz) = ['m','src']    ← 生产者自己的判据也这么说

$ python3 -c "import json;d=json.load(open('shelf/packages/statistics.json'));
              print([(v['version'],v.get('kinds')) for v in d['versions']]); print(d['verified'])"
[('1.7.7', ['m','src']), ('1.7.3', ['m','oct'])]      ← **声明与字节矛盾**
{'tarball_sha': 'cef3c090aee13eaa', …}                ← = 1.7.7 的 sha ⇒ **1.7.3 从未被探过**
```

**规模**：52 条版本记录里 **38 条 `kinds` 为空**（= 未经探包的作者主张）；而 `verified` 是
**条目级**、只覆盖 `pick_version()` 选中的那一版。⇒ **"每个版本各带一个是否兼容的属性"这件事，
今天连它依赖的输入（每版的真实内容构成）都是不可靠的。**

### N1 · 宿主给自己开了后门：装配产物从不过端口校验器

```
$ grep -n "validate-content-list" build/113/check-forge-catalog.py
（空）
$ python3 build/extra-content/validate-content-list.py --list site/assets/forge-catalog.json --site
⇒ ok                                ← 今天恰好合规
```

但这是**巧合**而非判据：宿主装配器产出的目录**从未被端口校验器查过** —— 只有**生产者表**
（`--upstream`）走那条路。同一个文件在"生产者身份"下会被查、在"宿主自产"下不查。

### N2 · 站点闸门 R4 **只有单向**（活体证明）

```
# 伪造一条「claim 说含 oct、字节里 0 个 .oct」的条目 ⇒ 闸门判定：
$ …（夹具：真 tarball 无 .oct + kinds=("m","oct")）…
claim 说含 oct、字节里 0 个 .oct ⇒ 闸门判定: ok（放行！）
```

R4 的实现（`build/113/check-forge-catalog.py:170`）只有 `if "oct" not in kinds: …查字节…`
——**反向（`"oct" in kinds` ⇒ 字节里必须有 `.oct`）不存在**。⇒ N5 那种声明可以永久说谎。

### N6 · 同一条事实，两个出口，两个答案（活体）

```
$ 8761 上 await OctaveAssets.install('symbolic')
{ "state":"ok", "installed":["pyodide","symbolic"],
  "layers": [], "bytes": 0, "acceleration": "not-built" }      ← layers/bytes 是**字面量**
$ OctaveAssets.statusOf('symbolic').detail.acceleration
"none-needed"                                                  ← 同一事实，另一答
```

`bridge/assets-loader.js:708` 把 `layers: []`/`bytes: 0`/`acceleration: 'not-built'`
**写死**（成功路径），而 `:504`（`statusOf`）与 `planOnly` 分支（`:630`）都**真算**。
⇒ 装 `symbolic`（闭包含 22 MB 的 Pyodide）报 `bytes: 0`。

> **这四条都属"已经漏过去一次"的洞**，不是未来需求。⇒ **设计必须以它们为起点**，
> 且**先修宿主自己**（否则新接口建在流沙上：宿主自产的目录都过不了自家端口校验器）。

---

## §1 四方案对比（depth / locality / seam 位置）

| | ①极简 | ②最大灵活 | ③常见调用者 | ④端口-适配器 |
|---|---|---|---|---|
| 入口 | `query`+`install` | `install`+`versionsOf`（+批量） | `install`+`browse` | 不新增（两端口不动） |
| 版本轴 | 条目内 `versions[]`（含 `stage`/`withheld`） | 顶层 `alternates` | 条目内 `versions` + `optional_keys` | 条目内 `variants` |
| 取得方式 | `ways` **派生字段**（三值求值） | `compile` 选项（3 值） | `source` 选项（2 值） | `{compile:true}` = 第三个适配器 |
| **独有贡献** | **`withheld` 诚实态**（未 stage ⇒ `compatible: null`，不编）；`ways` 不属记录的论证 | **`alternates` 规避 last-wins**：现役客户端按 name 建索引是**静默最后者胜** ⇒ `packs` 多行会让**旧页面选错架构** | **708 行 `.m` 路由**的发现 + `statusOf` 应搬进 async `browse` | **N1/N2/N3** 三条宿主缺陷 + 「市场」**本身该删** |
| 删除测试亮点 | 删 `query` ⇒ 散到 ≥4 处 | 砍 11 条（并列/卸载/取消/mirror/签名…）且说清复杂度去哪消失 | 删 `install` ⇒ ~1060 行散到 49 个调用点 | 删「市场」module ⇒ **复杂度消失**（它里面什么都没有） |

**四方案独立得出的共识**（最强信号）：

1. **不加"版本属性"** —— 口语诉求要翻译成"**三个属性按版本求值**"，不是第四个布尔。**四处全票**。
2. **取得方式不属记录** —— 它是（候选 × 宿主 × 站点）的函数；写进记录 = 第二份真值。**全票**。
3. **缝仍在「记录」上** —— 不新开「市场」module（零适配器 ⇒ 纯设想）。**全票**。
4. **不引入"每版本一个存储的 compatible 布尔"** —— 会漂，而**已经漂了**（见 N5）。**全票**。

---

## §2 判决

**取 ① 的骨架 + ② 的兼容键纪律 + ③ 的 `browse` + ④ 的修复顺序。**

| 决定 | 取谁 | 为什么 |
|---|---|---|
| **不加第四个属性**；三属性**按版本求值** | 全票 | N5 证明"每版声明会漂" ⇒ 存储的每版布尔是第二真值；必须是（候选 × 宿主）的**函数** |
| **版本轴 = 条目内 `versions[]`**（不是顶层 `alternates`） | ①③ | `alternates` 会破掉"一个 name 一条"不变量，而 **4 个验收套件**用 `packs.find(p=>p.name===)` 依赖它；`optional_keys` 已能优雅过渡 |
| **未 stage 的候选带 `compatible: null`**（不编） | ① | 只有它正面回答"没 stage 怎么报"——"不编假状态"纪律的直接延伸（对齐 `statusOf` 查无 ⇒ `null`） |
| **取得方式 = 派生字段 `ways`**（不是新轴） | ①② | 站点供没供 ≠ 包的性质（内容仓 `mail/014` 裁"硬依赖"时用过的同一条论据） |
| **`statusOf` 搬进 async `browse`**，旧名留作兼容视图 | ③ | 今天它是**同步方法但依赖异步缓存**，契约只写在测试注释里 ⇒ 接口缺陷 |
| **砍掉清单**：并存/卸载/取消/mirror/离线/`nodeps`/签名/事件总线 | ② | 每条都有删除测试；`nodeps` 尤其**与刚结案的硬依赖裁决冲突** |
| **先修 N1/N2/N6，再做接口** | ④ | 否则新接口建在流沙上（宿主自产目录过不了自家端口校验器） |

**「市场」这个词**：`CONTEXT.md` 已定名纪律——**它只是额外内容的 UI 形态，不是概念本身**。
判决：**不建 module**（删除测试：删掉它复杂度消失）。

---

## §3 目标接口（判决后的形状）

```js
// 读面（async；把 statusOf 的三属性 + 版本候选一次给出）
await OctaveAssets.browse()          // → Entry[]，一行一条（UI 渲染用）
Entry = { name, version, versions:[{version, content, arch, requires, stage}],
          fromSource, compatible, installed,     // ← 三属性（按解析出的那一版）
          state: 'available'|'installed'|'blocked'|'unknown', why }

// 做面（默认路径一行不变）
await OctaveAssets.install('optim')                          // 渠道/版本/取得方式全隐式
await OctaveAssets.install('statistics', { version:'1.7.3' }) // 显式钉版本
await OctaveAssets.install('datatypes', { compile:true })     // 现编（第三适配器）
await OctaveAssets.install('symbolic', { planOnly:true })     // 预演零下载（已有）

// Verdict（四态不可塌陷；★ 修 N6：三字段真算）
{ state:'ok'|'failed'|'not-found'|'cannot-know', name, version,
  installed:[…], layers:[{name,bytes}], bytes:{fetched,planned},
  acceleration:'built'|'not-built'|'none-needed',
  resolved:{version, reason:'explicit'|'newest-compatible'}, cause, why }
```

**版本解析规则**（唯一产地）：候选 = 表内该 name 的全部版本 ∩ `requires` 满足 ∩ **`arch` 与宿主档一致**
∩ **本档已 stage** ⇒ 取最高；空 ⇒ `not-found` + `cause='version-not-found'`。
**`reason` 必须报出来**（"为什么是这版"不许猜）。

---

## §4 "每个事实归谁"（含**无对账器**的诚实清单）

| 事实 | 产地 | 对账器 | 状态 |
|---|---|---|---|
| 哪些 name 存在 | 内容仓 | 生产者部分闭合 | ✅ |
| **一个 name 有哪些 version** | 内容仓 | **无** | ❌ N5 的土壤 |
| **每版的真实内容构成** | 内容仓 `detect_kinds`（从字节） | 宿主 R4（**单向**） | ❌ N2 |
| **版本策略**（哪版给哪个引擎版本） | 内容仓 | **无**（且代码三份副本） | ❌ |
| arch | 宿主（从字节派生） | R10 + 车道纯度 | ✅ |
| 字节 sha256 | 内容仓档案 | 三段各核 | ✅ |
| `verified` == 上架版 | 内容仓 | **无** | ❌ N5 |
| **宿主自产目录的合规** | 宿主 | **无（后门）** | ❌ N1 |
| `catalog.shelf_commit` == submodule pin | 宿主 | **无** | ❌ |
| `catalog.octave` == 站点 `VERSION` | 宿主 | **无** | ❌ |

> 六个 ❌ = "没有对账器的『必须一致』"（AGENTS C4 纪律的现成实例）。

---

## §5 迁移路径（每步独立验收；★ 先修宿主自己）

```
第 0 步（零客户端改动）★ N1：站点闸门加 R11 = 宿主**自己产出的目录**也过端口校验器
   ⇒ 判据：现役 site/assets/forge-catalog.json 仍 ok；把任意 arch 改成 "" ⇒ 必红
第 1 步 ★ N2：R4 补反方向（claim 含 oct ⇒ 字节里必须有）；derive_arch 守卫补一格
   （"声称有 oct 却一个都没找到"必须进 arch_problems ⇒ 该包被 skip 并说明）
   ⇒ 判据：statistics 1.7.3 那类条目 ⇒ 必红（真字节夹具，可复跑）
第 2 步 ★ N6：install() 成功路径三字段改真算（复用 planOnly 的算法）+ 同形状返回
   ⇒ 判据：装 symbolic ⇒ layers 含 pyodide 且 bytes>0；装纯 m 包 ⇒ acceleration='none-needed'
第 3 步 schema 3：条目内加 `versions[]`（含 stage/withheld）+ 三条不变量 + 逐候选轴派生
   ⇒ 判据：顶层标量 == 某候选（逐字）；未 stage 候选**不带**派生轴（不许编）
第 4 步 装配器：resolve() 逐版本遍历（withheld 如实落账）；删三份版本解析副本（收成一份）
   ⇒ 判据：现役目录 diff 为空（向后兼容）
第 5 步 客户端：browse() + 版本解析（arch ∩ 本档已装配）+ Verdict.resolved
   ⇒ 判据：新套件 accept-market（多版本/取得方式/withheld 各一 + 反向）
第 6 步 修 N5 的源头（内容仓）：38 条空 kinds 逐版本 probe；回信请它出 versions 轴
第 7 步 way:'compile' 接第三个适配器（与 NOTES-client-compile-design §9 合流）
第 8 步 补 §4 的六个 ❌ 对账器（shelf_commit / 引擎 VERSION / verified / …）
```

**本批只做第 0、1 步**（零客户端改动、各自独立可验收、直接关掉两个实测洞）。
**余下每步 = 后续批次**；第 6 步要跨仓（发信内容仓）。

---

## §6 诚实边界

- **今天没有真实用例**：现役目录 14 条里**0 条带 `arch`**、0 条含 `.oct`（`grep` 实测）
  ⇒ 版本轴/架构界都是**前瞻性**的（给 v2 与第三方 `.oct` 内容备位）。
- **三个"整块未实现"的东西**（`compileExtension` 0 命中、工具链不在站点、`consumer` 零读者）
  ⇒ 设计给它们**留位不假称已通**。
- **"市场"不是 module**：判决见 §2；它的价值是**验收测试的名字**（"市场能力清单"），
  不是新接口。
- 四份原始设计里各有一处**我方修正或质疑**（① 的 `versions[]` vs `alternates` 之争、
  ② 的 11 条砍掉清单、③ 的 708 行路由、④ 的 N1–N3）—— 全部记在 §1/§2，未丢。
