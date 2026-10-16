# 68 · 「市场」架构的四个实测缺陷（design-it-twice 发现；N1/N2 已修，N5/N6 待做）

**Status:** ready-for-agent
**Settling:** `python3 build/113/check-forge-catalog.py --selftest && python3 build/forge-catalog.py --selftest` —— 两条自证全绿 ⇒ N1/N2 的判据在位（含各自的反向断言）；N5/N6 的结算件见各自小节（**尚未存在**）。
**N5 的结算件**：`python3 build/113/check-forge-catalog.py`（逐候选 —— 待第 3 步实现；今天只查被选中的那一版）；
**N6 的结算件**：新套件 `accept-content-attributes` 扩一条（装 `symbolic` ⇒ `layers` 含 pyodide 且 `bytes>0`）—— **尚未存在**。

## 背景

用户点令「先 codebase-design 设计个真正好的市场架构」。用 design-it-twice（四子代理独立出方案）
做的设计发现**四条实测缺陷**（判决书 = `build/113/NOTES-market-design.md`）。四条**都不是未来需求，
是已经漏过去一次的洞**。本工单管它们的**收口**。

## N1 · 宿主给自己开后门：装配产物从不过端口校验器 ✅ **已修（本批）**

```
$ grep -n "validate-content-list" build/113/check-forge-catalog.py
（空 —— 此前宿主豁免自己）
```
端口校验器只被用在**生产者表**（`forge-catalog.py --upstream`）上；宿主**自己产出的目录**
从未被查。⇒ 现役目录"恰好合规"是**巧合**而非判据。

**修**：站点闸门加 **R11** —— 宿主自产目录也以 `--site` 模式过产地的校验器（**复用，不另写一份**）。
**反向断言**：把任意条目的 `arch` 改成 `""` ⇒ 必红（自证里有；活体验过）。
**判据**：`check-forge-catalog.py --selftest` **27→30**；现役 `site/assets/forge-catalog.json` 仍 `ok`。

## N2 · R4 只有单向 + `derive_arch` 守卫差一格 ✅ **已修（本批）**

```
# 活体（修前）：伪造一条「claim 说含 oct、字节里 0 个 .oct」⇒ 闸门判定 ok（放行！）
```

**根因两处**：① 站点闸门 R4 只查"声明无 oct ⇒ 字节不许有"（反向不存在）；
② 装配器 `derive_arch()` 在"声明说含 oct 而字节里一个都没有"时返回 `("", [])`（问题清单空）
⇒ 守卫不触发 ⇒ **空串被写进目录**。

**真例**（同一形状的现成实例）：`shelf/packages/statistics.json` 的 `1.7.3` 声明
`kinds:['m','oct']`，而真 tarball（sha `570d52af…`，与档案相符）**0 个 `.oct`、13 个 src 文件**
—— 生产者自己的 `detect_kinds()` 也判 `['m','src']`。

**修**：R4 双向（"声明含 oct ⇒ 字节里必须有"）；`derive_arch` 的守卫补一格
（"声明含 oct 却 0 个"⇒ 进 `arch_problems` ⇒ `resolve()` 跳过该包并说明）。
**判据**：`check-forge-catalog.py --selftest` 含 R4 反向用例；活体：claim-vs-bytes 矛盾 ⇒ 必红。

## N5 · 逐版本声明**已经漂了**，而核验只覆盖被选中的那一版 ❌ **待做（第 3/6 步）**

```
$ python3 -c "import json,glob;print(sum(1 for f in glob.glob('shelf/packages/*.json')
              for v in json.load(open(f))['versions'] if not v.get('kinds')))"
38                                         ← 52 条版本记录里 38 条 kinds 为空（未经探包的主张）
$ python3 -c "import json;print(json.load(open('shelf/packages/statistics.json'))['verified'])"
{'tarball_sha': 'cef3c090aee13eaa', …}     ← = 1.7.7 的 sha ⇒ **1.7.3 从未被探过**
```

⇒ 用户要的"每个版本各带一个是否兼容的属性"，**连它依赖的输入（每版真实内容构成）都不可靠**。

**修（第 3 步 + 第 6 步）**：schema 3 加条目内 `versions[]`（逐候选派生轴 + `stage`/`withheld`）；
闸门逐候选查（R4/R5/R10 候选化）；**第 6 步回信内容仓**：38 条空 `kinds` 逐版本 probe。
**判据**：`versions[]` 里每条 `stage:"staged"` 的候选都带派生轴，`withheld` 的**不带**（不许编）。
⚠️ 跨仓（内容仓要动它的档案）⇒ 这是**发信 + 等回**的活，不是本批。

## N6 · 同一条事实，两个出口，两个答案 ❌ **待做（第 2 步）**

```
$ 8761 上 await OctaveAssets.install('symbolic')
{ "state":"ok", "installed":["pyodide","symbolic"],
  "layers": [], "bytes": 0, "acceleration": "not-built" }   ← 三字段是**字面量**
$ OctaveAssets.statusOf('symbolic').detail.acceleration
"none-needed"                                                ← 同一事实，另一答
```

`bridge/assets-loader.js:708` 把三字段**写死**（成功路径），而 `:504`（`statusOf`）与
`planOnly` 分支（`:630`）都**真算**。⇒ 装 `symbolic`（闭包含 22 MB 的 Pyodide）报 `bytes: 0`。

**修（第 2 步）**：成功路径复用 `planOnly` 的算法真算三字段；`install`/`statusOf` 走**同一个派生函数**。
**判据**：新套件断言"装 symbolic ⇒ `layers` 含 pyodide 且 `bytes>0`"+"装纯 m 包 ⇒
`acceleration='none-needed'`"（**今天两条都必红** —— 这就是反向断言的价值）。

## 判决书

`build/113/NOTES-market-design.md`（四方案对比 / 判决 / 9 步迁移路径 / 诚实的"无对账器"清单）。
**本批只做第 0、1 步**（零客户端改动、各自独立可验收、直接关掉 N1/N2）。
