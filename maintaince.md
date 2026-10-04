# maintaince.md · 方向与地图

本文件**只指明方向**。测出来的现状由**事实系统本身**承载（`build/FACTS.json` 台账 +
`STATE.md` 末尾的机器块，每提交复跑证真）；硬规矩由 `AGENTS.md` 承载（每次会话自动载入）。
本文件不抄数字、不抄流程 —— 抄了就会漂；工具自己会说话（闸门会明说未启用，改口会要求
`--accept-changes`，测龄会打印在重测输出里），听它们比读本文件的任何细节都可靠。

## 这个项目是什么

GNU Octave 11.3.0 → WebAssembly 的**全量浏览器运行时**（纯客户端计算，无服务端执行端点）：
浏览器验收套件、带复跑命令的事实台账、每道先证明自己会红的闸门群——
上游全量 fork/submodule 接入。可交付物 = 四格站点（base/threads/w64/w64-base）+
嵌入接口层（UI 方开工包）。

## 地图（真值在哪里）

- **现在是什么**（活状态）：`STATE.md` —— 正文只写现状、数字一律引用台账键；
  末尾机器块由 `build/facts.py --render-doc STATE.md` 渲染，每提交重算。
- **测出来的数字**（唯一产地）：`build/FACTS.json`（源）+ `STATE.md` 的 AUTO 块（渲染）。
- **给 agent 的硬规矩**：`AGENTS.md`（路径铁律 / 三条不可违背 / 验收底线 / 批次收尾）。
- **历史与事故**：`HISTORY.md`（append-only，`§5.x`）。
- **悬案**：`.scratch/open-questions/issues/NN-*.md`（每条挂可执行结算件）。
- **机制/推断**：`build/113/NOTES-*.md`（jspi/threads/webgl/wasm64/hotpath/libm/plugins/upstream）。
- **上游**：`upstream/`（18 submodule，5 fork 的 wasm 补丁分支）+ `build/upstream-lock.json`
  （无 git 上游的 URL+sha256）+ `build/113/NOTES-upstream.md`（升级 SOP）。
- **部件插件契约**：`build/113/NOTES-plugins.md` + `build/plugins.json` + `plugin-check.py`。
- **C 库配方**：`build/CLIBS.md`；**术语**：`CONTEXT.md`；**部署**：`DEPLOY.md`。
- **给 agent 的方法学**：`docs/agents/`（memory / fact-system / issue-tracker / upstream-issues）。

## 方向

1. **工单 62（ABI 分叉悬案）**：全量 clean rebuild 露出 55 条 Fortran→BLAS signature
   mismatch（发运谱系 1 条）——增量谱系不可复现。结算件 = `CCACHE_DISABLE=1` 供给树对照
   重编；根因二选一（ccache 旧旗标污染 / 现役树未收编手改）。**结案后上游升级 SOP 才通**。
2. **部署与 UI 线**（人的动作）：票 38 页面资产上站（`promote-pages.sh`）、票 12 真机手测
   （等生产部署）、E6 图形线（embed 页 GL 纹理边界）。
3. **上游更新线**：SOP 已备（`NOTES-upstream.md`）——Octave/emsdk 新版发布 → fork merge →
   重编 → 全量验收 → 发运。emsdk 6.0.10 已在远处候着（主版本跳号，先读 changelog）。
4. **性能**：插件可达部件空间已实测封口（BLAS/分配器两插件即全部）；唯一剩余路线 =
   Octave 源码级优化——用户拍板"极其不想脱离树"⇒ 挂起，除非解除。
5. **Einfacht 反哺惯例**：提 issue/PR 前先做现有档位对照表（#5 witness / #6 calibrate /
   #7 invariants / #8 envfile / #9 撤回教训 / #10 doctor / PR #11 pins+locks）。

## 开工与提交的顺序

1. 开工前（要跑套件 / 基准）：`sudo -E $(which python3) build/lib/doctor.py` ——
   `DOWN: <哪条>` 就修环境，别带病开跑。
2. 改完：`sh build/gates-selftest.sh` 全绿再提交（装了钩子则 pre-commit 自动做；
   pre-push 复核机器块新鲜度）。**禁 `--no-verify`**。
3. 推送后：持久盘镜像同步。**8761 只由受管辖入口改**（批次收尾细则 = `AGENTS.md`）。
