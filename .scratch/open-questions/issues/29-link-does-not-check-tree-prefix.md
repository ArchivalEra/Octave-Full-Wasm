# 29: `relink.sh link <模式>` 不校验"树的 configure 前缀与模式是否匹配"

**What to build:** 工单 28 的**同族**防线。一棵 Octave 树只配一个 `--prefix`，而产物会把该前缀
**烘死**进 `octave.js`（docstrings/doc-cache 等运行期路径）。现在：

- `rebuild <模式>` 会按模式传 `$2`（28 已修）；
- 但 **`link <模式>` 只管链接、不看树**：在一棵 **threads 前缀**的树上跑 `link product`
  ⇒ 链出的 product 产物烘死 `octave-install-threads` 的路径 ⇒ **上线后 8761 的 help 会打不开**，
  而 `verdict=ok`、三条 SHA、"能链过"**全都绿**。

**Blocked by:** None（28 已把烘死路径的**自证**加在 `rebuild` 里，本单是把它扩到 `link`）

**Status:** resolved

**Settling:** `link <模式>` 在链之前读树的实际前缀（`grep '^prefix' Makefile` 或 `config.status` —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
里那一条），与模式应有前缀（product→`/src/work/octave-install`、threads→`-threads`、w64→`-w64`）
**比对**：不一致 ⇒ **点名 FATAL** 并打出"先 `rebuild <模式>` 重配"的下一步。
**反向断言**：把树重配成 threads 前缀后跑 `link product` ⇒ 必须 FATAL（当前是静默产出坏产物）；
同前缀下 `link threads` ⇒ 照常绿。

**Type:** task

## 为什么值得单列

- 这是"**换车道后忘了重配**"这一类事故的通用形状，本仓已有两个实例：
  `relink.sh rebuild product` 把树打成 product（我为此踩了工单 26 的 `shared-memory` 错），
  以及工单 28 的 prefix 烤错；
- `verdict=ok` 是**声明 vs 量测**的核对器，天生**不看运行期路径** ⇒ 这类错只能靠
  "链之前比对"或"链之后跑运行期套件"来拦。本单选前者（便宜、早、且在链之前）。

## Answer（2026-09-30）：已实现（自证 10/0）

`cmd_link` 开头读**树自己的** `Makefile` 的 `prefix` 行，与模式期望比对：
`threads → /src/work/octave-install-threads`、`w64|w64-base → -w64`、其余 `→ /src/work/octave-install`；
不一致 ⇒ **点名 FATAL** 并打出"先 `rebuild <模式>` 重配"的下一步（附 28 的盲区说明）。
一致时打一行 `树前缀校验：… == 模式 … 的期望 ✓`。

**自证**（`relink.sh --selftest` → **10 PASS / 0 fail**）：夹具树写 `prefix = …-threads`，
`link product` ⇒ 输出出现"树的 configure 前缀"⇒ 命中 FATAL。
（判据从**树**读，不信任何人的记忆；这与 28 在 `rebuild` 里的烘死路径自证一前一后夹住同一个坑。）
