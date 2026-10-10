# NOTES · Forge **按需拉取**插件系统（设计稿 v0，2026-10-09）

> 用户口径（原话）：
> - "我们要建立一个插件系统，要跟 fork 管线紧密贴合，我们要去 Octave-Forge 社区购物啦！"
> - "我想做成那种**客户端按需拉取**的东西，现在他那边 **8MB 拉取单个引擎是极其亮眼的成果**，
>   我认为这个插件系统应该**围绕按需下载来设计**"。
>
> 本文是**设计稿**（未实现）。性质：机制大部分已存在（下面逐条点名），本设计定义**组装方式** +
> 明确要补的那两处缝。

---

## §0 先分清：本仓有**两个**"插件"——别让它们互相冒充

| | **部件插件**（工单 61，已定稿 v1） | **Forge 按需插件**（本单） |
|---|---|---|
| 轴 | **构建期**：换链进来的库/旗标/第三方补丁（BLAS / 分配器 / rust 缝） | **运行期**：用户要哪个包，**客户端才去拉**哪个 |
| 面 | 影响**所有用户**的产物（一次构建，全站生效） | 影响**单个会话/页面**（谁 load 谁有） |
| 粒度 | 车道（lane）级 | 包（package）级，可装可卸 |
| 已落地 | `build/plugins.json` + `plugin-check.py`（R1/R2/R3，挂 pre-commit） | **本设计** |
| 载体 | `relink.sh` 模式表旋钮 + 产物 `declared` 标签 | 站点 **catalog** + 客户端 **installer** |

**它们共享的只有两条铁律**（本仓一贯）：
① **不许脱离 Octave 树**——包按 `pkg install` 的真实布局装，不另发明一套；
② **补丁不打在补丁上**——每个包独立可装/可卸，互不污染。

> ⚠️ 命名提醒（避免下一个维护者读错）：`build/plugins.json` 里没有、也**不该有** Forge 包；
> Forge 侧另有货架（`build/113/forge-catalog.json`）+ 登记（见 §5）。

---

## §1 为什么"围绕按需下载"是对的（8MB 引擎那条成绩的延伸）

实测载荷（复跑见 §9）：
- 现在整站首包 ≈ 11.6 MB，其中随站发的 Forge 资产 **`assets/pkg/` 12 个包 ≈ 12 MB**；
- 引擎侧**已经**是懒加载模型：`bridge/assets-loader.js` 的 `OctaveAssets.load(name)`
  **用到才 fetch、sha256 校验、写 MEMFS、dlopen、>8MB 异步预加载**（`SYNC_COMPILE_LIMIT`）。
- ⇒ Forge 包却还是"**构建期全打包、随站发**" ⇒ **12 MB 对每个用户都强制下载**，而多数人一辈子不用 `optim`。
  这与"8MB 单引擎按需拉"的成绩**直接矛盾**。

**目标**：把 Forge 包从"随站发的胖资产"改成"**货架上的条目**"——用户/页面需要时才拉，
拉到才装；没用到 = **0 字节**。这是**深度**的直接体现：客户端要学的接口不增加，能拉的东西变多。

---

## §2 现状盘点（机制已有 80%——本设计是收编，不是从零造）

| 层 | 现有件 | 复用方式 |
|---|---|---|
| **采购（构建期/宿主）** | `build/forge-fetch.py`（读 `gnu-octave.github.io/packages/packages.json`，**依赖递归 + 按 Octave 版本过滤 + sha256**） | 升级为**货架生成器**：不再只下载，而是产出 catalog |
| **打包** | `build/assets.py bundle-pkg`（**忠实模拟 `pkg install`**：`inst/` 上提、PKG_ADD 抽取、元数据） | 复用其**布局规则**，作为"客户端安装器"的规范来源（§4） |
| **打包（编译件）** | `build/113/build-pkg-oct.sh`（`src/*.cc` → wasm `.oct`，模块表写死） | 决定"含编译件的包"是否进 v1（§6 分叉） |
| **运行期装载** | `bridge/assets-loader.js`：`load(name)` / `deps` / `sha256` / `aliases` / `preloadIfHuge` | **接口就在这里扩**（§3） |
| **Octave 侧装载** | `build/webshims/pkg.m`（`pkg load <未装载包>` ⇒ 触发页面装载 + `pause` 轮询 ⇒ 委托核心 `pkg.m`）+ `build/pkgfix/*`（磁盘现状 → 核心 pkg 数据库） | **已存在的"按需"语义**：`pkg load` 就是触发器 |
| **可加载名单（Octave 侧）** | `build/pkgfix/__webassets_available__.m`（读 `/tmp/webassets.json`） | catalog 装进来后，`pending/available` 自动跟上 |
| **fork 管线** | `upstream/` 子模块 + `provision-upstream.sh` + `witness-upstream-pin.py` | **包不是 submodule**——见 §5 的 pin 形状 |

**结论**：**缺的只有两处缝**：① 客户端**没有上游货架概念**（不知道 Forge 上有啥）；
② **没有运行时安装**（只能构建期打包成 JS bundle 随站发）。本设计就补这两处。

---

## §3 接缝在哪（codebase-design：深模块 + 小接缝）

### 3.1 主接缝 = `OctaveAssets`（已存在，扩它，不另起）

`OctaveAssets` 已经是**深模块**：小接口（`init/list/load/isLoaded/loaded/onLoad`）+
深实现（fetch + sha + MEMFS + dlopen + deps + aliases + >8MB 预加载）。
**不要**为 Forge 另造一个加载器——那会把"依赖/校验/装载"的复杂度复制一份出第二个产地。

**接口只加两个方法**（其余全靠 catalog 数据驱动）：

```js
OctaveAssets.catalog()                   // → { packs: [{name, version, size, deps, kinds, source}] }
                                         //   读站点 catalog（§5），**不下载任何东西**
OctaveAssets.install(name, {onProgress}) // Promise<{name, version, installed:[…依赖闭包]}>
                                         //   依赖闭包解析 → 逐个 fetch+校验+落盘 → addpath → PKG_ADD
```

`load(name)` 语义不变（向后兼容：老清单继续走老路）。**新**：`install()` 面向 catalog 条目，
`loaded[name]` 记录中多一个 `source: 'catalog'` 字段供诊断。

**深度检验**：删掉 `install()`，复杂度会**回到每个调用点**（每处都要自己解析依赖、校验 sha、
按 `pkg install` 布局落盘、跑 PKG_ADD）⇒ 它挣到了位置。

### 3.2 谁调用它（两个调用点 = 真接缝）

1. **页面（UI）**：一个"包商店"面板/命令 ⇒ `OctaveAssets.install('statistics')`；
   进度走 `onProgress`（**复用现成的 state 通道**，见 UI gh#2 里说的 `booting→idle` 模式）。
2. **Octave 内部**：`pkg load <名>`（`build/webshims/pkg.m` **已经**在拦这个）——
   若 catalog 有、磁盘没有 ⇒ 触发同一次 `install()`。**这条已存在**，只是现在触发的是
   `OctaveAssets.load()`（随站清单）；改成先问 catalog。

### 3.3 第二个接缝 = "货架"（catalog）

```json
// <站点>/assets/forge-catalog.json（生成物）
{ "schema": 1,
  "octave": "11.3.0",            // 过滤基准（= fork 的 Octave 版本，§5）
  "generated_by": "build/forge-catalog.py <sha>",
  "packs": [
    { "name": "statistics", "version": "1.7.3",
      "size": 1366564,
      "sha256": "…",                          // tarball 的 sha（上游 index 给的）
      "url": "<站点>/assets/forge/statistics-1.7.3.tar.gz",  // **同源**，非跨域！见 §7
      "deps": ["io","nan"], "kinds": ["m"],   // kinds: m | oct（编译件）
      "install": { "upstream": "…/statistics-1.7.3.tar.gz", "verify": "sha256" },
      "note": "…" } ] }
```

**为什么 catalog 由构建期生成、而不是客户端直接读上游 `packages.json`**：
① **同源**（COI/CORS：跨域 fetch 会踩 COEP，见 §7）；② 上游 index 144 个包 / 332 KB，
客户端不该全下；③ **可以只把"我方验证过能装"的包放上货架**（§8 的准入闸门）。
⇒ catalog = **我方 curation 过的上游快照**，不是上游的镜子。

---

## §4 安装语义：**忠实 `pkg install`**（不许脱离 Octave 树）

`bundle-pkg` 的文件头已经把规则写死了，客户端安装器**必须逐条对齐**（否则 `pkg load` 之后
`help`/子目录 addpath 会静默坏掉）：

1. `inst/` 内容**上提**到包根（`install.m` 的 copy_files 阶段）；
2. `## PKG_ADD:` 行**抽取** + 包自带 `inst/PKG_ADD` 追加 ⇒ 落**包根** `PKG_ADD`；
3. 元数据（`DESCRIPTION`/`INDEX`/`COPYING`/`NEWS`）落**包根**；
4. 装完 `addpath(包根)` + `run(PKG_ADD)`（与 loader 现在对 `kind:'js'` 包做的一致）。

> 结论：**"客户端安装"= 把 `bundle-pkg` 的 Python 逻辑搬到浏览器**（同一套规则、两种实现）。
> 这就是"两处实现 = 真接缝"的代价与收益：**必须有一条对拍断言**（§8），
> 否则两处会漂（本仓对这种情况有一贯做法：`glue-selftest` 式的宿主/浏览器双跑）。

---

## §5 与 **fork/lock 管线**的多点贴合（用户点名的"紧密贴合"）

| 贴合点 | 形状 | 机制（已有件） |
|---|---|---|
| **① Octave 版本过滤** | catalog 的 `octave` 字段 = **fork 的 Octave 版本**（现 11.3.0，来源 `upstream/octave/configure.ac` 的 `AC_INIT`） | `forge-fetch.py --octave` 已在做；把版本**从 fork 树读**（不再手写）⇒ 升 Octave = catalog 自动重过滤 |
| **② 版本 pin** | catalog 里每个包 `version + sha256` 是**钉死的**（上游 index 给的 sha） | 同 `upstream-lock.json` 的"URL + sha256"家族；沿用其 `check_locks.py` 判据形状 |
| **③ witness（每提交真跑）** | 一条**只读、便宜**的见证：catalog 的 `octave` == fork 的 `AC_INIT` 版本；且 catalog 每个条目"仍在货架上"（`--head` 校验，或对本地缓存的 tarball 核 sha） | `witness-upstream-pin.py` 同款；进 `build/inputs` 见证档（每提交跑） |
| **④ 来源（谁生成的）** | catalog 顶部写 `generated_by`（脚本 sha）+ `generated_at` | `tool.script_sha256` 家族（Einfacht #5 witness） |
| **⑤ 供给** | 包的 tarball 从上游取一次，落**持久盘** `third_party/forge/`（现有 `forge-fetch.py` 目录），再由站点装配拷进 `assets/forge/` | `provision-upstream.sh` 同款"供给"语义 |

**⚠️ 包**不**进 `.gitmodules`/submodule**：它们是**数据资产**（tarball + 生成物），
不是要跟着 git pin 的源码树。所以包的 pin 由 **catalog 的 sha256** 承载，
**不走** `witness-upstream-pin.py` 那条 submodule 树见证（那条管 18 个源码 submodule）。

---

## §6 分叉点（**需要用户拍板**，故设计稿先停在这里）

### 分叉 A：v1 纳不纳**编译件**？—— ✅ **实测精化后：这个问题基本消解了**

**2026-10-09 对 10 个包逐个开箱实测**（`tools/forge-shelf.py --probe`，判别三态）：

| kinds | 含义 | 包 |
|---|---|---|
| `m` | 纯 `.m` | matgeom, quaternion, splines |
| `m+src` | `.m` **开箱可用**；`src/` 是**可选加速件源码**（不编也能用） | geometry, miscellaneous, nan, optim, statistics, struct, tsa |
| `m+oct` | 随包带**预编译 `.oct`**（异架构 ⇒ 必须重编） | **（本货架 0 个）** |

**关键实测事实**：这些源包里**预编译 `.oct` 数 = 0**（geometry/statistics/struct 逐个查过）。
⇒ 旧判别（`src/` ⇒ 当"需编译"）是**误判**，会把 7 个开箱可用的包错划到 v2。
⇒ **v1 范围 = 全部 10 个包**（`.m` 部分），零构建、零宿主预编。

**真正的 v2 才是有 `oct` 形态的那些**：包**自带** `.oct`（异架构，得换）或要用 `src/` 加速件
（宿主 `build-pkg-oct.sh` 预编 + 客户端 dlopen 拉取，两段式）。v1 的 catalog 保留 `kinds` 字段
（形状先定，v2 实现后到）。

> 教训（值得写进 NOTES）：**"有没有 src/"与"能不能直接用"是两件事**。
> 判别必须看**包内实际带什么**，不能看目录名推。这正是 T0 spike 这类实测的价值。

### 分叉 B：**解包在哪做** —— ✅ **已定（实测，2026-10-09）：不在 JS 里解，用 wasm 内建的 gunzip+untar**

用户点令：评估浏览器内建 tar 解析器的现有资产，有现成的就用。⇒ 查证结果：**有，而且是官方路径**。

- `build/webio.cc` 里是**真的**实现（编在主 wasm 内，C++）：`__web_gunzip__`（zlib `gzopen`）、
  `__web_untar__`（ustar 解析）、`__web_unzip__`（raw inflate）、`__web_tar__`（ustar 创建）；
  由 `build/webshell/{gunzip,untar,unzip,tar}.m` 映射成官方名字 —— **`pkg install` 内部调的就是它们**。
- **浏览器实测**（真实 forge tarball `signal-1.4.6.tar.gz`，447403 B）：`gunzip` → 1 文件；
  `untar` → **211 个文件**；顶层正确解出 `signal-1.4.6/`。
  ⇒ **零 JS tar 解析器**（`assets-loader.js` 文件头早有此判断：免掉在 JS 里实现 tar 解析）。
- ⚠️ 前提：`webio` + `webshell` 资产要**先装载**（懒加载资产；未装时 `untar`/`__web_*__` 直接 undefined）。
  ⇒ installer 第一步 = `load(['webio','webshell'])`（复用现成 `load`）。

**由此得到更优形态（比"客户端复现 bundle-pkg"更结实，正中用户"不烂尾"要求）**：
既然 `gunzip`+`untar` 在引擎里、`pkg install` 可被驱动（实测可跑），**客户端 installer 尽量委托核心 pkg install**：

```
fetch tarball（同源）→ sha256 校验 → 写 MEMFS → eval_string("pkg install <tarball>")
```

- 纯 `.m` 包：核心 `pkg install` 全包（解包 + `inst/` 上提 + PKG_ADD + 数据库登记）——**零复现**，最像官方。
- 含 `.oct` 的包：核心 `pkg install` 会去编 `src/`（浏览器无 mkoctfile）⇒ **必须走我方预编 + 直写**
  （§4 的复现路径）⇒ 这也是 §6A 建议把它留 v2 的原因。

> **旧 B1/B2 作废**（JS tar 解析 / 构建期预解包都不需要）。本发现让 v1 实现面**变小**、结实度**变高**。

#### T0 spike 结果（2026-10-09，**已跑**）：委托核心 `pkg install` **不成立** ⇒ 走"直写"

在浏览器里实测（装载 webio+webshell 后）：

| 步骤 | 结果 |
|---|---|
| `gunzip` 真 tarball | ✅ 1 文件 |
| `untar` 真 tarball（signal-1.4.6） | ✅ **211 文件**，顶层 `signal-1.4.6/` |
| 核心 `pkg('prefix',…)` + `pkg('install', <tarball>)` | ❌ `dirlist(3): out of bound 2`（web `pkg` shim 的路径手术 × 核心 install 的目录假设冲突） |
| `pkg('list')` | 0 条；`pkg('load',…)` → `package … is not installed` |

**结论（写死进设计）**：
- **解包层用引擎**（`gunzip`+`untar`）——已证可用；**不写 JS 解析器**。
- **安装/登记层不复用核心 `pkg install`**（在本构建下坏）——由 loader **直写**：
  按 `pkg install` 的真实布局（§4：`inst/` 上提 + PKG_ADD + 元数据）落盘，
  再让 **`pkgfix` 重扫磁盘**生成核心 pkg 数据库（这条已经是现役机制，`pkg.m` shim 会调 `__pkgfix_sync_db__`）。
- ⇒ **§4 的"复现 bundle-pkg"不是可选项，是 v1 的主路**；§8.1 的对拍断言是硬需求。
- （可选 v2：修 `pkg.m` shim 让核心 `pkg install` 可用，从而消掉"复现"——但那是另一笔账，v1 不背。）

### 分叉 C：**catalog 的生成入口**命名与落地

- 建议新脚本 `build/forge-catalog.py`（**只生成 catalog，不下载**——下载仍归 `forge-fetch.py`），
  即"**两段**：fetch（宿主，有网）→ catalog（宿主，读缓存 + 上游 index）→ 站点装配"。
- 站点侧落地：`assets/forge/<name>-<ver>.tar.gz` + `assets/forge-catalog.json`；
  `assets.py` 加一个 `gen-forge-catalog` 子命令（或独立脚本，二选一，**别两处都写**）。

---

## §7 纯客户端约束与非显然的坑

- **同源是硬要求**：COI 站点（COEP: require-corp）**fetch 跨域资源会被拦**。
  ⇒ 包 tarball **必须与站点同源**（`assets/forge/…`），**不能**让客户端直接打 `github.com`。
  （这也是"catalog 我方预取"的另一半理由。）
- **不许服务端执行**：所有解包/落盘/装载都在浏览器；`forge-fetch.py`/`catalog` 是**构建期**工具，
  不构成运行时端点。
- **sha256 三段都要**：上游 index 的 sha（采购时验）→ catalog 的 sha（装配时验）→ 客户端 fetch 后验
  （`assets-loader` 已有）。**任一不符 = 拒绝装**（fail-closed，与产物 `verdict=="ok"` 同一纪律）。
- **>8MB 编译件**：走现成的 `preloadIfHuge`（`SYNC_COMPILE_LIMIT`）——不要重造。
- **`pkg` 数据库一致性**：装完必须让 `__pkgfix_sync_db__` 重扫（`pkg.m` shim 已经会），
  否则 `pkg list` 看不见新包（这个坑 `pkgfix` 的文件头记过）。

---

## §8 准入闸门与验收（本仓纪律：每个新机制配**反向断言**）

1. **对拍断言（§4 的两处实现）**：同一次 `bundle-pkg` 与"浏览器 `install()`"，
   对同一个包产出**逐文件一致**的 FS 布局（宿主跑一遍、浏览器跑一遍，比 path→sha 表）。
   ⇒ 这是"客户端安装器忠实 `pkg install`"的**唯一硬证据**。
2. **catalog 闸门**（新，挂 pre-commit，可插拔）：
   - 每个 catalog 条目的 `octave` 兼容性（`forge-fetch` 的 `check_ver` 复用）；
   - 每个条目**在本地缓存里可核 sha**（witness 档）；
   - `kinds` 与实际 tarball 内容**一致**（说纯 `.m` 就不许有 `.oct`）；
   - 空 catalog ⇒ **红**（零值守卫）。
3. **浏览器验收**（新套件 `accept-forge-ondemand.mjs`）：
   - 干净站点跑 `OctaveAssets.install('struct')` ⇒ **磁盘出现** + `pkg list` 看得见 +
     `exist('[函数]')` 可用；
   - **反向**：装一个 catalog 里**没有**的包 ⇒ **必须明确失败**（不许静默）；
   - **反向**：sha 不符 ⇒ **拒绝装**（喂一个改过字节的 tarball）；
   - **按需性**：`plot` 前不装 `optim`，装后再用 ⇒ **网络只发生一次**（用 `onProgress` 计数或
     站点访问日志断言）。
4. **台账键**（进 `build/FACTS.json`）：`forge_catalog_packs`（货架条目数）、
   `forge_ondemand_installed_bytes`（验收里那一次的实拉字节）、`forge_catalog_pin_ok`（witness）。

---

## §9 复跑方式（本文每个数字/断言的可查性）

```bash
# 现状载荷
du -sh /mnt/hdd/octave-wasm-build/site/assets/pkg        # → 12M
python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/site/assets/manifest.json'));print(len([a for a in d['assets'] if '/pkg/' in (a.get('url') or '')]))"  # → 12
# 上游货架（宿主有网时）
python3 build/forge-fetch.py --octave 11.3.0 --list-compatible | tail -1
# fork 的 Octave 版本（catalog 的过滤基准）
grep -m1 AC_INIT upstream/octave/configure.ac
# 现有按需装载接口（客户端）
grep -n "loadOne\|preloadIfHuge\|SHA" bridge/assets-loader.js | head
```

---

## §10 待办（立单拆解，**等 §6 分叉拍板后开工**）

- [ ] **T0（spike，先做）** 用真实纯 .m 包在浏览器里跑通 `pkg install <tarball>`（先 load webio+webshell）；
      结论决定『委托核心』能覆盖多少（纯 .m）与哪里必须直写（编译件）。
- [ ] **T1** `build/forge-catalog.py`：读上游 index + 本地缓存 → 站点 `assets/forge-catalog.json`
      （含 §5 的 pin/witness 字段）
- [ ] **T2** 站点装配：tarball 落 `assets/forge/`（**同源**）+ `assets.py` 入口（§6C）
- [ ] **T3** `bridge/assets-loader.js` 加 `catalog()` + `install()`（§3），**tar+gzip 解包器**（§6B1）
- [ ] **T4** `build/webshims/pkg.m`：`pkg load` 先问 catalog（已有骨架）
- [ ] **T5** 闸门：catalog 闸门（§8.2）+ 对拍断言（§8.1）
- [ ] **T6** 验收 `accept-forge-ondemand.mjs`（§8.3，含 3 条反向断言）+ 台账键（§8.4）
- [ ] **T7** 文档：`maintaince.md` 地图加一行（两个"插件"的分界）+ `CONTEXT.md` 术语
      （**Forge 按需插件** vs **部件插件**）——防止下一个人读混
- [ ] **T8**（v2）含编译件包的 `.oct` 按需：宿主预编 + 客户端 dlopen 拉取（§6A）
