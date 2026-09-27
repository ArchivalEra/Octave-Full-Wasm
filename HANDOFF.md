# HANDOFF · Octave-Full-Wasm（给 AI 的接续说明 · **瘦身版**）

> **唯一目的：抗上下文压缩**。新会话只读这一份 + 几个指向文件就能接着干。
>
> **文档分层**（别混）：
> · **本文 = 活状态**（现在是什么 / 下一步）；活状态断言必须与产物一致，`check-handoff.py` 会拦。
> · **`build/113/PLAN-arch.md` = 当前工作令**（A0–A4 架构深化 + F1–F4 事实系统的批次、判据、回退点）。
> · **`HISTORY.md` = 历史**（append-only，`§5.x`/`§9`/`§10`；正文里单写的这些编号都指它）。
> · **`CONTEXT.md` = 术语表**（17 条术语 + 一行可复跑的证据）—— **看不懂黑话就读它**。
> · 分类坑：`build/CLIBS.md`（C 库）、`build/113/NOTES-jspi.md`、`build/113/NOTES-threads.md`、
>   `build/113/NOTES-webgl.md`；翻案台账 `build/lib/retractions.json`；事实台账 `build/FACTS.json`。
> **⚠️ 本文瘦身前的 1034 行全文在 `git show 76176bb:HANDOFF.md`**（删掉的表格/清单都在那儿）。

---

## 0. 现在是什么（2026-09-27）

- **8761 = 现役构建**（A2 产物，带产物身份证 `octave.build.json`），开机自检 1.7s，
  三处 parity `--strict` 绿（8761 / 8768 / 仓库 `site/`）。
  ⚠️ **本文件正文不写任何"测出来的数字"** —— sha / 体积 / 回归套件数在文末的
  `AUTO:STATE`，其他实测事实（SIMD 判据、导出名字数、环境变量条数…）在文末的 `AUTO:FACTS`，
  正文只写**台账的键名**（这是 F2 收尾的规矩，`.githooks/check-facts.py` 会拦手抄）。
- **架构深化 D1–D6 全部落地**（A0–A4）：重链有唯一入口 `build/113/relink.sh`（模式决定全部
  环境变量，条数见 `build/FACTS.json` 的 `env_vars`）；页面层是**一内核两适配器**
  （`bridge/octave-core.js`）；测试契约搬进仓库（`build/sweep.sh` + `test/browser/manifest.json`）；
  术语表 `CONTEXT.md`。
- **事实系统 F1–F3 已落地，F2 已收尾**（"保句子为真"的机械）：
  · **F1 闸门自证台**：`build/lib/gate.py` + `build/gates-selftest.sh` —— **每个闸门都必须能
    证明自己"会红"**（零值守卫 + `GATE_REPO` 根注入 + `--selftest`），**接在 pre-commit 上**；
  · **F2 事实台账**：`build/facts.py` → `build/FACTS.json`（每条带复跑命令）→ 渲染成
    `AUTO:FACTS` 块（**数字的唯一产地**）；`.githooks/check-facts.py` 四条规则：块与台账一致 /
    正文不许裸数字 / 引用的键必须存在 / 台账不许过期；
  · **F3 翻案台账**：`build/lib/retractions.json` + `.githooks/check-retractions.py`
    （被推翻的断言重新出现且无更正标记 ⇒ 红）。
- 产物能力**从身份证读，别背**：`site/octave.build.json` 的 `measured.*`
  （`simd.v128`、`exported_functions`、`fonts`、`jspi_entry`、`gl4es`、`idbfs`、`fontconfig`）。

## 1. 下一步（按此顺序）

1. ✅ **F2 收尾（2026-09-27 落地）**：数字**只在** `AUTO:FACTS` 块里生产（`build/facts.py
   --render-doc`，pre-commit 重算），正文引用台账键名。闸门从"抄了要抄对"升级成四条：
   块与台账一致 / 正文不许裸数字 / 引用的键必须存在 / **台账不许过期**（promote 后忘跑
   `facts.py` ⇒ 红）。
2. ✅ **F4 探针输入契约（2026-09-27 落地）**：选片逻辑搬进 `build/lib/sweep_select.py`
   （纯函数 + 14 条自证）；清单新增 `inputs` 段，5 个"产物在仓库外"的探针登记完，
   缺输入**跳过并报明缺什么**。实测 `PROBES=1` 选中 68 个套件、按清单跳过 16 个（全是 manual），
   跑完全绿；**accept-only 口径**（验收底线那对数字）见 `build/FACTS.json` 的
   `accept_suites` / `accept_pass`，全量合计（含探针/基准）见文末 `AUTO:STATE` 那一行的括号。
   `--check-inputs` 一行回答"要跑全套我缺什么"。
3. **B6 线程版构建 —— 等你拍板**（⛔ 本轮不做）：实测**多线程不歧视 Firefox**（有 COI 时两引擎跑
   pthread 产物平齐 `ok=100 / missing=0`），线程版 BLAS 收益大（DGEMM N=2000 **T=8 = 7.2×**）。
   卡点是产品取舍：**要不要为多线程要求宿主发 COI 头**（`coi-serviceworker` 实测三引擎都能拿到
   COI + SAB，但页面从此不能引跨源 CDN 资源 —— 本站不引）。前置/成本见 `PLAN-arch.md` §2 B6。
4. **E2 悬案（可选）**：把线程版 BLAS 链进 Octave 的最后一步。**根因已锁定**：不是重复定义、也不是
   Fortran 接口，而是**子程序返回类型**（f2c 的 `-> i32` vs OpenBLAS 的 `-> void`，wasm-ld 的警告
   原文写了）。两条修法（给 `interface/*.c` 加 `int` 返回且**必须** `return 0;` / 符号改名 + 薄包装）
   见 `NOTES-threads.md` 末两节。

## 2. 铁律（违反会被拦或返工）

**路径**：仓库 `/mnt/hdd/zcode-projects/Octave-Full-Wasm`（**唯一**可改的 git 仓）；
构建容器 docker **`o113`**；第三方产物 `/mnt/hdd/octave-wasm-build/`；
不常用工具链/一次性浏览器下载 `/mnt/hdd/crossbuild-tools/`（playwright 浏览器在 `pw-browsers/`）；
**禁止**碰课程仓 `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917`。

**三条不可违背**：① **纯客户端计算**（Octave 恒跑在浏览器 wasm 内，禁止任何服务端执行端点）；
② 不 force-push / 不删 git 对象 / 不改历史；**禁用 `--no-verify`**；
③ **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`。

**验收底线**：`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建；新实验失败不许让它
退化（回退：`cp site/octave.{wasm,js,data} siteWebGL/`，或站点备份目录）。

**事实纪律（5 条；F1–F3 之后已部分机器化）**：
1. 数值/行为**只认实测**，复跑方式写在断言旁边；写不出复跑方式的句子只能当历史。
2. **口径成组**：重配 = `WITH_OPENGL=1 WITH_GL2PS=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1` **一整组**；
   重链口径由 `build/113/relink.sh` 的模式表推出（`explain <模式>` 打出来就是口径），
   `relink.sh --selfcheck` 保证"模式表覆盖 link-web.sh 读的每个变量"。
3. **"能编过 ≠ 能用了"**：碰运行期行为（GL / 字体 / 加载路径 / 资源）必须**浏览器侧**实测。
4. **断言要能证伪**：新契约至少配一条**反向**断言（该报错的必须报错）；行为变了就**翻面**
   （改断言，别改检查器）。
5. **断言有生命周期**：活状态只写**实测**；**推断**写进 `NOTES-*.md` 并注明"哪个实验能结案"；
   被推翻的断言登记进 `build/lib/retractions.json`。

## 3. 提交前（六道闸门 + 闸门自证 + 一致性闸门）

```bash
python3 .githooks/update-readme.py --check   # README 的 AUTO:FILES 新鲜
python3 .githooks/update-handoff.py          # HANDOFF 的 AUTO:STATE 机器块
python3 .githooks/check-handoff.py           # 活状态断言不得与产物矛盾（只查 HANDOFF）
python3 .githooks/check-consistency.py       # 挂载点/启动清单/页面依赖/CONTEXT 证据行
python3 .githooks/check-wants.py             # 断言可证伪性
python3 .githooks/check-whitelist.py         # 白名单覆盖
python3 .githooks/check-retractions.py       # 翻案重现检测（F3）
python3 .githooks/check-facts.py             # 事实闸门（F2）：块/裸数字/键/过期 四条规则
sh build/gates-selftest.sh                   # ★ 每个闸门必须都能证明自己"会红"（F1）
```
⚠️ **闸门有盲区**：`check-whitelist.py` 只看**已暂存**的文件 ⇒ 被忽略且从未 `git add` 的它看不见
（曾因此漏掉 4 个承重文件）。新增目录后主动看 `git status --short --ignored <目录>`。
⚠️ **改数字 / 写被翻案的断言会让 F2、F3 的闸门变红 —— 那是设计行为**（改文档，别关闸门）。

## 4. 硬坑（踩过的，别再来一次）

- ★ **禁止使用 `sleep`**（任何形式，含 `sleep 3 && …`）：ZCode 的前台预算会把普通长命令转后台
  救活，**只有 `sleep` 开头的会被直接杀掉**（等待反而把工作弄丢）。长任务用
  `run_in_background: true` 起（后台无超时）或 `setsid nohup … &`，靠**完成通知**或
  `tail -f --pid=<pid> <日志>` 收尾；已后台化的任务**绝不重跑**。输出只 `tail -n`/`grep`。
  **跑验收时别并行干重活**（并发压缩曾让套件假崩）。
- **测试用例从仓库原路径直跑**：`cd /mnt/hdd/octave-wasm-build/harness && sh run.sh <仓库里的 .mjs> <URL>`
  —— `import 'playwright-core'` 按**脚本所在目录**解析 ⇒ 必须由 runner 现拷一份（别自己留副本）。
- ★ **跑测试前先验产物 SHA**：`check-deploy-sha.sh` + `probe-artifact-sha.mjs`（磁盘 / HTTP / 页面自证三层）。
- **容器里的构建脚本是另一份拷贝**：改完仓库的 `link-web.sh` / `configure-113-full.sh` / `main.cc`
  必须 `docker cp` 进去（`link-web.sh` 自己会编 `main.cc`）。
- **别猜挂载点**：逐字读 `build/assets-meta.json`（`pkgfix`=`/usr/src/octave/m/pkg`、
  `plotbridge`=`/usr/src/octave/m/plotbridge`）；少写一层会把桥文件铺到 `m/` 根上。
- **探测/自检不许放在开机路径上**（坏产物会让整页卡死）；探测器要**按需触发 + 带超时**。
- **JSPI × dlopen 三条机制**（详见 `NOTES-jspi.md`）：链里有 dlopen ⇒ 上游入口可能挂起、不能同步调；
  **顺序即机制**；启动路径上碰 dlopen 会让页面起不来。**`Module.execute_interp()` 之前不许碰解释器**。
- **shell 陷阱**（本会话反复咬人，注释与各闸门里都有）：`pkill -f 'x'` **会匹配到自己这条命令行**
  （用 `'x[y]'` 括号技巧）；`rc=$?` 接在管道后拿的是最后一个命令的状态；`&&` 放在 `&` 前会把整条链
  后台化；`echo` 里的反引号会被当命令替换；`grep -c` 零命中**退出 1**；`grep -E` 里 `{` 是区间表达式；
  正则字符类漏数字（`[A-Z_]+` 匹配不到 `P5_OBJS`）；`-sENV=…` 不是 emcc 5.0.7 的设置项。
- 结论只认**产物**：`sha256sum`、`sweep-logs/<时间戳>/`、探针输出、`FACTS.json`；不认印象。

## 5. 批次收尾（固定动作）

`sh build/glue-selftest.sh`（91 项，宿主秒级）→ **8768 验绿**（`sh build/sweep.sh http://127.0.0.1:8768/`）
→ promote 8761（`build/promote-webgl.sh`；**M2 车道必须 `GL_OUT=$SRC_OUT`**）
→ `sh build/check-boot.sh http://127.0.0.1:8761/` → **部署件 SHA 三层**
（`check-deploy-sha.sh` + `probe-artifact-sha.mjs`）→ **同步仓库 `site/`**
（`rsync -a --delete /mnt/hdd/octave-wasm-build/site/ site/`；`check-site-parity.sh --strict` 核三处一致）
→ **8761 全量**（`sh build/sweep.sh http://127.0.0.1:8761/`，每批再跑一次 `PROBES=1`）
→ `sh build/make-dist.sh`（核对包内 wasm 与部署件同 sha）→ §3 的闸门组 → 提交。
**8761 在 promote 之前一动不动。**

---

## 附 · 机器维护的区块（**自动生成，别手改**）

### 实测事实台账（**活状态文档里数字的唯一产地**）

<!-- AUTO:FACTS -->
> 本区块由 `build/facts.py --render-doc HANDOFF.md` 从 `build/FACTS.json` 渲染，**不要手改**（pre-commit 会重算并 `git add`）。
> **活状态文档里的「测出来的数字」只在这里生产**：正文要引用就写 `build/FACTS.json` 的键名（例如 `wasm_v128`），别手抄数字。
> `.githooks/check-facts.py` 三条规则：块必须与台账一致 / 正文不许出现裸数字 / 引用的键必须存在。

| 键 | 值 | 复跑命令 |
|---|---|---|
| `accept_pass` | **1076**（最近一次**全绿**扫描的 PASS 合计） | `同上，把每个套件的 PASS 相加` |
| `accept_suites` | **43** | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20260927-092416 里带汇总行的套件（且 0 FAIL）` |
| `build_json_sha` | `d953d7a7929754be…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json` |
| `data_sha` | `f250530ae5abe378…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data` |
| `env_vars` | **23** | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh \| sort -u（去掉位置参数）` |
| `exported_functions` | **710**（M2 保活集大小（M1 约 44987）） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` |
| `fonts_count` | **8** | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` |
| `js_sha` | `caac68bf62015859…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js` |
| `jspi_entry` | 是（B 姿势的可挂起入口在不在） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html` |
| `wasm_bytes` | **29632229** | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_sha` | `1ed3e528561e4475…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_v128` | **4752**（SIMD 判据；非 SIMD 那版是 0） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` |

台账生成时间 `2026-09-27T09:46:00+0800`；每条的值/出处/复跑命令都在 `build/FACTS.json` 里。
<!-- /AUTO:FACTS -->

### 部署状态

<!-- AUTO:STATE -->
> 本区块由 `.githooks/update-handoff.py` 重算，**不要手改**（pre-commit 会刷新并 `git add`；pre-push 会 `--check`）。

| 项 | 值 |
|---|---|
| `octave.wasm` | 29,632,229 B raw / 7,083,341 B gz | sha256 `1ed3e528561e4475…` |
| `octave.js` | 462,821 B raw / 89,652 B gz | sha256 `caac68bf62015859…` |
| `octave.data` | 9,712,174 B raw / 3,155,047 B gz | sha256 `f250530ae5abe378…` |
| 三大件 gzip 合计 | **10,328,040 B** | |
| 资产条目 | 49 | |
| 最近一次**全绿**回归 | `20260927-092416` · **43 套 / 1,076 PASS / 0 FAIL**（同日 PROBES=1 另跑：探针 23 套 / 210 PASS、基准 2 套（按契约无汇总行）） | http://127.0.0.1:8761/ |
| 交付包 | `octave-full-wasm-site-20260926` · tar.zst 27,262,406 B · `5b3fe9ae55645937…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `Slay`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->
