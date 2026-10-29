# STATE · 活状态

正文只写「现在是什么」，**数字一律引用 `build/FACTS.json` 的键**（或看文末机器块）。
方向与地图在 `maintaince.md`；硬规矩在 `AGENTS.md`；历史在 `HISTORY.md`（append-only）。

## 现在是什么（2026-10-29 · README 三件套重写 + OM 门缺陷闭环）

- **★ README 三件套重写（用户点令两轮）**：四个实测病 —— ① 图片加载不出（**master 分支
  从未有 `docs/charts/`**，三张图全断，而 master 是 GitHub 默认分支）② 又臭又长（英文
  1419 行 / 119 KB + **87 KB 的 AUTO 逐文件清单**）③ 掺互相的语言（英文 README 里 132 个
  汉字）④ 三份内容完全不一样（10/9/9 节，各写各的批次史）。
  修法：统一骨架 + 纯语言 + **批次史归 HISTORY**（新增 §5.110–§5.114）+ AUTO 块改分类摘要
  （`update-readme.py` 的逐文件清单从上千行降到约二十行，新增自证 4/0）+ master 补 `docs/charts/` 与白名单。
  结果：119 KB / 70 KB / 79 KB → **11 KB / 9 KB / 11 KB**。

- **★ 本批自我审计（adversarial-essay-sparring）抓到三处编造**：性能表复跑产地焊错
  （写成 `w64_rustsort_ab_*`，实为 `perf-data.json`+`HISTORY §5.96`）/ `libm` 几何均值
  写 0.991（真值 **0.964**）/ 「~500 packages」未查即改写口径。教训同族：**凭印象写数字
  = 造第二产地**。

- **★ OM 门缺陷闭环（收件 028，它认并独立复现）**：它测 gap **396 ms**（我测 477 ms，同一
  现象不同采样），两站改后 **9 PASS / 0 FAIL**。它**没照抄我的 `__octaveReady`**，理由成立：
  那是某站点的实现细节 ⇒ 绑它等于把"交付验收"退化成"某站点自检"；改用 **`/bridge` 在 MEMFS
  非空**（桥自己的契约，跨站点成立）。**我采纳并收回 `027` 的建议**。它另加 ★⑧ 门回归判据
  （就绪时 `/bridge` 必须非空，防"门太早"回归）。

- **★ 它的反向用例逼出我方两个缺陷（已修）**：`accept-omc-e2e.mjs` 在无桥站**整页崩**
  （清单 404 时 `bad` 未初始化 ⇒ `TypeError` ⇒ 不出汇总行 ⇒ 看起来像挂死而不是报红，正是
  F1 第三类要拦的形状）；E5 在 `/bridge` 不存在时 `readdir` 抛错。修后三向都对：
  8761 **6/0**、8768 **6/0**、无桥对照 8873 **3P/3F**。

- **验收**：两站全量**都零红**（套数与 PASS 数见 [[accept_suites]] / [[accept_pass]]）；三线（master / wasm32-final /
  IllegalPerformance）本地 = origin = mirror 三方一致；master 上 6 个 `docs/` 引用零缺失
  （GitHub API 探两张 SVG 均 200）。

## 现在是什么（2026-10-29 · E 线桥**交付完成**：OM 回信 025 → 装配落地 → 工单 70 结案）

- **★ 收件 `026`（OM `mail/025`）：三问逐条答完，且它纠正了我一条形态建议**（我复核成立）：
  我原以为"站点落 `omc/bridge/` + addpath"就够 —— **错**。`addpath` 走 **MEMFS**，站点
  HTTP 路径不在其中（我方独立验：MEMFS 根只有 tmp/home/dev/proc/fonts/src/usr；站点路径
  `exist=0`；MEMFS 写文件后 addpath ⇒ `exist=2`）。⇒ 形态是**两段**：站点目录 = 字节来源；
  运行期必须**写 MEMFS 再 addpath**。这是本批最有价值的一条纠错。

- **★ 交付物（我方侧，全部带自证）**：
  · `build/113/provision-omc-bridge.sh`：12 件字节供给（**投影** OM 的 `bridge/manifest.json`，
    逐件核 sha&bytes，反证清单外文件）；自证 **4/0**。两站各 13 件（12 交付 + 清单本身）。
  · `bridge/octave-omc-bridge.js`：四步装配（MEMFS → boot omc → import 桥 → serve）+ 三档
    失败态 + 两段式句柄（`.memfs` 完成 ⇒ 桥 `.m` 可见；`.ready` ⇒ 引擎+桥全通）。
    **引擎真实形态 = ESM（wasm-bindgen）**：`export { initSync, __wbg_init as default }` ——
    我第一版猜的三个 Emscripten 全局工厂名**全部不存在**（产物自证纠正）。
  · `bridge/octave-core.js`：把 `.memfs` 那一段**串进 boot 链**（`st.ready = true` 之前，
    实测 **39 ms**）；omc 引擎 boot 仍在后台（74 MB 级，不进开机路径 ⇒ 开机仍 **1.3 s**）。
  · `test/browser/accept-omc-e2e.mjs`：工单 70 的**结算件**，6 条含两条反向
    （E5 摘掉 `/bridge` ⇒ 三项必须 MISSING）。两站 **6/0**。

- **★★ 我查出的判据缺陷（OM 产品态套件 3 条假红的真因）**：
  它的就绪门是 `M.eval_string('x=1+1;') === 0`，**实测 877 ms 就通过**，而本站 boot 链
  到 **1354 ms** 才装完（`__octaveReady`）⇒ 它在 **477 ms 空窗**里探 `exist('omc_*')`
  ⇒ 必然 MISSING。换成本站 76 套统一的 `__octaveReady` 门重探同一页面 ⇒ **8/8 全绿**。
  这不是装配缺陷，是判据的时序缺陷。已投 `027-host` 请它改门（或说明它的定义）。

- **验收**：两站全量**都零红**（PASS 数见 [[accept_pass]]）；8761/8768 `BOOT OK 1.3s`；
  三处 parity 完全一致；`accept-omc-e2e` 两站 6/0。

- **仍开放**：`omc_simulate('BouncingBall')` 端到端数据矩阵需要 omc 引擎 boot 稳定完成
  （E2：8768=`ready`、8761=`omc-not-ready`）—— 74 MB ESM 引擎的 boot 耗时归 OM 侧。

## 现在是什么（2026-10-29 · E 线桥交接：收件 062 + 记工单 70 + 投 OM 024）

- **★ 收件 `062`（内容仓 `108-host`）= E 线归属裁定，我方接受**：UI「OpenModelica 终端」
  在 `__omc` 未起时走 fallback ⇒ `omc_simulate(...)` ⇒ `Error (rc=2)`。内容仓把归属判为
  **产权在 OM / 装配在我方 / 消费在 UI**、且**不是内容契约**（这批 `.m` 不进
  `forge-catalog.json`），并要求**我们两家自行约定交付形态**。四条判据我方复跑 **4/4 为真**
  （我方全树 `omc_*.m` = 0；OM `bridge/` 12 件齐；它的验收靠 `injectFile` 运行时注入；
  我方站点同样 0 件）。

- **★★ 我方查到的两条新事实（内容仓不知道，比它的描述深一层）**：
  1. **`omc_bridge.js` 零调用方** —— 全 OM 仓 + 其产品站点都查过（排除定义文件本身后 0 处）；
     它的验收套件里 `serveOnce()` 是**套件内自己实现的宿主**（`accept-omc-bridge.mjs:150`
     注释原文）。⇒ 缺口不止"没铺到宿主站点"，而是**这个桥从未被接线**。
  2. **三条承重语义只活在测试文件里**：`cd`（omc 输出目录跟 cwd 走，否则 `resultFile` 空）、
     `loadFile` 必须**跨 VFS 搬字节**（omc 是另一个 wasm，实测 `wasi_path_open → -1`）、
     `simulate` 结果 `.mat` 要**回搬**进 Octave MEMFS 并以 `MAT <path>` 告知。
     ⇒ 只照接口签名写产品实现的人必然重踩。

- **已投 `024-host` 进 OM 收件箱**（`OpenModelica-Full-Wasm/mail/024-host-matlab-bridge-delivery-shape.md`）：
  复跑四条判据 + 两条新事实 + **§3 三问**（谁铺/铺哪/谁 addpath；`serve()` 启动时序；
  产品态验收判据）+ 我方边界承诺（不碰协议语义、不碰内容契约）。
  **只读它仓源码，未读它仓 `mail/`。**

- **记工单 70**（`needs-info`，等 OM 答 §3 三问）：第一交付物 = 产品态 e2e 套件
  （**零 injectFile、零手写 addpath**，只靠站点装配 ⇒ `omc_simulate('BouncingBall')`
  返回数据矩阵）。**不自行选形态先铺** —— 那等于替产权方定接口契约。

- **站点现状（复跑）**：`site/omc/` 只有引擎 4 件（`files[]` 带逐件 sha）；
  `omc_*.m` = 0。即**编译器在、桥不在、没人 boot 它**。

## 现在是什么（2026-10-28 · 环境恢复 + 两单收口 + spike 仪器修复）

- **★ 环境恢复（用户确认 sudo 已给）**：`o113` 容器（Exited 137，两天前关机杀的）已起；
  `sudo -n docker` 可用 ⇒ **doctor ok**（8761 / 8768 / 8868 / 容器四项全活）。
  连带解锁两项之前 SKIP 的闸门：`witness-upstream-pin` **真跑了**（2 个 pin 全一致）、
  `plugin-check` **真核了**（登记表 ↔ 现役产物 declared 逐车道一致）—— 之前是
  "读不到容器 ⇒ 本次未核对，不是通过"。

- **★ 工单 69 → resolved**：两条结算判据 rc=0（校验器自证 63/0、三站闸门 ok ×3）。
  **依赖早解**：OM 侧 JS 台账键其实已上账（OM 仓 `b217f1a`，`omc_web_js_sha` +
  `omc_web_js_bytes`，注记原文写明"files[] 投影的产地"）⇒ 投影的是**完整两件**
  （bg.wasm + JS），不是原先预计的"只 bg.wasm"。

- **★ 工单 63 → resolved**：G1–G8 全部有可跑仪器，今日逐个复跑并入表（G2 22 域零失败 /
  G2b 4/4 与 31/31 被抓 / G3 比值 0.241 / G6 五档全 E-1 / G5 四条不变式）。
  **★ 修了一处仪器腐烂**：`rustsort-spike/run-spike.sh` 链接失败
  `undefined symbol: operator new[]`（`emcc` 编 `.cpp` 缺 C++ 标准库）⇒ 两条链接行加
  `-sDEFAULT_TO_CXX`。这套仪器是"grilling 取消"的**唯一凭据**，它悄悄坏掉等于凭据变空头
  —— 正是 AGENTS「probe 会腐烂」那条纪律的又一实例。

- **悬案账**：未结案 42 → 41（两单收口，新增 0）。

## 现在是什么（2026-10-27 · 工单 69 files[] + 工单 67 CI 入库 + 22 红根因修复）

- **★ 工单 69（`files[]` 下载闭包）四步全落**（内容仓 `mail/090` 五条绑定）：
  · schema：`$defs/entry` 加 `files`（map：文件名 → `{bytes:int≥0, sha256:hex64}`），
    描述里写死五条绑定 + "与 `$defs/artifact.files`（数组）同名非同义"；
  · 校验器：`form≠tree` 带 `files` ⇒ **红**（形态错配，本仓另裁的一点）+ 类型检查 +
    零值守卫（空 map 不是通过）；自证 **57→63/0**（+6 正反）；
  · 装配器：`capability_entries` 的 omc 条目**投影** `files`，值读 **OM 生产者台账**
    （`omc_web_wasm_sha`/`omc_web_js_sha`，OM 仓 `b217f1a` 已上账 ⇒ 完整两件而非只
    bg.wasm）+ 拿站点字节**核对**（不一致是红，不是重写）；台账读不到 ⇒ `[omc]` 致命；
    自证 **40→44/0**；
  · 站点闸门 **R15**：`files[]` 逐件与站点字节对账（列了缺件/ sha 不符 / bytes 不符
    ⇒ 红）；自证 **40→43/0**。三站 rebake 后 catalog 逐字节一致，`validate --site` ×3 ok。
  · **浏览器验收**：`accept-market-browse` **17→21/0**，新增 B11a–B11d（omc 两件下发件 /
    值 = OM 台账投影 / **闭包和 74,635,990 ≠ size 74,735,455 是有意设计** / 无 files 的
    tree 条目 `detail.files === null`）。

- **★ 工单 67（CI 从未入库）→ resolved**：`.gitignore` 放行 `!.github/workflows/*.yml`
  + 三份 workflow 入库；`gates.yml` 判据集与 `registry --run commit` 的 ran/off 逐个
  对账（4 个依赖部署树的明说不跑）；新建 `readme-sync.yml`（pre-push §④ 同一条
  `--changed` 判据）；pre-push 注释翻面（"只有本地一道" → "本地 + CI 两道"）。
  结算件 `build/113/check-ci-bootstrap.sh` **rc=1 → rc=0**。

- **★★ 22 红根因（音频批 658f001 埋下，至 10-26 才暴露）＝ `sync-js` 重置 meta**：
  那次为补 `audiodevinfo` 的 38 aliases 改了 `sync-js`，**重写条目时把手工维护的
  `deps` / `aliases` 抹成默认值**。两处承重真值丢失：
  · `webgraphics.deps` 丢掉 `["__init_web__"]` ⇒ `PKG_ADD` 里 `graphics_toolkit("web")`
    找不到模块 ⇒ accept-t2-graphics / accept-p5-graphics 假红；
  · `control-oct.aliases` 丢掉 `{file:"__control_slicot_functions__", names:[49 个 __sl_*__]}`
    ⇒ `c2d`/`step`/`norm` 全报 `'__sl_xxx__' undefined` ⇒ accept-slicot 11/14、
    accept-forge2 3 红。
  **为什么一周没人发现**：音频批之后只跑过 `probe-lane` 单套（不是全量）——
  AGENTS「换产物/改资源必须跑 PROBES=1 全量」那条纪律这次正是被绕过的。

- **★ 修法（三件，各有自证）**：
  · `assets.py`：**`deps`/`addpath`/`alias_dir` 的产地 = meta.json**（磁盘只供
    sha/mount/kind）；新增 `--selftest` **5/0**（meta 声明 deps 生效 / 没写⇒空 /
    sha 未变时 meta 仍生效（第三态）/ 缺 `assets` 键必报）；零值守卫只拦"缺键"
    不拦"空数组"（首次装配合法）。
  · `build/assets-meta.json`：`webgraphics.deps`、`control-oct.aliases` 从旧 manifest
    恢复进 meta（**否则下一次 sync-js 还会抹掉**）。
  · **音频名字解析（accept-requirements R8，第二类红）**：`audiodevinfo` 的 38 个
    `__player_*/__recorder_*` 桩别名原先建在 `m/oct/` 且该目录被逐个 oct 条目
    `addpath`（**前置**语义）反复顶到最前 ⇒ 桩压住 `m/webaudio` 的真实现 ⇒
    `audioplayer` 抛 PortAudio disabled。装载器新增 `alias_dir` + `addpath:false`：
    桩别名落独立 `m/audio-stub/` 且该目录**追加到 path 末尾**（`addpath(d,"-end")`）
    ⇒ **真实现优先、桩兜底**（accept-audio 50/0 与 requirements 14/0 两端同时成立）。

- **★ 工单 63 的 G5（Rust 工具链不变式）落地**（"最便宜、先落"那一项）：
  `build/113/check-rust-toolchain.py` 四条不变式 —— ① channel 必须是**带日期钉版**
  （浮名 = 没钉）② `crate-type` 含 `staticlib`（cdylib 会让 E4 弱符号判空失效）
  ③ `panic="abort"`（wasm 无 unwind）④ 两档脚本各钉对 target（wasm64 必须走
  `build-std`+`wasm64-unknown-unknown`，rustc 无 emscripten target）。自证 **6/0**；
  台账键 `rust_patch_toolchain_ok`（replay=True）。挂台账时复跑闸门抓到真错：
  `cmd` 带了括号说明 ⇒ rc=2 —— 裸值契约要求 cmd 是纯命令。

- **验收**：8768 与 8761 全量**都零红**（55 套，PASS 数见 [[accept_pass]]）；
  三处 parity 完全一致；8761 `BOOT OK`、部署件 SHA 三层（磁盘/HTTP/页面自证）全过；
  闸门 `ran 7 / off 6 / failed 0`；本仓自证台 49 个全绿。

## 现在是什么（2026-10-25 · 收件箱清空 + 待办盘点，压缩前快照）

- **★ 内容仓 `mail/090`（本仓收件 061）＝ 新 schema 提单，已记工单 69**：
  `form:"tree"` 条目补**可选键 `files[]`**（UI 的下载闭包缺口：omc 的 JS 胶水件在表里
  无 sha，`size`=目录和 ≠ 下载闭包）。**五条绑定**（可选键 tree 专属 / 值=下发闭包
  `{bytes,sha256}` / **逐件 sha 唯一产地 = 生产者台账，装配只投影** / 无键合法向后兼容 /
  校验器类型检查 + 正反自证）。本仓另裁一点：**`form:"file"` 带 `files` ⇒ 红**
  （静默忽略 = 让错的键看起来合法，与 fail-closed 相反）。
  **依赖**：OM 侧补 JS 台账键（内容仓 `091` 已请求）；补上之前可先只投影 bg.wasm 一件。

- **★ 收件箱已清空（本轮无人值守连续处理 9 封：044–061）**，全部有落地物：
  | 信 | 内容 | 落地 |
  |---|---|---|
  | 044 | gitignore 洞 + 投 UI 落错工作树 | `!mail/read/` 白名单 + 6 封补提交；两信补投 antigravity 侧（`host-` 前缀） |
  | 045 | 音频播放链断（钓鱼执法） | 三层修复（缺件补编 + 38 aliases + sync-js 第三态 bug）→ 双站 50/0 |
  | 046 | 音频复验收执 | 收执（无动作） |
  | 047 | `kind:'engine'` schema 提单 | schema + 校验器 52→57/0；llvm-wasm 升 engine |
  | 048 | mail/030 勘误（tree 键可缺省） | STATE 改口径 + 物证复核 |
  | 049 | llvm-wasm 装载事故（「未知的能力层」） | 拒绝拆两路（NOT_INSTALLABLE / LAYER_NOT_IMPLEMENTED） |
  | 051/053 | 引擎条目收执 + pyodide 漏标 | pyodide 补 `role:"language-bridge"`（15/15 自描述齐） |
  | 055 | kind/role 线终局收执 | 收口记录（无动作） |
  | 056/057/059/061 | omc 引擎条目 + MSL + consumer 裁定 + `files[]` 提单 | omc 上表、R14 兄弟目录不变量、MSL 并入（17 packs）、consumer 改 `["omc"]`、`files[]` 记工单 69 |

- **剩余待办（本仓侧，按可开工性排序）**：
  1. **工单 69**（`files[]`）—— 可立即开工的部分：schema + 校验器 + 投影 bg.wasm 一件；
     完整形态等 OM 补 JS 台账键。
  2. **工单 67**（CI 从未入库）—— `ready-for-agent`，`check-ci-bootstrap.sh` 已存在（rc=1 如实）；
  3. **工单 63**（rustpatch 事实覆盖）—— `ready-for-agent`；
  4. **多 TU 扩展**（compile v1 只编主 TU；判据 `partint(5)` 非空）—— 已有本地台（8s/轮）可做；
  5. **Einfacht #20③ B/C 剩余**（critical 跳过已落；`lanes.json` 单源已落）—— 无剩余；
  6. **工单 65**（typeinfo 重链）—— 已 resolved（2026-10-19）。
  · **下游（非本仓）**：UI 刷新部署看 17 packs（我已发 `host-009` 给渲染口径）；
    OM 补 JS 台账键；UI 的 #3/#4/#5 随后解锁。

## 现在是什么（2026-10-25 · MSL 并入 + consumer 裁定批，mail/059）

- **★ MSL 并入站点表（内容仓 mail/059 §3，OM 出表方）**：
  · **名字定案 = `modelica-standard-library`**（OM 申辩"通用缩写不可检索"获胜，
    内容仓采了；判据 = 名字携带上游身份，与 llvm-wasm/pyodide 同先例）；
  · `form:"file"`（单 zip，运行期 `omc_vfs_load_zip` 解压）+ `role:"package"` +
    `consumer:["omc"]`；`size`=19,482,938 B（与字节逐字核过）；
  · **落位 `assets/msl/`（兄弟目录）**——R14 守着的形状；实测三站 HTTP 200。
  · **★ 顺带修了一处装配器落点缺陷**（MSL 并入实测翻出）：`stage_upstream_bytes`
    原先**一律**把字节铺 `assets/forge/`，而生产者表的 url 是 `assets/msl/…`
    ⇒ **两处口径分叉**（站点闸门 R7b 会报 404，与 llvm-wasm 那次同族）。
    修法：**站内相对 url = 生产者的交付路径** ⇒ 落点照 url 铺；只有绝对 URL/带 query
    的重取入口才回退 `assets/forge/`（假目录树判例保留，自证加了一条反向断言）。
- **★ omc 的 consumer 改 `["omc"]`（mail/059 §2 裁定）**：`consumer` = 条目服务的
  **引擎车道**；omc 引擎是 omc 车道运行时（与 MSL 同栈），llvm-wasm/pyodide 服务
  octave 车道栈（不变）。效果：缺省 octave 市场面不被第二引擎条目污染。
- **browse Entry 透传 `consumer`/`kind`/`role`**（实测翻出：Entry 原先不带 consumer
  ⇒ UI 无法判车道；B3c 也判不了"非 octave 消费面的外部条目"）。
- **验收**：17 packs（13 货架包 + llvm-wasm/pyodide/omc 三能力层 + MSL）；
  三站闸门 ok ×3；回归九套零红（market-browse 17/0 含 B3c 口径扩到"外部条目"、
  install-verdict 10/0、capability-layer 12/0、forge-ondemand 15/0、catalog-load 27/0、
  content-attributes 14/0、arch-boundary 5/0、symbolic-seam 9/0、compile 16/0）；
  闸门 49/49；台账 packs 16→17、forge 自证 39→40（实测放行）；parity 一致。

## 现在是什么（2026-10-25 · OMC 引擎条目 + MSL 兄弟目录硬约束批）

- **★ omc 引擎条目上表（内容仓 mail/056/057 兑现）——第二个 `kind:'engine'`**：
  · **字节渠道已核**：OM 部署盘 `site-omc/omc/` 4 件，主件 sha 与 OM 台账
    `omc_web_wasm_sha` **逐字一致**（`provision-omc.sh` 再核一遍字节，不信台账口供）。
    ⚠️ 那个 sha 是 **omc 资产的**，不是本仓引擎部署件的（后者见台账 `w64_wasm_sha`）。
  · **新供给脚本** `build/113/provision-omc.sh`（自证 4/0）：逐件 sha fail-closed +
    **兄弟目录硬约束反向断言**（陌生文件混进 omc/ ⇒ 拒）。
  · **条目**：`kind:"engine"` + `role:"toolchain"` + `arch:"omc"`（lane 值）+
    `size` = 整目录 74,735,455 B；`version:"unversioned"`（OM 侧未给版本串 ⇒ **不编**）。
  · **拒绝文案改角色化**（实测抓到）：旧文案写死「clang/lld/sysroot」，omc 进来就撒谎
    ⇒ 改成「是编译工具链（role:toolchain）」；`install('omc')` ⇒ `NOT_INSTALLABLE`。
- **★ MSL 兄弟目录硬约束落成机器判据（mail/057 §2 + §4 请求 3）**：
  · 内容语义裁定：MSL 是**单个 zip**（运行期 `omc_vfs_load_zip` 解压）⇒ `form:"file"`
    （不是 tree——tree 语义留给多文件能力层）；**不许进 omc/**，否则引擎条目的
    `size` 预算从 74.7MB 虚胀到 94MB+（预算不诚实 = content 诚实纪律同族）。
  · **R14**（站点闸门新判据）：tree 条目的 `size` 必须等于 **url 所在目录**实测字节和；
    反向实测：往 omc/ 塞一个 MSL zip ⇒ **立刻红并点名**「兄弟目录硬约束」。
    自证 38→**40/0**。
- **验收**：三站 rebake + 站点闸门 ok ×3；回归七套零红（market-browse 17/0、
  install-verdict 10/0、capability-layer 12/0、forge-ondemand 15/0、catalog-load 27/0、
  content-attributes 14/0、arch-boundary 5/0）；闸门 **48→49**（+provision-omc 自证）；
  台账 packs 15→16 / 自证 37→39 / 闸门台 38→40（实测放行）。

## 现在是什么（2026-10-20 · 引擎条目上表批，mail/051 兑现）

- **★ llvm-wasm 升 `kind:'engine'` + `role:'toolchain'`（mail/047 schema 落地后的
  装配兑现——UI「统一引擎清单」的切换条件齐了）**：
  · **shelf pin `285af2f`→`7dfe77e`**（内容仓 --emit role 落地那个提交）；
    装配器 `resolve()` 透传 role（货架包恒 `package`，与内容仓 emit 同款显式自描述；
    档案未来真带 role 则档案优先）。
  · **llvm-wasm 条目**：`kind:'engine'`（arch = **lane 值** `w64`——索引键非架构字面量，
    从站点 lanes.js 读部署事实，`_host_lane_of_site()`；不手抄）+ `role:'toolchain'`。
  · **三处判据配套**：端口校验器 engine 词表补站点档名（base/w64）；R10（架构界
    字节对账）对 `kind:'engine'` 豁免（引擎的 url 指 clang.wasm，不在 assets/oct*/
    下是设计形状）；**loader 的 arch 硬闸门对 engine 豁免**（实测翻出：`w64` vs
    `wasm64` 不同词表 ⇒ 字面比对必假红——楚河汉界管的是"要 dlopen 的 .oct"，
    引擎是 compile-worker 的编译现场输入，不在那个语义里）。
  · **install('llvm-wasm') 现在走 `NOT_INSTALLABLE`**（role:'toolchain' 判据生效，
    name 兜底退役）——mail/049 事故的表升级完成形态。
  · **验收**：三站 rebake + 站点闸门 ok ×3；回归九套零红（market-browse 17/0、
    install-verdict 10/0、capability-layer 12/0、forge-ondemand 15/0、catalog-load
    27/0、content-attributes 14/0、arch-boundary 5/0（A2 翻面：engine 的 arch=lane
    合法携带）、compile-extension 16/0）；闸门 48/48；parity 一致。
  · mail/051 勘误收执：我 §⑥「llvm 台账指 v0.1.1」确是**过期信息**（内容仓
    2026-10-19 ebbde69 已修，我看的是翻案前旧段）——收下，教训 = 点别仓待办前先对
    它 HEAD 的活状态段。

## 现在是什么（2026-10-20 · mail/047/048/049 批：kind/role schema + 装载事故修复 + 勘误）

- **★ mail/049 契约事故修复：llvm-wasm 装载即拒的三仓脱节**（UI 现场触发：
  包管理器点装载 ⇒「未知的能力层」误导文案）。`installLayer` 拒绝拆两路：
  · **`NOT_INSTALLABLE`**（工具链）：「llvm-wasm 是编译工具链（clang/lld/sysroot），
    由下载管理（DownloadStore）+ 编译 Worker 使用——不走装载。UI 侧请走下载界面。」
    判据读 `role==='toolchain'`（schema 新键，表未升级时按 name 兜底——两层同答案）。
    方案 B（责任让渡）照内容仓裁定：工具链归 DownloadStore + compile-worker
    （执行域错配：不是 MEMFS/addpath 语义）。
  · **`LAYER_NOT_IMPLEMENTED`**（真未实现的能力层，如未来的新语言桥）——
    不再把两种情况混成「未知」。
- **★ mail/047 + 049 Q1 schema 提单落地**：`content-list.schema.json` 的 entry 加
  **`kind`**（src/pre/engine；engine 条目 arch = lane 值——「arch 是索引键不是版本轴」
  的 mail/031 裁决正好用上；逐件 sha 仍从产物自证（build.json measured.files），
  entry 只放入口清单+总字节，不造第二产地）与 **`role`**
  （package 缺省/toolchain/language-bridge——form 是形态不是角色，事故根因）。
  校验器自证 **52→57/0**（+5：engine 带 lane 合法 / 缺 arch 必报 / arch 非 lane 值必报
  / role 已知 / role 非法值必报）；consumer 注释钉死「数组 + 包含语义」。
  optional_keys 协商照旧（fail-closed 向后兼容）。
- **★ mail/048 勘误落正**：mail/030 宣称「`""`/`[]` 恒在 ⇒ UI 恒可渲染」与现役表
  实测不符（llvm-wasm/pyodide 整键缺失，curl 亲验）——按 C-2 裁定**改宣称不改装配器**：
  能力层（form:tree）无包级描述是合理形态，消费端「键不在 ⇒ 无描述」与「键空」等价
  （客户端 B9 用例本就是这个形状）。STATE 对应段已加勘误标记。

## 现在是什么（2026-10-19 · w64-base 死档化批，二次三线裁决）

- **★ w64-base 整格死档化（用户点令二次裁决：「master 线不允许在无 COI 的浏览器上跑；
  wasm32 是无 COI 环境下的唯一线；master 必须开启多线程；IP 是脱离官方树的 master 延伸」）**：
  · **最终模型**：站点**两格**（base / w64）。无 COI（哪怕浏览器有 memory64）⇒ **base**；
    w64 = master/IP 线产物（必须 COI + 多线程）。`w64-base`（wasm64 单线程"回退格"）
    与 threads 同待遇：**DEAD_LANES 双死档**，出现即红（HISTORY §5.109）。
  · **为什么现在做**：10-17 首次裁决删 threads 时把 w64-base 表述成"回退格"留下；
    工单 65 重链批我把它也重链+发运了 —— 与用户意图不符，本批连根拔除。
  · **拆除面七处产地**：lanes.json（单源）/ lane.js（FILES+order+正则+无COI⇒base）/
    gen-lanes / purity（DEAD_LANES+LANE_EXPECT）/ relink（模式删+死档点名 FATAL）/
    promote（只发 w64，残留必红）/ 三站目录。另台账 w64_base_* 5 键掉档、
    probe-lane 矩阵两格化（Cell 2 翻面 + 格 4b 死档 URL 断言）、六个测试套件分支清理。
  · **验收**：probe-lane **33/0**（两格站）；单源对账 OK（2 档 / 2 死档 / 4 消费方）；
    promote --verify 两站"两格齐备且无双死档痕迹"；三处 parity 完全一致；
    闸门自证 purity 10/0、promote 8/0、gen-lanes 4/0、lane-pick 9/0。

## 现在是什么（2026-10-19 · 工单 65 裁决 A 重链批）

- **★ 工单 65 结案：重链落地 + 两个真根因修复 + 全量验绿（用户点令「那就干」）**：
  · **重链**：`-6012` 车道全套（w64 `c994bdad…` / w64-base `35ef50dc…`，verdict=ok；
    台账已同步）。keep-6012-* 补 7 条 typeinfo；link-web 新增 `TI_TYPEINFO_FLAGS`
    （`-Wl,-u,_ZTIi` **强引用** + export-if-defined 成对 ×7 —— 实测 keep 的
    export-if-defined 单独**拦不住 DCE**：树代码不 import 基本类型 typeinfo ⇒ 归档成员
    被删 ⇒ 静默忽略）。
  · **★ C2c 真根因证伪翻案**：旧记录把它归"typeinfo 同族"是**间接推断（错）**——
    typeinfo 修掉后它仍在。真根因 = **Octave 头按档分叉**：wasm32 树 `mxtypes.h` 的
    `mwSize/mwIndex` 是 `int32_t`、wasm64 树是 `int64_t`；octinc 之前只供 wasm32 树的头
    ⇒ 现编 `.oct` 索引宽度错位 ⇒ "Invalid resizing operation"。
    修：provision 按目标档供两份头（含"两份必须真分叉"的反向断言），worker/本地台按
    target 选。**判据翻面**：C2c/C8e 从"如实记边界"翻成**硬绿**（`cell2cell=1x1/1x2`、
    `partint(4)` 不变式成立）。
  · **结算件翻面**：`probe-toolchain-gap` rc=2 → **rc=0**（throw 模块 dlopen OK 且真调用）。
  · **验收**：8768 与 8761 双站全量 `PROBES=1` 全绿（套数/PASS 见台账 `accept_suites` /
    `accept_pass`，PROBES 全量的明细在 `sweep-logs/`）；promote verify 全绿；
    SHA 三层 4/0。purity 回退格误报修正（w64-base 无专属 .oct 是设计形状；自证 10/0）。
  · **重链途中修的三处机制**（NOTES-emsdk-upgrade §7.7）：rebuild 的 install 前缀不跟
    LANE_TAG / 容器脚本漂移三件（relink/link-web/check-oct-imports + 后续
    write-build-manifest、check-build-manifest）/ keep 的 typeinfo 追加漏 -6012 系。

## 现在是什么（2026-10-18 · 多 TU + #20③ B/C 批）

- **★ 多 TU 编译落地（v2）+ 交互升级（用户点令「必须升级交互」）**：
  v1 只编主 TU ⇒ `miscellaneous` 的 `partint` 模块从未出现。现按**容器模块表**编全：
  · **模块分组是数据**：容器 `build-pkg-oct.sh` 那张手写表 → `build/pkg-module-table.json`
    （闸门 `check-pkg-module-table.py` 逐条对账，自证 **12/0**；真仓 **6 包 / 27 模块**一致）。
    客户端优先读站点 `assets/pkg-module-table.json`，**扫 DEFUN 只作兜底**。
    **判据**：`miscellaneous/sample.cc` 在 11.3.0 头下编不过（`rand_uniform` 签名变了），
    而容器表本来就不列它 ⇒ "含 DEFUN 就该编"是错的（会让用户误判工具链坏）。
  · **产物名 = 源 basename**（不是第一个 DEFUN 名）：证据 = 现役
    `assets/octdir/miscellaneous/partint.oct` 的导出表同时有 `Gpartcnt` 与 `Gpartint`。
  · **编排抽成深模块 `bridge/multi-tu.mjs`**（纯逻辑：分组/命名/编序/链接拼装/basename 摊平；
    runtime 注入）。**两个 adapter**：浏览器 `compile-worker.mjs` + **本地台
    `test/local/compile-local.mjs`**（`--selftest` 6/0）。后者是交互升级的落点：
    浏览器一轮 **8 分钟** → 本地台 **8~14 秒**，且失败拿到完整 stderr（不再是一句 `Aborted()`）。
  · **验收 `accept-compile-extension` 16/0**（v1 是 11/0）：新增 C8a 编出容器表全部模块 /
    C8b 产物名 = 源 basename / C8c 同源第二 DEFUN 也在 / C8d 第二模块被识别
    （v1 的边界：它压根不存在）/ C8e 调用语义**如实记**为与 C2c 同一已知边界（工单 65 重链批）。
  · **本批五条机械知识**（`NOTES-client-compile-design.md` §12）：clang `callMain` 每实例
    只能调一次（`too many signal callbacks`）/ emscripten abort 抛异常须 try-catch /
    `collected` 要清空不要替换 / lld 需 `-flavor wasm` 且 FS 独立须各装 sysroot /
    源必须摊平成 basename（`#include "./config.h"` 依赖同目录）。

- **★ Einfacht #20③ 两条本仓承诺已落**：
  · **B（critical 套件被跳过 ⇒ 本轮不绿）**：`manifest.json` 新增 `critical` 名单 +
    `critical_note`（登记门槛：只登记"缺了就是环境坏了"的，依赖额外站点资产的**不登记**）。
    选片器把"在范围内却被跳过"的 critical 单独报出（自证 **20→24/0**，含三条反向）；
    `sweep.sh` 两条路径都判 rc=1（含原先恒 rc=0 的"全被跳过"早退分支）。
    **实测**：`SITE_DIR=/nonexistent probe-lane` ⇒ rc=1 并点名；范围外 ⇒ rc=0（合法没跑）。
    动机 = 那一次真事：`probe-lane` 曾因清单登记随档删除而被永久跳过、summary 仍报 0 FAIL。
  · **C（lanes.json 单源）**：新建 `build/lanes.json`（档知识的**唯一声明**：9 个车道名 /
    3 个站内档 / 1 个死档 / 三线产品线 / 回退优先级）+ 对账器
    `build/113/check-lanes-single-source.py`（自证 **15/0**，对账四个消费方：
    `lane.js` 的 FILES/order/覆盖正则、`gen-lanes.sh`、`check-lane-purity.py`、`plugins.json`）。
    真仓对账**当场抓出一处真缺口**：`LANE_EXPECT` 缺 `IllegalPerformance`（docstring 的三线
    枚举里有、表里没有 ⇒ 用那条线跑纯度检查会被当"陌生名"拒）—— 已补。

- **★ 内容仓 `mail/042` §③ 的追问：答案是 (a) 信还没发出（已补发）**：
  原 STATE 写"已上报生产者仓"时信**确实没发**。查证还翻出更硬的事实：**已发布的 v0.1.2
  资产里也没有 `compile-core.mjs`**（tar 内 manifest 与 content-list 都是 13 条；
  工作树才是 14 条）。根因 = 时序 —— 生产者修打包脚本的 `149e72b`（10-15 **14:47**）
  晚于 v0.1.2 的 manifest 生成（**14:31**）与发布（**14:39**）⇒ **修了没重发**。
  已补发（宿主 `mail/044` → LLVM-wasm `mail/013`；宿主 `mail/045` → 内容仓 `mail/042`），
  三处不实断言（STATE / `provision-llvm-wasm.sh` 注释与 say 行 / NOTES §11）已改成可复跑的事实。

## 现在是什么（2026-10-18 · compile/diagnostics 批）

- **★ B 线落地：`compile:true` + `diagnostics`（内容仓 `mail/039` 待办① 的排期兑现）**：
  `OctaveAssets.compileExtension(name,{onProgress,onDiagnostic})` 同批落地，
  **`accept-compile-extension` 11/0**（8768 + 8761 双站）。
  · **Verdict**：`{state:'compiled', octPath, bytes, symbolGap, diagnostics}` /
    `{state:'m-only', why, stage}`（软失败：包仍可用）。
  · **`diagnostics` = 编译日志流**（`onDiagnostic` 逐条 + 最终数组）—— 实测 20 条
    （target → 源码 → 头 → sysroot → clang → headers → `[lazy]` → 编译行 → lld → 链接行）。
  · **★ 分段懒加载（用户点令「保证能分次懒加载」）**：三段切 —— sysroot 19.7 MB（init，
    按宿主档二选一）+ clang 45.8 MB（init）+ **lld 31.8 MB 推迟到首次链接**。
    实测首编峰值 **66 MB 原始（gzip 后约 25 MB）**，不是一次性 81 MB。实现 =
    本仓自建 `bridge/compile-worker.mjs`（分阶段），**编排仍 import 生产者
    `driver/compile-core.mjs`**（不复制）。
  · **供给层**：`build/upstream-lock.json` 加 `llvm-wasm` 条（v0.1.1，bundle sha 钉住）+
    `build/113/provision-llvm-wasm.sh`（13 资产逐件核 sha → 站点；Octave 头 770 个从
    **容器安装树**打包；`config.h.json` 25 宏从容器取）——自证 3/0。
  · **★ 已知边界（如实记，未解决）**：现编产物**能被识别**（`exist=3`、`which` 正确）
    但**跨边界调用失败**（`cell2cell` 报 `Invalid resizing operation…`），而**同站随站预编的
    7.2 产物同样调用 = 1x1（正常）** ⇒ 对照锁定。同族证据：产物 `symbolGap` 里 4 条
    typeinfo（`_ZTI6Matrix/_ZTS6Matrix/_ZTI7NDArray/_ZTS7NDArray`）在**宿主 w64 导出面为 0**
    —— 是**工单 65 缺口 2 的扩大版**（不只基本类型，Octave 类 typeinfo 也不导出）。
    ⇒ 归入**工单 65 裁决 A 重链批**（ready-for-human）；判据 = 本套件 C2c 从"报错"翻成"1x1"。
  · **多 TU 边界（v1）**：`miscellaneous` 只编主 TU（其余 4 个未编）；下一批判据 = `partint(5)` 非空。
  · **本批五条机械知识**（已写 `NOTES-client-compile-design.md` §11）：验证 dlopen 路径必须
    `eval_async`（同步会 SuspendError 且被吞成 `exist=0`）／`installFiles` 不许按 size 跳过
    （sysroot 有 7 个合法零字节文件）／产物名必须 `basename`／`mkdirTree` 失败不许空 catch／
    vendor 的 bundle manifest 可能漏列依赖（v0.1.1 漏了 `compile-core.mjs`，已兜底+上报）。

## 现在是什么（2026-10-18 · Einfacht 整层升级批）

- **★ Einfacht 机制层整层升级至上游 `45ca586`（2026-10-18，内容仓 `mail/039` 待办③）**：
  照内容仓 `b8e9bf7` 参照**整层换**（取代上次"只摘 #20② 单件"）：
  · **实质差异 7 文件**（facts/guard/knobs/render/check_locks/check_questions/
    check_facts_replay）全部整层替换 ⇒ **与上游逐字节同源（0 实质 diff）**。
  · **本地补丁退役**：`facts.py` 自制 measure 分派（→ 上游 `REFLECT_MEASURE_MODULE`
    旋钮 + `_measure()` 分派，回落有**响亮警告**）；`guard.py` 手移植 import 块；
    `check_locks.py` 本地旋钮注释（上游 #15 C2 化）。上游新件含 #14 修复
    （`prose_of` 剥**全部** AUTO 块——本仓 STATE 有 AUTO:GATES 块，正好暴露）。
  · **保留**：`measure_octave.py`（数据层）、`mail-read.py`（本仓工具）、`build/facts.py`
    壳（补 `REFLECT_MEASURE_MODULE` 旋钮；与盲写守卫**互补**——守卫拦"写被 ignore 的目标"，
    壳补全套口径）。
  · **验收六项全绿**：① 盲写守卫反测 rc=2+零字节；② 壳正测 163 条（直跑旋钮路径同过）；
    ③ 两台全绿（根台跨仓库夹具 14/14 + 本台 46 闸门+分工锁）；④ pre-commit 全链
    ran 10/failed 0；⑤ 数据层零牵连（重测**值零变化**，仅 measured_at 时间戳）；
    ⑥ 七文件与上游逐字节同源。
  · **移植细节**：模块名写 `measure_octave`（不带 `zreflect.` 前缀）——上游 `_measure()`
    用 `__import__(mod_name)`，`facts.py` 直跑时 `sys.path[0]` 是 `zreflect/` 自身，
    带前缀 ModuleNotFoundError（已实测踩到并修正）。
- **★ compile 排期答复（内容仓 `mail/039` 待办①）**：`compile:true` + `diagnostics`
  **同批**，排在**本升级批之后的第一个工作批**（依据 `NOTES-client-compile-design` §9：
  第 1–2 步已完成，从第 3 步 compileExtension 实现起跑）。**UI 的"从源码构建"按钮先藏**。
- **LLVM 悬案 02 结案收执**（wontfix）：判据认可——"问题问的那个世界不存在了"
  （5.0.7 轴已整体退役）；LLVM 收口账（出表 + 并入 ok + 悬案清零）。
- `mail/031` 已归档（内容仓提醒的待办②）。

## 现在是什么（2026-10-18 · Einfacht #20 裁决落地）

- **★ 上游 #20 裁决已回，三条全部落地**：
  · **② 已修并移植**（上游 `c29a33b`）：`guard.write_target_problems()` 盲写守卫 ——
    写盘前查目标，被 `.gitignore` 覆盖 ⇒ **FATAL**（rc=2、零字节写出，本仓反向验证）；
    仓里有 `Einfacht.env` 而本次未设旋钮 ⇒ warn（两个产地分叉）；`_load_or_die` 提示
    改写（不再教人"在仓库根跑量测"）。vendored `guard.py`/`facts.py` 已同步，
    guard 自证 **16→20/0**（上游 4 条用例一并移植）。
    **移植细节**：本仓 `guard.py` 的 import 与上游不同（缺 `GATE_REPO`/`os`），
    贴移植块必须连带补 import —— 这是 vendored 副本的接线差异，不是上游 bug。
  · **① 终局 = B（不是上游建议的 A）**：实测 **46 条里 45 条在 `build/`/`.githooks/`**
    （上游发现式只扫 `zreflect/*.py`），且 **12 条是 shell 脚本**（无法落 Python 的 `GATE`
    声明）⇒ A 代价 = 45 文件搬迁 + 33 个改造 + 12 个永久例外。**B = 保留两份台但锁死分工**：
    `build/gates-selftest.sh` 新增「两份台**交集必须为空**」自证（跑通：14 平台闸门 /
    46 本仓专属，无交集；反向验证：塞一个 `zreflect/check_facts.py` 进本地名单 ⇒ 必红）。
  · **③ 留本仓落**：`critical` 套件被跳过 ⇒ sweep 整体 rc≠0（与 C2「off 不是通过」同纪律）
    + `lanes.json` 单源（与 #18 cohort 同族）。

## 现在是什么（2026-10-18 · 下载/装载分离规格）

- **★ 架构重大变化：下载与装载分离（内容仓 `mail/037` 规格，宿主三项裁定）**：
  用户点令「市场提供下载源码包/预编译包两选项；装载在另一界面；已安装改已下载」。
  规格 = 内容仓（design-it-twice 四子代理 + **原生 Octave 11.3.0 实测**定 OPFS 布局）；
  **缝仍在「记录」上**（不推翻市场判决书 §2），只是记录从"站点装配态"多出一种"用户本地态"。
  **宿主三个裁定**（判决书 §10，`build/113/NOTES-market-design.md`）：
  · **engine 的 sha 源更正**：用 `<站点>/<lane>/octave.build.json` 的 `measured.files`
    （每档一份、逐件 sha256+bytes），**不是** `upstream-lock.json` —— 实测后者是**第三方源码锁**
    （9 条 lapack/glpk/pyodide…，无一条是引擎三件套）。这让 I1 三源同构（都从产物读）。
  · **`ARCH_MISMATCH` = 装载期硬闸门**，与下载层解耦（下载层只记账）——现役
    `assets-loader.js:678-689` 已是这个口径（plan 阶段扫 deps 闭包、hostArch 不读引擎、能力层豁免）。
  · **`install()` 暂不收敛到 DownloadStore**（两条链并存）：install 是**原子链无时间 gap**，
    而 DownloadStore 的全部价值来自跨时间 gap；两套 staged 语义不同（站点装配态 vs 用户 OPFS
    + 与今日目录对账），合并即造"同一事实两个产地"；且现役 14 码已覆盖 install 全部失败面。
  · 新错误码 ~6 个（`NOT_DOWNLOADED` / `VERSION_WITHHELD` / …）**同意闭集扩展**，要求与
    本仓 14 码同构；`cannot-know` 只保留给"连目录/索引都读不到"。
  · **最有价值的实测**（内容仓给）：`.m` 必须在包根，**多套一层 ⇒ `pkg load` 无报错但类
    undefined** ⇒ 兼容判据只能是原生 Octave 跑 `pkg rebuild → pkg list → pkg load` 三连全通。

## 现在是什么（2026-10-18 · Einfacht 反哺 #20）

- **★ 反哺上报：三线裁决大拆除里卡住的三处「两套产地并存」（Einfacht issue #20）**：
  https://github.com/ArchivalEra/Einfacht/issues/20 —— 每条带可复跑判据 + 最小复现：
  ① **`gates-selftest.sh` 两份并存**（根 = 上游声明式 `registry --all-runnable`；
  `build/` = 本仓手写 46 条名单），**pre-commit 两个都跑**（`reflect-hooks/pre-commit:73,74`）
  ⇒ 同一件事两处产地，新增闸门义务不同（声明自动 vs 手写登记）；
  ② **`REFLECT_*` 默认值把写操作导向被 gitignore 掩盖的位置**：裸跑 `facts.py` 写仓库根
  `FACTS.json`（60052 字节实测），而钩子读 `build/FACTS.json` ⇒ **重测"成功"但改口不生效**，
  `check_facts_replay` 一直红而根因是写错地方（本次会话真实代价 ≈40 分钟）；
  ③ **档位/车道知识散在三张登记表**：本次漏改 `manifest.json` 的 `THREADS_ARTIFACT`
  ⇒ **核心闸门 `probe-lane` 被 sweep 永久跳过而 summary 报 "0 FAIL"**（假绿）。
  · **共同形状**：「必须一致」的东西只要有一个产地没被闸门看着，它漂的时候表现是
  「跳过 / 默认值 / 没报错」，**不是红** —— 这是本仓反复踩的"收集-断言式闸门在输入消失时
  静默变绿"的跨仓库版。
  · **追加评论（同日，同 issue 不新开单）**：② 升级为**路径根本不设防** —— 写盘不检查目标是否
  被 gitignore 掩盖、不提示默认路径；内容仓"裸跑没写盘"的自查**对但原因不是防护**（先
  `--render-doc` 会读失败早退），换顺序即写出 **60604 字节**野文件（本仓实测）；
  **`_load_or_die` 的提示"先在仓库根跑一遍量测"本身在教人踩坑**（那正是写出野文件的动作）
  ⇒ 提示文本也是「默认值产地」的一部分。

## 现在是什么（2026-10-18 · mail 读信规则批）

- **★ mail 未读区/已读区 + 读信入口命令（2026-10-18，采纳内容仓 `mail/031` 提案，用户点令「read 文件夹」）**：
  `mail/` = 未读区，`mail/read/` = 已读区；读信走
  `python3 zreflect/mail-read.py <编号>`（读 = 打印全文 + `git mv` 进 read/，`--follow` 保历史）。
  工具自证 **10/0**（含 **bug#1 修复**：同名重投**拒覆盖**——试验场实测 rename 兜底曾静默覆盖旧信）；
  `MODULE` 声明 `selftest=True` 但**无 GATE**（它是工作流工具，不进断言面——信件内容永远不是
  机器可信输入）。已用它归档 16 封历史信（git 识别为 rename）。
  · **本仓特殊点（提案 §④ 点名）已验并修**：`check-mail-boundary.py` 用 `os.listdir` + 只收 `.md`
    ⇒ `read/` 子目录天然跳过（"不误报"判对了）；**但零值守卫会咬人**——信全部归档后 `mail/*.md`
    变空 ⇒ 报"空输入不是通过"，一个合法的读信动作把闸门变红。**修法**：未读区空时**退扫
    `mail/read/`**（已读信 `To:` 不变，不变量照样成立），**两处都空仍必报**。
    闸门自证 **5→8/0**，新增三条（含"归档不许把闸门变成恒绿"这条关键反向）。

## 现在是什么（2026-10-18 · 发布规范批）

- **★ 「正式发布」的定义落定：源码包 vs 预编译件（2026-10-18，用户点令「规范一下插件市场」）**：
  判决书 = `build/113/NOTES-release-model.md`。**核心三句**：
  · **发布单位 = `(name, version, arch)` 三元组** —— 不是 28 个文件，也不是整个包集；
    `control` 的 9 个 `.oct` 是**一个** artifact 的内容。现役 = **5 包 × 2 架构 = 10 个发布单位**。
  · **架构不进版本号** —— 版本号是上游事实（`optim 1.6.3`），架构是构建矩阵索引键；
    塞进版本号会造出 `optim-1.6.3-wasm32` 这种**上游不存在的版本**（用户担心的"28 个文件分俩版本"正是坏模型）。
  · **两套判据各自可机器验**：源码包 A1–A6（已有闸门全在跑）；预编译件 **B1–B7**（本批新立）。
  · **落地第 1–3 步**（零客户端改动）：端口 schema 加 entry `artifacts[]` + `$defs/artifact` +
    三条不变量（唯一性 / 版本锚定：artifact **没有自己的 version** / 不许编 arch），
    校验器自证 **46→52/0**；装配器从站点字节逐文件量 sha + `oct-arch.py` 派生 arch
    （+ octave/toolchain/recipe 溯源），自证 **32→35/0**，三站 rebake 真产出 **10 个 artifact**；
    站点闸门新增 **R13**（逐文件 sha 对账 + 架构纯度 + 多一件也必报），自证 **34→38/0**。
  · **产地归属**：预编译件（构建/sha/arch/工具链/配方）归**宿主**；内容仓**不声明** `artifacts`
    （它不构建、量不出 sha）——与 staged 语义同一条纪律。**内容仓无需改档案**。
  · **如实记一处边界**：`control`（9 个 `.oct`）**不在货架档案里**（站点侧随站预置资产），
    所以它今天**没有发布身份**——10/12 个 artifact 有身份，`control` 的两个是站点资产。

## 现在是什么（2026-10-18 · 包预编译批）

- **★ 包预编译批：28 个 7.2 时代 `.oct` 全量重编为 11.3.0 两档产物（2026-10-17/18，用户点令）**：
  用户点令「各种包的预编译……原生编译尽量给做到极限性能极限体积，wasm32 和 64 分版本」。
  三线口径下只出**两份**：wasm32（无 pthread，base 档用）+ wasm64（`-pthread + MEMORY64`，w64 档用）。
  · **旋钮 A/B 量化（optim 5 模块 × 2 档 × 5 配方，真浏览器计时 + 体积）**：
    `-O2` 基线胜出——`-O3` 体积 **+11%** 而性能在噪声内；**LTO 双档 dlopen 当场炸**
    （`reading 'value'`，§5.78 判例重现：whole-program 剥掉只有 dlopen 用的支撑符号）；
    `wasm-opt -O3` 后处理 -0.6% 无收益。**判决：全量配方 = `-O2`**（"极限性能/体积"在
    side module 这层旋钮空间实测为零收益，真杠杆在主模块/BLAS 层）。档案 = `build/113/NOTES-pkg-precompile.md`。
  · **全量重编**：三档各 28 个 `.oct` 全绿（wasm32 / wasm64 / 原 threads 档——后者随三线裁决废弃）；
    补编了 base 档 slicot 模块（7.2 时代最后一个残留；判据⑨ BLAS 入口模块内定义、零 cxa_guard）。
  · **途中抓到一处真 bug**：threads 档首轮重编**全部编成 wasm64**——`lane-shim.sh` 建影子时
    沿 PATH 命中前面的 w64 影子 ⇒ `-sMEMORY64=1` 透传。`oct-arch.py` 纯度检查当场抓红，
    干净 PATH 重建影子后修正（该档随后随三线裁决删除）。
  · **上站**：8768 实验站验绿 → 8761（两站逐字节一致，`octdir` 28 个 wasm32 + `octdir-w64`
    28 个 wasm64）；**浏览器侧 `accept-113-pkgoct` 两档各 27/0**（全部真调用：bfgsmin /
    polybool_mrf / svmtrain / struct 操作…）。
  · **已知边界如实记**：`__bfgsmin` 直调（cell 传参）在 11.3.0 头编出的模块上
    `signature mismatch`——`.m` 包装 `bfgsmin(...)` 完全正常（27/0 的判据就是它）；7.2 老模块
    同路径也炸 ⇒ 是 optim 源码对 octave_value_list 的用法边界，非编译配方问题。

## 现在是什么（2026-10-17 · 三线裁决执行批）

- **★ 三线裁决执行：threads 档（wasm32+atomics 多线程畸形档）整档删除 + 试验场↔分支绑定（2026-10-17，用户点令）**：
  用户原话「wasm32 不允许拥有多线程档」「不允许出其他畸形儿」「试验场与分支牢绑定，
  只能存在 wasm32-final/master/IllegalPerformance 三种实验场」。七阶段拆除（HISTORY §5.108）：
  · **relink.sh**：threads 模式全删 + **w64 基线自档化**（原取 m2fc-threads-out——跨线取基线是
    错配）；23 自证绿。**页面档死**：lane.js 删 threads 文件表/选择分支（非 m64 一律 base）、
    floor=['base']、覆盖正则收窄；gen-lanes/lanes.js 同步。
  · **三站摘除**（site/ 镜像、8761、8768）：`threads/ + oct-threads/ + octdir-threads/ +
    manifest.threads.json` 全清（约 51 件/站）；lanes.js 三格重生（base/w64/w64-base）。
  · **部署入口**：promote-webgl 2b/3b 段删（换成幂等死档清理 + threads 痕迹必 FATAL）；
    promote-w64-lane 守卫反向化（7 自证）；promote-pages/parity/site-illegalperf 收窄；
    纯 A 类删 7 文件；build-oct-lane 保留但 w64 化（**它是 w64 车道 .oct 构建器**）；
    NOTES/PLAN-threads 加历史横幅。
  · **验收矩阵三格化**：probe-lane **33/0**（死档 URL `?lane=threads` ⇒ 覆盖失效落 base、
    页面照常 ready 的三重断言）；lane-pick 9/0；其余六套件枚举收窄。
  · **台账**：threads_* 8 键 + oct_lane_* 3 键 allow-drop 掉档（**163 条**）；
    `locale_contract_lanes` 4→2（实测）；车道 .oct 键改 w64 形状。
  · **纪律固化**：check-lane-purity **三线权威枚举 + DEAD_LANES={threads}**（7 自证）；
    现役双档纯度实测绿（w64=44 .oct wasm64 / base=44 .oct wasm32）。
  · **预编译批连带修正**：28×3 套 .oct 中 threads 套废弃，只发 w32/w64 两份（正合三线口径）。
  · **断电恢复 + 一处闸门盲区修正**（2026-10-18）：机器断电后 doctor DOWN（8761/容器），
    已 `docker start o113` + 双站 serve-coi 重启，doctor **ok**、8761 BOOT OK、三处 parity 一致、
    镜像资产逐字节无损坏。★ **sweep 抓出一处闸门盲区**：`probe-lane` 被列为"按清单跳过"——
    manifest 里还登记着 `THREADS_ARTIFACT=siteWebGL/threads/octave.wasm`（随档已删），
    而 probe-lane 是**三线纪律的核心闸门**，被跳过 = 永久假绿。已删该登记 + 刷新 SITE_DIR 说明；
    复验：单跑 33/0 + `PROBES=1 sweep probe-lane` 真跑 33/0（不再跳过）。
    全量 sweep 全绿（套数/PASS 见台账 `accept_suites` / `accept_pass`；唯一"有问题"= probe-toolchain-gap 缺口 2 如实红）。

## 现在是什么（2026-10-14）

- **★ 透传批（内容仓 029/030 兑现）：description/links 全链 + browse() + `_byCode` 补全（2026-10-17，UI 等的饭）**：
  内容仓 `029`（`--emit` 出包级 `description`/`links`，optional_keys 协商）+ `030`（Q2 终裁
  「内联、拆分文件不采」）两封信的宿主侧落地，**端到端五层全链**：
  · **端口定稿**：`description`（string）/`links`（`[{label,url}]`，icon 非规范键）进
    `content-list.schema.json` 正式键 + `$defs/link`；校验器只查类型/结构（「写对了没」无机器
    判据 —— 同 license 的诚实边界），自证 **41→46/0**（正反各钉：非字符串必报/缺 url 必报/
    合法缺省不报）。**生产者真样件**（`--emit` 285af2f，13 包全带）过校验器双模式。
  · **装配透传**：`resolve()` 从货架档案 `upstream.description/links` 摊平进站点目录
    （**对函数包**：缺省空值不省键 ⇒ UI 恒可渲染不用判有没有）；`--upstream` 路径透传 + `_site_fixups`
    （links 的 url strip/去转义 —— 只修结构噪声，不删坏形状项，让闸门点名）。自证 28→**32/0**。
    ★ **勘误（2026-10-20，内容仓 mail/048 C-2）**：原宣称「`""`/`[]` 恒在 ⇒ UI 恒可渲染」
    **与现役表实测不符**——能力层条目（form:tree，llvm-wasm/pyodide）的 description/links
    **整键缺失**（非空串）。**改宣称不改装配器**（裁定）：能力层不是包、无包级描述是合理形态；
    消费端判据统一为「**键不在 ⇒ 无描述**，与键在但空等价处理」。为 tree 条目硬灌空键
    = 为宣称的形状造数据（违背诚实纪律）。
  · **站点闸门 R12**（新对账器，「声明↔消费」第七例）：货架条目的 description/links 必须与
    货架档案**逐字**对账；缺键必报。自证 30→**34/0**（含反向：漂一字必红）。
  · **三站 rebake**（catalog sha 见台账 `forge_catalog_shelf_commit` 的同批提交；shelf pin
    `922736a`→`285af2f`）：端口校验器 site 态 `ok` + 站点闸门 `ok` + `--check` 一致，三层全绿。
  · **客户端 `browse()`**（市场判决书 §3/§5 第 5 步 + 内容仓 `028` §④ 上调优先级）：
    async 正门返回 Entry[]（三属性 + `versions[]` 逐候选 + description/links 透传 +
    `state/why` 聚合）；**statusOf 三属性与它共用 `_browseEntry` 一条产地**（N6 教训：
    同一事实两个出口不许两个答案），旧形状纯增量。**`_byCode` 补全 14 码全表**
    （`030` §Q1 点名的 7 码缺口 —— 原表只收 install 路径 7 码，load 路径错误从 install
    链冒出会静默落 `cause:'unknown'`；现 err.code 与 __verdict__.cause 不再不同源）。
  · **验收**：新套件 `accept-market-browse` **17/0**（B1–B10 含三条反向：arch 不符 ⇒
    blocked+why 点名 / 选中版 withheld ⇒ blocked / 老形状条目 ⇒ 空值兜底不炸；注入用
    **新实例工厂**——全局实例的目录缓存开机被 octave-core 填过 ⇒ `__catalogSource`
    只对未读目录的实例生效，同页两轮实测 undefined 后修对）。**既有五套零回归**
    （content-attributes 14/0、install-verdict 10/0、arch-boundary 5/0、forge-ondemand 15/0、
    catalog-load 27/0，8768+8761 双站）。**已 promote-pages 上站**（四处一致、三大件未动），
    8761 BOOT OK + browse 17/0。
  · 顺带（生产者侧、随 pin 进来）：symbolic/statistics 的逐版本 `kinds` 在新 pin 里被
    逐版重探补齐（N5 防再犯的延续）—— 站点目录候选相应更真。

  · **已上站 8761**（走 `promote-pages.sh`；四处一致 + 三大件逐字节未动 ⇒ 页面批；
    页件 sha 与验证方式见 `promote-pages.sh --verify` 的输出）+ **真站点验收 11/0**。
  · **顺带修掉受管辖入口自身一处自建以来的缺陷**（上站时抓到）：`promote-pages.sh` 的
    `--verify` 比**四处**（仓库 bridge/·8761·8768·镜像），而真同步循环**从建起只写两处**
    （漏 `$SITE_EXP`）⇒ **任何一次真同步后 `--verify` 都不可能绿**（`git log -S` 证据：
    自工具诞生那批 `e26a80d` 起就没有写 8768 的版本）。已修 + 加自证用例 ①b
    （真跑一次后**断言 8768 也被写上**）⇒ 自证 4→**5/0**。

- **★ 022 回信收口：`optim` 的 query-URL 缺口（它纠正我"今天用不上"）+ 端到端又抓两处真缺陷（2026-10-16）**：
  内容仓 `022` 纠正我 `021` 的误判 —— **带 query 的绝对 URL 今天就在它表里**（`optim`：
  `…download.php?package=optim-1.6.3.tar.gz`，缓存真名 `optim-1.6.3.tar.gz`）⇒ 两条推名路径都命中不了。
  **判 (a)**（采纳它的倾向）：`url` 是**重取入口**（不改它仓 emit）；宿主侧加 fallback ——
  **`byte_name_candidates()`**（逐条试：路径末段 / query 值 / query 各段；**判序按"末段像不像归档名"**
  —— 实测：`download.php` 是脚本名，先给它会找错文件）。另按要求：**站点态 withheld 候选带
  `upstream_url`**（出处 ≠ 交付路径，两段式的用意）。
  · **★ 端到端 stage 真表时又抓出两处宿主真缺陷**（它没报）：① `dst=join(site, 绝对URL)` ⇒
    造出 `site/https:/github.com/…` **假目录树**（而验证查同一表达式 ⇒ **看起来成功**）；
    ② 条目级同源改写**只做在货架路径**（`resolve()`），`--upstream` 路径漏了 ⇒ 并进来的条目
    是绝对 URL（端口校验器必红 + 不变量② 对不上）。**都修了** + `size` 按站内字节补真值。
  · 判据：`forge-catalog.py --selftest` **20→28/0**（+fallback 正反 + 改写正反；两条旧断言**翻面**
    到新落点）；真表 + stage ⇒ 端口校验器 `ok`、站点闸门 `ok`；现役三站 `--check` 仍 `ok`。
  · **它那条观察我收下**：「四类"文件里对、装配态才见真章"的共同点 = **声明与消费之间没有对账器**」
    —— 本批的假目录树 / 改写漏做是**第五、第六例**。跨仓面纪律加一档：**"我这侧对" ≠ "你那侧吃到"**。

- **★ UI 四问的宿主侧落地：结构化错误码 `err.code`（UI mail/028 Q1，2026-10-17）**：
  UI 报的现场（全英文界面冒 `Module.FS 尚未就绪…` 中文）**产地在本仓 `assets-loader.js`**。
  · **15 处 throw 全带 `err.code`**（闭集词表：`FS_NOT_READY`/`ENGINE_NOT_READY`/
    `CATALOG_UNREADABLE`/`NOT_IN_ANY_LIST`/`SHA_MISMATCH`/`ARCH_MISMATCH`/`LAYER_UNREACHABLE`/…）；
    `message` 保持中文（人读不变）。UI 国际化层用 `t('errors.' + err.code)` 渲染。
  · **`install()` 四态分类从正则改读 `e.code`**（结构化——消息改字不再影响分类；正则保留为
    兼容兜底，`.m` 侧按消息前缀分流不受影响）；code→cause 映射与既有词表逐字同值。
  · **已 promote 上站**：真站点 8761 实测 `err.code='NOT_IN_ANY_LIST'`+`cause='not-in-any-list'`
    （分类来自 code）；既有回归 `accept-install-verdict` 10/0 不变。
  · **Q2（版本描述）归内容仓裁**（我给了边界事实：开机表体积 vs 拆分文件 `desc_url` 变体）；
    **Q3/Q4 宿主口径**已答（双模式默认路径 = 预编译优先按档自动，UI 不用自建首选逻辑；
    LLVM 前置 = `planOnly` 规划拦截而非即时报错；`compile:true` 是槽位未实现别先接）。
  · LLVM `mail/028` 收执：两个照办复核过（`check-ztii-regression` 4 PASS + 双编号）；
    它点名的**手抄数字教训本仓也中了一处**（给它的 011 信里），已修。
  · 回信：内容仓 `029`（四问答集）已投已推；LLVM `012`（收执短复）落它仓工作树。

- **★ 026 裁决（工单 65 缺口 2 `_ZTIi`）：判 A 分两步 + 三信全收（2026-10-17）**：
  LLVM-wasm `mail/026`（归属答复）：**第三种情况**成立——`_ZTIi` 两边都不存在定义
  （宿主实测 `_ZTI*` 全是 Octave 类；仓库镜像 48 个 `.oct` 零基本 typeinfo），
  "抛基本类型"是任何正确编译器的必然产物（emcc 官方路径同样）⇒ 判定权归 ABI 属主（本仓）。
  · **判 A**（支持基本类型 throw）：`_ZTIv/b/c/i/f/l/d` 定义在宿主 sysroot 的
    `libc++abi-mt-legacyexcept.a`（D 段实测）；keep-list 已导 `__cxa_*` 10 条（同族）。
    B 的代价 = 第三方 `.oct` 撞**运行期** `reading 'value'`（看不出原因的失败模式）。
  · **本批落零风险半**：keep 生成器显式追加 7 条（gen-keep-list **永远不自己长**它们——
    没有任何 .oct 导入）+ 容器内现役 keep-w64/keep 补 7 条 + `--selftest`（闸门台 45→**46**）。
    **重链留独立批**（keep 只在终链消费；无真实用例不急 ⇒ 工单 65 = `ready-for-human`，
    重链与否是产品决定）。
  · **024/025**（UI 契约）：内容仓已给 Octave-UI 建箱 + 推广内容契约，**UI 已接纳**
    （它 `CONTEXT.md` §五，五条语义逐字对齐）；UI 选双投（它仓 + 投内容仓副本）；
    **A3 与本仓直接相关**：UI 确认读**本仓装配的** `forge-catalog.json` —— 与 §8.1"投送 = 宿主"一致。
  · 回信：LLVM `mail/010`（判 A + 复核表 + 重链后 `probe-toolchain-gap` 应翻 2 PASS/0）已落它仓工作树。

- **★ versions[] 全链闭环：内容仓 020（--emit 侧落地）复核 + 宿主侧消费 + 三站 rebake（2026-10-16）**：
  内容仓 `020`：`--probe` 改**逐版探**（N5 防再犯）+ `--emit` 出 `versions[]`。**我逐条复核**：样件
  sha 逐字相符（见回信 `Octave-Extra-Content/mail/021`）⇒ 过我校验器 `ok`（生产者态）；不变量② 13/13 逐字成立；全表
  **52 条候选**；它自证⑤（withheld 带轴 ⇒ 我校验器拦）我复跑确认。
  · **发现并修一处宿主缺口**：装配器**货架路径不产候选集**（`--upstream` 路径透传但货架
    `resolve()` 从不消费档案的 `versions` 数组）⇒ `resolve()` 现在逐版本产站点态候选
    （staged = **该版字节真在缓存/站点**；不在 ⇒ `withheld` + `bytes-not-staged`，不带派生轴）。
  · **staged 语义裁决**（它 020 §④2 请裁）：**装配态 staged 由宿主**（字节在谁那），
    **生产者态 staged 由它**（探包在谁那）—— 两种态**各自如实、不冲突**（我 `021` 已答）。
  · **三站 rebake**（catalog `1fcda92d…`→`254a696e…`，sha 快照作证）：8761 `BOOT OK`、
    端口校验器 `ok`、站点闸门 `ok`、`accept-symbolic-seam` **9/0** 不变 ⇒ 向后兼容
    （客户端只读顶层标量，`versions[]` 对旧消费者是纯增量键）。
  · **仍开放**：`--upstream-bytes` 对绝对 URL 的映射缺口（生产者表 url 带 query ⇒ stage 映射
    不到本地缓存名；登记待办，非本批）；客户端 `browse()`（判决书 §5 第 5 步，等真 UI 需求）。

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
| `accept_pass` | **1259** | 2026-10-29T22:40:10+0800 | `同上，把每个套件的 PASS 相加` |
| `accept_suites` | **56** | 2026-10-29T22:40:10+0800 | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20261029-223241 里带汇总行的套件（且 0 FAIL）` |
| `build_json_sha` | `d953d7a7929754be…` | 2026-10-29T22:40:10+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json | cut -d' ' -f1` |
| `data_sha` | `f250530ae5abe378…` | 2026-10-29T22:40:10+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data | cut -d' ' -f1` |
| `dist_lane_probe_fail` | **0** | 2026-10-29T22:40:12+0800 | `同上` |
| `dist_lane_probe_pass` | **33** | 2026-10-29T22:40:12+0800 | `cd <dist 包目录> && python3 serve.py 8788；再 SITE_DIR=<dist 包目录> sh build/sweep.sh http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log` |
| `e2_lu800_ratio` | **1.4** | 2026-10-29T22:40:10+0800 | `上面两行的比值（车道 / E2）` |
| `e2_lu800_s` | **0.043** | 2026-10-29T22:40:10+0800 | `同 E2 那一行` |
| `e2_matmul500_ratio` | **1.9** | 2026-10-29T22:40:10+0800 | `上面两行的比值（车道 / E2）` |
| `e2_matmul500_s` | **0.021** | 2026-10-29T22:40:10+0800 | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` |
| `e2_single_verdict` | **ok** | 2026-10-29T22:40:10+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` |
| `e2_single_wasm_bytes` | **29495868** | 2026-10-29T22:40:10+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | 2026-10-29T22:40:10+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm | cut -d' ' -f1` |
| `e2_threaded_lu800_s` | **0.02** | 2026-10-29T22:40:10+0800 | `同上` |
| `e2_threaded_matmul500_ratio` | **6.7** | 2026-10-29T22:40:10+0800 | `车道 / 线程版（派生）` |
| `e2_threaded_matmul500_s` | **0.006** | 2026-10-29T22:40:10+0800 | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` |
| `e2_threaded_oct_rc` | **124** | 2026-10-29T22:40:10+0800 | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` |
| `e2_threaded_verdict` | **ok** | 2026-10-29T22:40:10+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` |
| `e2_threaded_wasm_bytes` | **29908917** | 2026-10-29T22:40:10+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | 2026-10-29T22:40:10+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm | cut -d' ' -f1` |
| `emcc6_probe_geomean` | **1.001** | 2026-10-29T22:40:11+0800 | `sh test/fixtures/emcc6-probe/run-probe.sh 1（读 w64-logs/emcc6-probe.log 的 geomean 行）` |
| `env_vars` | **33** | 2026-10-29T22:40:10+0800 | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh | sort -u（去掉位置参数）` |
| `exported_functions` | **710** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` |
| `floor_matrix_engines` | **4** | 2026-10-29T22:40:12+0800 | `数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）` |
| `floor_matrix_fail` | **0** | 2026-10-29T22:40:12+0800 | `同上` |
| `floor_matrix_pass` | **16** | 2026-10-29T22:40:12+0800 | `同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）` |
| `fonts_count` | **8** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` |
| `forge_catalog_oct_packs` | **0** | 2026-10-29T22:40:11+0800 | `python3 -c "import json;print(len([p for p in json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['packs'] if 'oct' in (p.get('kinds') or [])]))"` |
| `forge_catalog_octave` | **11.3.0** | 2026-10-29T22:40:11+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['octave'])"` |
| `forge_catalog_packs` | **17** | 2026-10-29T22:40:11+0800 | `python3 -c "import json;print(len(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['packs']))"` |
| `forge_catalog_selftest_pass` | **44** | 2026-10-29T22:40:12+0800 | `python3 build/forge-catalog.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `forge_catalog_shelf_commit` | **7dfe77efff43** | 2026-10-29T22:40:11+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['shelf_commit'])" | cut -c1-12` |
| `forge_gate_selftest_pass` | **43** | 2026-10-29T22:40:12+0800 | `python3 build/113/check-forge-catalog.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `forge_shelf_packs` | **13** | 2026-10-29T22:40:11+0800 | `ls shelf/packages/*.json | wc -l` |
| `forge_shelf_verified` | **13** | 2026-10-29T22:40:11+0800 | `grep -l '"verified": {' shelf/packages/*.json | wc -l` |
| `hotpath_fft_blktrans_pct` | **19.1** | 2026-10-29T22:40:11+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6; tic; for k=1:10, y=fft(x); end' --lane w64` |
| `hotpath_instrument_ok` | **ok** | 2026-10-29T22:40:11+0800 | `python3 build/113/hotpath.py calibrate` |
| `hotpath_top` | **exp_inline 23.6%** | 2026-10-29T22:40:11+0800 | `读 /mnt/hdd/octave-wasm-build/hotpath-logs/20261005-142643/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）` |
| `hotpath_xpow_driver_pct` | **39.5** | 2026-10-29T22:40:11+0800 | `同上（elem_xpow + do_rc_map）` |
| `hotpath_xpow_libm_pct` | **48.9** | 2026-10-29T22:40:11+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6+0.1; tic; for k=1:20, y=sqrt(x)+x.^0.7; end' --lane w64（读 w64-logs/hotpath-final3.log）` |
| `hw_apis_available` | **3** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['hw'];print(sum(1 for k in ('serial','usb','hid') if d.get(k)))"` |
| `ip_vs_next_sort_ip_ms` | **0.105** | 2026-10-29T22:40:11+0800 | `sh test/browser/run.sh test/browser/bench-lanes.mjs <8761> w64（读 w64-logs/bench-IP-vs-NEXT.log）` |
| `ip_vs_next_sort_next_ms` | **0.237** | 2026-10-29T22:40:11+0800 | `同（<8869>）` |
| `ip_vs_next_sort_ratio` | **0.443** | 2026-10-29T22:40:11+0800 | `派生：IP ÷ NEXT` |
| `js_sha` | `caac68bf62015859…` | 2026-10-29T22:40:10+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js | cut -d' ' -f1` |
| `jspi_entry` | **True** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` |
| `lane6012_ip_verdict` | **ok** | 2026-10-29T22:40:12+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-ip.verdict` |
| `lane6012_master_verdict` | **ok** | 2026-10-29T22:40:12+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-master.verdict` |
| `lane6012_ok_lines` | **3** | 2026-10-29T22:40:12+0800 | `grep -l '^ok$' /mnt/hdd/octave-wasm-build/w64-logs/lane6012-*.verdict | wc -l` |
| `lane6012_wasm32_verdict` | **ok** | 2026-10-29T22:40:12+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-wasm32.verdict` |
| `lane_lu800_s` | **0.06** | 2026-10-29T22:40:10+0800 | `同车道那一行` |
| `lane_matmul500_s` | **0.04** | 2026-10-29T22:40:10+0800 | `现役车道站点跑同一个 bench-core.mjs` |
| `libm_spike_geomean` | **0.964** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-libm-spike.sh 8（读 w64-logs/libm-spike-verdict.txt 的 geomean 行）` |
| `locale_contract_lanes` | **2** | 2026-10-29T22:40:11+0800 | `for l in w64 base; do sh test/browser/run.sh test/browser/probe-locale.mjs "http://127.0.0.1:8761/?lane=$l"; done （读 w64-logs/locale-all-lanes.log 的 '8 PASS / 0 FAIL' 计数）` |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | 2026-10-29T22:40:10+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html | cut -d' ' -f1` |
| `mem_live_ceiling_gib` | **7.45** | 2026-10-29T22:40:12+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log` |
| `native_netlib_loop1e6_s` | **0.500141** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu1500_s` | **0.25765** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu800_s` | **0.04076** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul1000_s` | **0.196202** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul500_s` | **0.027249** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_lu1500_s` | **0.040473** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_lu800_s` | **0.026146** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul1000_s` | **0.009586** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_matmul1024_s` | **0.008517** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul2000_s` | **0.050018** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul500_s` | **0.003212** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_threads` | **24** | 2026-10-29T22:40:12+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `oct_base_files` | **17** | 2026-10-29T22:40:10+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' | wc -l` |
| `oct_w64_files` | **17** | 2026-10-29T22:40:10+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct-w64 -name '*.oct' | wc -l` |
| `octave_pin` | **f4bf15b792bf** | 2026-10-29T22:40:11+0800 | `git -C upstream/octave rev-parse --short=12 HEAD` |
| `octdir_base_files` | **28** | 2026-10-29T22:40:10+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' | wc -l` |
| `octdir_w64_files` | **28** | 2026-10-29T22:40:10+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-w64 -name '*.oct' | wc -l` |
| `port_gate_selftest_pass` | **6** | 2026-10-29T22:40:12+0800 | `python3 build/extra-content/check-content-port.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `port_validator_selftest_pass` | **63** | 2026-10-29T22:40:11+0800 | `python3 build/extra-content/validate-content-list.py --selftest | grep -oE '自证：[0-9]+ PASS' | grep -oE '[0-9]+'` |
| `probe_lane_fail` | **0** | 2026-10-29T22:40:10+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `probe_lane_pass` | **33** | 2026-10-29T22:40:10+0800 | `SITE_DIR=<站点> sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` |
| `pyodide_sync_probe_pass` | **4** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sync.json'))['pass'])"` |
| `pyodide_sync_ready_ms` | **2288** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sync.json'))['result']['pyodideReadyMs'])"` |
| `rust_fill_spike_ratio` | **1.094** | 2026-10-29T22:40:11+0800 | `sh test/fixtures/rustfill-spike/run-spike.sh（读 w64-logs/rustfill-spike.log 的比值行）` |
| `rust_patch_toolchain_ok` | **ok** | 2026-10-29T22:40:11+0800 | `python3 build/113/check-rust-toolchain.py` |
| `rust_sort_spike_base_ms` | **352.0** | 2026-10-29T22:40:11+0800 | `sh test/fixtures/rustsort-spike/run-spike.sh（读 w64-logs/rustsort-spike.log）` |
| `rust_sort_spike_cand_ms` | **87.0** | 2026-10-29T22:40:11+0800 | `同上` |
| `rust_sort_spike_ratio` | **0.249** | 2026-10-29T22:40:11+0800 | `派生：cand ÷ base` |
| `symbolic_seam_fail` | **0** | 2026-10-29T22:40:12+0800 | `awk '/=== [0-9]+ PASS/{f=$5} END{print f}' /mnt/hdd/octave-wasm-build/w64-logs/accept-symbolic-seam.log` |
| `symbolic_seam_pass` | **9** | 2026-10-29T22:40:12+0800 | `awk '/=== [0-9]+ PASS/{p=$2} END{print p}' /mnt/hdd/octave-wasm-build/w64-logs/accept-symbolic-seam.log` |
| `sympy_assets_bytes` | **6757104** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['bytes']['disk']['coreTar'])"` |
| `sympy_import_ms_pyc` | **380** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['importB_ms'])"` |
| `sympy_import_ms_source` | **2757** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['importA_ms'])"` |
| `sympy_perf_cold_start_ms` | **2276** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide.json'))['timings'];print(round(d['load']+d['pkg']))"` |
| `sympy_perf_pyodide_over_native` | **2.01** | 2026-10-29T22:40:12+0800 | `python3 test/fixtures/sympy-perf/compare.py（读最后一行 JSON 的 geo）` |
| `sympy_pyc_bytes_ratio` | **3.28** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['bytes'];print(round(d['B']/d['A'],2))"` |
| `sympy_pyc_cold_geo_speedup` | **1.29** | 2026-10-29T22:40:12+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读 cold_geo_speedup）` |
| `sympy_pyc_compile_calls` | **0** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['sourceToCode']['B'])"` |
| `sympy_pyc_import_speedup_pyodide` | **7.4** | 2026-10-29T22:40:12+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读末行 JSON 的 import_s.speedup）` |
| `sympy_pyc_speedup` | **7.26** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['speedup'])"` |
| `sympy_pyc_steady_geo_ratio` | **0.99** | 2026-10-29T22:40:12+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读 steady_geo_ratio）` |
| `sympy_pyodide_break_fails_loud` | **True** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][2]['result']['ok'])"` |
| `sympy_pyodide_diff` | **cos(x)** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][0]['result']['diff'])"` |
| `sympy_pyodide_nocoi_ok` | **True** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'];print(d[1]['result']['ok'], d[1]['result']['diff'])"` |
| `sympy_pyodide_ok` | **True** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][0]['result']['ok'])"` |
| `upstream_submodule_count` | **19** | 2026-10-29T22:40:11+0800 | `git submodule status | wc -l` |
| `w64_big_heap` | **True** | 2026-10-29T22:40:12+0800 | `同上（探针结尾的 `W64_BIG_HEAP=` 行）` |
| `w64_build_recipe_ok` | **ok** | 2026-10-29T22:40:11+0800 | `python3 build/113/witness-build-inputs.py` |
| `w64_build_tool_match` | **match** | 2026-10-29T22:40:11+0800 | `<重链 w64 后：python3 build/113/witness-build-provenance.py w64>` |
| `w64_cand_exported_functions` | **751** | 2026-10-29T22:40:11+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 measured.exported_functions` |
| `w64_cand_loop1e6_s` | **0.574** | 2026-10-29T22:40:12+0800 | `同上（loop 1e6）` |
| `w64_cand_lu800_s` | **0.014** | 2026-10-29T22:40:12+0800 | `同上（lu 800）` |
| `w64_cand_malloc` | **mimalloc** | 2026-10-29T22:40:11+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 declared.malloc / measured.malloc` |
| `w64_cand_matmul500_s` | **0.005** | 2026-10-29T22:40:12+0800 | `<交错 3 轮取中位：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8861/ w64（×3 ⇒ w64-logs/bench-mi2-r1..3.log）>` |
| `w64_cand_verdict` | **ok** | 2026-10-29T22:40:11+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.build.json）` |
| `w64_cand_vs_ship_lu800` | **1.0** | 2026-10-29T22:40:12+0800 | `派生：同上（lu 800）` |
| `w64_cand_vs_ship_matmul500` | **1.25** | 2026-10-29T22:40:12+0800 | `派生：w64-logs/bench-mi2-r1..3.log 的中位 ÷ bench-ship2-r1..3.log 的中位` |
| `w64_cand_wasm_bytes` | **30984954** | 2026-10-29T22:40:11+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm` |
| `w64_cand_wasm_sha` | `01fb52fc3b5dde30…` | 2026-10-29T22:40:11+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm | cut -d' ' -f1` |
| `w64_exported_functions` | **757** | 2026-10-29T22:40:11+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.exported_functions` |
| `w64_i64_insns` | **4175689** | 2026-10-29T22:40:12+0800 | `llvm-objdump -d <w64>/octave.wasm | grep -c i64（由 build/113/build-w64-lane.sh facts 写出，容器内跑）` |
| `w64_lu800_s` | **0.079** | 2026-10-29T22:40:12+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_malloc` | **mimalloc** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 declared.malloc / measured.malloc` |
| `w64_matmul500_s` | **0.048** | 2026-10-29T22:40:12+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_mem_5g_bytes` | **5242880000** | 2026-10-29T22:40:12+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_8g_bytes` | **8589934592** | 2026-10-29T22:40:12+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_probe_fail` | **0** | 2026-10-29T22:40:12+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `w64_mem_shared_5g_bytes` | **5242880000** | 2026-10-29T22:40:12+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_ob_lib_wasm32_members` | **0** | 2026-10-29T22:40:12+0800 | `同上` |
| `w64_ob_lib_wasm64_members` | **1557** | 2026-10-29T22:40:12+0800 | `E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh src patch build > w64-logs/e2-w64-build.log（读那行架构断言）` |
| `w64_ob_lu800_s` | **0.014** | 2026-10-29T22:40:12+0800 | `同上（8761 现役那轮）` |
| `w64_ob_matmul1000_native_ratio` | **0.38** | 2026-10-29T22:40:12+0800 | `派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_ob_matmul500_native_ratio` | **1.07** | 2026-10-29T22:40:12+0800 | `派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_ob_matmul500_s` | **0.003** | 2026-10-29T22:40:12+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log` |
| `w64_ob_matmul500_speedup` | **15.3** | 2026-10-29T22:40:12+0800 | `派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项` |
| `w64_ob_matmul500_vs_netlib` | **9.1** | 2026-10-29T22:40:12+0800 | `派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_oct_files` | **46** | 2026-10-29T22:40:12+0800 | `同上（文件名：oct-wasm64.txt 的第二个数）` |
| `w64_oct_wasm64` | **46** | 2026-10-29T22:40:12+0800 | `bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/llvm-readobj 逐个量）` |
| `w64_relaxed_madd` | **6** | 2026-10-29T22:40:11+0800 | `<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>` |
| `w64_rustsort_ab_asc_ms` | **165** | 2026-10-29T22:40:11+0800 | `bash build/113/sort-ab.sh /mnt/hdd/octave-wasm-build/site-illegalperf /mnt/hdd/octave-wasm-build/site-illegalperf-baseline 3（读 w64-logs/rust-sort-ab.log）` |
| `w64_rustsort_ab_asc_ratio` | **0.506** | 2026-10-29T22:40:11+0800 | `派生：候选 ÷ 对照（asc 中位）` |
| `w64_rustsort_ab_desc_ratio` | **0.551** | 2026-10-29T22:40:11+0800 | `派生：候选 ÷ 对照（desc 中位）` |
| `w64_rustsort_base_ab_ms` | **326** | 2026-10-29T22:40:11+0800 | `同上` |
| `w64_rustsort_cand_sha` | `f6fec91fc7a0f4b8…` | 2026-10-29T22:40:11+0800 | `sha256sum /mnt/hdd/octave-wasm-build/artifacts-w64-rust-on/octave.wasm | cut -d' ' -f1` |
| `w64_shared_memory` | **True** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.threads.shared_memory` |
| `w64_v128` | **6295** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.simd.v128` |
| `w64_verdict` | **ok** | 2026-10-29T22:40:10+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts/octave.build.json）` |
| `w64_vs_netlib_loop1e6` | **0.67** | 2026-10-29T22:40:12+0800 | `派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6` |
| `w64_vs_netlib_lu1500` | **3.8** | 2026-10-29T22:40:12+0800 | `派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500` |
| `w64_vs_netlib_matmul1000` | **7.8** | 2026-10-29T22:40:12+0800 | `派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_wasm64` | **True** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.wasm64` |
| `w64_wasm_bytes` | **31246819** | 2026-10-29T22:40:11+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm` |
| `w64_wasm_sha` | `0225d0b374f3bed9…` | 2026-10-29T22:40:11+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm | cut -d' ' -f1` |
| `wasm_bytes` | **29632229** | 2026-10-29T22:40:10+0800 | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_sha` | `1ed3e528561e4475…` | 2026-10-29T22:40:10+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm | cut -d' ' -f1` |
| `wasm_v128` | **4752** | 2026-10-29T22:40:10+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` |
| `webgpu_main_device` | **OK** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['main']['device'])"` |
| `webgpu_vendor` | **nvidia** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['main']['vendor'])"` |
| `webgpu_worker_compute_ok` | **True** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['computeOK'])"` |
| `webgpu_worker_device` | **OK** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['device'])"` |
| `webgpu_worker_webgl2` | **True** | 2026-10-29T22:40:12+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['webgl2'])"` |
| `xpow_driver_spike_pct` | **2.1** | 2026-10-29T22:40:11+0800 | `bash test/fixtures/xpow-spike/run-spike.sh（读 w64-logs/xpow-spike.log）` |
| `xpow_driver_spike_ratio` | **0.988** | 2026-10-29T22:40:11+0800 | `同上（cand/base）` |

159 条事实。
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
| 资产条目 | 52 | |
| 最近一次**全绿**回归 | `20261029-223241` · **56 套 / 1,259 PASS / 0 FAIL** | http://127.0.0.1:8768/ |
| 交付包 | `octave-full-wasm-site-20261019` · tar.zst 65,944,760 B · `abd8622a709425e7…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `IllegalPerformance`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->