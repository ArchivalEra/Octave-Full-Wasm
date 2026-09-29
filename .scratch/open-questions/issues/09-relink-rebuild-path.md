# 09: `relink.sh rebuild` 路径实测

**What to build:** `relink.sh` 的 `rebuild` 子命令**从未被跑过**。一条没跑过的路径 = 一条不知道会不会红的路径。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** `bash build/113/relink.sh rebuild product --out <新目录> --yes-rebuild` —— rc=0 且 `verdict=ok` ⇒ rebuild 路径还活着；rc≠0 ⇒ 该路径已腐烂（**这本身就是发现**）
`verdict=="ok"` 且产物 sha 与不 rebuild 时一致/可解释；若它与 `link` 的产物**不一致**，
那本身就是发现（说明 rebuild 路径已经腐烂）。

**Type:** task

**⚠️ 代价诚实**：这条要一整轮重配 + 数小时构建，所以它不该被顺手塞进别的批次 ——
它自己就是一批，且**要占住容器**（别与浏览器验收并行，本仓实测过并发会让套件假崩）。

- [ ] 先读 `build/113/PLAN-arch.md:336` 确认原文
- [ ] 跑 `rebuild` 并留全日志（不是 `tail`，要整份）
- [ ] 结论回填 NOTES，工单置 `resolved`

## Answer（2026-09-29，无人值守批次）：路径烂了两处，都修了，现在活着且可复现

**实测过程**（三次跑，每次一面墙，全部钉在日志里）：

1. **第一面墙：隐形 PATH 前置**。`docker exec o113 bash -c 'relink.sh rebuild …'`（非交互）
   ⇒ `FATAL: PATH 里没有 emf77`，rc=2。与车道影子同款——前置活在操作员的交互 shell 里。
   **修**：relink.sh 入口把自己的 `$(dirname $0)` 挂上 PATH（容器里 = /src/bin，有 emf77）。
2. **第二面墙：已知预期的 make 失败被当致命**。树内 octave-cli 按 configure 时的 /usr/local
   前缀链 LAPACK，缺 `zgejsv_`/`cgejsv_`（web 链接用的是 /src/deps/lapack-simd 那份新的）——
   farm 的 stage_tree 早写明"预期 ≠0"。旧 cmd_rebuild 却在这里中止，永远走不到链接。
   **修**：容忍 make rc≠0 + **零值守卫**（树内四大 .libs 必须非空，否则"全没编过"必须红着死）。
   ⚠️ 守卫第一版路径写错（少 `.libs/`）——守卫自己拦下了自己的错，这正是零值守卫该干的事。
3. **第三面（活着）**：`rebuild product --out /src/websrc/rebuild-out --yes-rebuild` ⇒
   **rc=0、verdict=ok**，产物换到完整站点目录后 `check-boot` ⇒ **BOOT OK 1.2s**。

**可复现性**（B6 式判决）：
- 同日两次 rebuild ⇒ **octave.wasm / octave.data 逐字节一致**（e036d174… / f250530a…）；
- octave.js 不同 = 胶水**嵌入了输出目录路径**（rebuild-out vs rebuild-out2，3 处字面量）——
  同目录必同字节，这不是腐烂；
- 与 09-25 部署基线（`1ed3e528…`）不同 = **入口演进**（B6 后 configure 显式 WITH_THREADS=0、
  模式表多了 declared.threads 键），量测面完全一致（710 导出 / v128 4752 / wasm64=false，
  data 与基线**逐字节相同**）⇒ 符合本单判据"一致/可解释"。
