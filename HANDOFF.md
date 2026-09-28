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

## 0. 现在是什么（2026-09-28）

- **8761 = 现役「双档」站点**：根目录基础档 + `threads/` 线程档，**带头服务**（`build/serve-coi.py`）
  ⇒ 页面按 COI 选**线程档**（实测 `probe-artifact-sha` 2/0：实例化的正是 `threads/octave.wasm`）。
  sha / 体积 / 回归数字都在文末 `AUTO:STATE`；其他实测事实在 `AUTO:FACTS`（源 = `build/FACTS.json`，
  每条带复跑命令）。正文只写**台账的键名**（F2 的规矩，闸门会拦手抄）。
- **B6（双档 + COI）已收尾并上线**（branch `threads` 已合并到主干工作流；工作令 = `PLAN-threads.md` §6）：
  · **三套矩阵全绿**：线程档（8768 带头 + `PROBES=1`）、基础档（8770 不带头）、**8761 部署态**
    （带头 ⇒ 页面跑线程档）各跑一遍，逐套日志留档在 `sweep-logs/`；**套件数与 PASS 一律看台账**
    （`accept_suites` / `accept_pass`，口径 = 最近一次全绿扫描；逐档当时的数字见 `HISTORY` §5.64）；
  · 首跑暴露的**七条红**逐条查清并修好（真因与判据见 `NOTES-threads.md` 的四段机制 + `PLAN-threads.md`
    §6 的坑 10–13）：清单只改 URL 不改 sha、车道清单照抄 install 前缀、pthread `.oct` 引用
    `__cxa_guard_*`、slicot 少链 `common.oct.o`、选档只传给第一个上下文（worker / 第二实例）；
  · 产物：`threads_verdict` / `threads_shared_memory` / `threads_pthread_glue` / `threads_v128` /
    `threads_blas_dir` / `threads_wasm_sha`（都在 `AUTO:FACTS` 里，别背数字）；
  · `.oct` 两档分好：`oct_lane_tls_init` / `oct_lane_files` / `oct_lane_octdir_files`，基础档同条数
    （`oct_base_files` / `octdir_base_files`）；
  · **`test/browser/probe-lane.mjs` 全绿**（PASS 数见 `build/FACTS.json` 的 `probe_lane_pass`，
    FAIL = `probe_lane_fail` 必须为 0）：带头选线程档 + `caps.sharedMemory === true`、
    不带头落基础档照常 ready、`?lane=base` 覆盖生效、**没 COI 强选线程档硬失败**。
- **线程档的两条已知边界（都钉了断言，改回去会红）**：
  · **worker 宿主自动落基础档**（`?worker=1` 或缺省的手搓 `new Worker`）：线程产物在
    DedicatedWorker 里当主宿主**起不来**（`Module.eval_string is not a function`，实测）；
    显式 `?lane=threads&worker=1` 仍选线程档并**硬失败**（不静默降级）。
  · **同页多实例是支持的**（13/0），但**前提是每个实例都拿到页面的选档计划** —— 少传一个就是
    "线程胶水 + 基础产物"的错配（`eval_string` 缺席）。
- ★ **现役线程档 = E2（OpenBLAS，`USE_THREAD=0` 的交付形态）**，2026-09-28 上线：
  `threads/` 那份产物**就是 OpenBLAS**（BLAS 来源见台账 `threads_blas_dir`，收益见
  `e2_matmul500_ratio` / `e2_lu800_ratio`）。
  ⚠️ **别把「E2 上线」读成「数学已并行化」**：上线的是**单线程**形态 —— 收益来自 OpenBLAS 的内核，
  不是多线程；**线程版仍不可用**（`e2_threaded_oct_rc`），"为什么"未结案 ⇒ 工单 02。
  **基础档本次一字未换**（`wasm_sha` 逐字节未变，promote 的 §1b 判据核过）⇒ 这是一次
  **只换线程档**的换产物。
- 现役 farm（`/usr/local`、`/src/deps`）**一字未动**（实测仍 100% 缺 atomics）；车道在
  `/usr/local-threads` + `/src/deps-threads`；两档 prefix 分开是硬要求。
- 事实系统：`build/FACTS.json`（源）+ `AUTO:FACTS`（渲染）+ 翻案台账 `build/lib/retractions.json`
  （本轮新增 R-009：更正了「每个对象都必须带 atomics」这句过度概括）。

## 1. 下一步（按此顺序）

**E2（单线程形态）已上线 2026-09-28**：8768 验绿（套件数 / PASS 见 `accept_suites` / `accept_pass`，
全 0 FAIL）→ promote（只换线程档）→ boot → SHA 三层 → 台账 `threads_*` 那几条按实测**接受改口**。
⇒ 下一步两条线：

1. **多线程版（独立课题，收益最大：小尺寸见 `e2_threaded_matmul500_ratio`）** —— 按工单 **01 → 02** 走：
   · **01** = 把诊断/额外导出这类旗标收进 `relink.sh` 的模式表（`explain` 打得出来、`--selfcheck`
     覆盖得到）。它是 02 与 03 的**共同前置**，本身不碰产物；
   · **02** = 线程版在 dlopen 的 `.oct` 路径上不返回的**定位**。
     ⚠️ **第一步是一次重链** —— 三个产物的导出表里**一条 BLAS 都没有**（实测，见工单 02），
     所以「页面里先 `openblas_set_num_threads(1)`」今天敲不下去，得先把那个符号导出来。
     ⇒ 这次重链可**顺带做掉工单 11**（B5 worker 渲染后端），省一次 29MB。
2. **wasm64**：需求书 + 容器内实测在 `build/113/PLAN-wasm64.md`，工单 **14**，交外部 agent 在**新分支**做。
   结论方向已定：**不是工具链挡的，挡的是引擎版本**（容器内 node 22 装不进、宿主 node 26 跑得动，
   memory64 的 side module + dlopen 与 wasm32 对照行为一致）。**不动 8761/8768。**
3. **其余前沿**（各自独立、互不阻塞）：工单 04（UMFPACK 整页陷阱）、05（JSPI G1 真因）、
   08（外审 4 项补判据）、10（Firefox COI 矛盾）；需要设备的 07 / 12 / 13。
   **不要与上面那次重链并行**（本仓实测过并发会让套件假崩）。

**本轮顺带发现并登记的**：工单 **15** —— `relink.sh verify --out <副本>` **假红，并把 `verdict`
写成 `rejected`**（根因：`check-build-manifest.py` 的配对检查按身份证里记录的 `build.out` 找兄弟文件，
而 `cmd_verify` 不转发 `--out-dir`）。⇒ **验副本必须在产物原位验。**

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
| `accept_pass` | **1077**（最近一次**全绿**扫描的 PASS 合计） | `同上，把每个套件的 PASS 相加` |
| `accept_suites` | **43** | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20260928-084847 里带汇总行的套件（且 0 FAIL）` |
| `build_json_sha` | `d953d7a7929754be…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json` |
| `data_sha` | `f250530ae5abe378…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data` |
| `e2_lu800_ratio` | **1.4** | `上面两行的比值（车道 / E2）` |
| `e2_lu800_s` | **0.043** | `同 E2 那一行` |
| `e2_matmul500_ratio` | **1.9** | `上面两行的比值（车道 / E2）` |
| `e2_matmul500_s` | **0.021** | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` |
| `e2_single_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` |
| `e2_single_wasm_bytes` | **29495868** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` |
| `e2_threaded_lu800_s` | **0.02** | `同上` |
| `e2_threaded_matmul500_ratio` | **6.7** | `车道 / 线程版（派生）` |
| `e2_threaded_matmul500_s` | **0.006** | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` |
| `e2_threaded_oct_rc` | **124** | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` |
| `e2_threaded_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` |
| `e2_threaded_wasm_bytes` | **29908917** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` |
| `env_vars` | **28** | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh \| sort -u（去掉位置参数）` |
| `exported_functions` | **710**（M2 保活集大小（M1 约 44987）） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` |
| `fonts_count` | **8** | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` |
| `js_sha` | `caac68bf62015859…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js` |
| `jspi_entry` | 是（B 姿势的可挂起入口在不在） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` |
| `lane_lu800_s` | **0.06** | `同车道那一行` |
| `lane_matmul500_s` | **0.04** | `现役车道站点跑同一个 bench-core.mjs` |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html` |
| `oct_base_files` | **16**（基础档 `assets/oct/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' \| wc -l` |
| `oct_lane_files` | **16**（线程档 `assets/oct-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct-threads -name '*.oct' \| wc -l` |
| `oct_lane_octdir_files` | **28**（线程档 `assets/octdir-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-threads -name '*.oct' \| wc -l` |
| `oct_lane_tls_init` | **44**（每个都必须有（没有在线程档里 dlopen 会 tlsInitFunc 不是函数）；分母见 oct_lane_files + oct_lane_octdir_files） | `python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads --base <站点>/assets/oct <站点>/assets/octdir` |
| `octdir_base_files` | **28**（基础档 `assets/octdir/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' \| wc -l` |
| `probe_lane_fail` | **0** | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `probe_lane_pass` | **17**（双档探针的 PASS 数（FAIL 必须 0）） | `SITE_DIR=siteWebGL sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` |
| `threads_blas_dir` | **/src/work/e2-openblas-lib-s**（**必须含 `-threads`**（判据见 check-build-manifest.lane_blas_problem）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 inputs.blas.resolved_dir` |
| `threads_exported_functions` | **725** | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.exported_functions` |
| `threads_pthread_glue` | **54**（基础档实测是 0） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.pthread_glue` |
| `threads_shared_memory` | 是（wasm 内存段的 shared 位；线程档的硬身份） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.shared_memory` |
| `threads_v128` | **4926**（线程档也带 SIMD（两轴不互斥）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.simd.v128` |
| `threads_verdict` | **ok**（只有 ok 才可部署（fail-closed）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 verdict` |
| `threads_wasm_bytes` | **29495868** | `stat -c%s /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` |
| `threads_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` |
| `wasm_bytes` | **29632229** | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_sha` | `1ed3e528561e4475…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_v128` | **4752**（SIMD 判据；非 SIMD 那版是 0） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` |

台账生成时间 `2026-09-28T09:44:19+0800`；每条的值/出处/复跑命令都在 `build/FACTS.json` 里。
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
| 最近一次**全绿**回归 | `20260928-084847` · **43 套 / 1,077 PASS / 0 FAIL**（同日 PROBES=1 另跑：探针 24 套 / 227 PASS、基准 2 套（按契约无汇总行）） | http://127.0.0.1:8761/ |
| 交付包 | `octave-full-wasm-site-20260928` · tar.zst 50,063,501 B · `8d2b49c1dfd6922a…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `open-questions`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->
