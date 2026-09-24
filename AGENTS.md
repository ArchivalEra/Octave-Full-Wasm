# AGENTS.md · Octave-Full-Wasm

> **接续先读两份**：`HANDOFF.md`（活状态）+ `build/113/PLAN-jspi.md` 的 **§0.5「现在的状态与下一步顺序」**（当前工作令）。
> 历史与旧数字在 **`HISTORY.md`**（`§5.x`/`§9`/`§10`，append-only；正文里单写的这些编号都指它）。
> 分门别类的坑：C 库配方 `build/CLIBS.md`、图形线 `build/113/NOTES-webgl.md`、JSPI 机制 `build/113/NOTES-jspi.md`。

## 路径铁律
- 仓库：`/mnt/hdd/zcode-projects/Octave-Full-Wasm`（**唯一**可改的 git 仓）
- 构建容器：docker `o113`（11.3.0 车道；`obuild`/`odld`/`obench` 是更早的车道）
- 第三方源码/产物：`/mnt/hdd/octave-wasm-build/`、`/tmp/opencode/`
- **禁止**碰课程仓 `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917`

## 三条不可违背
1. **纯客户端计算**：Octave 恒跑在浏览器 wasm 内 —— 禁止任何服务端执行代码的端点。
2. 不 force-push / 不删 git 对象 / 不改历史；**禁用 `--no-verify`**。
3. **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`，否则 pre-commit 直接拒。

## 验收底线
`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建。新实验失败**不许**让它退化：
失败就回退（`cp site/octave.{wasm,js,data} siteWebGL/`，或站点备份目录）+ 记档 + 继续下一批。

## 事实纪律（每句"现在如此"都要能被复跑的命令证明）
**照抄旧话是文档说假话的唯一来源**（一天里抓到过 5 处）。四条：
1. **数值/行为只认实测**，并把**复跑方式写在断言旁边**；写不出复跑方式的句子 → 只能放进 HISTORY 当历史。
2. **口径成组记录**：重配就是 `WITH_OPENGL=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1` **一整组**；
   漏一个会**静默退化**（漏 `WITH_OPENGL=1` ⇒ 默认 toolkit 掉回 `web`，而构建/链接/自检**全绿**）。
   重链的**唯一权威命令**在 HISTORY §5.26（M2 那条 + `WITH_FONTCONFIG=1`；`WITH_JSPI` 默认**关**）。
3. **"能编过 ≠ 能用了"**：碰运行期行为（GL / 字体 / 加载路径 / 资源）必须**浏览器侧**实测；
   构建成功 + 产物自检绿**不算**功能验收。
4. **断言要能证伪**：替身不能比真实对象松；新契约至少配一条**反向**断言（该报错的必须报错）。
   行为变了就**翻面**（改断言，别改检查器）；`probe-*` 会腐烂 ⇒ 每批用 `PROBES=1` 跑一遍。

## 批次收尾（固定动作，缺一步等于没做完）
`sh build/glue-selftest.sh`（宿主秒级）→ **8768 验绿**（`sweep.sh http://127.0.0.1:8768/`）
→ promote 8761（`build/promote-webgl.sh`；纯资产批用 `assets.py bundle-m` + `sync-js`）
→ **开机自检** `sh build/check-boot.sh http://127.0.0.1:8761/`（30 秒，**不过就别往下走**）
→ **8761 全量回归**（`sweep.sh http://127.0.0.1:8761/`，每批**再跑一次 `PROBES=1`**）
→ `sh build/make-dist.sh`（并核对**包内 wasm 与部署件同 sha**）
→ **两站点一致** `sh build/check-site-parity.sh --strict`
→ 六道闸门 → 提交 → 推持久盘镜像。**8761 在 promote 之前一动不动。**

## 提交前（六道闸门）
```bash
python3 .githooks/update-readme.py --check   # README 的 AUTO:FILES 要新鲜
python3 .githooks/update-handoff.py          # HANDOFF 的 AUTO:STATE 机器块
python3 .githooks/check-handoff.py           # 活状态断言不得与产物矛盾（只查 HANDOFF.md）
python3 .githooks/check-consistency.py       # 挂载点/启动清单/车道路径一致
python3 .githooks/check-wants.py             # 断言可证伪性（裸数字匹配/截断后匹配）
python3 .githooks/check-whitelist.py         # 白名单覆盖
```
⚠️ **闸门有盲区**：`check-whitelist.py` 只看**已暂存**的文件 ⇒ 被 `.gitignore` 忽略且从未
`git add` 的文件它看不见（曾因此漏掉 4 个承重文件）。新增目录后主动看一眼
`git status --short --ignored <目录>`。

## 操作习惯与硬坑（踩过的，别再来一次）
- **重活用 `setsid nohup … &` + ≤3 分钟的命令轮询**，输出只 `tail -n`/`grep` —— 长前台命令会把 ZCode 弄崩。
  **跑验收时别并行干重活**（并发 docker commit / 压缩曾让一个套件假崩）。
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
- 结论只认**产物**：`sha256sum`、`sweep-logs/<时间戳>/`、探针输出；不认印象。
