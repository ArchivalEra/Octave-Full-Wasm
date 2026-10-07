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
活跃开发前端 = **IllegalPerformance 分支**（Rust 补丁线——本仓唯一允许改 Octave 树
补丁的线，用户拍板解除且不回主线）。

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

1. **Rust 补丁线（IllegalPerformance，当前前端）**：Rust 内核 = **源缝插件**
   （Array-base.cc 弱符号缝 + RUST_SORT 链接期旋钮，摘除 = 旋钮关）→ 差分门（G2）+
   变异自证（G2b）+ hotpath A/B。**候选③ sort 已在 w64 落地 ADOPT——端到端 2.0×**
   （nightly build-std wasm64 库；`w64_rustsort_ab_*` 台账键；全量 PROBES=1 1358/0
   等效；端到端逐位抽查双站一致；工单 63），**发运 = 产品决定**。专属站 =
   site-illegalperf/-baseline（装配入口 build/113/site-illegalperf.sh）。
   **缝空间已封口**：libm（IEEE 逐位红线）、fill/fft（带宽绑定）、**候选④ xpow 驱动层
   （实测 driver_only 仅 2.1% ⇒ 排除，G6 仪器已建）** ⇒ 无已知上升空间。
2. **上游更新线**：SOP 已通（工单 62 结案——供给树 rebuild 恢复可复现）。**emcc 6.0.10
   探针判决：编译器红利 ≈ 0（geomean 1.001），旗标矩阵全绿——升级不立项**，重启时机 =
   Octave/emsdk 新版发布 → fork merge → 重编 → 验收（`emcc6_probe_geomean` 台账键哨兵）。
3. **部署与 UI 线**（人的动作）：票 38 页面资产上站（`promote-pages.sh`）、票 12 真机手测
   （等生产部署）、E6 图形线（embed 页 GL 纹理边界）。
4. **Einfacht 反哺（暗线，持续推进）**：三插件已并（#11 check_pins/check_locks、
   #12 check_ab）；**可执行闸门脚本必须显式 `__main__` 入口**（#12 并后抓到的缺口）。
   提 issue/PR 前先做现有档位对照表；覆盖不到或配置繁琐 ⇒ 自行迭代再提 PR。
5. **性能边界（实测封口项，勿重开）**：插件可达部件空间（BLAS/分配器即全部）、
   libm 标量替换（wasm 无标量 FMA）、fill 热点（带宽绑定）、faer/PGO/LTO/链接旗标/NT>8、
   工单 62 ABI 分叉（根因 = f77-fcn.h 未收编手改，已收编 fork `a5a7208`；供给树
   rebuild 可复现：1 条容忍 mismatch + wasm-opt 绿）——
   全部有数字判决，见 HISTORY 与 NOTES。

## 分支模型（三线独立，2026-10-07 定稿）

三条**独立可持续维护**的产线，每条都能独立吃 fork 更新、构建、验收、发运：

| 分支 | fork pin（upstream/octave） | 定位 |
|---|---|---|
| `wasm32-final` | —（冻结） | wasm32 归档线；不做新活，需要时按 NEXT 同法接 fork |
| `wasm64-NEXT` | `a5a7208`（平台补丁+f77 修复，**无 rust 缝**） | **中庸 wasm64 线**：8869 对照站；已验证"从 fork pin 全新重编 = 与现役产物逐字节同"（01fb52fc） |
| `IllegalPerformance` | `f4bf15b`（+ rust-sort 源缝） | **激进 wasm64 线**：8761 现役（rust-sort 2.2×、IEEE 已评估） |

**换线规则（共享容器 o113 的代价，必须遵守）**：容器里的**树、构建脚本、印章**都跟着
分支走——切分支后必须 ① `git submodule update upstream/octave` ② `sh build/provision-upstream.sh
--only octave` ③ `docker cp` 该分支的 `relink.sh`/`link-web.sh` 进容器 ④ **闸门与推送的
站点口径**：`OCTAVE_WASM_BASE` 指向**本线**的站点（IP 线 = 默认 `…/site`；NEXT 线 =
`…/next-base/site` → site-illegalperf-baseline 符链；master 线 = 仓库 `site/`，即
`OCTAVE_WASM_BASE=$PWD`）——plugin-check/check-facts/witness 读的都是它，不指本线 =
在别的线的部署上跑闸门（实测三次：NEXT 拣选红、master 提交红、NEXT 重编产物混入
rust_sort）。四步少一步 = 在别的线的状态上构建或验收。

**fork 更新 SOP（每条线相同）**：上游发版 → `upstream/octave` fork 分支 merge 上游 tag
→ 该线 bump pin（NEXT = 无缝 lineage；IP = 缝随分支携带）→ provision → rebuild → 全量
→ 发运。IP 上新增的内核缝 = fork 上的独立提交，其他线**不继承**（各线 pin 各自的 fork 点）。

## 开工与提交的顺序## 开工与提交的顺序

1. 开工前（要跑套件 / 基准）：`sudo -E $(which python3) build/lib/doctor.py` ——
   `DOWN: <哪条>` 就修环境，别带病开跑。
2. 改完：`sh build/gates-selftest.sh` 全绿再提交（装了钩子则 pre-commit 自动做；
   pre-push 复核机器块新鲜度）。**禁 `--no-verify`**。
3. 推送后：持久盘镜像同步。**8761 只由受管辖入口改**（批次收尾细则 = `AGENTS.md`）。
