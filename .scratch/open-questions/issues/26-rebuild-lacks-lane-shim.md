# 26: `relink.sh rebuild <车道>` 不挂车道影子 ⇒ 自己产不出线程档/w64 档产物

**What to build:** `cmd_rebuild` 的 configure + make 两步**没有把车道影子挂上 PATH**
（只有 `cmd_link` 在入口挂了）。而线程档/w64 档的**对象**必须由影子注入 `-pthread`
（w64 还要 `-sMEMORY64=1`）才编得出来 —— 否则重链时报
`--shared-memory is disallowed by <tree>.o because it was not compiled with 'atomics'`。

**Blocked by:** None

**Status:** resolved

**Settling:** `bash build/113/relink.sh rebuild threads --out /tmp/rb-test --yes-rebuild`
—— rc=0 且产物 `verdict=ok` ⇒ 修好；在 product 车道的树上直接跑它 ⇒ 必须**不再**报
`shared-memory is disallowed`（当前实测就是这么报的）。
**反向断言**：把影子目录改名后再跑 ⇒ 必须**点名 FATAL**（与 `link` 的处置一致），
不许退化成"编到一半才报一个离根因很远的错"。

**Type:** task

## 实测（2026-09-30）

- 我在 diag 车道上做 OpenBLAS 补丁实验时踩到：树被 `relink.sh rebuild product`（我自己跑的）
  重配成 product 车道 ⇒ `E2_OPENBLAS=… relink.sh link threads --diag` 报
  `--shared-memory is disallowed by libarray_la-dim-vector.o`（树对象不带 atomics）；
- 用 `grep -c '\-pthread' Makefile` 判车道 = **0**（product）⇒ 诊断闭合；
- 绕过办法（本次用的）：`export PATH=/src/libwork/lane-shim:$PATH` 再跑 `rebuild`。
  但那是**操作员记忆里的前置**——正是本仓反复吃过的那类坑（工单 09 的 emf77 同族）。

## Answer（2026-09-30）：入口已修，结算实测通过

**修法**：`cmd_rebuild` 在 `configure`/`make` **之前**（且提在 `emmake` 检查之前）自己挂车道影子
（`threads` ⇒ `LANE_SHIM`，`w64` ⇒ `LANE_SHIM_W64`），缺则**点名 FATAL** 并打出建影子的命令 ——
与 `cmd_link` 同款处置。**为什么必须提在 emmake 之前**：自证在宿主上跑（宿主没有 emmake），
不提就会被"PATH 里没有 emmake"先拦下，影子前置那一条永远测不到（第一版就这么假绿过）。

**反向断言（自证内置，`relink.sh --selftest` → 9 PASS / 0 fail）**：
`LANE_SHIM=/nonexistent-shim relink.sh rebuild threads --out … --yes-rebuild` ⇒ 输出里出现"车道影子"点名。

**正向结算（本单 Settling 的原命令，**不手工 export 任何 PATH**）**：
`bash /src/bin/relink.sh rebuild threads --out /src/websrc/rb26-out --yes-rebuild`
⇒ **rc=0**，出厂核对 `verdict=ok`，产物 sha `d918ef4199b7dd34…`（29,338,644 B）。
⇒ 现在"重建某个车道"这件事**入口自己就够了**，不再依赖操作员的 shell 记忆。
