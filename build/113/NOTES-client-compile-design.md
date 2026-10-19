# 设计 · 客户端自编 `.oct`（A+B）——紧贴 fork 管线、零插件库维护

> 用户点令（2026-10-12）：
> · "无人值守先设计出 AB" · "**一定要紧贴 fork 管线**" · "**我真的不想维护一个插件库**"
>
> 本文件 = 设计（不是实现）。所有结论旁注明**复跑方式**；推断逐条标"推断"。
> 前置实测：`NOTES-client-compile.md`（浏览器内 clang 编真 `.oct` 全链路已打通）。

---

## §0 两条硬约束，先把它们变成设计判据

| 约束 | 反面（会被否掉的设计） | 收敛出的判据 |
|---|---|---|
| **紧贴 fork 管线** | 为工具链/包另造一套 pin、供给、见证 | 每一件外部输入的"版本 + 字节"都必须由**已有**三件套承载：`upstream-pins.json`（身份）+ `upstream-lock.json`（URL+sha256）+ `provision-upstream.sh`（供给）；判定器复用 `witness-upstream-pin.py` / `check_locks.py` |
| **不想维护插件库** | 我们自己存/发工具链与包字节、自己记账 | 我们**不持有任何字节的权威**：字节按 URL+sha256 取、可随时重取；站点上的副本是**缓存**（可重生成），不是"维护对象"。工具链 = 别人的 Release；包 = 上游 Forge tarball |

## §1 ★ 决定性的实测：COEP 把"运行时跨域拉工具链"这条路**封死**了

这是本次设计最重要的一条实测，它**否掉了两个独立设计变体共同的首选方案**。

```
8761 COEP: require-corp | COI: true
跨域 fetch（COI 页内）: {"threw":"TypeError: Failed to fetch"}
```
（复跑：在 8761 页内 `fetch('<GitHub Release 资产 URL>', {mode:'cors'})`；
GitHub Release 资产 302 跳到 `release-assets.githubusercontent.com`，该域**不发** `CORP`，
而本站是 `require-corp` ⇒ 被拦。curl 侧可复跑：`curl -sSI <URL>` 看 302 目标域。）

**逃生口排查（都已实测/查证）**：

| 逃生口 | 结论 |
|---|---|
| 非 COI 页面能跨域 | ✅ 能，但**要放弃 w64 档**（现役最快形态）⇒ **不可接受** |
| Service Worker 拦截（SW 不受 COEP 约束） | 仓内无 SW；且这是既有待办（需宿主同意装 SW）⇒ **不作为本设计的依赖** |
| 让上游给 Release 资产加 `CORP`/`ACAO` | **可以提，但不能当作我们的设计前提**（跨仓依赖 + 我们无法保证） |

⇒ **工具链字节必须同源托管在我们站点上**。这条与"不想维护插件库"**表面冲突**，解法见 §3：
**不维护字节，只维护一张"从哪取 + 什么 sha"的清单**；站点副本由 provision 生成、可随时重建。

## §2 A 与 B 是什么（先分清，别混）

| | **A：装 `.m`** | **B：编 `.oct`** |
|---|---|---|
| 触发 | `pkg load <包>` 或商店点击 | 包 `kinds` 含 `src` + 用户要加速件 |
| 需要工具链 | **不需要** | 需要（clang+lld 122.9 MB 解包 / 34.7 MB 压缩） |
| 现状 | **已实现并已发运**（`OctaveAssets.install()`，v1，10 包全绿） | 未实现；本轮已实测打通链路 |
| 缺口 | `pkg load` 只查"随站清单"，**catalog 的包不在那份账里**（T4 未做） | 全链路（供给/pin/编译/落盘/验收） |

## §3 字节从哪来（三族，各交一件已有物）

| 族 | 字节来源 | pin 载体（**已有机制**） | 校验点 |
|---|---|---|---|
| **Octave 头**（788 个 / 6.2 MB） | 从 `upstream/octave` 树**派生** | `upstream-pins.json`（`kind=tree`，submodule pin） | `witness-upstream-pin.py` 每提交核"容器树 == pin" |
| **工具链**（clang/lld/sysroot/driver） | LLVM-wasm 的 GitHub Release（34.7 MB 压缩） | **新增 `upstream-lock.json` 一条**：`{name:'llvm-wasm', version:'v0.1.1', url:<release>, sha256:…}` | `check_locks.py`（**已有**判定器，加一条即生效） |
| **Forge 包 tarball** | 上游 Forge index → 持久盘 → 站点 | **货架 submodule commit**（每包 json 的 `url+sha256+version`） | `check-forge-catalog.py`（已有，R1–R4） |

**关键设计决定（针对"不想维护插件库"）**：

- **我们不入库工具链字节**，只在 lock 里记"URL + sha256"（与 `lapack`/`glpk` 那些条目同体例）。
- 站点上的 `assets/llvm/` 是 **provision 的产物**（`provision-llvm-wasm.sh` 按 lock 拉一次、
  逐件核 release 内 `manifest.json` 的 sha、解包落盘）——**可随时删掉重建**，
  不是"我们维护的一份资产"。
- **版本升级 = 改 lock 一行 + 重跑 provision**（与 emsdk 升级同款）；货架加包 = 加一个 json 文件。
- ⇒ **零长期维护面**：没有我们自己的包仓库、没有我们自己的版本表。

## §4 接缝在哪（codebase-design：深模块 + 小接缝）

### 4.1 A 的主接缝（已存在，只补一个洞）

`OctaveAssets.catalog()` / `.install(name,{onProgress})` **已经是深模块**
（小接口 + 深实现）。A 的缺口**不是接口**，是**数据源**：

```
现状  build/webshims/pkg.m:  pkg load <名> ⇒ 只查 __webassets_pending__()（随站清单）
目标  build/webshims/pkg.m:  pkg load <名> ⇒ 先查 catalog（货架）⇒ 有则触发 install()
```
（这是设计稿 T4，**未做**。判据：干净站上 `pkg load <未随站包>` ⇒ 真装上 ⇒ `exist=3`。）

### 4.2 B 的新接缝 = **一个方法**（不是一套框架）

B 的复杂度**不放进调用方**。新增**一个**接口方法：

```js
// OctaveAssets 上的第三个方法；前两个（catalog/install）语义不变
OctaveAssets.compileExtension(name, { onProgress }) 
//   → Promise<{ state:'compiled' | 'm-only', toolchain:{release,bytes}, diagnostics:[] }>
//   幂等：已编过（同 pin 键）直接返回；state='m-only' = 编不成但包仍可用（软失败）
```

**为什么是这一个方法**（深度检验：删掉它会怎样）：
删掉它 ⇒ 每个调用点都要自己：判 `kinds` → 取工具链 → 选对 sysroot 档 → 拼
`-DHAVE_CONFIG_H=1 -std=c++17` + 788 个头路径 → 处理 `compile()` 的三个已知门槛
（主 TU 必须排首位 / 多文件要逐级建目录 / `.oct` 靠文件名+addpath 发现）→ 落盘 → addpath。
⇒ 复杂度会**在 N 个调用点复现** ⇒ 它挣到了位置。

**两个调用点**（≥2 = 真接缝）：页面"编加速件"按钮；Octave 内 `pkg load`（可选自动编）。

### 4.3 B 实现内部的小接缝（不暴露给调用方，只给自己的测试用）

```
compileExtension(name)
 ├─ toolchain()      ← 供给：按 lock 取工具链（同源 assets/llvm/），逐件核 sha
 ├─ headers()        ← 供给：Octave 头（从 pin 派生，同源 assets/octinc/）
 ├─ pickSysroot()    ← 按**宿主档**选 wasm32/wasm64（复用 check-lane-purity 的档判据）
 └─ compileAndLand() ← 调工具链 compile() → 写目录 → addpath → __pkgfix_sync_db__()
```
每件都可单独测（换一个假 toolchain 就能测编排，不需要真 122.9 MB）。

## §5 pin 形状：三段各归已有机制，**不新造**

```
① 工具链身份+字节   上游 Release  tag v0.1.1 + tarball sha256
                    → build/upstream-lock.json 新增一条（check_locks.py 接手）
② 工具链树（可选）  upstream/llvm-wasm submodule（若要做"树级见证"）
                    → upstream-pins.json 加 kind=tree（witness-upstream-pin.py 接手）
③ 包（版本+字节）   货架 submodule commit + 每包 json 的 sha256
                    → check-forge-catalog.py 接手（已发运）
④ Octave 头         即 octave 树 pin（同一条路，不另立）
```

**双重对账（防"钉的 commit ≠ 用户真在跑的字节"）**：Release 内 `manifest.json` 记着
`llvm_source_commit` ⇒ 在 `witness-upstream-pin.py` 的 `crosscheck()`（**已有**对账器）
加一条：Release manifest 的 commit == submodule pin。不等即 DRIFT。

## §6 验收与反向断言（每个新机制配一条"必须红"）

| # | 断言 | 反向（必须红） |
|---|---|---|
| 1 | 工具链字节 sha == lock（三层：下载后/落盘后/客户端 fetch 后） | 改一字节 ⇒ 拒 |
| 2 | 编出的 `.oct` 档 == 宿主档（w64 宿主 ⇒ wasm64 产物） | 喂错档产物 ⇒ 拒（**已有** `check-lane-purity.py`，接进来） |
| 3 | 端到端：真编 → 落盘 → `addpath` → `exist=3` → 调用出已知值 | 编失败 ⇒ `state='m-only'` 且**明说哪一件没成**（不许静默当成功） |
| 4 | A 的 catalog 路径：`pkg load <未随站包>` ⇒ 真装上 | catalog 无此包 ⇒ 明确失败（不许静默） |
| 5 | 校验点齐全（release sha / manifest 逐资产 sha / catalog sha / 客户端 sha）| 任一不符 ⇒ 拒装（fail-closed） |

## §7 本设计的已知风险（诚实清单）

1. **站点体积**：工具链 122.9 MB 解包（34.7 MB 压缩）落站点 ⇒ 站点变大。
   缓解：**懒加载**（只在用户真要编时拉；首拉 14.37 MB brotli，`lld` 8.49 MB 首次链接才拉）；
   `make-dist` 要确认不吞（**已有先例**：`*.gz` 排除面曾静默删掉 forge 包）。
   **未决**：是否把工具链放进 `make-dist` 交付包（会显著变大）——**倾向不进**（它可重取）。
2. **内存**：63 MB wasm + sysroot + Octave 自身堆 ⇒ 低端机可能 OOM，表现是"编到一半死"。
   **未实测**（本轮实验是在 Node 里跑的，不是低内存浏览器）。
3. **只有少数包真能直编**：10 包里 7 个有 `src`，但**需自身 configure 的编不出来**（如
   `nan` 依赖 sqlite/zlib 头）。⇒ B 的实际覆盖**要在真包上量一次**，不能按"有 src"报数。
4. **ABI 漂移**：Octave 头 pin 与部署 wasm 不同步 ⇒ 链接过、运行期烂。
   金丝雀只能端到端一条（§6.3）。
5. **上游 Release 非持久制品**：可被删/替换 ⇒ 供给必须落持久盘备份 + sha fail-closed。

## §8 明确不做（本设计范围外）

- **不改上游工具链**（那两条小建议已作为 issue/建议提出，不阻塞）。
- **不建包仓库、不做包签名体系、不做多版本共存**（用户明确不想维护）。
- **不在开机路径碰工具链**（既有铁律：探测/自检不许进开机路径，坏产物会整页卡死）。
- **不承诺"任意 Forge 包都能编"**（§7.3 的实测边界）。

## §9 建议的落地顺序（每步独立可验收）

1. **A 收尾（最小、零风险）**：`pkg.m` 先问 catalog（T4）⇒ 判据 §6.4。
2. **供给 + pin（无客户端改动）**：`provision-llvm-wasm.sh` + lock 一条 + witness 对账 ⇒ 判据 §6.1/§5。
3. **`compileExtension()` 实现 + 夹具测**：用一个假 toolchain 测编排；再上真工具链。
4. **真包上量覆盖**（§7.3）：挑 2–3 个包实测，报"能编的有几个"（不许按 src 数推断）。
5. **端到端浏览器验收**（§6.3）⇒ 才谈 UI（C）。

---

## §10 ★ 设计验证：真包源码直编成功（2026-10-12 实测，A+B 设计的关键输入）

在设计定稿前，用**真包源码**（不是最小探针）验证 B 的核心假设。

**样本**：`miscellaneous-1.3.3/src/cell2cell.cc`（3448 B，`#include <octave/oct.h>` + `"./config.h"`）

**链路**：
```
解包真 tarball 取 src/cell2cell.cc
  + 我们合成的 config.h（**从容器取出**：build-pkg-oct.sh 的 emit_config_h 产物，25 个宏）
  + 788 个真 Octave 头（6.2 MB）
  → 工具链 compile({target:'wasm64', abi:{wasm-legacy,pthread,memory64}})
  → 13446 B 真 .oct（导出 Gcell2cell + _Z10Fcell2cellRK17octave_value_listi + _emscripten_tls_init）
  → 写 FS + addpath → exist=3
  → cell2cell({1,2}, 1) = 1×1 ；cell2cell({1,2}, 2) = 1×2    ← **语义正确**
```

**这验证了三件事**：

1. **B 对真包可行**，不只是对玩具探针（本轮早先只验过 11 行的 minitest）。
2. **`config.h` 是必须喂的输入**，而且它**不在 tarball 里** —— 是我们 `build-pkg-oct.sh` 的
   `emit_config_h()` **合成的 25 个宏**（出处逐条注在该脚本头部：都是对 11.3.0 安装头
   实测 grep 出来的）。⇒ **客户端要复现的核心知识 = 这 25 个宏**，
   它必须是**数据**（跟 catalog 走），不是散在浏览器 JS 里的硬编码。
3. **两个已知门槛都在真包上复现了**（不是理论风险）：
   - 主 TU 必须排 `files` 首位（我第一跑编成了 `Array-base.cc`，`ok=true` 却是错的产物 ——
     **这正是"能编过 ≠ 编对了"的形状**，务必进验收反向断言）；
   - 多文件要逐级建父目录（否则 `ErrnoError errno=44`）。

---

## §11 落地实测（2026-10-18，compile 批）

**已实现并验收**（`accept-compile-extension` **11/0**，8768+8761）：

| 项 | 状态 | 凭据 |
|---|---|---|
| `OctaveAssets.compileExtension(name,{onProgress,onDiagnostic})` | ✅ | C1 |
| 真包编译（miscellaneous → cell2cell.oct，wasm64） | ✅ **state=compiled，5.0 s，13,405 B** | C2a |
| Octave 识别产物 | ✅ `exist=3`、`which` 指向该 `.oct` | C2b |
| **分段懒加载**（用户点令） | ✅ 首编只拉 **clang 45.8 MB + sysroot 19.7 MB**；**lld 31.8 MB 推迟到首次链接** | C3 诊断流 `[lazy]` 行 |
| `diagnostics` 日志流 | ✅ 20 条（onDiagnostic 逐条回调） | C3 |
| 幂等（同会话二次调用） | ✅ `cached:true` 且**零网络** | C4 |
| 反向：纯 `.m` 包 | ✅ `state:'m-only'` + 明说"不含 src" | C5 |
| 反向：坏源 | ✅ `ok:false` + `clang exited 1` | C6 |
| 产物架构 == 宿主档 | ✅ dylink 特性含 `wasm64`（w64 宿主） | C7 |

**★ 已知边界（如实记，本批未解决）**：
- **现编产物的跨边界调用仍不通**：`cell2cell({1,2},1)` 在现编 11.3 产物上报
  `Invalid resizing operation or ambiguous assignment to an out-of-bounds array element`；
  **同一站点、随站预编的 7.2 产物同样调用 = 1x1（正常）** ⇒ 对照实验已把范围锁死。
  已排除：调用语法 / 注册路径（`exist=3`）/ config.h 宏（与容器 host 侧逐字一致）/ 架构（C7）。
  **同族证据**：`symbolGap` 里 4 条 typeinfo（`_ZTI6Matrix/_ZTS6Matrix/_ZTI7NDArray/_ZTS7NDArray`）
  在宿主 w64 wasm 的导出面里**为 0** —— 是**工单 65 缺口 2（`_ZTIi`）的扩大版**：
  不只是基本类型，**Octave 类（Matrix/NDArray）的 typeinfo 也不在宿主导出面**。
  ⇒ 与工单 65 合并处理：**裁决 A 的重链**（ready-for-human，产品决定）一旦落地，
  这条边界应随之消失（判据 = 本套件 C2c 从"报错"翻成"1x1"）。
- **多 TU 包只编主 TU**（v1 边界）：`miscellaneous` 有 6 个源，只编 `cell2cell.cc`；
  其余 4 个 TU（`partint` / `sample` / `text_waitbar`）需要各自成模块，
  且 helper（`error-helpers.cc`）要与主 TU 一起链 —— **下一批做**（判据：`partint(5)` 非空）。
- **供给体积**：`assets/llvm/` 13 件 = **约 120 MB 原始**（clang 45.8 + lld 31.8 + 两档 sysroot
  各 19.7 + 头 0.5 + 其余）；**已按用户点令分段**（见上），但**站点总量**显著增加。
  `make-dist` 的取舍待定（§7.1 原判断"倾向不进交付包"，本批未改）。

**本批新增的机械知识（都是实测踩出来的，别再踩）**：
1. **验证 dlopen 路径必须 `eval_async`**：同步 `eval_string` 抛 `SuspendError` 且被 Octave
   侧吞掉 ⇒ 表现成 `exist=0`（我一度误判"产物没被识别"，白查两轮）。JSPI 铁律的又一次应验。
2. **`installFiles` 不许按 size 跳过**：sysroot 里有 7 个合法零字节文件；只能按"name 以 `/`
   结尾 = 目录项"判断。
3. **产物文件名必须 `basename`**：源清单里是 `pkg-1.3.3/src/cell2cell.cc`，直接去扩展名
   会得到带子目录的名字 ⇒ 写盘 `ErrnoError 44`（门槛 2 的第三种形态）。
4. **`mkdirTree` 的失败不许空 catch**：吞掉之后真正的错在 `writeFile` 才炸，且信息只有 `ErrnoError`。
5. **vendor 的 bundle manifest 可能漏列依赖**：v0.1.1 的 `manifest.json` 没列
   `driver/compile-core.mjs`（worker 的 import 依赖）⇒ provision 侧兜底补拷。
   ★ **续查（2026-10-18，内容仓 `mail/042` 追问逼出来的）**：**已发布的 v0.1.2 同样缺**
   ——tar 内 `manifest.json` 与 release 的 `content-list.json` **都是 13 条**、都不含它；
   生产者工作树 `release/out/` 是 14 条。根因 = 时序：修打包脚本的 `149e72b`（glob 取代
   手写清单）是 **10-15 14:47**，而 v0.1.2 的 manifest 生成于 **14:31**、发布 **14:39**
   ⇒ **修了但没重发**。已正式上报（宿主 `mail/044` → LLVM-wasm `mail/013`）；
   原 STATE 写"已上报"在查证前是**没有凭据的活状态断言**（内容仓核了它的 mail/issues/
   questions 三处都无痕迹）——这条本身就是一次教训：**"已上报"也是断言，要有落点**。
   ★ **结案（2026-10-19）**：对方发 v0.1.3 —— 14 条含 `driver/compile-core.mjs`，
   并附 `release/check-published.mjs`（四对账，含"bundle driver == repo HEAD 逐字节"
   那层，正是抓"一致地旧"的判据；对方承认我抓的那次其内部 13/13/13 自洽、
   内部一致性检查天然抓不到）。我方独立复跑：bundle sha `cd6450fe…` 逐字相符、
   `check-published --tar --freshness` 20 PASS。⇒ 我方 pin 换 v0.1.3、
   **兜底拷贝退役**（provision 里改成正向断言：manifest 必须列它，缺 ⇒ die），
   反向验证已做（删掉 manifest 那项 ⇒ 断言红）。

---

## §12 多 TU（v2，2026-10-18）：模块分组是**数据**，不是"扫 DEFUN 全编"

**背景**：v1 只编主 TU ⇒ `miscellaneous` 的 `partint` 模块从未出现（判据 `partcnt(5)` 空）。

**最终的模块规则**（三条都有实测出处，不是设计推演）：

1. **产物名 = 源文件 basename**，不是第一个 DEFUN 名。
   证据 = 现役部署件 `assets/octdir/miscellaneous/partint.oct` 的导出表：
   `Gpartcnt, Gpartint, _Z4pcntm, …` —— **一个源里的多个 DEFUN 共用一个以源名命名的模块**。
   （容器 `build-pkg-oct.sh` 的表行同样是 `miscellaneous|partint|partint.cc|`。）
2. **一个模块可以跨多个源**：`optim/__bfgsmin` = `__bfgsmin.cc + error-helpers.cc`，
   `statistics/svmtrain` = `svmtrain.cc + svm.cpp + svm_model_octave.cc`。
3. **包里"含 DEFUN 的源"不等于"该编的模块"**：`miscellaneous/sample.cc` 在 11.3.0 头下
   **编不过**（`OCTAVE__RAND_UNIFORM()` 零参调用 vs 11.3.0 的 `rand_uniform(n, p)`），
   而容器表本来就没列它（现役站点只有 cell2cell.oct + partint.oct）。
   ⇒ **客户端不许扫 DEFUN 全编**（会让用户看到"编译失败"，误判工具链坏）。

**落地方形**：容器那张手写表变成**数据** `build/pkg-module-table.json`（闸门
`check-pkg-module-table.py` 逐条对账容器表，自证 12/0；真仓 6 包 / 27 模块一致）。
客户端 `moduleTable()` 优先读站点资产 `assets/pkg-module-table.json`，**扫 DEFUN 只作兜底**。

**架构**：编排抽成深模块 `bridge/multi-tu.mjs`（纯逻辑：分组 / 命名 / 编序 / 链接拼装 /
basename 摊平；runtime 注入）。两个 adapter：浏览器 `compile-worker.mjs` 与
**本地台 `test/local/compile-local.mjs`**。后者的动机是用户点令「必须升级交互」：
改一行 → 浏览器验证 = **8 分钟/轮**；本地台 = **8~14 秒/轮**且拿到完整 stderr（不再是
一句 `Aborted()`）。今天在这条线上花的四小时，绝大部分是这个往返差。

**本批新踩的机械知识（五条，都别再踩）**：
1. **clang 的 `callMain` 每个实例只能调一次**：第二次报
   `LLVM ERROR: too many signal callbacks already registered` ⇒ abort。
   （v1 单 TU 永远没暴露。）⇒ runtime 契约写死 `clang()` **每次新实例**；字节缓存即可。
2. **emscripten 的 abort 是抛异常不是返回码**：不接住就只剩 `Aborted(). Build with
   -sASSERTIONS for more info.` —— 失败原因永远查不到。必须 try/catch + 把 printErr 带出去。
3. **`collected` 要"清空"不要"替换"**：printErr 闭包持有原数组，`x.collected = []`
   会让之后的 push 落到旧数组 ⇒ detail 永远空。
4. **lld 是通用驱动器**：不给 `-flavor wasm` 就打印 "lld is a generic driver" 并退 1
   （只设 `thisProgram: 'wasm-ld'` 不够）。**lld 的 FS 与 clang 的 FS 是两个** ——
   sysroot 必须各装一次。
5. **源必须摊平成 basename**：包源普遍 `#include "./config.h"`；按原始相对路径铺
   `/src/pkg-x.y/src/a.cc` ⇒ `./config.h` 落到不存在的子目录 ⇒ clang abort。
   摊平后 `-I /src/octinc -I /src/octinc/octave` 两个根（第二个解 `<randmtzig.h>` 这类扁平头）。

**验收**：`accept-compile-extension` **16/0**（v1 是 11/0）：新增
C8a 编出容器表全部模块 / C8b 产物名 = 源 basename / C8c 同源第二 DEFUN 也在 /
C8d 第二模块被识别（v1 的边界：它压根不存在）/ C8e 调用语义**如实记**为与 C2c 同一
已知边界（typeinfo 导出面，工单 65 重链批 —— 不假装通过）。
本地台自证 6/0（分组 / 命名 / 对象名唯一 / basename 冲突必报 / 无 DEFUN 返回 null）。

**本地台怎么跑**（改编译线的第一动作 —— 别先起浏览器）：
```bash
node test/local/compile-local.mjs --selftest            # 编排层单测（不碰 wasm，秒级）
node test/local/compile-local.mjs <包 tar.gz> --target wasm64
# 例：node test/local/compile-local.mjs \
#       /mnt/hdd/octave-wasm-build/third_party/forge/miscellaneous-1.3.3.tar.gz --target wasm64
#   ⇒ 2 模块 / 8s；产物落 /tmp/compile-local/
#   --only <模块名> 只编一个；--site <目录> 换工具链来源；--out <目录> 换落盘
```
产物正确性判据（本地台产物 vs 现役部署件，导出面应逐条一致）：
```bash
node -e "const b=require('fs').readFileSync('/tmp/compile-local/partint.oct');\
new WebAssembly.Module(b);console.log(WebAssembly.Module.exports(new WebAssembly.Module(b)).map(e=>e.name).filter(n=>/^G/.test(n)).join(','))"
# ⇒ Gpartcnt,Gpartint（与站点 assets/octdir/miscellaneous/partint.oct 相同）
```

---

## §13 C2c 根因翻案 + 工单 65 结案（2026-10-19，重链批）

**§11 那条"已知边界"的最终归宿：推断被证伪，真根因找到并修复。**

### 翻案链（每步都有实测）

1. 工单 65 重链落地（typeinfo `-u` 保活）后 `probe-toolchain-gap` **rc=0** —— 但
   C2c 的 "Invalid resizing operation" **仍在** ⇒ 旧记录"typeinfo 同族"是间接推断，错。
2. AB 分离：容器 11.3 版 cell2cell（8467B，随站可用）vs 本地台同源版（13405B，失败）
   —— 导出面 13 条**逐条一致** ⇒ 差异在字节内部。
3. 容器内复现：同 clang + worker 命令 + octinc 头 ⇒ 13404B（坏）；同命令 + **安装树头** ⇒ 好。
4. 头树 diff：wasm32 树（octinc 的来源）与 wasm64 树的 `mxtypes.h` 分叉 ——
   `mwSize/mwIndex/mwSignedIndex` 前者 `int32_t`、后者 `int64_t`（`f77-fcn.h` 的
   `F77_CHAR_ARG_LEN_TYPE` 同分叉）。**wasm32 树还根本没有 `octave/config.h`**
   （25 宏合成那个历史决定的来源）。
5. 修：provision 按目标档供两份头 + "两份必须真分叉"反向断言；worker/本地台按 target 选。

### 判据翻面

C2c/C8e：`check(true, "如实记…")` → **硬绿断言**（`R1=1x1/R2=1x2`、`PARTINT_OK=1`）。
曾错过的两个探针坑也记下：eval_async **吞 Octave 侧 error**（判据必须看输出值，不看
resolve）；`partint(n)` 只返回**单个**矩阵（`[m,~,~,p]` 接三值 ⇒ "element number 2 undefined"）。

### typeinfo 的真机制（工单 65 的另一半）

keep 的 `--export-if-defined` 单独**不够**：MAIN_MODULE=2 的 DCE 先删没人引用的归档成员
（树代码不 import 基本类型 typeinfo）⇒ 符号不存在 ⇒ export-if-defined 静默忽略。
真保活 = `TI_TYPEINFO_FLAGS`（`-Wl,-u,_ZTIi` 强引用 + export-if-defined **成对** ×7，
rust_sort 的 `-u` 同款先例）。产物导出面实测 7 条全进（757 导出）。
