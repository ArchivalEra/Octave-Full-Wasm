# AGENTS.md · Octave-Full-Wasm

> **接续先读两份**：`maintaince.md`（**方向与地图**，只指方向不抄数字）+
> `STATE.md`（活状态：现在是什么 + 文末机器块）。
> 记忆架构规约 = `docs/agents/memory.md`（Einfacht 吞噬形态：HANDOFF 已退役）。
> **并行度线**（SIMD/线程/Worker/嵌入契约）在 `build/113/PLAN-threads.md`，与本条并行、共享同一个产物。
> 历史与旧数字在 **`HISTORY.md`**（`§5.x`/`§9`/`§10`，append-only；正文里单写的这些编号都指它）。
> 分门别类的坑：C 库配方 `build/CLIBS.md`、图形线 `build/113/NOTES-webgl.md`、JSPI 机制 `build/113/NOTES-jspi.md`。
> **黑话看不懂就读 `CONTEXT.md`**（术语表：每个词一条权威定义 + 一行可复跑的证据）。

## 路径铁律
- 仓库：`/mnt/hdd/zcode-projects/Octave-Full-Wasm`（**唯一**可改的 git 仓）
- 构建容器：docker `o113`（11.3.0 车道；`obuild`/`odld`/`obench` 是更早的车道）
- 第三方源码/产物：`/mnt/hdd/octave-wasm-build/`、`/tmp/opencode/`
- **不常用工具链/一次性浏览器下载**：`/mnt/hdd/crossbuild-tools/`（playwright 浏览器在
  `pw-browsers/`，用时设 `PLAYWRIGHT_BROWSERS_PATH`；WebKit 的依赖修正见 NOTES-threads.md）
- **禁止**碰课程仓 `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917`

## 三条不可违背
1. **纯客户端计算**：Octave 恒跑在浏览器 wasm 内 —— 禁止任何服务端执行代码的端点。
2. 不 force-push / 不删 git 对象 / 不改历史；**禁用 `--no-verify`**。
3. **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`，否则 pre-commit 直接拒。

## 验收底线
`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建。新实验失败**不许**让它退化：
失败就回退（`cp site/octave.{wasm,js,data} siteWebGL/`，或站点备份目录）+ 记档 + 继续下一批。

★ **上站候选必须过「全量」才叫候选**（2026-10-02 真踩到）：NT=8 候选当初只验了"数值四套"
就发运，全量里 **`accept-dldfcn`（唯一大量压 `dlopen` 的套件）71/0→44/27** ——
热自旋池线程挡住了 dlopen 需要的表/内存增长安全点（NT=4 从不暴露）。⇒ **换产物/改线程数/
改 GL/改资源** 的批次，进件前必须跑一次 `PROBES=1` 全量（至少含 `accept-dldfcn`），
只跑几个"数值套件"不算候选（那条捷径正是这次事故的形状）。

## 事实纪律（每句"现在如此"都要能被复跑的命令证明）
**照抄旧话是文档说假话的唯一来源**（一天里抓到过 5 处）。四条：
1. **数值/行为只认实测**，并把**复跑方式写在断言旁边**；写不出复跑方式的句子 → 只能放进 HISTORY 当历史。
2. **口径搬进代码了（2026-09-26 批次 A1）——别再照抄文档拼命令**：
   重链的**唯一入口是 `bash build/113/relink.sh link product`**（模式 `product` / `scalar` / `m1`
   决定**全部环境变量**（条数见 `build/FACTS.json` 的 `env_vars`；★ 曾写 22 是**错的** ——
   A1 加了 `BUILD_MODE` 标签变量，另有 `P5_OBJS` 是脚本内数组不算）**，一个都不许手设**。要看口径就打
   `bash build/113/relink.sh explain product`（**那就是文档，生成物**）；
   `bash build/113/relink.sh --selfcheck` 是它的可测契约（link-web.sh 读的每个变量都必须被
   模式表覆盖；反向实测能红）。**重配**仍是一整组
   `WITH_OPENGL=1 WITH_GL2PS=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1`（漏 `WITH_OPENGL=1`
   ⇒ 默认 toolkit 静默掉回 `web`，而构建/链接/自检**全绿**）。
   历史口径与踩坑留在 HISTORY §5.26 / §5.38 / §5.54（**当历史读，别当配方**）。
   产物自证不靠 grep 了：链接时写出 `octave.build.json`（只记**量到的事实**），
   **`verdict=="ok"` 才可部署**；现役 `octave.wasm` 的 sha 与 `measured.simd.v128` 见
   `build/FACTS.json` 的 `wasm_sha` / `wasm_v128`（**正文不手抄数字**）。
   ⚠️ 手跑 `link-web.sh` 的产物 `declared` 是 null ⇒ 判拒；补判：
   `relink.sh verify <模式> --out <目录>`。手查仍可用 `llvm-objdump -d <wasm> | grep -c v128`
   （现役值 = `build/FACTS.json` 的 `wasm_v128`，非 SIMD 那版 = 0；⚠️ 别用 `grep simd128`，那是**假**判据）。
3. **"能编过 ≠ 能用了"**：碰运行期行为（GL / 字体 / 加载路径 / 资源）必须**浏览器侧**实测；
   构建成功 + 产物自检绿**不算**功能验收。
4. **断言要能证伪**：替身不能比真实对象松；新契约至少配一条**反向**断言（该报错的必须报错）。
   行为变了就**翻面**（改断言，别改检查器）；`probe-*` 会腐烂 ⇒ 每批用 `PROBES=1` 跑一遍。
5. **断言有生命周期：实测 / 推断 / 翻案**（F3，2026-09-26）：活状态文档里**只写实测**；
   推断写进 `build/113/NOTES-*.md`，并注明**哪个实验能结案**（写不出结案实验的推断 = 猜想，
   别写）；被推翻的断言登记进 `build/lib/retractions.json` —— `.githooks/check-retractions.py`
   会在它**重新出现**时报错（实测代价：一条"线程档在 Pages 上跑不起来"在被更正后**仍留在
   同一个文件里**，还带一份 HANDOFF 副本）。
   闸门自身也吃这条：每个闸门必须 `--selftest`（`build/gates-selftest.sh`，接在 pre-commit）。

## 批次收尾（固定动作，缺一步等于没做完）
★ **开工预检（Einfacht #10 收编，2026-10-04）**：每批先跑
  `sudo -E $(which python3) build/lib/doctor.py` —— stdout 必须是 **ok** 才开工；
  `DOWN: <哪条>` = 环境问题点名（8761 活性+COI 头 / o113 容器 / 实验独占端口 8868，
  策略在 `doctor.json`）。动机 = 两次实测：机器重启杀掉 8761 服务与容器、文件层全绿
  但底线不可用（HISTORY §5.86）；8868 被占 ⇒ 探测误判（§5.83）。
  ⚠ 本机用 sudo：shell 的 docker socket 需 root，否则 docker 项假阳 DOWN（工具在如实
  报"探针看不见"）。
★ **8761 只由 `build/promote-webgl.sh` 改**（2026-09-27 真踩到）：为了在 8768 上试页面改动，
  我顺手把 `bridge/{lane.js,index.html}` 也 `cp` 进了 **8761 站点**，而那里没有 `threads/` 且**带头服务**
  ⇒ 页面按 COI 选线程档 ⇒ `threads/octave.js` **404**，验收底线当时是坏的（回退三步见
  `build/113/NOTES-threads.md` 末节）。⇒ 实验只 `cp` 到 `siteWebGL/`；`site/` 那一份交给 promote。
  **只改某一档 / 某一类的批次走各自的受管辖入口**（都是 `--dry-run`/`--verify`/`--selftest`，
  且都带"不许夹带别的改动"的反向断言）：页面资产批 = `build/promote-pages.sh`；
  **wasm64 车道批 = `build/promote-w64-lane.sh`**（工单 30 起 —— 它拒收 base/threads 被动过的站点，
  因为 `promote-webgl.sh` 会从容器 `m2fc-threads-out` 重推线程档，而那份已漂走）。
★ **服务方式（B6 起，2026-09-27）**：8761/8768 **必须带头**起 —— `python3 build/serve-coi.py
  --dir <站点目录> --port 8761`（它发 `COOP: same-origin` + `COEP: require-corp`）。`python3 -m
  http.server` 发不了这两个头 ⇒ 线程档选不中、页面**静默**落回基础档（不报错，只是没线程）。
  测"基础档"那一侧时另起一台 `--no-coi`（同一份目录）。
`sh build/glue-selftest.sh`（宿主秒级）→ **8768 验绿**（`sweep.sh http://127.0.0.1:8768/`）
→ promote 8761（`build/promote-webgl.sh`；纯资产批用 `assets.py bundle-m` + `sync-js`；
  **M2 车道必须 `GL_OUT=$SRC_OUT`** —— 只传 SRC_OUT 会把 out-webgl 旧件盖上新产物，§5.49）
→ **开机自检** `sh build/check-boot.sh http://127.0.0.1:8761/`（30 秒，**不过就别往下走**）
→ **部署件 SHA 检查**（★ 用户点名的铁律，2026-09-25；改完程序用老产物跑 = 本会话多次事故）：
  `sh build/check-deploy-sha.sh <站点目录> <刚构建的wasm sha> <URL>` +
  `node test/browser/probe-artifact-sha.mjs <URL> [页面实际选中的那一档的 sha]` —— 三层
  （磁盘/HTTP/页面自证）不全绿就停。
  ★ **四格站点（带头 ⇒ 页面跑 `w64/`）**：第二参数要么留空（探针会走 ③a 身份证判据：
  页面实例化的字节 == 那一档自己 `octave.build.json` 记的 sha），要么传 **w64 档**的 sha；
  传根目录基础档的 sha 没有意义（页面根本不实例化它）。
→ **同步仓库 `site/`**（入库的可部署镜像，部署说明 DEPLOY.md）：
  `rsync -a --delete /mnt/hdd/octave-wasm-build/site/ site/` 后一并提交
→ **8761 全量回归**（`sweep.sh http://127.0.0.1:8761/`，每批**再跑一次 `PROBES=1`**）
  ★ **双档（B6）**：站点里除根目录三大件外还要有 `threads/octave.{js,wasm}`（文件名相同、子目录区分），
  `SITE_DIR=<站点目录> sh build/…` 跑 `probe-lane` 验"带头选线程档 / 不带头落基础档 / 选错档硬失败"。
  ★ **四格（工单 30，2026-10-01）**：再加 `w64/` 与 `w64-base/`（同名文件、子目录区分）+
  `assets/{oct-w64,octdir-w64}` + `assets/manifest.w64.json`，档清单由 `gen-lanes.sh` 重生成。
  期望：带头 ⇒ `w64`（shared）、不带头 ⇒ `w64-base`、**无 memory64 ⇒ `threads`（反向断言）**、
  无 COI 强选 `w64` ⇒ 硬失败。四格批**只走** `build/promote-w64-lane.sh`（别用 promote-webgl：
  它会重推已漂走的 `m2fc-threads-out`）。`probe-lane` 的 PASS 数随站点档数变（双档 17 / 四格 33）。
→ `sh build/make-dist.sh`（并核对**包内 wasm 与部署件同 sha**）
→ **三处一致**（8761 / 8768 / 仓库 `site/`）`sh build/check-site-parity.sh --strict`
→ 六道闸门 → 提交 → 推持久盘镜像。**8761 在 promote 之前一动不动。**

## 提交前（事实系统 = Einfacht 平台 + 本仓专属闸门）
> **2026-10-09：事实系统已采纳完全重构后的 Einfacht**（`zreflect/` 机制层 + `reflect-hooks/`
> 钩子 + `gates-selftest.sh` 发现式自证台）。本仓的**数据层**在 `zreflect/measure_octave.py`
> （数据 vs 机制分离：换仓库只换那一个文件，机制原样可升级）。旋钮的唯一可复现来源 =
> `reflect-hooks/Einfacht.env`。钩子已指向 `reflect-hooks`（`git config core.hooksPath`）。
> 下面手工复跑的就是钩子跑的那几道：
```bash
# 平台层（发现式名录，别手写清单）：机器块 + 13 道闸门 + 自证
python3 zreflect/facts.py --render-doc STATE.md   # 重渲染事实块 + 闸门名录块（--check 验新鲜）
for g in zreflect/check_*.py; do python3 "$g" || exit 1; done
sh gates-selftest.sh                              # ★ 平台闸门自证（含跨仓库可配置性反向断言）
# 本仓专属层（平台无对应件）：AUTO 区块 + 活状态断言 + 一致性 + 可证伪 + 白名单 + 就绪 + pin 见证
python3 .githooks/update-readme.py --check        # README 的 AUTO:FILES 要新鲜
python3 .githooks/update-state.py --check         # STATE 的 AUTO:STATE 机器块
python3 .githooks/check-state.py                  # 活状态断言不得与产物矛盾（只查 STATE.md）
python3 .githooks/check-consistency.py            # 挂载点/启动清单/车道路径一致
python3 .githooks/check-wants.py                  # 断言可证伪性（裸数字匹配/截断后匹配）
python3 .githooks/check-whitelist.py              # 白名单覆盖
python3 .githooks/check-readiness-pattern.py      # 就绪反模式（工单 40/42）
python3 .githooks/witness-upstream-pin.py         # 上游 pin 见证（容器树 == submodule pin）
python3 build/113/plugin-check.py                 # 部件插件登记闸门（工单 61）：登记表↔产物 declared 双向
sh build/gates-selftest.sh                        # ★ 本仓专属闸门自证（40 个，含构建侧）
```
**★ 闸门自证（F1，2026-09-26）**：前几道查仓库，自证那道查**检查器本身**。
本仓实测过：~20 个检查器里只有 1 个能证明自己会红，而"收集-断言"式闸门在输入消失时
**静默变绿**（三处站点同时缺 `VERSION` ⇒ parity 报"完全一致"；`declared == {}` ⇒ `verdict:"ok"`；
`glue-selftest` `0/0` 算全过）。⇒ 现在**每个闸门必须带 `--selftest`**，且三类用例齐备：
**正常不报 / 该报的必须报 / 空输入必须报**。平台本体：`zreflect/gate.py`（rc 契约 +
零值守卫 + 发现式名录）。新增平台闸门 = 落一个 `GATE = gate.meta(…)` 声明行，名录自动长出来；
新增本仓专属闸门**必须**在 `build/gates-selftest.sh` 的名单里登记 —— 名单外的闸门就是没人盯着的闸门。
⚠️ **闸门有盲区**：`check-whitelist.py` 只看**已暂存**的文件 ⇒ 被 `.gitignore` 忽略且从未
`git add` 的文件它看不见（曾因此漏掉 4 个承重文件）。新增目录后主动看一眼
`git status --short --ignored <目录>`。

## 操作习惯与硬坑（踩过的，别再来一次）
- ★ **禁止使用 `sleep`**（用户点名，2026-09-27）。**任何形式都不行** —— `sleep 3`、`sleep 3 && …`、
  `until …; do sleep 1; done` 都算。
  · 原因（实测）：ZCode 的 120 s 前台预算到点会把命令**转后台并救活**，
    **唯独 `sleep` 开头的命令直接被杀**（`Command timed out after 10m`）⇒ 等待本身把工作弄丢；
    而"轮询一次"只是把同一件事再看一遍，白花一个工具调用 + 它读回来的 token。
  · 正确做法：**长任务用 `run_in_background: true` 起**（后台任务**没有超时**），
    起完就返回、去干别的，**等完成通知**；需要盯着已有进程就用
    `tail -f --pid=<pid> <日志>`（进程一死 `tail` 自己退出 ⇒ 通知即完成），
    或直接读它写好的产物（`sweep-logs/<时间戳>/`、`FACTS.json`、`*.log`）。
  · 已经后台化的任务**绝不重跑**：重跑 = 双倍工作 + 两份互相打架的日志。
- **重活用 `setsid nohup … &` 起、输出只 `tail -n`/`grep`**（前台长命令会占住预算）。
  **跑验收时别并行干重活**（并发 docker commit / 压缩曾让一个套件假崩）。
- **测试用例从仓库原路径直跑**（`cd harness && node /mnt/hdd/.../test/browser/x.mjs`）——
  别 `cp` 一份到 harness 再跑：改完仓库用旧副本跑，断言红绿全错位（实测两次，2026-09-25）。
- ★ **跑测试前先验产物 SHA**：`check-deploy-sha.sh` + `probe-artifact-sha.mjs` 三层
  （磁盘/HTTP/页面实例化字节）——"改完程序用老产物跑"本会话踩了三次（promote 覆盖、
  harness 旧副本、清缓存后的站点），都是 SHA 一查就现形。
- **测试用例从仓库原路径直跑**（`cd harness && node /mnt/hdd/.../test/browser/x.mjs`）——
  别 `cp` 一份到 harness 再跑：改完仓库用旧副本跑，断言红绿全错位（实测两次）。
- **容器里的构建脚本是另一份拷贝**：改完仓库的 `configure-113-full.sh` / `link-web.sh` /
  `main.cc` 必须 `docker cp` 进容器（`main.cc` → `/src/websrc/main.cc`，构建脚本 → `/src/bin/`），
  否则跑的是旧的。（`link-web.sh` 自己会编 `main.cc`，不用手动编。）
- **别猜挂载点**：`assets.py bundle-m <名字> <目录> <挂载点> <输出>` 的挂载点**逐字读
  `build/assets-meta.json`**（`pkgfix` = `/usr/src/octave/m/pkg`、`plotbridge` =
  `/usr/src/octave/m/plotbridge`）。**少写一层**会把文件铺到 `m/` 根上，桥的"摘桥目录"路径手术
  就会把整棵核心 m 树摘掉（真发生过：`clf` 报 `no core implementation cached`）。
- **探测/自检不许放在开机路径上**：坏产物会让**整页卡死**（JSPI 那次），连带所有浏览器验收全挂。
  探测器要**按需触发 + 带超时**，它的失败模式必须和被探测的东西解耦。
- **JSPI × dlopen 三条机制**（实测，详见 `NOTES-jspi.md`）：① 链里有 dlopen ⇒ 它**上游整条入口**
  都可能挂起、**不能被同步调用**（会抛 `SuspendError: trying to suspend without WebAssembly.promising`）；
  ② **顺序即机制** —— 先走一次被 promising 包装的入口，之后同步 dlopen 就正常了；
  ③ **启动路径上碰 dlopen 会直接让页面起不来**。
- **两处旗标不对称**：`-sEXPORTED_RUNTIME_METHODS` 写不存在的名字是**编译期硬错**（并中止编译）；
  `-sJSPI_EXPORTS` 写不存在的名字**无害**。`--preload-file` 按**第一个 `@`** 切 `src@dst`
  （`m/@ftp` 源路径自带 `@` ⇒ 整棵 m 树曾被复制错位，见 HISTORY §5.13）。
- ★ **"赋值了但没被引用"的旗标会静默失效**（2026-09-24 深夜，HISTORY §5.46）：
  `link-web.sh` 里 `JSPI_FLAGS` 只在分支里赋值，而 `em++` **链接行从来没引用它**
  ⇒ `WITH_JSPI=1` 的产物里**宏进了 C++、`-sJSPI` 没进链接**，构建/链接/五条自检**全绿**，
  浏览器侧却把"绑定不异步"当成"JSPI 坏了"，白查一晚。
  ⇒ **改旗标组之后，必须有一条"从产物里读出来"的自检**（这里就是
  `grep -o 'WebAssembly\.promising' "$OUT/octave.js"`）；**只信命令行的旗标组不算验收**。
- ★ **`Module.execute_interp()` 之前不许碰解释器**（同上，§5.46）：那之前的 `eval_string` /
  `eval_async` / `feval` **一律抛 `RuntimeError: null function`**（同步异步一样）。
  开机路径上的任何探测/预热**必须 try/catch**，否则异常会打断 `postRun` 剩下的步骤
  ⇒ `__octaveReady` 永远 false ⇒ **页面看起来"卡死"**（G1 那次事故的真身）。
- **shell 陷阱**（本会话反复咬人，各闸门注释里也有）：`pkill -f 'x'` **会匹配到自己这条命令行**
  （用 `'x[y]'` 括号技巧）；`rc=$?` 接在管道后拿的是最后一个命令的状态；`&&` 放在 `&` 前会把整条链
  后台化；`echo` 里的反引号会被当命令替换；`grep -c` 零命中**退出 1**；`grep -E` 里 `{` 是区间表达式；
  正则字符类漏数字（`[A-Z_]+` 匹配不到 `P5_OBJS`）；`-sENV=…` 不是 emcc 5.0.7 的设置项。
- 结论只认**产物**：`sha256sum`、`sweep-logs/<时间戳>/`、探针输出；不认印象。

## Agent skills

### Issue tracker

工单是本仓的 markdown 文件，在 `.scratch/open-questions/issues/NN-*.md` 下 —— **本地 tracker，
不用 GitHub Issues**（本仓是私有仓且从未建过任何 issue；活状态由 `STATE.md` 承载，工单只装
"未结案"）。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个规范角色写成工单头部 `**Status:**` 行的字符串（`needs-triage` / `needs-info` /
`ready-for-agent` / `ready-for-human` / `wontfix`）。`wontfix` **不是删除** —— "我们决定不查这个"
本身是一条结论，删掉它下一个人会重问一遍。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：根 `CONTEXT.md`（`docs/adr/` 尚未创建 ⇒ 静默跳过）。见 `docs/agents/domain.md`。

### 悬案台账（本仓专属，2026-09-27 起）

**未结案的问题不留在散文里**：一条悬案 = 一张工单，且**必须挂一个可跑的结算件**（头部
`**Settling:**` 行）。写不出结算件的，只能降级成 `NOTES-*.md` 里的"猜想"，不许留在活状态。
结算件尚不存在的悬案是**合法工单** —— 它的第一交付物就是造那个结算件（写
`**Settling:** 不存在 —— 本工单的第一交付物`，别编假路径）。
一句话理由：**没结案的问题等于没被问过**；`retractions.json` 管"被推翻的"，这里管"还没查清的"。
