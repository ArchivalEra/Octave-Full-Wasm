# 61: **部件插件系统**：换部件 = 一行声明（构建期替换契约 × 事实系统接线）

**What to build:** 用户拍板（2026-10-04）：**极其不想脱离 Octave 树**；既然构建工具包已并入
事实系统，把"构建期替换老部件为新的"做成**专属插件系统**，且**移除/替换不需要繁琐动作**——
声明一次，链入口、闸门、事实系统全部自动接线。目标形态：

```
bash build/113/relink.sh link w64        # 模式表里声明了插件 ⇒ 补丁、库序、旗标、
                                         # declared 标签、见证、验收子集全自动
```

而不是现在的散装手驱动：手 `docker cp` 补丁、手设 `E2_*` 旗标、手跑见证、
产物标签靠人记住（工单 57 的 mimalloc 就是这么试出来的，`declared=null` 不可发布）。

**Blocked by:** None（契约定稿要吸收 59/60 的经验回流，但设计稿可以先行）

**Status:** resolved（2026-10-04：契约 v1 定稿 —— build/113/NOTES-plugins.md（声明格式 + 施工流水线 + 现役插件清单 + 机制对照表）+ build/plugins.json（登记表：e2-openblas 追认、mimalloc、libm 负判决）+ build/113/plugin-check.py 闸门（R1 正向 / R2 反向 / R3 A-B 同旗标；自证 10/0，挂 pre-commit，进 gates-selftest 38 闸门）。libm 轴由工单 60 实测否决 —— **插件可达的部件空间就此封口：现役两插件（BLAS/分配器）即全部。**）

**Settling:** 不存在 —— 本工单的第一交付物（契约设计稿 + `build/113/plugin-check.py` 闸门：
两条反向断言——"登记的插件 ⊆ 产物 `declared`"（插件开着但产物没它 = 红）与
"A/B 两件产物 `declared` 必须相同"（工单 57 混淆变量的机制化）；带 `--selftest`，
登记进 `build/gates-selftest.sh`）。

## 机制已有 80%（证据；本单是收编，不是从零造）

- **车道注入**：`build/113/lane-shim.sh`（PATH 影子注旗标；B6 `-pthread` / wasm64
  `-sMEMORY64=1` 实战）；
- **唯一口径**：`relink.sh` 模式表（`env_vars` 个环境变量、`explain` 生成的就是文档、
  `--selfcheck` 可测契约）；
- **补丁家族**（全部带自证）：`patch-openblas-{f77-ret,symbol-prefix,emscripten}.py`、
  `patch-glue-proxy-dlsync-bigint.py`、`unpatch-ax-pthread.py`；
- **产物自证**：`octave.build.json` 的 `declared` / `inputs` / `tool.script_sha256`
  （fail-closed：`verdict=="ok"` 才可部署）；
- **输入见证**：`witness-build-inputs.py` / `witness-build-provenance.py`（每提交逐字复跑，
  工单 42/53）；
- **事实系统**：`build/FACTS.json` 键 + 仪器生命周期闸门（`build/instruments.json`）。

## 缺口（本单要建的契约）

1. **插件声明文件**（`build/plugins/<name>.json`）：目标部件 / 应用方式
   （库序 | 链接旗标 | 第三方源码补丁——只许补**第三方**，不许补 Octave）/ `declared` 标签 /
   事实键 / 见证不变式 / 验收子集 / 车道约束（wasm32/w64、线程）/ 回退方式；
2. **消费入口**：relink / link-web 读声明（替代散装 `E2_*` 手路径）；
3. **闸门**：登记插件 ↔ 产物 `declared` 一致（防"赋值了但没被引用"——§5.46 那族坑的插件版）；
   A/B 同旗标不变式；
4. **收编**：现有 `E2_*` 旋钮逐步迁为声明（mimalloc 先行，工单 59）；
   `promote-w64-lane.sh` 的"只许新增"守卫照旧。

## 硬边界（写进契约，防插件系统变成变相 fork）

- 插件只能换**链接进来的部件**（分配器 / BLAS / libm / 第三方库）与构建旗标；
  **Octave 自身源码零改动**（用户拍板：极其不想脱离树）；
- 需要改 Octave 调用点的优化（如 libm 批量向量化）**在契约之外**——差距由工单 60 的
  spike 量出来留档，不立项；
- 每个插件必须带**反向断言**（关掉插件 ⇒ `declared` 不含其标签 ⇒ 闸门红），且
  接受"换产物批次必须过 `PROBES=1` 全量"的进件纪律（AGENTS.md 验收底线）。
