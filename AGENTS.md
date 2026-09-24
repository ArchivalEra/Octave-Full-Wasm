# AGENTS.md · Octave-Full-Wasm

## 路径铁律（最重要）
只在本路径工作：

- 仓库：`/mnt/hdd/zcode-projects/Octave-Full-Wasm`（**唯一**可改的 git 仓）
- 构建容器：docker `o113`（11.3.0 车道；`obuild`/`odld`/`obench` 是更早的车道）
- 第三方源码/产物：`/mnt/hdd/octave-wasm-build/`、`/tmp/opencode/`

**禁止**碰课程仓 `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917`
（Octave 相关内容已刻意移出，与本项目无关）。

**接续先读两份文档**：
- **`HANDOFF.md` = 活状态**（现在什么样、下一步干什么）：§0 铁律 / §7 已知偏差 / §8 仍待办。
- **`HISTORY.md` = 历史**（append-only）：第三轮 T1–T10、批次 A–E、图形线 P5→WebGL、
  第四轮换 11.3.0 基线、`§5.23`–`§5.32` 的逐批实况。**正文里单写的 `§5.x`/`§9`/`§10` 一律指它。**
- C 库配方与坑详见 **`build/CLIBS.md`**；图形线见 `build/113/NOTES-webgl.md`。

## 三条不可违背
1. **纯客户端计算**：Octave 恒跑在浏览器 wasm 内，禁止任何服务端执行代码的端点。
2. **不 force-push / 不删 git 对象 / 不改历史**；**禁用 `--no-verify`**。
3. **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`，否则 pre-commit 拒提交。

## 验收底线
`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建。
新实验失败不许让它退化；失败就回滚镜像、记录、继续下一批。

## 事实纪律（**每句"现在如此"都要能被复跑的命令证明**）
2026-09-24 一天里抓到 5 处文档说假话，**全都是照抄旧话**造成的：§7 的 shell 口径、
"两个站点逐字节相同"、交付包里套件的项数（写 47、实测 48）、我自己刚写下的
"桥不支持 `plot(…,'parent',…)`"，以及 6 个套件每次全量回归**白等 18 分钟**（无人察觉）。

1. **数值/行为只认实测**，并把**复跑方式写在断言旁边**（`accept-*.mjs` / `probe-*.mjs` / 一条命令）。
   写不出复跑方式的句子，就别写成"现在如此" —— 放进 HISTORY.md 当历史。
2. **口径要成组记录**：改构建/配置就写清**完整那一组**开关（现在重配是
   `WITH_OPENGL=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1`）。漏一个可能**静默退化**
   （漏 `WITH_OPENGL=1` 会让默认 toolkit 掉回 `web`，而构建、链接、自检全绿）。
3. **"能编过 ≠ 能用了"**：碰运行期行为（GL / 字体 / 加载路径 / 资源）的改动，验收必须来自
   **浏览器侧**（探针或 suite 的实测数字）。构建成功 + 产物自检绿**不算**功能验收。
4. **断言要能证伪**：测试里的"替身"不能比真实对象松（拿 figure 句柄冒充 axes 骗过一次）；
   新契约至少配一条**反向**断言（该报错的必须报错），必要时做红-绿对照。
5. **改动前先量当前行为**（`harness/run.sh test/browser/probe-*.mjs`），别信记忆与文档。

## 文档自更新（HANDOFF 是本项目唯一活文档，别让它烂）
- **机器维护的数字别手写**：`HANDOFF.md` 文末 `AUTO:STATE` 区块（部署件 sha、raw/gz 体积、
  最近一次**全绿**回归的套件数与项数、交付包、资产条目）由
  `.githooks/update-handoff.py` 从**持久盘产物**重算；pre-commit 会刷新并 `git add`。**别手改那个区块。**
- **活状态断言必须与产物一致**：`HANDOFF.md` 的头部 + §0–§4 / §6–§8 是活状态，那里的
  sha/套件数/体积一旦与产物矛盾，`.githooks/check-handoff.py` 直接拦提交。
- **历史留在 `HISTORY.md`**（`§5.x`/`§9`/`§10`，append-only）：里面的数字是"当时如此"，
  检查器不查；**不要把历史删掉来"对齐现状"**，也不要把它抄回活状态。
- 活状态里要引用旧值，就在**那一行**写清 `历史` / `退役` / `之前` —— 检查器认这个标记。
- 一段活干完（尤其是 promote / 跑完 sweep 之后）跑一次
  `python3 .githooks/update-handoff.py`；ZCode 的 `Stop` hook 也会自动跑（`.zcode/config.json`）。

## 批次收尾（固定动作，缺一步就等于没做完）
8768 验绿 → promote 到 8761（`build/promote-webgl.sh`，纯资产批则用 `assets.py bundle-m`+`sync-js`）
→ **8761 全量回归**（`sh /mnt/hdd/octave-wasm-build/sweep.sh http://127.0.0.1:8761/`）
→ `sh build/make-dist.sh`（并核对包内 wasm 与部署件同 sha）→ 四道闸门 → 提交 → 推持久盘镜像。

## 提交前
```bash
python3 .githooks/update-readme.py --check   # README 的 AUTO:FILES 要新鲜（pre-commit 会自动重算并 git add）
python3 .githooks/update-handoff.py          # HANDOFF 的 AUTO:STATE 机器块（pre-commit 也会重算）
python3 .githooks/check-handoff.py           # 活状态断言不得与产物矛盾（只查 HANDOFF.md）
python3 .githooks/check-consistency.py       # 挂载点/启动清单/车道路径一致
python3 .githooks/check-wants.py             # 断言可证伪性（裸数字匹配/截断后匹配）
python3 .githooks/check-whitelist.py         # 白名单覆盖
```
⚠️ **闸门有盲区**：`check-whitelist.py` 只看**已暂存**的文件，被 `.gitignore` 忽略且从未
`git add` 的文件它看不见（曾因此漏掉 4 个承重文件）。新增目录后主动看一眼
`git status --short --ignored <目录>`。

## 操作习惯（踩过的，别再来一次）
- **长前台命令会把 ZCode 弄崩**：重活用 `setsid nohup … &` 起，再用 **≤3 分钟**的命令轮询；
  输出一律 `tail -n` / `grep`，别把大段日志灌进上下文。
- **跑验收时别并行干重活**（并发 docker commit / 压缩曾让一个套件假崩）。
- **容器里的构建脚本是另一份拷贝**：改完仓库的 `configure-113-full.sh` / `link-web.sh` /
  `main.cc`，必须 `docker cp` 进容器，否则跑的是旧的。
- 结论只认**产物**：`sha256sum`、`sweep-logs/<时间戳>/`、探针输出；不认印象。
