# 53: **构建输入的不变式**当作事实（Einfacht #6 ② 落地）—— 不是外挂 build-doctor

**What to build:** 用户点破一个我本来想歪的方向：编译工具包**脱离事实系统**就会变成又一个
自带"我以为的构建状态"的组件——幻觉温床。正解 = **把构建的输入（配方/旗标/环境）当成事实**，
走已落地的四档（replay / witness / calibrate / first_seen），由**同一批复跑闸门**每提交核对。
上游 Einfacht #6 ② 已把原则写进 `collect.py`：**「输入要有便宜的落点」**。本单 = 它的本仓实例。

**Blocked by:** None

**Status:** resolved（2026-10-03：声明式清单 + 见证 + 事实键落地；真仓证伪测试通过）

**Settling:** `python3 build/113/witness-build-inputs.py` ⇒ `ok`（或 `DRIFT: …`）；
证伪测试：往 `build/113/link-web.sh` 的 `EXC_FLAGS` 塞 `-flto` ⇒ 必须 `DRIFT`（已实测）；
自证 `--selftest` 5/0（含"该报/零值守卫/空清单"反向）。

## Answer

（2026-10-03 结案。）

**形状（数据不是代码）**：
- `build/build-inputs.json` —— 声明式检查项：`{path, must_contain, must_not_contain, why}`。
  现覆盖三条：`link-web.sh` 无 `-flto` 且含 `-fwasm-exceptions`；`build-w64-lane.sh` /
  `build-e2-lane.sh` 含 `-sMEMORY64=1`。
- `build/113/witness-build-inputs.py`（自证 5/0）—— **只读配方文件、不构建、不碰容器**
  ⇒ 进 `witness` 档每提交真跑。判据 stdout 裸值：`ok` / `DRIFT: …`；`--selftest` 覆盖
  "该报必须报 / 读不到必须报 / 空清单必须报"。
- 事实键 **`w64_build_recipe_ok`**（挂该见证）+ 既有 **`w64_build_tool_match`**（产物侧）。

**两条互补，别混**：
| 键 | 查什么 | 时机 | 真实事故 |
|---|---|---|---|
| `w64_build_tool_match` | 部署件记的 `tool.script_sha256` == 仓库现役 `link-web.sh` | **事后**（产物已生） | `-flto` 漂移（工单 41/52） |
| `w64_build_recipe_ok` | 仓库**配方**本身有被证伪片段 / 缺必需旗标 | **事前**（产物未生） | `-flto` 在脚本里、丢 `-sMEMORY64=1`（工单 52） |

**证伪测试（实测，非声明）**：临时把 `-flto` 塞进 `link-web.sh` 的 `EXC_FLAGS` ⇒ 见证当场
`DRIFT: build/113/link-web.sh 出现被证伪的片段 '-flto'`；还原 ⇒ `ok`。

**为什么必须挂在事实系统上**（本单的设计要点）：一个脱离事实系统的"build-doctor"会**自带**
一套关于构建状态的说法，而那套说法不可复跑、不可证伪、不与产物对账——**又一次制造"照抄旧话"
的温床**。输入侧不变式走同一批四档 + 同一批复跑闸门，才拿到"可复跑 / 可证伪 / 可登记"的资格。
