# NOTES-release-model · 「正式发布」到底指什么（源码包 vs 预编译件）

> 起因（用户 2026-10-18）：「我想规范一下插件市场，这个预编译包和源码包到底怎么才算正式发布，
> 你总不可能自己仓库里一个 release 28 个文件还分成俩版本」。
> 本文 = 判决书。**先给结论，再给实测依据与迁移步骤。**

---

## §1 结论（三句话）

1. **发布单位不是"28 个文件"，也不是"整个包集"** —— 是 **artifact =（包名, 包版本, 架构）**。
   现役 28 个 `.oct` 属于 **6 个包 × 2 个架构 = 12 个 artifact**（`control` 9 个文件本身是一个
   artifact 的内容，不是 9 个发布物）。
2. **wasm32 与 wasm64 不是"两个版本"** —— 是**同一个包版本的两份 artifact**，用 `arch` 区分。
   版本号永远来自**上游源码版本**（`optim@1.6.3`），架构是**索引键**，不是版本轴。
   ⇒ 用户担心的"一个 release 28 个文件分成俩版本"**在模型里不会发生**，因为架构不进版本号。
3. **两种发布各有各的判据，且判据都能机器验**（§3）：源码包发布 = 上游 tarball 的 sha 在目录里
   且字节在站点；预编译发布 = 该 (包, 版本, 架构) 的**每个** `.oct` 有 sha 且与站点字节相符
   + 产物自证（架构纯度 / TLS 入口 / 无 cxa_guard）+ 浏览器侧该档真调用通过。

---

## §2 现状实测（为什么"发布"今天没有定义）

| 事实 | 复跑 |
|---|---|
| 市场目录 14 条，**全部 `form:"pkg"`（源码 tarball）** | `python3 -c "import json;d=json.load(open('site/assets/forge-catalog.json'));print({p['form'] for p in d['packs']})"` |
| 带 `arch` 的条目 **0**；带 `artifacts` 的条目 **0** | 同上，检查键名 |
| 预编译 `.oct` 在**站点清单**里（6 条 `kind:"octdir"`），**不在**市场目录里 | `python3 -c "…manifest.json…kind=='octdir'"` |
| `install()` 只认 `form:"pkg"` 与 `form:"tree"`；`octdir` 只存在于站点资产装载路径（`load()`） | `grep -n "p.form" bridge/assets-loader.js` |
| 货架档案（内容仓）无任何预编译字段 | `python3 -c "…shelf/packages/optim.json…"` |
| 端口 schema 已预留 `octdir` 枚举 + arch 三档语义，**无生产者/消费者** | `build/extra-content/content-list.schema.json` |

**⇒ 根因**：预编译件今天是**站点资产**（随站发货、`load()` 装、没有版本），
**不是市场内容**（不进货架、不进目录、`install()` 拿不到、`browse()` 看不见）。
"发布"这个词对它们无定义——它们只是"被 cp 进站点的一堆文件"。

---

## §3 发布判据（两条门，各自可机器验、各自可证伪）

### A. 源码包发布（已存在，判据已在跑）

| # | 判据 | 现役闸门 |
|---|---|---|
| A1 | 目录条目有 `version` + `sha256`（上游 tarball） | 端口校验器 |
| A2 | `url` 同源相对、字节在站点且 sha 相符 | 站点闸门 R3 / R7b |
| A3 | 与货架档案 `(version, sha256)` 逐字对账 | R2 |
| A4 | `kinds` 与真字节一致（含/不含 `.oct` 双向） | R4 双向 |
| A5 | `verified` 非空（被某版 Octave 探过） | 装配器 `resolve()` 默认拒收未验证 |
| A6 | 版本候选集三不变量 | 端口校验器 versions 三条 |

**"正式发布"= A1–A6 全过**。今天 13 个货架包全过（`forge_catalog_packs` 台账键）。

### B. 预编译件发布（**本判决新立**；今天 0 条满足，因为字段都还没有）

一个 artifact 被认作**正式发布**，必须同时满足：

| # | 判据 | 机器判据（要造的闸门） |
|---|---|---|
| B1 | **身份齐全**：`(name, version, arch)` 三元组唯一；`version` 必须**等于**该条目某个源码候选的 `version`（预编译件不能凭空有版本） | 新增：artifact 的 version ∈ 该条目 `versions[].version` |
| B2 | **逐文件 sha**：artifact 里**每个** `.oct` 都有 sha256，且与站点字节**逐字节**相符 | 现有 `check-oct-lane.py` 的字节侧 + 新增 sha 清单核对 |
| B3 | **架构纯度**：artifact 内所有 `.oct` 的机器派生架构 == 声明的 `arch`（`oct-arch.py` 从 `dylink.0` 读，**不看目录名**） | 现有 `oct-arch.py` + `check-lane-purity.py` |
| B4 | **产物自证**：线程档每个 `.oct` 有 TLS 入口；两档都**不许**引用 `__cxa_guard_*` | 现有 `check-oct-lane.py` 判据①② |
| B5 | **构建溯源**：记录 `octave`（对哪版头编的）+ `toolchain`（emcc 版本）+ `recipe`（配方标识） | 新增字段（本判决定义） |
| B6 | **浏览器侧真调用**：该档 `accept-113-pkgoct` 通过 | 现有套件（两档各 27/0） |
| B7 | **架构界**：客户端只在 `hostArch == artifact.arch` 时提供它（错档必须响亮拒绝） | 现有 `install()` 的 arch 检查（要扩到 octdir） |

**"正式发布"= B1–B7 全过**。今天**没有任何一条**满足——因为 B1/B5 需要的字段在 schema 里
还不存在，`octdir` 也没进市场目录。

---

## §4 记录形状（判决：entry 级 `artifacts[]`，不塞进 `versions[]`）

**为什么不塞进 `versions[]`**：`versions[]` 的三条不变量是围绕**源码候选**写的
（顶层标量 == 某候选逐字）。artifact 是**我们自己构建的字节**，与上游 tarball 是不同物；
混进去会破坏"顶层标量 = 上游候选"的语义，且让 `stage`（字节在谁那）出现两种含义。

**判决形状**（端口 schema 3）：

```jsonc
{
  "name": "optim", "version": "1.6.3", "sha256": "<上游 tarball>", "url": "assets/forge/optim-1.6.3.tar.gz",
  "form": "pkg", "content": ["m","src"], "kinds": ["m","src"],
  "versions": [ /* 源码候选集，语义不变 */ ],

  "artifacts": [                        // ★ 新键：预编译件（宿主构建，逐架构一份）
    {
      "arch": "wasm32",                 // B3 派生，不是手写
      "octave": "11.3.0",               // B5：对哪版头编的
      "toolchain": "emcc 6.0.12",       // B5
      "recipe": "O2",                   // B5：配方标识（本批 A/B 定稿 = O2）
      "form": "octdir",                 // 投送形态：一包一组 .oct
      "files": [                        // B2：逐文件 sha（fail-closed 的唯一依据）
        { "name": "__bfgsmin.oct", "sha256": "…", "size": 57179 },
        { "name": "numgradient.oct", "sha256": "…", "size": 17025 }
      ],
      "url": "assets/octdir/optim/",    // 站点上的目录（同源相对）
      "stage": "staged"                 // 或 withheld + withheld_cause
    },
    { "arch": "wasm64", "…": "…" }
  ]
}
```

**三条不变量**（与 `versions[]` 同款纪律，新校验器逐条判）：

1. **唯一性**：同一 entry 内 `(arch, octave, toolchain, recipe)` 不得重复
   —— 即**一个架构一个配方只许一份 artifact**。想要第二份 = 换配方就得改 `recipe`
   且必须显式可见（不许静默替换）。
2. **版本锚定**：artifact 的 `version` **不单独存在**——它只能是 entry 顶层 `version`
   （= 某个源码候选），即"预编译件永远附着在某个已发布的源码版本上"。
3. **不许编**：`arch` 必须由字节派生；`files` 必须与站点字节相符；
   派生不出/字节不在 ⇒ `stage:"withheld"` + `withheld_cause`，**不许写一个猜的 arch**。

**为什么架构不进版本号**（用户最关心的那点）：版本号是**上游的事实**（`optim 1.6.3`），
架构是**我们的构建矩阵**。把架构塞进版本号 ⇒ 上游发 1.6.4 时我们要发两个"版本"，
用户看到 `optim-1.6.4-wasm32` / `optim-1.6.4-wasm64` 这种**并不存在的上游版本**
——那正是"28 个文件分成俩版本"的坏模型。⇒ **架构做索引键，不做版本轴。**

---

## §5 谁拥有哪一半（沿用既有裁决，不新开）

| 事实 | 产地 | 依据 |
|---|---|---|
| 源码包版本/url/sha/内容构成 | **内容仓**（货架档案） | 既有：`versions[]`、`detect_kinds` |
| **预编译件**（构建、sha、arch、toolchain、recipe） | **宿主（本仓）** | 既有：装配态 staged 由宿主（字节在谁那）；构建配方是宿主知识（`build-pkg-oct.sh` / `build-oct-lane.sh`） |
| 发布判据（A1–A6 / B1–B7） | **宿主**（端口产地） | 既有：`build/extra-content/` 是 schema 产地 |

⇒ **内容仓不需要为预编译件改档案**（它不构建、量不出 sha）。它在 `--emit` 里
**不声明** `artifacts`；宿主装配时**补上**。这与"staged 语义按谁持有字节"同一条纪律。
（若将来内容仓要"替某个包预编"，那是它自己建构建能力后再谈——今天不预建。）

---

## §6 迁移步骤（每步独立可验收）

| 步 | 做什么 | 判据 |
|---|---|---|
| 1 | 端口 schema 3：entry 加 `artifacts[]` + 三条不变量 + `$defs/artifact` | 校验器正反自证（唯一性/版本锚定/不许编 各一条反向） |
| 2 | 装配器产 `artifacts[]`：从 `assets/octdir-<lane>/<pkg>/` 逐文件量 sha + `oct-arch.py` 派生 arch + 从 `octave.build.json`/`build-inputs.json` 取 octave/toolchain/recipe | `forge-catalog.py --selftest` 增正反用例；现役 6 包 × 2 档 = 12 artifact 全部 `staged` |
| 3 | 站点闸门新增 **R13**：`artifacts[]` 与站点字节逐文件对账（缺一件/多一件/sha 不符 ⇒ 红） | 自证含三条反向 |
| 4 | 客户端：`install(name, {arch})` 认 `form:"octdir"`（按 artifact 逐文件拉 + 校验 + 落盘 + addpath）；`browse()` 带出 `artifacts[]` | 新套件 `accept-market-artifact`（正：装 optim 的 w64 artifact 后 `bfgsmin` 真算；反：错档必须 `arch-mismatch` 拒绝） |
| 5 | 把 6 条站点清单 `octdir` 资产**降级**为"随站预置"（保留，不删），市场路径成为**可选按需拉取**的第二条路 | 两条路并存：随站 = 0 请求；按需 = `install` 拉。`accept-113-pkgoct` 两档仍 27/0 |
| 6 | 文档：`CONTEXT.md` 加「artifact（预编译件）」词条；`DEPLOY.md` 写发布判据 A/B；给内容仓发信（告知 B 判据归宿主、它无需改档案） | 三语 README 同批 + mail |

**第 1–3 步是零客户端改动**（与市场判决书第 0/1 步同款节奏），可以先落；
第 4 步才动 `install()`（有真实 UI 需求时再做——`browse()` 已能带出，UI 可先只展示"有预编译件"）。

---

## §6b 落地实测（2026-10-18，第 1–2 步已做）

| 步 | 状态 | 凭据 |
|---|---|---|
| 1 schema 3：entry `artifacts[]` + `$defs/artifact` + 三条不变量 | ✅ | 校验器自证 46→**52/0**（+6 正反：唯一性/版本锚定/缺 arch/staged 无 files/withheld 合法） |
| 2 装配器产 `artifacts[]`（逐文件 sha + `oct-arch.py` 派生 arch + octave/toolchain/recipe） | ✅ | `forge-catalog.py --selftest` 32→**35/0**；三站 rebake 真产出 **10 个 artifact** |

**实测形状**（现役站点）：

```
geometry       wasm32(1 文件)  wasm64(1)
miscellaneous  wasm32(2)       wasm64(2)
optim          wasm32(5)       wasm64(5)
statistics     wasm32(7)       wasm64(7)
struct         wasm32(4)       wasm64(4)
```

⇒ **5 包 × 2 架构 = 10 个发布单位**，不是 28 个文件（`optim` 的 5 个 `.oct` 是**一个**
artifact 的内容）。这正是用户担心的"28 个文件分成俩版本"在模型里的正确形状。

**★ 一处必须如实记的边界**：`control`（9 个 `.oct`，含 slicot）**不在货架档案里**——
它是**站点侧随站预置资产**（11.3.0 随站包，不是"按需拉取的额外内容"）。
⇒ 装配器只给**货架包**产 artifacts，`control` 的预编译件今天**没有发布身份**
（它随站发货，用户从不"安装"它）。若将来 `control` 要进市场，得先把它加进货架档案
（内容仓的活）；在那之前它的 9 个 `.oct` 属于 §3 的"站点资产"而非"市场发布物"。
**这条边界不粉饰**：现在 10/12 个 artifact 有发布身份，`control` 的两个是站点资产。

## §7 诚实边界

1. **今天 0 条 artifact 是"发布"态**：字段不存在 ⇒ 这条规范落之前，预编译件只能算
   "站点随附资产"，不能算市场发布物。如实记，不粉饰。
2. **构建不可位复现**：同一配方重编出的 `.oct` sha 会变（emcc/ccache 状态）。
   ⇒ 发布判据只能锚在**当次字节的 sha**（B2），不能锚"配方能重现"。
   `recipe` 字段是**溯源标签**，不是"可复现承诺"。
3. **`octdir` 的按需拉取有成本**：一包 9 个文件（control）要 9 个请求（或一个 bundle）。
   第 4 步实现时再决定"逐文件"还是"打 tar"；今天不预建 bundle 格式。
4. **配方空间已榨干**（预编译批 A/B 实测）：`-O3` +11% 体积零收益、LTO 弄坏 dlopen、
   `wasm-opt` 无感 ⇒ 短期内不会有"同一架构第二个 recipe"的真实需求；
   `recipe` 字段的现值就是 `O2`，唯一性的反向断言现在就能写。
