# 25: 8768 站点的实验残留文件（三份，来源不明 —— 只登记，不擅自删）

**What to build:** `check-site-parity.sh --strict`（2026-09-30 绿）在"非部署件内容差异"一节里报出
**只有 8768（siteWebGL）有**的三份文件：

| 文件 | 猜测来源（**未验证**） |
|---|---|
| `octave.js.orig` | 某次调试胶水时留的备份（`cp octave.js octave.js.orig`） |
| `wtest.html` / `wtest.js` | B5/C3（解释器进 Worker）时期的**手搓测试页** |

它们**不是**部署件（parity 只报不算差异），但 8768 是 promote 的源候选之一 ⇒ 将来若有人
用 `rsync`/`cp -a` 整目录搬 8768，会把它们一起带进 8761 或交付包。

**Blocked by:** None

**Status:** ready-for-agent

**Settling:** 三份文件各得一个明确去向，且有可复跑的判据：
- **要留** ⇒ 移进 `build/113/`（实验物该待的地方）并在注释/工单里说明用途，然后
  `ls /mnt/hdd/octave-wasm-build/siteWebGL/{octave.js.orig,wtest.html,wtest.js}` 必须全部"不存在"
  （rc≠0）；或
- **要删** ⇒ 先 `sha256sum` 存档到工单 Answer（**删前留指纹**，本仓纪律：不删 git 对象、
  但站点上的非入库文件要留痕），再删，然后同一条 `ls` 必须报缺。
**反向断言**：做完之后 `sh build/check-site-parity.sh --strict` 仍必须 **rc=0**，
且输出里**不再出现这三行**。

**Type:** task

## 为什么"不擅自删"

本仓纪律：**不是自己建的产物，先surface 再动**（用户点名的"删之前先看目标、不是自己建的
就要先汇报"）。这三份文件**没有对应的工单/提交记录**（`git log` 里查不到），
所以来源与是否还有用**只能由人确认** —— 本单的存在就是那条"留痕"。
