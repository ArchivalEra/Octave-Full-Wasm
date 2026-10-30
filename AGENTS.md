# AGENTS.md · Octave-Full-Wasm

本文件是**在本仓工作的操作契约**。它只写三件事：不可违背的规则、去哪里找事实、踩过的坑
（哪些动作会静默失败）。

**不写**执行顺序、命令清单、历史事故的完整叙述 —— 那些分别在：
- **怎么跑**：`build/` 下的脚本自己就是文档（`relink.sh explain <模式>`、各脚本 `--selftest`）
- **为什么这样**：`HISTORY.md`（append-only，§5.x 编号）
- **现在是什么**：`STATE.md`
- **黑话**：`CONTEXT.md`

> 若本文件与脚本行为冲突，**信脚本**（它是可执行的），然后修本文件。

---

## 一、不可违背（违反即回滚）

1. **纯客户端计算**：Octave 恒跑在浏览器 wasm 内。**禁止任何服务端执行代码的端点。**
2. **不 force-push、不删 git 对象、不改历史**；**禁用 `--no-verify`**。
3. **课程仓 `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917` 只读 + 只投信**
   （2026-10-30 用户点令放行投递）。**可写**：它 `mail/` 里新增信件（投递 = 落文件，
   不提交、不推它仓）。**不可写**：它的其余任何路径、它的 git 提交。
   原因：它是外部消费者，有自己的维护者 —— 我们只与它通信，不替它改代码。

## 二、路径（唯一可改的仓与它的邻居）

| 位置 | 是什么 |
|---|---|
| `/mnt/hdd/zcode-projects/Octave-Full-Wasm` | **唯一可改的 git 仓** |
| `/mnt/hdd/octave-wasm-build/` | 站点、产物、日志、镜像仓（非 git 仓，可写） |
| `/mnt/hdd/crossbuild-tools/` | 一次性工具链、playwright 浏览器 |
| docker 容器 `o113` | 11.3.0 车道的构建环境 |

## 三、三线模型（分档只由两件事决定）

| 线 | 产物 | 门槛 |
|---|---|---|
| **`wasm32-final`** | wasm32 单线程 | **无** —— 无 COI 环境下的唯一线 |
| **`master`** | wasm64 多线程 | 必须 COI + 多线程 |
| **`IllegalPerformance`** | wasm64 多线程 + Rust 补丁 | 必须 COI；**non-free** |

**分档依据只有两条**：① 用户能否使用（浏览器支持 / COI 要求）② 是否作为 non-free 软件。
**与性能无关。**

站点只显示两格：`base`（wasm32）与 `w64`（wasm64）。`threads` 与 `w64-base` 是**死档**，
任何地方出现都是缺陷（机器判据：`build/113/check-lane-purity.py`）。

**新实验 = 新分支，不许往站点加格。**

## 四、事实纪律

**每句"现在如此"都必须能被一条复跑命令证明。** 照抄旧话是文档说假话的唯一来源。

1. **数字只认实测**，且**复跑方式写在断言旁边**。写不出复跑方式的句子 ⇒ 只能进 HISTORY
   当历史，不许留在活状态文档里。
2. **数字的唯一产地是台账**：`build/FACTS.json`（每个键自带 `cmd`）。文档正文写
   `[[键名]]` 引用，**不手抄数字**（闸门 `check_facts.py` 会拦裸数字）。
3. **"能编过 ≠ 能用了"**：碰运行期行为（GL / 字体 / 加载路径 / 资源）必须**浏览器侧**实测。
   构建成功 + 产物自检绿**不算**功能验收。
4. **断言要能证伪**：每个闸门必须带 `--selftest`，且三类用例齐备 ——
   **正常不报 / 该报的必须报 / 空输入必须报**。证不出会红的闸门不算闸门。
5. **推断与实测分开**：推断写进 `build/113/NOTES-*.md` 并注明**哪个实验能结案**；
   被推翻的断言登记进 `build/lib/retractions.json`（闸门会在它重现时报错）。

## 五、验收底线

`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建。新实验失败**不许**让它退化。

**换产物 / 改线程数 / 改 GL / 改资源**的批次，进件前必须跑一次全量（`PROBES=1`）。
只跑几个"数值套件"不算候选 —— 曾经这样放过一个 `dlopen` 回归（HISTORY §5.71）。

**每批固定动作**（细节在脚本里，不在这里复述）：

```bash
sudo -E $(which python3) build/lib/doctor.py      # 预检，stdout 必须是 ok
sh build/sweep.sh http://127.0.0.1:8768/           # 实验站先绿
sh build/promote-pages.sh                          # 或 promote-webgl / promote-w64-lane
sh build/check-boot.sh http://127.0.0.1:8761/      # 不过就别往下走
sh build/check-deploy-sha.sh <站点> <sha> <URL>    # 磁盘/HTTP/页面自证三层
sh build/sweep.sh http://127.0.0.1:8761/           # 与 PROBES=1 各一次
sh build/check-site-parity.sh --strict             # 8761 / 8768 / 仓库 site/ 一致
```

**8761 只由受管辖的 promote 脚本改**（`promote-webgl.sh` / `promote-w64-lane.sh` /
`promote-pages.sh`，按批次类型选）。实验只写 `siteWebGL/`。

## 六、mail 边界

跨 agent 通信是**收件箱制**：

1. **投递落点 = 收信方的 `mail/`**（不留在发信方自己仓）。
2. **只读自己仓的 `mail/`** —— 不读别仓的 `mail/`（那是别人的私人往来，哪怕对方仓是 public）。
3. 本仓收件箱由 `.githooks/check-mail-boundary.py` 守：`**To:**` 必须指名本仓。

**外部消费者也按同一套走**（2026-10-30 用户点令）：课程站已建 `mail/`，信直接投它仓
`mail/`（`**To:**` 指名它）；它回信投我方 `mail/`。上面三条规则的**前提只是"对方有信箱"**，
不是"对方在 coalition 内"。

`/mnt/hdd/octave-wasm-build/outbox/` 是**备用**落点 —— 只在对方还没建信箱时用。

## 七、提交前

**执行面只有一个产地**：`python3 zreflect/registry.py --run commit` 会跑所有
`runs_at="commit"` 的闸门。**别 glob `check_*.py`，别手写清单**。

```bash
. reflect-hooks/Einfacht.env                       # 旋钮（唯一可复现来源）
python3 zreflect/registry.py --run commit          # ran / off / failed 三档
sh gates-selftest.sh && sh build/gates-selftest.sh # 证明每个闸门能红
```

**"全绿"不许把"没跑"算进去** —— `off` 是没查，不是通过。
`check_facts.py` 会拦：文档里的裸数字、块与台账不一致、坏引用。

## 八、会静默失败的坑

这些动作**不报错**却结果错误。每条都踩过。

- ★ **禁止使用 `sleep`**（任何形式）。ZCode 的前台预算到点会把命令转后台，
  唯独 `sleep` 开头的直接被杀。长任务用 `run_in_background: true`；盯已有进程用
  `tail -f --pid=<pid>`。**已后台化的任务绝不重跑。**
- ★ **容器里的构建脚本是另一份拷贝**。改完仓库的脚本/`main.cc` 必须 `docker cp` 进容器，
  否则跑的是旧的。
- ★ **"赋值了但没被引用"的旗标会静默失效**。改旗标组之后必须有一条**从产物里读出来**的自检。
- ★ **`Module.execute_interp()` 之前不许碰解释器**（`eval_string`/`feval` 全抛 `null function`）。
  开机路径上的探测必须 `try/catch`，否则 `__octaveReady` 永远 false —— 页面看起来"卡死"。
- ★ **`addpath` 读的是 MEMFS，不是站点 HTTP 目录**。要让 Octave 看见的文件必须先写进 MEMFS。
- ★ **别猜挂载点**：`assets.py bundle-m` 的挂载点逐字读 `build/assets-meta.json`。
  少写一层会把整棵核心 m 树摘掉。
- ★ **测 dlopen 必须每次用全新页面**（同一页第二次调用结果不可信）。
- **探测/自检不许放在开机路径上**：坏产物会让整页卡死，连带所有验收全挂。
- **shell 陷阱**：`pkill -f 'x'` 会匹配到自己（用 `'x[y]'`）；`rc=$?` 接管道拿的是最后一个命令；
  `&&` 放 `&` 前会把整条链后台化；`grep -c` 零命中退出 1。
- **结论只认产物**：`sha256sum`、`sweep-logs/<时间戳>/`、探针输出。不认印象。

## 九、Agent skills

- **工单**：`.scratch/open-questions/issues/NN-*.md`（本地 tracker，不用 GitHub Issues）。
  活状态在 `STATE.md`；工单只装"未结案"。
- **Triage 标签**：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` /
  `wontfix` / `resolved`，写在头部 `**Status:**` 行（只写角色词，解释写在下一行）。
  见 `docs/agents/triage-labels.md`。
- **悬案台账**：一条悬案 = 一张工单，且**必须挂一个可跑的结算件**（头部 `**Settling:**` 行）。
  写不出结算件的，降级成 `NOTES-*.md` 里的猜想。见 `docs/agents/issue-tracker.md`。
- **领域文档**：根 `CONTEXT.md`（术语表）。见 `docs/agents/domain.md`。
