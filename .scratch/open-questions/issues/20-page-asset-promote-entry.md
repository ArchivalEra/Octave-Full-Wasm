# 20: 纯页面资产批没有 promote 入口（今天真撞到）

**What to build:** 今天同步 `bridge/{index.html,octave-worker.js}` 到 8761 时发现：
`build/promote-webgl.sh` 是**产物（GL wasm）导向**的，它的守卫（目标产物比现役旧就拒）**正确地**
拒绝了本次"只改页面 JS、三大件一字不动"的批次 —— 但仓库里**没有**一条受管辖的
"页面资产批"入口 ⇒ 只能手 `cp` 两个文件（本次是这么做的，有备份、有 sha 比对、有 parity 复核，
但**这正是 AGENTS.md 点名的危险动作形状**："为了试页面改动顺手 cp 进 8761"）。

**Blocked by:** None

**Status:** ready-for-agent

**Settling:** 存在一条**受管辖**的入口，两值可分辨 ——
`sh build/promote-pages.sh --dry-run` 打印"只同步页面资产（清单见脚本）且**不碰**三大件"；
真跑后 `sh build/promote-pages.sh --verify` ⇒ rc=0 且逐文件打印 `仓库/8761/8768/repo-site`
四处的 sha 一致；**反向断言**：若有人改了三大件里任何一个，`--verify` 必须**红**
（页面批不许悄悄夹带产物）。

**Type:** task

## 为什么值得立（本次的实际代价）

- 手 `cp` 时**没有任何守卫**会拦：拷错文件、漏拷、把产物一起带过去都无人发现；
- 本次靠"人肉四比较 sha + boot + SHA 三层 + parity"补上了，但那是**流程之外**的自律；
- `promote-webgl.sh` 的守卫逻辑（比现役旧 ⇒ 拒）值得复用：页面批的等价守卫是
  "三大件 sha 必须与现役**逐字节相同**"。

## 交付标准

1. `build/promote-pages.sh`：**资产清单从 `build/recover-113.sh:64-70` 那份 <script src> 清单推**
   （别另抄一份会漂的清单）；
2. `--dry-run` / `--verify` 两个模式；`--verify` 覆盖四处 sha（仓库 `bridge/`、8761、8768、仓库 `site/`）；
3. 反向断言进 `build/gates-selftest.sh` 名单（该脚本必须能证明自己会红）；
4. 结论回填 `build/113/NOTES-*.md` 或本单 Answer。
