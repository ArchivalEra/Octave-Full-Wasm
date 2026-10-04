# NOTES · 部件插件契约（wasm64-NEXT 工单 61，2026-10-04 定稿 v1）

> 把 mimalloc 批次（工单 57 实测 → 59 出厂发运）抽象成**声明格式**，让下一个部件替换
> "照单施工"而不是重新发明。规约性质：机制已全部存在（见对照表），本文件定义**组装方式**。
> 硬边界（用户拍板，写死）：**插件只换链接进来的部件（库/旗标/第三方补丁），Octave 自身源码
> 零改动**；缝上必须有两个真实适配器（codebase-design 判据）才许登记。

## 一、声明格式（每插件一条，住 `build/plugins.json`）

```json
{ "name": "<部件名>",
  "lanes": ["w64"],                      // 哪些车道启用
  "knob": "MALLOC",                      // relink.sh 模式表里的旋钮名（唯一口径；禁手设环境变量）
  "applied": "<怎么生效：库序 | 链接旗标 | 第三方源码补丁>",
  "declared_label": {"malloc": "mimalloc"},   // 产物 declared 里的标签（从模式表推出，禁读环境）
  "probe": "<产物侧判据：导出段独有符号 或 输入侧溯源>",
  "witness": ["<build-inputs.json 行>", "<witness 档事实键>"],
  "since": "<哪批引入>" }
```

配套两个机器件：
- **lane_expect**（同文件）：每车道 declared 必须含的插件标签 —— 闸门 R1/R2 的期望面；
- **declared_base_keys**：不算插件的基础键清单（能力面）。

## 二、施工流水线（= component-swap skill 第 2–5 步，此处只列接缝）

1. 模式表加旋钮 → `relink.sh --selfcheck`（表 ↔ link-web 读取面双向）+ `--selftest` 补用例；
2. `mode_declared()` 标签**从表推出**（explain 与真链不分叉）；
3. 消费侧 link-web.sh 两行式（见 `MALLOC_FLAGS` 样板）；
4. 产物探针：部件独有符号 + `--export-if-defined`（`llvm-nm` 验独有性）→
   `write-build-manifest.py` 量 `measured.<键>` → `check-build-manifest.py` **双向**核对；
5. `build-inputs.json` 见证行（旋钮被删 ⇒ DRIFT）+ 产物 witness 档事实（每提交复查）；
6. 候选批（verdict=ok + 全量 `PROBES=1` 含 dldfcn 71/0 + 交错 3×3）→
   发运走 `promote-w64-lane.sh`（8768 先验 → 8761）→ 台账重测（候选键与现役键汇合）。

## 三、闸门（`build/113/plugin-check.py`，已挂 pre-commit；登记表 = `build/plugins.json`）

- **R1 正向**：lane_expect 登记 (键,值) 逐条等于现役产物 declared（旋钮没生效 ⇒ 红）；
- **R2 反向**：declared 出现 `declared_base_keys ∪ lane_expect` 之外的键 ⇒ 红
  （链进去了却没登记——工单 59 `malloc_drift_problem` 的登记层副本）；
- **R3 A/B**（`--ab <dirA> <dirB> --allow <轴>`，按需）：两件 declared 除被测轴外必须全等
  （工单 57 `--diag` 混淆变量 −39% 虚报的机制化）。
- stdout 裸值：`ok` / `PROBLEM:` / `MISMATCH:` / `SKIP:`（站点读不到，明说）/ 未启用退 0。
- 自证 10 条（含零值守卫三类）已登记 `build/gates-selftest.sh`（38 闸门）。

## 四、现役插件清单（登记时刻的快照）

| 插件 | 车道 | 旋钮 | declared | 探针 | 判决 |
|---|---|---|---|---|---|
| e2-openblas | w64, threads | E2_OPENBLAS | `e2_openblas: true` | 输入侧溯源（inputs.blas.resolved_dir） | 已发运（工单 33） |
| mimalloc | w64 | MALLOC | `malloc: "mimalloc"` | 导出段 `mi_version` | 已发运（工单 59） |
| ~~libm 标量替换~~ | — | — | — | — | **负判决**（工单 60：wasm 无标量 FMA，geomean 0.96–0.99） |

## 五、机制对照表（反哺上游前先查这里 —— #9 的教训）

| 层 | 机制 | 出处 |
|---|---|---|
| 输入文本（配方） | build-inputs.json + witness-build-inputs | Einfacht #7 收编 |
| 来源（谁构建的） | tool.script_sha256 + witness-build-provenance | Einfacht #5 witness 档 |
| 产物能力 | octave.build.json declared/measured + check-build-manifest | 本仓 D1/D2 |
| 仪器可信 | calibrate + instruments.json | Einfacht #6 ① |
| 环境活性 | doctor.py + doctor.json | Einfacht #10 收编 |
| 钩子配置载体 | envfile 插件 | Einfacht #8 收编 |
| **插件登记 ↔ 产物** | plugins.json + plugin-check.py | **本契约（R1/R2/R3）** |
