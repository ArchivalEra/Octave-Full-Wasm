# 需求单 · 插件商店 + 贴近 MATLAB（2026-10-13）

> **性质**：需求单（不是实现、不是设计稿）。每条需求带**实测现状**与**可复跑的验收判据**；
> 写不出验收判据的条目不进本单（本仓事实纪律）。
> **读者**：不需要本仓上下文——每条自带背景。可整段交给外部（UI 师傅 / 检索模型 / 下一个 agent）。

---

## §0 一句话结论

**后端的"装包"能力已经好了（T4，2026-10-13 发运 8761）；商店能不能上线，卡在"货架上有没有
用户想要、而我们没随站发的东西"——不是卡在 UI。** 实测：货架 11 个包里，**10 个与随站发运的
完全重合**（唯一独占的是本单刚加的 `cgi`）。所以"商店"现在做出来 = 给已经在站点上的包做个货架样子。

**但本单实测到一个"杀手级用例"（§1.5）**：货架装上 `datatypes` 包 ⇒ **`table` / `datetime` /
`string` 这些现代 MATLAB 类型当场可用**（`table([1;2;3],…)` 真跑出 rows=3/vars=2）。
⇒ 商店的第一个真实价值 = "**一键补齐 MATLAB 现代类型**"，这正好接上用户点令"完全靠近 MATLAB"。

**同时**：这些类型现在**默认缺失**，而且撞上去给的是**误导性错误**（见 §4.1 / 工单 66）——
**本单已把那个报错修好**（§4.1：现在给的是 Octave 的原话"belongs to the 'datatypes' package…
which seems not to be installed"，直接告诉用户装哪个包）。

---

## §1 现状（全部实测，复跑方式见括注）

### 1.1 装包后端：已可用

| 能力 | 现状 | 证据 |
|---|---|---|
| `pkg load <名>` 自动判来源 | **已发运 8761** | `test/browser/accept-catalog-load.mjs` 27/0 |
| 从货架装**从未预打包**的包 | **已实测通过** | `pkg load cgi` ⇒ 拉 `cgi-0.1.2.tar.gz`(9960B) → 落盘 7 项 → `pkg list` 见 `cgi` |
| 依赖闭包 | 可用 | 装 `optim` 连带 `statistics`+`struct` |
| 校验 | sha256 fail-closed | 篡改字节 ⇒ 拒绝安装（验收 D2） |
| 卸载 | **无** | `assets-loader.js` 里 `uninstall`/`unload` **0 命中** |

### 1.2 货架内容：**与随站几乎完全重合**（本单的核心问题）

```
货架（forge-catalog.json）11 个：control? 无 | geometry matgeom miscellaneous nan optim
                                  quaternion splines statistics struct tsa + cgi(新)
随站（assets/pkg/*.js）12 个：control signal geometry matgeom miscellaneous nan optim
                                  quaternion splines statistics struct tsa
独占货架（商店真能装的新东西）：cgi（本单刚加，1 个）
```
（复跑：`python3 -c "…"` 见 §7）

⇒ **商店要做，先得让货架上有独占内容。** 两条路（不互斥）：
- **A. 扩货架**：上游 index 有 **144 个包，142 个兼容 Octave 11.3.0**（实测过滤）⇒
  能把货架从 11 扩到上百个（用户能装我们**从没预打包**的包）。
- **B. 摘随站**：把 `assets/pkg/` 里与货架重合的包**从随站清单摘掉**（改走货架）⇒
  站点变薄、且"装"这个动作**第一次有真实意义**（现在是"点了发现早装好了"）。

### 1.3 体积：**货架不省带宽**（本单纠正一个错前提）

> 设计稿 `NOTES-forge-ondemand.md` §1 原写"12 MB 对每个用户强制下载"——**实测推翻**（已在该文更正）：
> - **开机不下载包**：8761 页面 boot 全程，`assets/pkg/*.js` 传输 = **0.00 MB**（包是懒加载的）；
> - **gzip 后 bundle 比 tarball 更小**：`statistics.js` raw 5.35 MB → gzip **0.92 MB**，
>   货架 tarball **1.44 MB**。

⇒ 货架的真实价值 = **广度**（能装的包从 12 → 142）+ **交付件体积**（`assets/pkg/` 12 MB
从站点/`make-dist` 里挪走），**不是**每用户传输。

### 1.4 MATLAB 贴近度：现代类型缺失 + 误导性报错

| 探针 | 实测（8761，`try/catch` 取 `e.message`） |
|---|---|
| `exist('table')` / `'datetime'` / `'duration'` / `'timetable'` / `'string'` | **0**（不存在） |
| `table()` / `datetime()` / `string()` / `contains()` / `split()` / `join()` / `pad()` / `strlength()` | **`system: unable to start subprocess for 'makeinfo …'`**（误导！） |
| `readmatrix()` / `zzz_abc()` | `'<名>' undefined near line 1, column 37`（干净） |
| `isstring` / `startsWith` / `endsWith` / `validateattributes` / `mustBePositive` | **2**（存在，可用） |
| `jsonencode` / `arrayfun` / `cellfun` / `containers.Map` / `inputParser` / `matlab.lang.makeValidName` | **可用**（实测通过） |
| `save('-v7')` | ok |
| `save('-v7.3')` | `Matlab file format -v7.3 is not yet implemented`（上游本身不支持） |

**根因**（已定位到行）：`upstream/octave/scripts/help/__unimplemented__.m:549` —— 命中
"MATLAB 有、Octave 没实现"名单时，它生成 texinfo 提示再调 `__makeinfo__` 渲染成纯文本，
而 `__makeinfo__` 实现是 `system("makeinfo …")`。**本构建无 shell** ⇒ 渲染那步抛错，
**盖掉了本来那句有用的 "… is not yet implemented"**。详见**工单 66**。

### 1.5 ★ 杀手级用例：货架装 `datatypes` ⇒ 现代 MATLAB 类型当场可用（本单实测）

**这是"商店为什么值得做"的最强证据。** 链路（复跑见 §7）：

```
干净站（无 datatypes）:  table() ⇒ "'table' undefined … belongs to the 'datatypes' package"
                          （工单 66 修好后，这句**直接点名要装哪个包**）
  ↓  pkg load datatypes   （走货架：1 个 tarball 请求 datatypes-1.4.2.tar.gz，2.1 MB）
装好后（实测，8761 派生站）:
  table([1;2;3], {'a';'b';'c'})  ⇒ class=table，height=3，width=2   ← **真跑通**
  string(42)                     ⇒ class=string，char() 得 "42"      ← **真跑通**
  string('a')+" "+string('b')    ⇒ 可拼接
  exist('duration') = 2          ⇒ duration 类存在
  落盘 79 个文件
```

⚠️ **边界（如实记）**：`datetime()` 报 `'__datetime__' undefined` —— 它要一个**编译件**
（`.oct`），属设计稿 §6A 的 v2（宿主预编 + 客户端 dlopen），**v1 装不了**。
⇒ 商店对 `datatypes` 要标注"`table`/`string`/`duration` 可用；`datetime` 需编译件（暂不可用）"。

---

## §2 需求（按"能不能上"排序，每条带验收判据）

### 需求 A · 插件商店后端（UI 师傅的接口契约）

**A1 接口面**（已存在，UI 直接用，**不要另造加载器**）：

```js
OctaveAssets.catalog()                    // → { packs: [{name, version, size, sha256, url, deps, kinds}] }
OctaveAssets.install(name, {onProgress})  // → Promise<{name, installed:[…依赖闭包]}>
                                          //   onProgress({phase}) ∈ plan|fetch|unpack|installed|done
OctaveAssets.loaded()                     // → 已装名数组（含 'forge:<名>'）
```
**验收**：UI 只读这三个，不碰 `assets-loader.js` 内部。

**A2 状态语义**（T4 已定，UI 要如实显示，别把四态压成两态）：
`已装 / 可装（货架）/ 可装（随站）/ 不存在`。**"货架读不到" ≠ "不存在"**（T4 的头号教训）。
**验收**：干净站上装一个货架没有的包 ⇒ 明确失败、且信息**不含**"不存在"字样。

**A3 依赖闭包要显示**：`optim → statistics+struct`、`geometry → matgeom`、`tsa → nan`。
**验收**：点 `optim` 的"装"按钮 ⇒ UI 在下载前列出将连带装的包。

**A4 `kinds` 要如实标注**：`['m']` 纯 `.m`（开箱可用）；`['m','src']` 表示 `.m` 可用但
**加速件不编**（7/11 个包如此）；`['m','oct']` 本构建**装不了**（异架构 `.oct`，T8/v2）。
**验收**：`kinds` 含 `oct` 的包，UI 的"装"按钮**禁用并说明**，不是点了才报错。

**A5 卸载**：**当前没有**。商店若只做"装"可先不做；要做"管理已装包"⇒ 先补接口
（`.m` 文件从 MEMFS 删 + `addpath` 撤销 + `pkgfix` 重扫）。**这是新活，不是接线。**

### 需求 B · 让货架有独占内容（商店的**前置**，纯后端/装配）

**B1 扩货架**：把上游兼容包批量加进 `shelf/packages/`（工具已有：
`tools/forge-shelf.py --add/--fetch/--probe`）。**先挑纯 `.m`、无依赖、体积小的**
（实测 `cgi` 走通全程，是本模式的样板）。
**验收**：货架 ≥ N 个包（N 由人定），每个 `--probe` 记录 `kinds` 且 `verified` 非空。

**B2 摘随站**（可选，但这是让"装"有意义的唯一办法）：把与货架重合的包从
`site/assets/manifest.json` 的随站条目里去掉。
**验收**：干净站 `pkg load optim` ⇒ 真下载 tarball（网络审计 1 个 `.tar.gz`）⇒ 装好可用。
⚠️ **会连带改 19 个验收套件**（它们现在 `OctaveAssets.load('statistics')` 之类）——
摘之前先把套件改成 `install()`，否则一片红。**这是本单最大的一块工作量。**

### 需求 C · 贴近 MATLAB（用户点令"完全靠近"）

**C1 修未实现函数的报错**（工单 66）—— ✅ **本单已修**（2026-10-13）。
新增 `build/webshims/__makeinfo__.m`（覆写：无 makeinfo 时**剥 texinfo 标记**给可读文本）
+ `build/webshims/__webshim_strip_texinfo__.m`（纯函数，10 条 `%!test`）。
**实测效果**（8761 派生站）：`table()` 现在报 Octave 的原话 ——
*"The 'table' function belongs to the 'datatypes' package indexed in Octave Packages at
https://packages.octave.org which seems not to be installed on your system."*
（**直接告诉用户装哪个包**，比原来那句 `makeinfo` 子进程错有用得多。）
`help sin`/`help ode45`/`lookfor` 均未受影响（实测 len=105 / 2807 / n=164）。
**结算件**：`test/browser/probe-unimplemented-msg.mjs`（6/0 ⇒ rc=0）。

**C2 现代类型的缺口盘点**（先量后做）—— ✅ **本单已答**（§1.5）：
`table`/`string`/`duration` **不在上游 Octave 核心，但在 Forge 的 `datatypes` 包**里，
**纯 `.m` 可装**（货架实测装上即用）；`datetime` 要**编译件**（`.oct`）⇒ 属 v2。
⇒ **不是"要改 Octave"，是"要装 datatypes"** —— 成本低，且正好是商店的用例。

**C3 `.mat` 互操作边界要如实告知**：`save -v7.3` 上游本身不支持；`-v7` 可用。
UI/文档要写清"能读 MATLAB 的 `.mat` 到哪一版"，别让用户以为全兼容。

**C4（新增）把 `datatypes` 放进货架并**显眼标注**（§1.5 的直接推论）：
它是"贴近 MATLAB"的**最高性价比**一件——装了就有 `table`/`string`/`duration`。
UI 上应把它排在推荐位，并如实标注 `datetime` 暂不可用。

### 需求 D · 非本仓（探查，不立项）

用户另问：`scilab` / `pathsim` / `pyblocksim` 作为浏览器 wasm 插件的可能。
**那是别的 wasm 项目**，不在本仓范围 —— 见 `build/113/NOTES-plugin-survey.md`（本单同批产出）。

★ **2026-10-13 晚补充（用户 + Claude 的挑战，已查证）**：要覆盖**更广泛的差距**，
关键的不是那三个，而是 **OpenModelica**。把"差距"拆成三根轴后才看得清：

| 轴 | 我们的覆盖 | 谁覆盖 |
|---|---|---|
| ① MATLAB 语言 | **✓ 本仓**（Octave = MATLAB 语法） | 本仓 |
| ② Simulink 因果块图 | **能**（引擎实测 6/0，探针 `probe-blockdiag-backend`） | 本仓引擎 + 新仓前端 |
| ③ **Simscape 非因果物理建模**（电/流体/热/机械…） | **✗ 零覆盖** | **OpenModelica**（wasm 路径**在官方主仓里**、有 Rust 重写、**已发货浏览器 FMI 仿真器**、许可 AGPLv3/OSMC-PL 兼容） |

⇒ 本仓引擎**天然给不了**轴 ③（Octave 是数值/命令式语言，没有"非因果方程建模 + DAE"那套机器）。
**详见 `NOTES-plugin-survey.md` §8**（含 OM 的 wasm 成熟度、代价与限制的实测查证）。

---

## §3 明确不做（本单范围外）

- **不做包签名/多版本共存**（用户明确不想维护插件库）。
- **不承诺"任意 Forge 包都能编"**：含 `src/` 的包只装 `.m` 部分；含 `.oct` 的包本构建装不了。
- **不引入服务端**（纯客户端铁律）。

---

## §4 给 UI 师傅的最小交接清单

1. **能用的就三个方法**（§2.A1），其余是数据（`catalog()` 的返回）。
2. **四态要分开**（§2.A2）—— 尤其"读不到 ≠ 不存在"。
3. **进度用 `onProgress`**（`plan|fetch|unpack|installed|done`）—— 已有通道，别另造。
4. **依赖闭包先显示再下载**（§2.A3）。
5. **`kinds` 含 `oct` 的要禁用**（§2.A4）。
6. **卸载接口不存在**（§2.A5）—— 要做"管理"先说，那是后端新活。

---

## §5 建议的推进顺序（哪步先做）

1. **C1**（修报错）——最小、独立、立刻改善"像不像 MATLAB"。
2. **B1**（扩货架）——纯工具，把商店的"货"备上。
3. **A**（UI 接线）——此时货架已有独占内容，商店才有意义。
4. **B2**（摘随站）——大改（19 个套件），单独一批做。
5. **C2**（现代类型盘点）——先出结论，再决定投不投。

---

## §6 验收判据汇总（可整段复跑）

| # | 判据 | 命令/复跑 |
|---|---|---|
| 1 | 货架装从未预打包的包 | `SITE_DIR=<站点> node test/browser/accept-catalog-load.mjs`（27/0） |
| 2 | 货架 vs 随站重合度 | §7 的 python 一行 |
| 3 | 开机不下载包 | 页面 `page.on('response')` 统计 `assets/pkg/*.js`（实测 0.00 MB） |
| 4 | 未实现函数报错 | 工单 66 的 `probe-unimplemented-msg.mjs`（待造） |
| 5 | MATLAB 类型存在性 | §1.4 的探针表（`exist()` 逐条） |

---

## §7 复跑命令（本单每个数字的出处）

```bash
# ① 货架 vs 随站重合度
python3 -c "
import json,io
S='/mnt/hdd/octave-wasm-build/site'
cat=json.load(io.open(S+'/assets/forge-catalog.json',encoding='utf-8'))
man=json.load(io.open(S+'/assets/manifest.json',encoding='utf-8'))
shelf={p['name'] for p in cat['packs']}
shipped={a['name'] for a in man['assets'] if (a.get('url') or '').startswith('assets/pkg/')}
print('货架',len(shelf),'随站',len(shipped),'独占货架',sorted(shelf-shipped))"

# ② 上游 index 兼容包数
python3 -c "
import json,urllib.request,re
idx=json.loads(urllib.request.urlopen('https://gnu-octave.github.io/packages/packages.json',timeout=15).read())
pkgs=idx.get('packages',idx); print('总',len(pkgs))"

# ③ 货架工具
cd shelf && python3 tools/forge-shelf.py --list          # 货架清单
python3 tools/forge-shelf.py --verify                    # 逐包核 sha
python3 tools/forge-shelf.py --add <包名>                # 加一个包档案
```
