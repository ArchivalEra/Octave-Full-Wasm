# STATE · 活状态

正文只写「现在是什么」，**数字一律引用 `build/FACTS.json` 的键**（或看文末机器块）。
方向与地图在 `maintaince.md`；硬规矩在 `AGENTS.md`；历史在 `HISTORY.md`（append-only）。

## 现在是什么（2026-10-14）

  · **已上站 8761**（走 `promote-pages.sh`；四处一致 + 三大件逐字节未动 ⇒ 页面批；
    页件 sha 与验证方式见 `promote-pages.sh --verify` 的输出）+ **真站点验收 11/0**。
  · **顺带修掉受管辖入口自身一处自建以来的缺陷**（上站时抓到）：`promote-pages.sh` 的
    `--verify` 比**四处**（仓库 bridge/·8761·8768·镜像），而真同步循环**从建起只写两处**
    （漏 `$SITE_EXP`）⇒ **任何一次真同步后 `--verify` 都不可能绿**（`git log -S` 证据：
    自工具诞生那批 `e26a80d` 起就没有写 8768 的版本）。已修 + 加自证用例 ①b
    （真跑一次后**断言 8768 也被写上**）⇒ 自证 4→**5/0**。

- **★ 市场架构收口：018 回信复核通过 + versions[] 轴进 schema + N6 修复上站（2026-10-16）**：
  内容仓 `018` 全面回复（七件事我**逐条复核全过**：N5 它修完 —— 52/52 版本 `kinds`/`size` 真字节
  重探、空 kinds **38→0**、其 `--emit` 过我校验器 `ok`、`--selftest` 36/0、`arch` 副本同步
  `port/README.md`（0→5 处）、抽查 4/4 与字节一致）。**我兑现待办**：
  · **`versions[]` 轴进端口 schema**（它裁「出，且只出已 stage 字节的版本」；三不变量 = ① 非空不重
    ② 顶层标量恰等于某候选 ③ staged 必带派生轴 / withheld 必带 cause 且不带派生轴——不许编）；
    校验器自证 **33→41/0**（+8 正反）；新 golden `versions.json`；现役三处 `--check` 仍 `ok`（向后兼容）。
  · **N6 修复上站**：`install()` 成功路径三字段（layers/bytes/acceleration）改**真算**（修前是
    字面量）；`accept-content-attributes` **11→14/0**，**真站点 8761 实测**：装 symbolic ⇒
    `layers=[pyodide 22013349]`、`bytes=22289801`；tsa⇒`not-built`、quaternion⇒`none-needed` ——
    与 `statusOf` 同一判据。**工单 68 结案**（N1/N2/N6 宿主修 + N5 内容仓修）。
  · 它裁的两件：**versions 轴「出+只出已 stage」**（已落地）、**三属性「现名确认」**（命名权用掉了）。
    **仍开放**：它 `--emit` 侧 versions[] 实现（与 `--probe` 逐版探同批）；客户端 `browse()`
    （判决书 §5 第 5 步）。

- **★ 「额外内容市场」架构判决（design-it-twice，2026-10-16 用户点令）**：判决书 =
  `build/113/NOTES-market-design.md`（四子代理独立出方案 + 对比 + 判决 + 9 步迁移路径）。
  **四方案共识**（独立得出）：① **不加"版本属性"** —— 口语诉求翻译成"**三个属性按版本求值**"；
  ② **取得方式（clang 现编 vs 下载预编译）不属记录** —— 它是（候选 × 宿主 × 站点）的函数，
  写进记录 = 第二份真值；③ **缝仍在「记录」上**（不新开「市场」module —— 零适配器 ⇒ 纯设想）；
  ④ **不引入"每版本一个存储的 compatible 布尔"**（会漂）。**判决**取「①骨架 + 条目内
  `versions[]`（未 stage ⇒ `compatible: null` **不编**）+ `ways` 派生字段 + `statusOf` 搬进
  async `browse`」；**砍掉**并存/卸载/取消/mirror/离线/`nodeps`/签名/事件总线（各带删除测试）。
  · **★ 四子代理独立推翻了我提供的"真例"**（我复核确认）：`statistics 1.7.3` 声明
    `kinds:['m','oct']`，而真字节 **0 个 `.oct`**（13 个 src；生产者自己的 `detect_kinds` 也判
    `['m','src']`），且 `verified.tarball_sha` 记的是 **1.7.7** 的 ⇒ **1.7.3 从未被探过**
    （全库 52 条版本记录里 **38 条 `kinds` 为空**）。⇒ 真缺陷比原例更硬：
    **逐版本声明已经漂了，而核验只覆盖被选中的那一版**。
  · **四条实测缺陷**（每条我都独立复核；工单 68）：**N1** 宿主给自己开后门（装配产物从不过
    端口校验器 —— `grep validate-content-list check-forge-catalog.py` 此前为空）；
    **N2** R4 只有单向 + `derive_arch` 守卫差一格（活体：伪造"claim 含 oct、字节 0 个"⇒ 旧闸门
    **放行**）；**N5** 逐版本声明漂了（见上）；**N6** 同一事实两个出口两个答案（8761 上装
    `symbolic` ⇒ `layers:[] bytes:0 acceleration:'not-built'` 是**字面量**，而 `statusOf` 答
    `'none-needed'`）。
  · **本批落地 = 第 0、1 步**（零客户端改动）：**R11**（宿主自产目录也过产地校验器 ⇒ 关 N1）、
    **R4 双向**（声明含 oct ⇒ 字节必须有 ⇒ 关 N2）、**`derive_arch` 守卫补一格**（声明含 oct 却
    0 个 ⇒ 跳过该包并说明）。`check-forge-catalog` 自证 **27→30/0**；三站 `--check` 仍 `ok`。
    **余下 7 步在 NOTES §5**（第 3 步 schema 3 的 `versions[]`、第 6 步要发信内容仓）。

- **★ 内容三属性：`fromSource` / `compatible` / `installed`（2026-10-16 用户点令「一个内容应该有三个属性」）**：
  三条**各自独立、全部派生**（不手写、不加目录字段），统一入口 = `OctaveAssets.statusOf(name)`
  （查无此内容 ⇒ **`null`**，不编假状态）：
  · `fromSource` = `content` 含 `src`（加速件是源码，本构建无 mkoctfile 不编）—— 现役 **8 个包**为 true；
  · `compatible` = 架构界（`arch` vs 宿主档）+ `requires`（若目录带）；
  · `installed` = **会话态**（`loaded[…]`，三种装载键都查）。
  **为什么分开**：三者可自由组合（带 src 的包"兼容但没编"；不兼容的条目**装了也没用**）——
  塌陷成一根轴就答不了"能用吗 / 编了吗 / 装了吗"这三件不同的事。
  **验收 `accept-content-attributes` 11/0**（S3b：`installed` 装前 false → 装后 true 真会翻；
  ★ S4：同一条 arch 不符事实下 `compatible===false` **且** `install` 拒绝 `cause='arch-mismatch'`；
  ★ S5/S5b：`fromSource` 正反都有判别力；S2c 查无 ⇒ null）。
  **顺手修两个真 bug**（实测抓到的，非测试问题）：① 随站条目的 `kind`（投送形态）曾被当
  `content`（内容构成）冒充；② `installed` 只查 `forge:`/`layer:` 键 ⇒ **随站包永远显示"没装"**。
  术语 = `CONTEXT.md`「内容三属性」。

- **★ 架构界落地（「楚河汉界」，2026-10-16 用户点令）**：**要 dlopen 进宿主的东西必须与宿主档
  同架构**。用户原话「wasm32 引擎只能装 32 的额外内容，IP 线和 64 线都要兼容 64 的额外内容」——
  **实测修正一处**：这条界**不是**"w64 档只收 wasm64 内容"（反例：**Pyodide 是 wasm32，却在 w64 档
  页面上跑通**，`accept-symbolic-seam` 9/0），受约束的只有"要 dlopen 进宿主"那一类。
  **三档语义**：纯 `.m` 包无架构概念（现役货架 10 包全属此）／含 `.oct` 的条目带 `arch` 且必须同档／
  能力层（`form:"tree"`）不带（自带运行时）。**判据可派生**（`build/113/oct-arch.py`，纯 stdlib，
  读 `.oct` 的 `dylink.0` TARGET_FEATURES 子节；**不看目录名推**）。**落地四处**：
  ① 端口 schema 加 `arch`（派生值，与 `form`/`content` 同例）+ 校验器三档正反判据（自证 26→**33/0**）；
  ② 装配器从**包内字节**派生（四类用例实测：wasm32/wasm64/混杂必报/纯 .m 不带）；
  ③ 站点闸门 **R10**（条目 arch ↔ 站点 `assets/oct*/` 里实际字节一致；自证 20→**27/0**，含两条反向）；
  ④ 客户端 `install()` 不符 ⇒ **响亮拒绝** `cause='arch-mismatch'`（新增测试注入缝 `__catalogSource`）。
  **验收** `accept-arch-boundary` **5/0**（A3 反向：注入不符条目 ⇒ 必拒且 cause 对；A4 正向：
  相符不许被拦；A2 豁免档确认）——在**隔离站点副本**上跑（不碰 8761）。
  闸门自证台 44→**45**。术语 = `CONTEXT.md`「架构界」。

- **★ 悬案收口三件（2026-10-16，无人值守）**：
  · **工单 65（clang-wasm 接入缺口）⇒ 结算件已造**（`test/browser/probe-toolchain-gap.mjs`，
    四档 rc 契约）：**缺口 1（TLS `_emscripten_tls_init`）已修并端到端复验** —— 驱动现在
    **拒绝**单 tar 编 wasm64（"Refusing rather than linking a module without the TLS init entry"，
    正是工单建议的响亮失败方向），用 **per-arch sysroot**（`{tars:{wasm32:…,wasm64:…}}`）编出的
    模块在 8761 w64 宿主上 **`dlopen=OK` 且 `probe_f(22)==22`**（真调用）。**缺口 2（基本类型
    typeinfo `_ZTIi`）仍开**：新编 throw 探针 `check-oct-imports` 报 `★ 新缺导出: _ZTIi`、
    浏览器报 `reading 'value'`；**归属待邻仓确认** ⇒ 工单 65 状态 = `needs-info`。
  · **工单 66（未实现函数报 makeinfo 子进程错）⇒ 结案**：结算件复跑 **6/0**；修法 ①
    （`build/webshims/__makeinfo__.m` 覆写，零重链）已落。现状报错比"not yet implemented"**更准**
    （`datatypes` 已进货架 ⇒ 报"belongs to the 'datatypes' package"，告诉用户**怎么拿到**）。
  · **新工单 67（CI 兜底从未入库）**：`pre-push` 注释曾称"CI（`.github/workflows/readme-sync.yml`）
    跑同一条判据" —— **该文件全历史从未存在，且 `.github/` 整体未被 git 跟踪** ⇒ 那句已改成
    实话（判据只有本地一道）；**真把 CI 立起来 = 工单 67**（本批不做）。
  · **顺带**：`probe-octc-spike`（已结案的实验探针）登记进 `test/browser/manifest.json` 的 `inputs`
    —— 此前未登记 ⇒ 每轮 `PROBES=1` 被记成 **12 条假红**（同 `probe-output-cost` 先例）；
    现在**点名跳过**（"缺路径 …/zzspike-minioct-bare.oct"），不是失败。

- **★ 依赖边全部来自数据：删掉 `forge-catalog.py` 的硬编码 + bump shelf pin（2026-10-15，回应内容仓 `mail/011`/`014`）**：
  内容仓在**数据**里出了能力层边（`shelf/packages/symbolic.json` 的 `depends:["pyodide"]`），
  请我删掉装配器里**按包名硬编码**的那段（`if p["name"]=="symbolic" … p["deps"]+=["pyodide"]`）——
  "加内容 = 加一行数据、不改代码"正是本协议的意义。**已删**。
  · **前置（`mail/012` 我方指出、`014` 对方认下）**：边只在**新 pin** 里 ⇒ 删硬编码必须与
    **bump `shelf/` pin 同批**（`f6d38c9`→`922736a`）；否则 `resolve()` 从旧 pin 读到空 `depends`
    ⇒ `install('symbolic')` 静默断。已同批做。
  · **两处自证翻面**（行为变了 ⇒ 改断言不改检查器）：从"硬编码造边"改成"**货架的 `depends` 流过**"
    （`build/forge-catalog.py` 自证 19→**20/0**）。
  · **R9 完整闭合**（回应 `014`：内容仓只能做**部分**闭合，因它的 `--emit` 是部分视图）：本闸门
    在**装配态**判三档 —— ① 目标在同表 ⇒ 闭合；② 目标是**已知能力层名**（`shelf/recipes/*.md` 派生）
    而本表未供 ⇒ **合法缺席**（install 时响亮失败，非缺陷，走 note）；③ 两者都不是 ⇒ **typo/未知 ⇒ 必红**。
    `check-forge-catalog.py` 自证 20→**24/0**（+4：表内闭合 / 合法缺席 / typo 必红 / 无 recipes 不拿空当合法）。
  · **裁定（内容仓 `014`）**：`symbolic → pyodide` = **硬依赖**（站点没供能力层 ⇒ install 响亮失败）。
  · **三处 catalog rebake**（8761/8768/仓库镜像，逐处文件级 sha 快照证明**唯一变化 = `forge-catalog.json`**）；
    三处 sha 一致；`accept-symbolic-seam` **9/0**（P1 边在场、P2 先拉能力层、P5/P6 真算对）。

- **★ mail 边界立规：本仓补上收件箱 + 收信侧闸门（2026-10-15，用户点令「各家只读自己的 mail」）**：
  起因是**一次越界实测** —— 本仓去 `LLVM-wasm/mail/`、`OpenModelica-Full-Wasm/mail/` 里找
  "写给我的信"，而那两份是**内容仓发给 LLVM 和 OM** 的私人往来。**根因 = 本仓曾是四仓里
  唯一没有 `mail/` 的** ⇒ 写给我的信无处可投、只能落回发信仓 ⇒ 逼我去翻别人目录。
  ⇒ **补 `mail/`（收件箱）+ 三条边界**（投递落点=收信方 / 只读自己仓 / `**To:**` 指名本仓），
  由新闸门 `.githooks/check-mail-boundary.py` 守（自证 5/0，含反向：`To:` 别的仓 ⇒ 必红）。
  规则详版 = `mail/README.md`（含 5 封历史信路由表）；铁律 = `AGENTS.md`「mail 边界」；
  术语 = `CONTEXT.md`「mail 边界（收件箱制）」。

- **★★ 符号计算在浏览器里真跑通了（2026-10-15，用户点令的下一阶段）**：`symbolic` 包
  **一个字节没改**，靠一条**零补丁接缝**接上 Pyodide：`diff(sin(x),x)` ⇒ **`cos(x)`**、
  `double(sym(3)/2)` ⇒ `1.5`（验收 `accept-symbolic-seam` **[[symbolic_seam_pass]]/[[symbolic_seam_fail]]**，含两条反向断言）。
  · **机制**：包的 `python_ipc_system` 后端调**全局名 `system`**（包内没有 `private/system.m`）
    ⇒ 落到本仓 webshim ⇒ 转页面桥 `__octaveRunPython` ⇒ **同步**调浏览器 Pyodide
    （决定性实测 `probe-pyodide-sync` **4/0**：不必 JSPI/Asyncify/Atomics）。
  · **四处宿主侧改动（零重链、零重编，wasm 三件套 sha 不变）**：`octave-core.js` 桥函数、
    `webshims/system.m` python 分支、`webshims/__webshim_python_cmd__.m`（纯函数 5/5 `%!test`，
    转义精确互逆）、`webshims/pkg.m` 钉 `sympref('ipc','system')` + `assets-loader.js` 真起 Pyodide。
  · **外部调研**：wasm 宿主同步调浏览器 Python **无现成桥**（Q2/Q5 没找到）⇒ 这条是自建；
    但调研结论决定了「自建，且不必 JSPI」——不是重复搓轮子。
  · **诚实边界**：上游 46 条 `%!test` 未在浏览器全跑（原生侧验过 46/46）；矩阵非位精确（上游行为）。

- **★ 接缝 §5 第①②③步已落地（2026-10-14 无人值守批）**：
  **① 端口产地**（`build/extra-content/`：schema + 校验器自证 22 条 + golden×3 + bad×5 + 闸门 6/0）；
  **② 表升 schema 2**（`form`/`content` 两轴，`kinds` 留兼容视图；闸门加 R5；**判据 = 老 loader 照装**：`accept-forge-ondemand` 15/0、`accept-catalog-load` 27/0 不变）；
  **③ `install()` 四态 Verdict**（ok/failed/not-found/cannot-know **不可塌陷**；旧字段全保留）+ `planOnly` 零下载 —— 新套件 `accept-install-verdict` **12/0**（含两条关键反向）。
  **端口三裁决**（回应内容仓上报）：①能力层 `content` 留空（不扩枚举）；②加 `consumer` 可选轴（`octave`/`omc`，缺省 octave）；③`pin` 建议前缀（`release:`/`commit:`/`submodule:`）。
  **顺手修两个潜伏 bug**：`catalog()` 双拼 base（base 非空才暴露）、planOnly 未声明变量。
  **§5 ④⑤ 已完成（2026-10-15）**：④能力层进图 —— `provision-pyodide.sh` 供三件资产（PyPI 字节 + 改写托管 lock sha）+ 装配器产 `form:"tree"` 条目并入同一张 packs + `symbolic` 靠 `deps` 边指向（**不加 needs**）；`accept-capability-layer` **12/0**（含拓扑序与两反向）。⑤工具链表收口 —— `--upstream` 读生产者表、复用产地校验器：**合格并入 / 不合格拒收+点名**；**余下 = LLVM 自修表**（内容仓推广方的活）。

- **★ 端口三裁决②批：内容仓 mail/009 的三问已裁 + 收口落地（2026-10-15 无人值守）**：
  回收发信全链（`Octave-Extra-Content/mail/` 001→009），逐题裁并**落产地**（`build/extra-content/`）：
  · **待确认①（license）⇒ 保持自由字符串，不收紧成 SPDX 枚举**：真实产物**逐文件混合**
    （clang/lld = Apache-2.0 WITH LLVM-exception、glue js = MIT OR NCSA、driver = AGPL）——
    枚举会逼生产者说谎或拆条。校验器只查**类型**（string|object）；"写对了没"**没有机器判据**（如实记）。
  · **待确认②（「普通条目」条数）⇒ 不限制**：LLVM 的 clang 工具链出 **13 条**合法
    （逐文件许可三档 + 逐文件 sha 才让两档 sysroot 复用可见）；"普通"= **它不特殊**（同一套遍历、同一张图），
    **不是"物理上只能一条"**。校验器新增"多条能力层不报"正向断言。
  · **待确认③（`--upstream` 重跑）⇒ 已用 LLVM 修后的真表重跑，并入干净**：
    表身份见回信 `Octave-Extra-Content/mail/010`（`release/content-list.json` ≡ `release/out/` 逐字节同），
    生产者态/站点态**双 `ok`**（13 条）；
    隔离站 `--upstream` 并入 **13 条 rc=0**；`v0.1.2` 经 `gh release list` 实测**已真发布**（🔴 不是预示）。
    ★ **修了我自己两处门里的债**（并入 LLVM 才暴露）：① 站点闸门对非货架条目跑货架口径
    （R2/R4）⇒ **26 条假红** ⇒ 改为**按 `url` 前缀分域**（货架包走 R2–R5；能力层/生产者表走 **R7**）；
    ② 旧 R6 要求"能力层**必需** consumer"与裁决②"**可选**、缺省 octave"**自相矛盾**（对 LLVM 的 sysroot 假红）⇒ **翻面**。
    **新增 `--upstream-bytes`**（stage 生产者表引用的字节进站点，逐件核 sha）：只并表不 stage ⇒
    目录指 **404**（R7b 拦）；端到端证明 = 并入 LLVM 真表 + stage ⇒ 站点闸门 **`ok`**（catalog 26 条）。
  · **附件裁决（`size`/`url` 口径）**：**由 `form` 决定** —— 单文件 `size` == 该文件字节；
    **`form:"tree"` 的 `size` = 整树字节预算**（现役 pyodide：22,013,349 = `assets/pyodide/` 整目录，
    `url` 指树里主 wasm 9,598,218，**两者不是同一个对象、都是有意的**）。闸门加 **R8** sanity
    （单文件 `size`==字节；tree 的 `size` ≥ `url` 锚）——`size` 不参与 fail-closed（唯一依据是 sha256）。
  · 闸门/校验器自证计数进台账：`port_validator_selftest_pass` [[port_validator_selftest_pass]] /
    `port_gate_selftest_pass` [[port_gate_selftest_pass]] / `forge_gate_selftest_pass` [[forge_gate_selftest_pass]] /
    `forge_catalog_selftest_pass` [[forge_catalog_selftest_pass]]。

- **★ 三仓统一「额外内容」接口设计已判决（2026-10-14，用户点令「大一统」）**：
  `build/113/NOTES-extra-content-seam.md` —— **缝在「记录」上，不在「方法」上**：
  一种记录（`form`=投送形态 / `content`=内容构成，两轴各自命名，收编今天 `kind`/`kinds` 的同名两义）
  + 能力层（Pyodide/clang）作 `form:"tree"` 的**普通条目折进同一张依赖图**
  + 宿主返回 **Verdict 四态值**（ok/failed/not-found/cannot-know 不可塌陷）
  + **端口产地**在 `build/extra-content/`（schema + 纯 stdlib 校验器 + golden/bad 夹具，
  生产者自证不需宿主在场）+ 一条协商规则（未知轴默认 fail-closed）。
  方法 = design-it-twice 四子代理（极简/最大灵活/常见调用者/端口-适配器）独立出方案 → 判决取
  「极简骨架 + 常见调用者返回值 + 端口产地 + 一条协商规则」。**修的是三条实测缺陷**：
  `kind`/`kinds` 同名两义（实测取值 4 种 vs 2 种）、`forge-catalog.py:37` import 生产者内部、
  版本解析三份副本（复跑见该文 §7）。**未落实现** —— 增量五步在 §5，每步独立验收。

- **★ 角色共识再次确认（2026-10-16，用户原话「内容仓负责推广标准，然后作为 OCTAVE 核心的
  我们做好适配」）**：这不是新判决，是对既有分工的**再确认** —— 四件各归其位：
  **内容仓** = 推广标准（推的是**宿主定稿**的标准 —— 推广 ≠ 产地方）+ 内容记录收口
  （生产侧汇总，非运行期端点）+ 档案/配方/内容语义；**本仓** = 端口产地（`build/extra-content/`
  —— 标准在此定稿）+ 消费适配（装配拒收不合格表 / 站点闸门 R1–R11 / 客户端四态 Verdict 与
  三属性）；**UI 仓** = 两条契约。**实盘已运转**：内容仓已推给 LLVM（其表过校验、已并入 `ok`）、
  OM 缺席（合法）；本仓对一切表 fail-closed。**分工细则 = `NOTES-extra-content-seam.md` §8**。

- **★ 组织形态判决：三选一取「去中间商」（2026-10-14，用户点令「你选」）**：
  额外内容的后端整合**仍由本仓（宿主）承担**；非核心内容（包/运行时/工具链的元数据与供给配方）
  转交**额外内容仓**的 agent（今天货架仓的扩容或新仓）；**UI 仓立两条契约** —— 与本仓
  （引擎/embed/四态 install）、与额外内容仓（内容治理/端口）。**不取中间商制**（整合知识在本仓，
  中间商要么重学要么成门面）；**不取纯标准推广制**（标准是活动不是结构，无 owner 必漂）。
  运行期仍只有一个同源端点。细则 = `build/113/NOTES-extra-content-seam.md` §8。

- **★ Pyodide 是否性能承重件 —— 定论（用户点令三边实测，2026-10-14）**：
  同一份 `bench-sympy.py`（15 个 CAS op，同 sympy 1.14.0、同 ground types）三边跑：
  **原生 CPython（uv）= 1×** / **浏览器 Pyodide = [[sympy_perf_pyodide_over_native]]×** /
  原生 Octave+`symbolic`（**持久** popen2 IPC）= **7.54×**。
  ⇒ **明确答案：是承重件，但只承"≈2×"这个量级，不是数量级**；而且**浏览器档比
  原生 Octave+symbolic 还快 3.69×**（后者每 op 要过管道做变量编组）。
  冷启动另一笔账 = **[[sympy_perf_cold_start_ms]] ms**（懒加载，不进开机路径）。
  ⇒ 判据满足"性能接近"（若问"要不要为它重写引擎"：不要，2× 不改变架构选择）。
  复跑 `sh test/fixtures/sympy-perf/run-perf.sh`；读数 `w64-logs/sympy-perf-*.json`。

- **★ 追加之问：预编译 `.pyc` 还能快多少（2026-10-14）**：**收益集中在"每个会话的头几秒"，
  稳态一点不变**。四段口径实测（`compare-pyc.py`）：
  ① `import sympy` **2.71 s → 0.37 s（[[sympy_pyc_import_speedup_pyodide]]×）**；
  ② 每 op **首次调用**几何均值 **[[sympy_pyc_cold_geo_speedup]]×**（惰性子模块加载）；
  ③ **稳态 [[sympy_pyc_steady_geo_ratio]]×（≈不变，对照）**；④ 同会话二次 import 2.73 → 0.28 s。
  ★ **④ 的含义最值钱**：源码档**二次 import 仍要 2.73 s** ⇒ **浏览器里没有隐式字节码缓存**
  （原生 CPython 会写 `__pycache__`，浏览器 site-packages 只读 ⇒ **每次冷启动重编 472 个模块**）
  ⇒ `.pyc` 轮子的本质 ≠ "把执行变快"，而是"**把每次冷启动的固定成本砍掉 85%**"。
  代价仍是字节 [[sympy_pyc_bytes_ratio]]×（见 §1.3c）。

- **★ 缺口①"符号计算"的路线前提已实测通过（2026-10-14）**：浏览器里 **Pyodide + SymPy
  真算对** —— `test/browser/probe-pyodide-sympy.mjs` **5/0**：COI 模式 `diff(sin(x),x)`
  = **`cos(x)`**（SymPy 1.14.0 / Pyodide 314.0.7）；**无 COI**（发不了 COOP/COEP 的宿主）
  **同样算对**（⇒ 基础档用户也有份）；反向断言（拿掉 SymPy 轮子）**响亮失败**。
  **为什么必须引 Python**（实测）：`symbolic` 包是**纯 `.m`**（0 个 `.cc`）但功能全经
  `python_ipc_driver` 起 Python —— 而本构建 wasm 里 `pyexec`/`pyeval`/`pycall` 字节数
  **全 = 0**、`system`/`popen` 无 shell（webshim 清晰报错）⇒ 包原样跑不了。
  **用户的 Transcrypt 之问有两半，实测答案**：① **静态编译成 JS 不可行**（官方 README
  第 45 行 *"No eval and exec of Python code"* × SymPy 实测 `eval(` **340** / `exec(` **61**
  处）；② **预编译字节码（`.pyc`）可行且现在完全没做**（实测 `.pyc` 计数：pyodide
  stdlib = 0、sympy/mpmath 轮子 = 0）⇒ **A/B = [[sympy_pyc_speedup]]×**
  （`import sympy` [[sympy_import_ms_source]]→[[sympy_import_ms_pyc]] ms，
  源码编译 472→[[sympy_pyc_compile_calls]] 次），代价 = 字节 **[[sympy_pyc_bytes_ratio]]×**
  （6.55→21.47 MB，gzip 后仍 3.29×）。
  台账键：`sympy_pyodide_{ok,diff,nocoi_ok,break_fails_loud}` / `sympy_import_ms_{source,pyc}` /
  `sympy_pyc_{speedup,compile_calls,bytes_ratio}` / `sympy_assets_bytes`。

- **★ 补缺口的工作令已落档（2026-10-14）**：`build/113/PLAN-matlab-gaps.md` ——
  三条缺口（符号计算 / 库厚度 / 计划内三件）各带实测现状 + 复跑命令 + 验收与反向断言。
  库厚度实测：货架 12 包 vs 上游索引 **144 个包全兼容 11.3.0**（纯候选 **102** 个）；
  计划内三件在本仓**只剩接口/验收角色**（前端与 OM 均已交独立仓）。

- **★ WebGPU 在 Worker 里可用且真算对（2026-10-14，推翻我自己的假结论）**。实测
  （8761 页面 + 真 Worker，`probe-webgpu-capability.mjs` **8/0**）：
  主线程 `device=OK`（vendor=nvidia）；**Worker 内**（DOM-free）`adapter/device=OK`；
  **真跑 compute shader**：`[1,1,1,1] × 2` 读回 **`[2,2,2,2]`**；Worker 内
  `OffscreenCanvas + webgl2` 可用；硬件接口 **WebSerial/USB/HID 三个全在**。
  ⇒ **"算力放 Worker + GPU 加速 + 页面出图"这条链路成立**，且 **WebGPU 不挑厂商**
  （NVIDIA/AMD/Intel/Apple 同一套 API）—— 与 CUDA（私有栈、手机没有）**正好相反**。

  ⚠️ **这条曾被测错，教训进档**：我最初在**无头浏览器 + `about:blank`** 上探
  `navigator.gpu` 得到 `undefined`，据此写下"这台机器/我们的场景**没有 WebGPU**"
  ⇒ **两处都错**。真因：**`about:blank` 不是安全上下文**（`isSecureContext=false`），
  而 `http://127.0.0.1` 是 ⇒ `navigator.gpu` 才存在。**与有头无头无关、与 WebGPU 支持无关**
  —— 是**探测条件本身**错了。⇒ 探针已把"先 `goto` 真页面、再探"写成代码。
  台账键：`webgpu_main_device` / `webgpu_worker_device` / `webgpu_worker_compute_ok` /
  `webgpu_worker_webgl2` / `hw_apis_available` / `webgpu_vendor`。

- **与 MATLAB 的差距盘点（2026-10-14，用户点令：clang + Octave + OM 之后还剩多少）**：
  三根轴 —— ① 语言/矩阵**基本齐**（`datatypes` 补上 `table`/`string`/`duration`）；
  ② Simulink **数值面全有**（实测 `ss`+`step` len=21、`tf`、`ode45` 69步、**刚性 `ode15s`**、
  **`ode15i` DAE V₅=0.9931 vs 理论 0.9933**、`lqr` K=[0.414 0.682]、`zpkdata`），**只缺前端**；
  ③ Simscape 协议面+参考实现已查证（OM 官方 wasm CMake 目标 + `sendExpression`↔`omc_eval`），
  **产品未 build**。
  **用户砍掉的三条不是差距而是"不要/更好"**（2026-10-14 用户裁定）：
  · **CUDA** —— 私有栈 + 手机没有 ⇒ 不进开源项目；**WebGPU 才是那条路**（已实测可用）；
  · **App Designer / 硬件支持包** —— 网页自带 UI 框架；硬件反而是**网页原生 API**
    （实测 serial/usb/hid 三件全在）⇒ 比 MATLAB 的"装驱动+daemon"**更轻**；
  · **pthread 分档** —— 不是"缺线程"，是**给无 COI 环境留的活路**（比 MATLAB 更宽容）。
  **真正剩下的差距**：**符号计算**（`sym`=0，硬缺口）、**库的厚度**（长度问题，
  靠**额外内容**（货架按需装 + 浏览器内 clang 自编 `.oct`；见 CONTEXT.md 的"额外内容"）长）、**用户计划内三件**（Simulink 前端 /
  OM 自产 `omc.wasm` / `.mat` 端到端）。

- **8761 货架补装（2026-10-14）**：装配产物停在 10 包，而 `shelf` submodule 早已 pin 到
  **12 包**（含 `datatypes`/`cgi`）⇒ 重新装配 + `check-forge-catalog` gate 复跑 ok。
  **形状（本仓反复踩）**：改了源码/子模块 ≠ 装配产物跟上。台账键
  `forge_catalog_packs`（10→12）/ `forge_catalog_shelf_commit`（`a6ab1a8…`→`980e093…`）。

## 现在是什么（2026-10-13）

- **★ 额外内容的杀手用例实测 + 工单 66 已修（2026-10-13）**：从货架装 Forge 的 **`datatypes`** 包
  ⇒ **现代 MATLAB 类型当场可用** —— `table([1;2;3],{'a';'b';'c'})` 得 `class=table`
  （height 3 / width 2）、`string(42)` 得 `"42"`、`duration` 类存在、落盘 79 文件。
  **边界如实记**：`datetime()` 要编译件（`__datetime__.oct`）⇒ v2，v1 装不了。
  同批修好**工单 66**：未实现的 MATLAB 名字（`table`/`string`/`contains`…）以前报
  `system: unable to start subprocess for 'makeinfo …'`（误导），现在报 Octave 的**原话**
  *"belongs to the 'datatypes' package … seems not to be installed"*（**直接点名装哪个包**）。
  根因：`upstream/.../__unimplemented__.m:549` 生成提示后调 `__makeinfo__` 渲染，而它是
  `system("makeinfo …")`、本构建无 shell ⇒ 渲染抛错盖掉了那句有用的话。修法 =
  `build/webshims/__makeinfo__.m`（无 makeinfo 时**剥 texinfo 标记**给可读文本）+
  `__webshim_strip_texinfo__.m`（纯函数）。**已发运 8761**（`M_ASSETS=webshims`），
  结算件 `test/browser/probe-unimplemented-msg.mjs` **6/0**；四个 pkg 套件复验全绿
  （pkgview 17/0、pkg 16/0、forge-ondemand 15/0、catalog-load 27/0）。
- **两份文档（2026-10-13）**：`build/113/REQUIREMENTS-store-and-matlab.md`（额外内容拉取接口契约
  + 贴近 MATLAB 的 C1–C4 + UI 师傅交接清单）、`build/113/NOTES-plugin-survey.md`
  （scilab/pathsim/pyblocksim 探查：**pathsim 首选**，MIT + 依赖仅 numpy/scipy/matplotlib
  且 Pyodide 全有；pyblocksim 次选，GPL + 多 2 个非标准依赖；**scilab 不做**，464 MB C++ 且
  语言不兼容 MATLAB）。
- **纠正一个错前提（2026-10-13）**：`NOTES-forge-ondemand.md` §1 原写"12 MB 对每个用户
  强制下载"——**实测推翻**：开机 `assets/pkg/*.js` 传输 = **0.00 MB**（包懒加载），
  且 gzip 后 bundle（statistics 0.92 MB）比货架 tarball（1.44 MB）**更小**。
  ⇒ 货架价值 = **广度**（能装的包 12 → 142，上游兼容数）+ 交付件体积，**不是**每用户带宽。
  原文已更正（保留旧文作对照）。
- **货架扩到 12 包**（submodule `shelf`，已推 origin）：新增 `cgi`（纯 `.m`，证明
  "**从未预打包的包也能装**"）与 `datatypes`（杀手用例）。

## 现在是什么（2026-10-12）

- **T4 落地：`pkg load <货架上的包>` 现在真能从货架装（2026-10-12，A+B 的第一块）**。
  设计稿 §9① 的"A 收尾"已完成：`build/webshims/pkg.m` 改为**先问来源**（随站 ⇒ `load`；
  货架 ⇒ `install`），并把"装完了没有"变成**可判的终态**（成功/失败/查无/问不到四态分开）。
  配套：`build/pkgfix/{__webpackage_source__,__webshelf_names__}.m`（纯函数，宿主可测）+
  加载器账本新增四字段（`catalog_state`/`catalog_packs`/`catalog_miss`/`install_error`）。
  **结案实验** = `test/browser/accept-catalog-load.mjs`（含"真下载 tarball + 真算 `csaps`
  与宿主 Octave 逐位一致"），跑在 `build/113/prep-catalog-accept-site.sh` 造的副本上
  （把 `splines` 从随站清单摘掉、只留货架 ⇒ 否则测的还是老路 = 假绿）。
  **三条实测教训（已写进代码注释，别改回去）**：
  ① 货架目录**必须开机读**（`bridge/octave-core.js`）—— 让 `pkg.m` 现读就得挂起，
     而**同步入口**（页面队列外的 `eval_string`）挂起会抛 `SuspendError`，那个抛错在
     Octave 侧 try/catch **抓不住**（直接穿到 JS）⇒ 打错个包名就把调用方炸掉
     （`accept-pkg` 当场变 CRASH，实测抓到）。
  ② `miss`（两个名单都没有）**不许由 shim 报错** —— 包可能已在本会话磁盘上，
     该不该报错只有核心 `pkg` 能判（shim 抢答 = 假失败）。
  ③ 装载失败是**终态**（原因落账本）⇒ `.m` 侧立刻报错；老实现只有"等满 60 秒"一条路。
  顺带修：`promote-pages.sh` 新增 `M_ASSETS` 旋钮（m 胶水批必须重生成**车道清单**；
  空 = 老行为）+ 一条反向断言（陈旧车道清单 ⇒ 必须红）。
- **客户端自编 `.oct`（A+B）设计已定稿（2026-10-12）**：`build/113/NOTES-client-compile-design.md`。
  **决定性实测**：COI 页面（`COEP: require-corp`）里跨域 fetch GitHub Release ⇒
  `TypeError: Failed to fetch` ⇒ **工具链字节必须同源托管**（逃生口全排查过：非 COI 页可跨域
  但要放弃 w64 档、SW 未装、让上游加 CORP 不能当前提）。**但"不维护插件库"仍成立**：
  我们**不持有任何字节的权威** —— 工具链 = 上游 Release（`URL+sha256` 进
  `upstream-lock.json`，`check_locks.py` 接手）；包 = 上游 Forge tarball（货架 submodule
  commit 承载）；头 = Octave 树派生（`upstream-pins.json` 承载）。站点副本是 **provision
  产物**（可删可重建）= 缓存，不是维护对象。
  接缝：A 只补一个洞（`pkg.m` 先问 catalog）；B 只加**一个方法**
  `OctaveAssets.compileExtension()`。**设计验证**：真包源码直编成功 ——
  `miscellaneous/src/cell2cell.cc` + 合成 `config.h` + 788 真头 ⇒ 13446 B 真 `.oct`
  ⇒ `addpath` 后 `exist=3` 且 `cell2cell({1,2},1)=1×1`、`(,2)=1×2` **语义正确**。
  ⚠️ 关键发现：`config.h`（25 宏）**不在 tarball 里**、是 `build-pkg-oct.sh` 合成的
  ⇒ 客户端要复现的核心知识 = 这 25 个宏，**必须是数据**（跟 catalog 走），不是硬编码。
- **上游闭环（2026-10-12）**：给 `ArchivalEra/LLVM-wasm` 提了 issue #1（发布包只装 wasm32
  档 sysroot ⇒ 编出的 wasm64 模块进不了下游宿主）；**对方已修**（v0.1.1：两档 sysroot 都发 +
  缺档硬拒绝），我方**独立复验通过**（反向断言生效 / 两档都能编 / wasm64 产物进真宿主
  `dlopen OK`）。留档：`build/113/ISSUE-for-LLVM-wasm.md` + `ISSUE-1-verify-comment.md`。
- **车道架构纯度闸门（用户点令：一线一架构）**：新增 `build/113/check-lane-purity.py`
  （判据①宿主②车道 `.oct`③站点**本档专属**目录；fail-closed + 零值守卫；自证 6 条），
  已接进 `promote-w64-lane.sh` 第 5 步自检并**三线各推一份**。
  实测：8761 w64 ✓ / master w64 ✓ / wasm32 ✓ 三处同档。

- **三线 6.0.12 全部跑通并推送（2026-10-11→12）**：三条线各自在 emsdk 6.0.12 下重编、
  浏览器侧验收、推送 —— **local = origin = mirror 三处一致**：
  | 线 | 产物（verdict=ok） | 浏览器侧验收 | 分支头（三处一致） |
  |---|---|---|---|
  | IllegalPerformance（8761 现役） | w64 `8c535553…` / w64-base `f7139099…` | 全量 PROBES=1 全绿（唯一红 probe-octc-spike=环境性） | `860307f` |
  | master（wasm64-NEXT） | w64 `1ff6a111…` | 数值六套 107/0 + IEEE 逐位一致 + gfx-render 14/0 | `ea3d02d` |
  | wasm32-final（冻结线） | product `f1c0d21b…` | 数值六套全 0 FAIL + IEEE 逐位一致 + 宽套件大幅转绿 | `c09e6d0` |
  **两条验收纪律（本日实测踩到，别重犯）**：
  ① **验某一线必须让页面真跑它** —— 带 COI 的四格站会让页面静默选 `w64/`（在别的线产物上
  跑本线验收）；单档站（删 `threads/ w64/ w64-base/ lanes.js` + `--no-coi`）才可信。
  ② **源码修了 ≠ 站点跑的是修过的** —— `site/assets/m/*.js` 是打好的 bundle 快照；
  判据 = 用 `build/assets.py bundle-m` 重生成比 sha，且**挂载点必须逐字读
  `build/assets-meta.json` 的 `mount`**（`pkgfix` 挂 `m/pkg` 不是默认 —— 我按默认猜过，已纠正）。
- **两条冻结线的已知边界（非回归）**：Forge 按需拉取（`OctaveAssets.catalog/install`）只在
  本线落地（`ef912a1` 起），master 与 wasm32-final 未移植 ⇒ 那两线 `accept-forge-ondemand`
  的 A0 必然红（两线实测同形）。
- **本批新踩的第三个 6.x 假阳（口径已搬进代码）**：emcc 6.x sysroot 有 `<omp.h>` 无
  libomp ⇒ configure 探到 `-fopenmp` 可用 ⇒ 后续库探测带它 ⇒ 要求 shared-memory ⇒
  glpk（无 atomics）链不过 ⇒ `HAVE_GLPK` undef ⇒ **`__glpk__.oct` 出厂即空桩**
  （1494B、0 个 glp_ 符号），而构建/链接/自检全绿。修法固化进
  `build/113/configure-113-full.sh`：`ac_cv_func_omp_get_num_threads=no`
  `ax_cv_c_openmp=none` `ax_cv_cxx_openmp=none`。
- **既存形态（非本批引入，如实记）**：`accept-gfx-isolation` 的 C/C2 反向断言在
  **8761 现役上同样红**（A/B 各 13/0 全过）⇒ 是图形守卫 `gfxGuard()` 报告通道的既存
  缺口，与本轮三线重编无关。
- **既存闪烁（非本批引入，如实记）**：`accept-embed-api` 在 **sweep 并发**下偶发 1 条红
  （B 的 `on.output` 订阅偶发收不到 marker），**单跑 4/4 全 13/0 绿**（本批复验 4 次），
  且在 8768 全量里也是 13/0。⇒ 并发负载下的时序竞态，与 T4 无关（本批没碰 embed 通道）。


- **emsdk 6.0.12 已发运 8761（2026-10-11，落地批闭环）**：w64 两档 =
  治理化重链产物（`LANE_TAG` 旋钮，`verdict=ok`），sha 看台账
  `w64_wasm_sha`/`w64_base_wasm_sha`。发运链：farm 补库（freetype 2.14.3 离线
  供给 + fontconfig/gl2ps）→ 树全配方重编（+ omp 缓存变量 + **rust-sort seam 回补**
  ——试点树供错了源，缺 pin f4bf15b 的 Array-base.cc 缝 ⇒ sort 慢 2.2×）→
  `E2_OPENBLAS` 重链（试点漏 ⇒ BLAS 慢 8×）→ 独立站全量全绿 →
  promote 8768（全量全绿）→ promote 8761（全量 `PROBES=1` 除环境性探针外全绿，
  唯一红与 8772 同为 probe-octc-spike）→ 三层 SHA ✓ → dist 包内 sha == 部署件 ✓ →
  parity 三处一致 ✓。IEEE 双站逐位一致；BLAS/sort 基准
  持平。机制与复跑命令全在 `build/113/NOTES-emsdk-upgrade.md`（§7.5 keep-list
  跨版本重生成、§7.6 `<omp.h>` 无实现、§8.7 落地批全记录）。
  **遗留**：master 线/wasm32-final 未重编（§8.7 如实留单）。
- **断电恢复（2026-10-11）**：容器 o113 与三处站点服务被杀（§5.86 同款），
  已 `docker start` + `serve-coi.py` 重启，doctor 复验 **ok**、8761 BOOT OK；
  git 无损失（断电时被掐断的那次提交内容原样落在暂存区，已补提交）。

- **Forge 按需拉取插件系统 v1 已跑通并**发运**（2026-10-09/10，issue 64）**：客户端**用到才拉**——
  `OctaveAssets.catalog()` 读站点货架（**0 包下载**）、`OctaveAssets.install(name)` 拉包 + 依赖闭包
  + sha256 校验 + 委托引擎内建 `gunzip`/`untar` 解包 + 按 `pkg install` 布局落盘。
  **额外内容 = 独立仓 `Octave-Extra-Content`**（submodule，**private**；元数据 + 供给配方，每包一文件）
  ⇒ pin 由 submodule commit 承载、字节由 sha256 承载 ⇒ **能力与包数解耦**（加包 = 加一个文件）。
  站点目录 = `build/forge-catalog.py`（Octave 版本**从 fork 的 configure.ac 读**）；
  验收 = `test/browser/accept-forge-ondemand.mjs` **15/15**（含 3 条反向断言 + 按需性双向证据）；
  台账键 `forge_shelf_packs` / `forge_catalog_packs` 等 6 条。**v1 覆盖全部 10 个货架包**
  （`.m` 部分；`src/` 是可选加速件）。**已发运 8768/8761/仓库 `site/`**（装配件与已验收快照
  逐字节对拍）；新闸门 `build/113/check-forge-catalog.py`（目录↔货架↔镜像字节，自证 9 条，
  挂 pre-commit）。**v2（含编译件包的 `.oct` 按需）未做**，设计稿 §10 留单。

- **事实系统 = 重构版 Einfacht（2026-10-09 采纳）**：机制在 `zreflect/`（vendored 上游
  Phase 1–5：gate 平台 / registry 发现式名录 / knobs 登记 / guard / world 闸门），
  本仓数据层 = `zreflect/measure_octave.py`（数据 vs 机制分离），旋钮载体 =
  `reflect-hooks/Einfacht.env`，钩子挂 `reflect-hooks`。`build/facts.py` 降为兼容壳。
  退役 5 道被平台取代的旧 checker；悬案工单按新契约规范化。提交 `20e45c0`。
- **issue #5 已修并三线同步（2026-10-09）**：三线图形装饰命令（title/xlabel/grid/legend/
  axis/hold/subplot/bar）曾全崩（外部宿主写 0 输出 figure 桩覆盖核心 m）。修法 = 引擎侧
  `bridge/octave-core.js` 图形核心 m 树守卫（快照 + eval 前还原退化桩 + rehash）+
  `octave-page.js` embed 资产链修复。三线：IP `f3a4851` / master `f6ec52a` /
  wasm32-final `87b6c8b`；8761 已发运（`3a80fe3`）。验收 `accept-gfx-isolation` 四格 6/6。
  UI 侧只提不改：<https://github.com/ArchivalEra/Octave-UI/issues/1>。
- **worker 模式（`?worker=1`）曾整条坏，已修（2026-10-10）**：`bridge/index.html` 的 worker
  分支调 `octaveUiAppend`，而那函数在 `9239cae`（抽页面适配器）时被删除 ⇒ 第一次输出合批抛
  `ReferenceError` 且缓冲清空在其**后** ⇒ **每条 `OctaveWorker.eval` 永不 settle**（页面看似
  卡死）。修法 = 分支内定义 `appendOutput` + `flushUi` 先清后写。实测 `accept-worker`
  **21/0**、`probe-engine-parity` **22/0**（修前两者分别挂到 425s/NO-SUMMARY）。**随本批发运。**
- **现役 8761 = 四格站点**（根目录 base + `threads/` + `w64/` + `w64-base/`；w64 档 =
  relaxed-simd FMA **+ mimalloc** 版，工单 59 已发运）。各档 sha 看文末 AUTO 块与
  `build/FACTS.json` 的 `w64_wasm_sha`；最近一次全绿回归 = `accept_suites` / `accept_pass`。
  发运入口与批次收尾 = `AGENTS.md`。
- **上游架构已接入**（`upstream/` 18 个浅 submodule + `build/upstream-lock.json`）：
  5 fork 的 wasm 补丁分支（octave `wasm/11.3.0` @ `build/FACTS.json` 的 `octave_pin`、
  openblas `wasm-e2`、gl4es `wasm`、rapidjson `wasm/1.1.0`；suitesparse 对官方 tag 零差异）
  + 13 直连 tag。供给 = `build/provision-upstream.sh`；一致性 = `witness-upstream-pin.py`
  （容器树 == pin，每提交核对）。升级 SOP = `build/113/NOTES-upstream.md`。
- **性能线结论**：插件可达部件空间实测封口——现役两插件（e2-openblas / mimalloc）即全部；
  libm 标量替换负判决（wasm 无标量 FMA，`build/113/NOTES-libm.md`）；热点余下部分全在
  Octave 自身源码（`build/113/NOTES-hotpath.md`）。
- **Rust 补丁线（工单 63）**：**候选③ sort 已在 w64 落地 ADOPT**——nightly
  build-std 编 wasm64 库（rustc 无 wasm64-emscripten target；评审 E0–E5 全绿）+
  Array-base.cc 弱符号缝（fork `octave_pin`）+ RUST_SORT 旋钮（纯链接期，摘除 =
  旋钮关）。w64 端到端 A/B = asc **0.491** / desc 0.487（2.0×，`w64_rustsort_ab_*`）；
  全量 PROBES=1 等效 1358/0；端到端逐位抽查双站一致（IEEE 红线）。
- **rust-sort 已发运（2026-10-07）**：8761 的 w64 档 = f6fec91f（rust_sort+mimalloc+
  e2-rsimd+wasm64），`promote-w64-lane.sh` 发运，全量 PROBES=1 1358/0 + IEEE 754 评估
  通过（§5.97）+ 对撞 2.2×。**master 线 = 中庸 wasm64**（wasm64-NEXT，无 rust 缝，fork
  pin a5a7208）已改名推送（CI 部署仓库 site/）。三线独立：wasm32-final（冻结）/ 
  wasm64-NEXT / IllegalPerformance——换线四步规则见 `maintaince.md`。isui.ren 部署
  集成已抹除（929fc63/9d89fd0，部署改手工按 DEPLOY.md）。Einfacht #13（reflection
  world 反哺）已建档。
  **专属站 = site-illegalperf(8868) / -baseline(8869)**（装配入口
  `build/113/site-illegalperf.sh`）；候选产物 sha = `w64_rustsort_cand_sha`；
  **发运 = 产品决定**（翻表默认 + lane_expect + promote）。候选④ elem_xpow
  前置 G6 延迟断言。
- **工单 62 已结案（2026-10-05）**：ccache 假说被 equiv2 对照推翻（R-014）；真根因 =
  `f77-fcn.h` 未收编手改（`F77_CHAR_ARG_LEN_TYPE` wasm64→int），已按处方收编 fork
  `wasm/11.3.0`（octave_pin 指新提交）；equiv3 确认供给树 rebuild 可复现——1 条容忍
  mismatch + wasm-opt 绿 + `verdict=ok`。**上游升级 SOP 解锁**（emcc6 仍不立项）。
  供给树是 pin 管辖物，改动只有 fork commit 一条路（过程插曲见 HISTORY §5.89）。
- **8761 在 promote 之前一字未动**；FMA 版备份 =
  `/mnt/hdd/octave-wasm-build/w64-artifacts-fma-backup-20261004/`。
- **人的动作**（外部依赖）：票 38 页面资产上站（`build/promote-pages.sh`）、票 12 真机手测
  （清单 `docs/manual-test-checklist.md`）、E6 图形线（embed 页 GL 纹理边界）。
- **Einfacht 反哺（暗线持续推进）**：PR #11（check_pins + check_locks）**已并**（76ff1f5）；
  **PR #12（check_ab，A/B 同旗标）已并**（dfd8af8）——上游并后抓到我一处真 bug
  （check_ab 缺 `__main__` 入口 ⇒ 直接跑静默退 0）并修之（ef14f67），已同步本地
  main 并验证全绿；本仓 tools 教训：**所有可执行闸门脚本必须显式 __main__ 入口**。
  量法登记 3 条（含被证伪的排序基准法）。

## 附 · 机器维护的区块（**自动生成，别手改**）

### 实测事实台账（**活状态文档里数字的唯一产地**）

<!-- AUTO:FACTS -->
> 本区块由 `zreflect/facts.py --render-doc` 从 `FACTS.json` 渲染，**不要手改**（pre-commit 会重算并 `git add`）。
> 正文里的「测出来的数字」只在这里生产：要引用就写 `[[键名]]`，不要手抄数字。

| 键 | 值 | 测于 | 复跑命令 |
|---|---|---|---|
| `accept_pass` | **1211** | 2026-10-16T15:57:56+0800 | `同上，把每个套件的 PASS 相加` |
| `accept_suites` | **53** | 2026-10-16T15:57:56+0800 | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20261016-120747 里带汇总行的套件（且 0 FAIL）` |
| `build_json_sha` | `d953d7a7929754be…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json | cut -d' ' -f1` |
| `data_sha` | `f250530ae5abe378…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data | cut -d' ' -f1` |
| `dist_lane_probe_fail` | **0** | 2026-10-16T15:57:58+0800 | `同上` |
| `dist_lane_probe_pass` | **33** | 2026-10-16T15:57:58+0800 | `cd <dist 包目录> && python3 serve.py 8788；再 SITE_DIR=<dist 包目录> sh build/sweep.sh http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log` |
| `e2_lu800_ratio` | **1.4** | 2026-10-16T15:57:56+0800 | `上面两行的比值（车道 / E2）` |
| `e2_lu800_s` | **0.043** | 2026-10-16T15:57:56+0800 | `同 E2 那一行` |
| `e2_matmul500_ratio` | **1.9** | 2026-10-16T15:57:56+0800 | `上面两行的比值（车道 / E2）` |
| `e2_matmul500_s` | **0.021** | 2026-10-16T15:57:56+0800 | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` |
| `e2_single_verdict` | **ok** | 2026-10-16T15:57:56+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` |
| `e2_single_wasm_bytes` | **29495868** | 2026-10-16T15:57:56+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm | cut -d' ' -f1` |
| `e2_threaded_lu800_s` | **0.02** | 2026-10-16T15:57:56+0800 | `同上` |
| `e2_threaded_matmul500_ratio` | **6.7** | 2026-10-16T15:57:56+0800 | `车道 / 线程版（派生）` |
| `e2_threaded_matmul500_s` | **0.006** | 2026-10-16T15:57:56+0800 | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` |
| `e2_threaded_oct_rc` | **124** | 2026-10-16T15:57:56+0800 | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` |
| `e2_threaded_verdict` | **ok** | 2026-10-16T15:57:56+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` |
| `e2_threaded_wasm_bytes` | **29908917** | 2026-10-16T15:57:56+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm | cut -d' ' -f1` |
| `emcc6_probe_geomean` | **1.001** | 2026-10-16T15:57:56+0800 | `sh test/fixtures/emcc6-probe/run-probe.sh 1（读 w64-logs/emcc6-probe.log 的 geomean 行）` |
| `env_vars` | **33** | 2026-10-16T15:57:56+0800 | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh | sort -u（去掉位置参数）` |
| `exported_functions` | **710** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` |
| `floor_matrix_engines` | **4** | 2026-10-16T15:57:58+0800 | `数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）` |
| `floor_matrix_fail` | **0** | 2026-10-16T15:57:58+0800 | `同上` |
| `floor_matrix_pass` | **16** | 2026-10-16T15:57:58+0800 | `同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）` |
| `fonts_count` | **8** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` |
| `forge_catalog_oct_packs` | **0** | 2026-10-16T15:57:56+0800 | `python3 -c "import json;print(len([p for p in json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['packs'] if 'oct' in (p.get('kinds') or [])]))"` |
| `forge_catalog_octave` | **11.3.0** | 2026-10-16T15:57:56+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['octave'])"` |
| `forge_catalog_packs` | **14** | 2026-10-16T15:57:56+0800 | `python3 -c "import json;print(len(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['packs']))"` |
| `forge_catalog_selftest_pass` | **20** | 2026-10-16T15:57:58+0800 | `python3 build/forge-catalog.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `forge_catalog_shelf_commit` | **922736ae6293** | 2026-10-16T15:57:56+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['shelf_commit'])" | cut -c1-12` |
| `forge_gate_selftest_pass` | **30** | 2026-10-16T15:57:58+0800 | `python3 build/113/check-forge-catalog.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `forge_shelf_packs` | **13** | 2026-10-16T15:57:56+0800 | `ls shelf/packages/*.json | wc -l` |
| `forge_shelf_verified` | **13** | 2026-10-16T15:57:56+0800 | `grep -l '"verified": {' shelf/packages/*.json | wc -l` |
| `hotpath_fft_blktrans_pct` | **19.1** | 2026-10-16T15:57:56+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6; tic; for k=1:10, y=fft(x); end' --lane w64` |
| `hotpath_instrument_ok` | **ok** | 2026-10-16T15:57:56+0800 | `python3 build/113/hotpath.py calibrate` |
| `hotpath_top` | **exp_inline 23.6%** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/hotpath-logs/20261005-142643/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）` |
| `hotpath_xpow_driver_pct` | **39.5** | 2026-10-16T15:57:56+0800 | `同上（elem_xpow + do_rc_map）` |
| `hotpath_xpow_libm_pct` | **48.9** | 2026-10-16T15:57:56+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6+0.1; tic; for k=1:20, y=sqrt(x)+x.^0.7; end' --lane w64（读 w64-logs/hotpath-final3.log）` |
| `hw_apis_available` | **3** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['hw'];print(sum(1 for k in ('serial','usb','hid') if d.get(k)))"` |
| `ip_vs_next_sort_ip_ms` | **0.105** | 2026-10-16T15:57:56+0800 | `sh test/browser/run.sh test/browser/bench-lanes.mjs <8761> w64（读 w64-logs/bench-IP-vs-NEXT.log）` |
| `ip_vs_next_sort_next_ms` | **0.237** | 2026-10-16T15:57:56+0800 | `同（<8869>）` |
| `ip_vs_next_sort_ratio` | **0.443** | 2026-10-16T15:57:56+0800 | `派生：IP ÷ NEXT` |
| `js_sha` | `caac68bf62015859…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js | cut -d' ' -f1` |
| `jspi_entry` | **True** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` |
| `lane6012_ip_verdict` | **ok** | 2026-10-16T15:57:58+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-ip.verdict` |
| `lane6012_master_verdict` | **ok** | 2026-10-16T15:57:58+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-master.verdict` |
| `lane6012_ok_lines` | **3** | 2026-10-16T15:57:58+0800 | `grep -l '^ok$' /mnt/hdd/octave-wasm-build/w64-logs/lane6012-*.verdict | wc -l` |
| `lane6012_wasm32_verdict` | **ok** | 2026-10-16T15:57:58+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-wasm32.verdict` |
| `lane_lu800_s` | **0.06** | 2026-10-16T15:57:56+0800 | `同车道那一行` |
| `lane_matmul500_s` | **0.04** | 2026-10-16T15:57:56+0800 | `现役车道站点跑同一个 bench-core.mjs` |
| `libm_spike_geomean` | **0.964** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-libm-spike.sh 8（读 w64-logs/libm-spike-verdict.txt 的 geomean 行）` |
| `locale_contract_lanes` | **4** | 2026-10-16T15:57:56+0800 | `for l in w64 base threads w64-base; do sh test/browser/run.sh test/browser/probe-locale.mjs "http://127.0.0.1:8761/?lane=$l"; done （读 w64-logs/locale-all-lanes.log 的 '8 PASS / 0 FAIL' 计数）` |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html | cut -d' ' -f1` |
| `mem_live_ceiling_gib` | **7.45** | 2026-10-16T15:57:58+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log` |
| `native_netlib_loop1e6_s` | **0.500141** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu1500_s` | **0.25765** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu800_s` | **0.04076** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul1000_s` | **0.196202** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul500_s` | **0.027249** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_lu1500_s` | **0.040473** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_lu800_s` | **0.026146** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul1000_s` | **0.009586** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_matmul1024_s` | **0.008517** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul2000_s` | **0.050018** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul500_s` | **0.003212** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_threads` | **24** | 2026-10-16T15:57:58+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `oct_base_files` | **16** | 2026-10-16T15:57:56+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' | wc -l` |
| `oct_lane_files` | **16** | 2026-10-16T15:57:56+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct-threads -name '*.oct' | wc -l` |
| `oct_lane_octdir_files` | **28** | 2026-10-16T15:57:56+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-threads -name '*.oct' | wc -l` |
| `oct_lane_tls_init` | **44** | 2026-10-16T15:57:56+0800 | `python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads --base <站点>/assets/oct <站点>/assets/octdir` |
| `octave_pin` | **f4bf15b792bf** | 2026-10-16T15:57:56+0800 | `git -C upstream/octave rev-parse --short=12 HEAD` |
| `octdir_base_files` | **28** | 2026-10-16T15:57:56+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' | wc -l` |
| `port_gate_selftest_pass` | **6** | 2026-10-16T15:57:58+0800 | `python3 build/extra-content/check-content-port.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `port_validator_selftest_pass` | **41** | 2026-10-16T15:57:57+0800 | `python3 build/extra-content/validate-content-list.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `probe_lane_fail` | **0** | 2026-10-16T15:57:56+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `probe_lane_pass` | **33** | 2026-10-16T15:57:56+0800 | `SITE_DIR=<站点> sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` |
| `pyodide_sync_probe_pass` | **4** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sync.json'))['pass'])"` |
| `pyodide_sync_ready_ms` | **2316** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sync.json'))['result']['pyodideReadyMs'])"` |
| `rust_fill_spike_ratio` | **1.094** | 2026-10-16T15:57:56+0800 | `sh test/fixtures/rustfill-spike/run-spike.sh（读 w64-logs/rustfill-spike.log 的比值行）` |
| `rust_sort_spike_base_ms` | **352.0** | 2026-10-16T15:57:56+0800 | `sh test/fixtures/rustsort-spike/run-spike.sh（读 w64-logs/rustsort-spike.log）` |
| `rust_sort_spike_cand_ms` | **87.0** | 2026-10-16T15:57:56+0800 | `同上` |
| `rust_sort_spike_ratio` | **0.249** | 2026-10-16T15:57:56+0800 | `派生：cand ÷ base` |
| `symbolic_seam_fail` | **0** | 2026-10-16T15:57:58+0800 | `awk '/=== [0-9]+ PASS/{f=$5} END{print f}' /mnt/hdd/octave-wasm-build/w64-logs/accept-symbolic-seam.log` |
| `symbolic_seam_pass` | **9** | 2026-10-16T15:57:58+0800 | `awk '/=== [0-9]+ PASS/{p=$2} END{print p}' /mnt/hdd/octave-wasm-build/w64-logs/accept-symbolic-seam.log` |
| `sympy_assets_bytes` | **6757104** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['bytes']['disk']['coreTar'])"` |
| `sympy_import_ms_pyc` | **380** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['importB_ms'])"` |
| `sympy_import_ms_source` | **2757** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['importA_ms'])"` |
| `sympy_perf_cold_start_ms` | **2276** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide.json'))['timings'];print(round(d['load']+d['pkg']))"` |
| `sympy_perf_pyodide_over_native` | **2.01** | 2026-10-16T15:57:58+0800 | `python3 test/fixtures/sympy-perf/compare.py（读最后一行 JSON 的 geo）` |
| `sympy_pyc_bytes_ratio` | **3.28** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['bytes'];print(round(d['B']/d['A'],2))"` |
| `sympy_pyc_cold_geo_speedup` | **1.29** | 2026-10-16T15:57:58+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读 cold_geo_speedup）` |
| `sympy_pyc_compile_calls` | **0** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['sourceToCode']['B'])"` |
| `sympy_pyc_import_speedup_pyodide` | **7.4** | 2026-10-16T15:57:58+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读末行 JSON 的 import_s.speedup）` |
| `sympy_pyc_speedup` | **7.26** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['speedup'])"` |
| `sympy_pyc_steady_geo_ratio` | **0.99** | 2026-10-16T15:57:58+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读 steady_geo_ratio）` |
| `sympy_pyodide_break_fails_loud` | **True** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][2]['result']['ok'])"` |
| `sympy_pyodide_diff` | **cos(x)** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][0]['result']['diff'])"` |
| `sympy_pyodide_nocoi_ok` | **True** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'];print(d[1]['result']['ok'], d[1]['result']['diff'])"` |
| `sympy_pyodide_ok` | **True** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][0]['result']['ok'])"` |
| `threads_blas_dir` | **/src/work/e2-openblas-lib-s** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 inputs.blas.resolved_dir` |
| `threads_exported_functions` | **725** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.exported_functions` |
| `threads_pthread_glue` | **54** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.pthread_glue` |
| `threads_shared_memory` | **True** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.shared_memory` |
| `threads_v128` | **4926** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.simd.v128` |
| `threads_verdict` | **ok** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 verdict` |
| `threads_wasm_bytes` | **29495868** | 2026-10-16T15:57:56+0800 | `stat -c%s /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` |
| `threads_wasm_sha` | `e570905ecc8927bf…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/threads/octave.wasm | cut -d' ' -f1` |
| `upstream_submodule_count` | **19** | 2026-10-16T15:57:56+0800 | `git submodule status | wc -l` |
| `w64_base_shared_memory` | **False** | 2026-10-16T15:57:58+0800 | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.threads.shared_memory` |
| `w64_base_verdict` | **ok** | 2026-10-16T15:57:58+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.build.json）` |
| `w64_base_wasm64` | **True** | 2026-10-16T15:57:58+0800 | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.wasm64` |
| `w64_base_wasm_bytes` | **29970457** | 2026-10-16T15:57:58+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm` |
| `w64_base_wasm_sha` | `f71390990d8f1428…` | 2026-10-16T15:57:58+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm | cut -d' ' -f1` |
| `w64_big_heap` | **True** | 2026-10-16T15:57:58+0800 | `同上（探针结尾的 `W64_BIG_HEAP=` 行）` |
| `w64_build_recipe_ok` | **ok** | 2026-10-16T15:57:56+0800 | `python3 build/113/witness-build-inputs.py` |
| `w64_build_tool_match` | **match** | 2026-10-16T15:57:56+0800 | `<重链 w64 后：python3 build/113/witness-build-provenance.py w64>` |
| `w64_cand_exported_functions` | **751** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 measured.exported_functions` |
| `w64_cand_loop1e6_s` | **0.574** | 2026-10-16T15:57:58+0800 | `同上（loop 1e6）` |
| `w64_cand_lu800_s` | **0.014** | 2026-10-16T15:57:58+0800 | `同上（lu 800）` |
| `w64_cand_malloc` | **mimalloc** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 declared.malloc / measured.malloc` |
| `w64_cand_matmul500_s` | **0.005** | 2026-10-16T15:57:58+0800 | `<交错 3 轮取中位：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8861/ w64（×3 ⇒ w64-logs/bench-mi2-r1..3.log）>` |
| `w64_cand_verdict` | **ok** | 2026-10-16T15:57:56+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.build.json）` |
| `w64_cand_vs_ship_lu800` | **1.0** | 2026-10-16T15:57:58+0800 | `派生：同上（lu 800）` |
| `w64_cand_vs_ship_matmul500` | **1.25** | 2026-10-16T15:57:58+0800 | `派生：w64-logs/bench-mi2-r1..3.log 的中位 ÷ bench-ship2-r1..3.log 的中位` |
| `w64_cand_wasm_bytes` | **30984954** | 2026-10-16T15:57:56+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm` |
| `w64_cand_wasm_sha` | `01fb52fc3b5dde30…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm | cut -d' ' -f1` |
| `w64_exported_functions` | **750** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.exported_functions` |
| `w64_i64_insns` | **4175689** | 2026-10-16T15:57:58+0800 | `llvm-objdump -d <w64>/octave.wasm | grep -c i64（由 build/113/build-w64-lane.sh facts 写出，容器内跑）` |
| `w64_lu800_s` | **0.079** | 2026-10-16T15:57:58+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_malloc` | **mimalloc** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 declared.malloc / measured.malloc` |
| `w64_matmul500_s` | **0.048** | 2026-10-16T15:57:58+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_mem_5g_bytes` | **5242880000** | 2026-10-16T15:57:58+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_8g_bytes` | **8589934592** | 2026-10-16T15:57:58+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_probe_fail` | **0** | 2026-10-16T15:57:58+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `w64_mem_shared_5g_bytes` | **5242880000** | 2026-10-16T15:57:58+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_ob_lib_wasm32_members` | **0** | 2026-10-16T15:57:58+0800 | `同上` |
| `w64_ob_lib_wasm64_members` | **1557** | 2026-10-16T15:57:58+0800 | `E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh src patch build > w64-logs/e2-w64-build.log（读那行架构断言）` |
| `w64_ob_lu800_s` | **0.014** | 2026-10-16T15:57:58+0800 | `同上（8761 现役那轮）` |
| `w64_ob_matmul1000_native_ratio` | **0.38** | 2026-10-16T15:57:58+0800 | `派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_ob_matmul500_native_ratio` | **1.07** | 2026-10-16T15:57:58+0800 | `派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_ob_matmul500_s` | **0.003** | 2026-10-16T15:57:58+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log` |
| `w64_ob_matmul500_speedup` | **15.3** | 2026-10-16T15:57:58+0800 | `派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项` |
| `w64_ob_matmul500_vs_netlib` | **9.1** | 2026-10-16T15:57:58+0800 | `派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_oct_files` | **46** | 2026-10-16T15:57:58+0800 | `同上（文件名：oct-wasm64.txt 的第二个数）` |
| `w64_oct_wasm64` | **46** | 2026-10-16T15:57:58+0800 | `bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/llvm-readobj 逐个量）` |
| `w64_relaxed_madd` | **6** | 2026-10-16T15:57:56+0800 | `<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>` |
| `w64_rustsort_ab_asc_ms` | **165** | 2026-10-16T15:57:56+0800 | `bash build/113/sort-ab.sh /mnt/hdd/octave-wasm-build/site-illegalperf /mnt/hdd/octave-wasm-build/site-illegalperf-baseline 3（读 w64-logs/rust-sort-ab.log）` |
| `w64_rustsort_ab_asc_ratio` | **0.506** | 2026-10-16T15:57:56+0800 | `派生：候选 ÷ 对照（asc 中位）` |
| `w64_rustsort_ab_desc_ratio` | **0.551** | 2026-10-16T15:57:56+0800 | `派生：候选 ÷ 对照（desc 中位）` |
| `w64_rustsort_base_ab_ms` | **326** | 2026-10-16T15:57:56+0800 | `同上` |
| `w64_rustsort_cand_sha` | `f6fec91fc7a0f4b8…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/artifacts-w64-rust-on/octave.wasm | cut -d' ' -f1` |
| `w64_shared_memory` | **True** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.threads.shared_memory` |
| `w64_v128` | **6295** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.simd.v128` |
| `w64_verdict` | **ok** | 2026-10-16T15:57:56+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts/octave.build.json）` |
| `w64_vs_netlib_loop1e6` | **0.67** | 2026-10-16T15:57:58+0800 | `派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6` |
| `w64_vs_netlib_lu1500` | **3.8** | 2026-10-16T15:57:58+0800 | `派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500` |
| `w64_vs_netlib_matmul1000` | **7.8** | 2026-10-16T15:57:58+0800 | `派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_wasm64` | **True** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.wasm64` |
| `w64_wasm_bytes` | **31246703** | 2026-10-16T15:57:56+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm` |
| `w64_wasm_sha` | `8c535553a2140ae4…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm | cut -d' ' -f1` |
| `wasm_bytes` | **29632229** | 2026-10-16T15:57:56+0800 | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_sha` | `1ed3e528561e4475…` | 2026-10-16T15:57:56+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm | cut -d' ' -f1` |
| `wasm_v128` | **4752** | 2026-10-16T15:57:56+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` |
| `webgpu_main_device` | **OK** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['main']['device'])"` |
| `webgpu_vendor` | **nvidia** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['main']['vendor'])"` |
| `webgpu_worker_compute_ok` | **True** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['computeOK'])"` |
| `webgpu_worker_device` | **OK** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['device'])"` |
| `webgpu_worker_webgl2` | **True** | 2026-10-16T15:57:58+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['webgl2'])"` |
| `xpow_driver_spike_pct` | **2.1** | 2026-10-16T15:57:56+0800 | `bash test/fixtures/xpow-spike/run-spike.sh（读 w64-logs/xpow-spike.log）` |
| `xpow_driver_spike_ratio` | **0.988** | 2026-10-16T15:57:56+0800 | `同上（cand/base）` |

172 条事实。
<!-- /AUTO:FACTS -->

<!-- AUTO:GATES -->
> 本区块由 `zreflect/facts.py --render-doc` 从发现式名录（zreflect/registry.py 的声明行）渲染，**不要手改**。
> 执行面（hooks / CI）读 `registry --run <相位>` —— 相位是声明字段（`runs_at`），不是文件名。

| 闸门 | 相位 | 它挡住什么 | 消费的旋钮 |
|---|---|---|---|
| `check_ab.py`（A/B 闸门） | commit | A/B 同旗标不变式（非 allow 轴差异 = 混淆变量，A/B 作废） | `REFLECT_AB` |
| `check_envfile.py`（env 文件闸门） | commit | 守钩子的 REFLECT_* 载体（旋钮 typo / 指向缺失 / 空值） | `REFLECT_ENV_FILE` |
| `check_facts.py`（事实闸门） | commit | 块一致性 / 裸数字 / 坏引用 | `REFLECT_FACTS`, `REFLECT_DOC`, `REFLECT_NAKED_MIN` |
| `check_facts_replay.py`（复跑闸门） | commit | 台账 cmd 逐字复跑（裸值契约：stdout 必须等于值） | `REFLECT_FACTS`, `REFLECT_REPLAY`, `REFLECT_REPLAY_TIMEOUT` |
| `check_instruments.py`（仪器生命周期闸门） | commit | 恒常检测（first_seen）+ 被证伪量法登记 | `REFLECT_INSTRUMENTS`, `REFLECT_INSTRUMENT_DAYS`, `REFLECT_FACTS` |
| `check_invariants.py`（不变量闸门） | commit | 声明式不变量：仓库文件必须/不得含某片段（grep 级） | `REFLECT_INVARIANTS` |
| `check_locks.py`（锁定源闸门） | commit | 锁定源清单（URL + 文件 + sha256 的内容指纹） | `REFLECT_LOCKS` |
| `check_pins.py`（pin 闸门） | commit | 派生树 pin 一致性（stamp commit / dirty / 版本串对读） | `REFLECT_PINS` |
| `check_questions.py`（悬案闸门） | commit | 未结案的问题必须挂一个能跑的结算件 | `REFLECT_QUESTIONS` |
| `check_readme_sync.py`（三语 README 闸门） | commit | 语言版本是同一条断言的三份拷贝：结构互链 + 每次推送同批 | `REFLECT_READMES` |
| `check_retractions.py`（翻案重现检测） | commit | 被推翻的断言不许悄悄回来当现状 | `REFLECT_RETRACTIONS`, `REFLECT_DOCS`, `REFLECT_HISTORY_SECS` |
| `check_stale.py`（陈旧断言检测） | commit | sha 出处 / 退役名 / 测龄 | `REFLECT_DOCS`, `REFLECT_FACTS`, `REFLECT_HISTORY_SECS`, `REFLECT_RETIRED`, `REFLECT_STALE_DAYS` |
| `check_world.py`（world 闸门） | commit | 声明式验证对象：多线仓库共享验证环境的世界对账 | `REFLECT_WORLD`, `REFLECT_WORLD_LINE` |
| `doctor.py`（开工预检 doctor） | start-of-work | 进程 / 端口活性（查会死的东西 ⇒ runs_at=start-of-work，不进 pre-commit） | `REFLECT_DOCTOR`, `REFLECT_DOCTOR_TIMEOUT` |

14 道闸门（发现式名录派生 —— 手写清单会漂，加闸门 = 落一个声明行，这里自动长出来）。
<!-- /AUTO:GATES -->

### 部署状态

<!-- AUTO:STATE -->
> 本区块由 `.githooks/update-state.py` 重算，**不要手改**（pre-commit 会刷新并 `git add`；pre-push 会 `--check`）。

| 项 | 值 |
|---|---|
| `octave.wasm` | 29,632,229 B raw / 7,083,341 B gz | sha256 `1ed3e528561e4475…` |
| `octave.js` | 462,821 B raw / 89,652 B gz | sha256 `caac68bf62015859…` |
| `octave.data` | 9,712,174 B raw / 3,155,047 B gz | sha256 `f250530ae5abe378…` |
| 三大件 gzip 合计 | **10,328,040 B** | |
| 资产条目 | 50 | |
| 最近一次**全绿**回归 | `20261016-102727` · **51 套 / 1,195 PASS / 0 FAIL**（同日 PROBES=1 另跑：探针 39 套 / 337 PASS、基准 3 套（按契约无汇总行）） | http://127.0.0.1:8761/ |
| 交付包 | `octave-full-wasm-site-20261013` · tar.zst 91,174,916 B · `979d3cf0d085e165…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `IllegalPerformance`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->