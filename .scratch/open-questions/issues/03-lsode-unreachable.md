# 03: LSODE/ODEPACK `unreachable` 陷阱的位置

**What to build:** 把 LSODE 的 `unreachable` 陷阱从"知道它有、不知道在哪"变成
"知道是哪一行、以及触发它的最小条件"。

**Blocked by:** 01（需要符号化/诊断构建的口子）

**Status:** resolved

**Settling:** 不存在 —— **本工单的第一交付物就是造它**：一个符号化构建（`-g` + 诊断）
+ 最小复现脚本，跑出非零退出码并把栈指到具体位置。

**Type:** research

- [x] 先读 NOTES —— **悬案已被结掉**（见 Answer；本单此前一直没翻状态）
- [x] 结算件当年已造好并跑完：DIAG_NAMES/DIAG_ASSERT/DIAG_SOURCEMAP 三级符号化 + LSODE.cc 前后插桩
- [x] 结论已回填 NOTES（文件开头「✅ 结论」节），工单置 `resolved`

## Answer（2026-09-29，无人值守批次）：悬案早已根因修好，本单只欠翻状态

**Settling 的两问当年都已交付**（NOTES-lsode 全程留档，无需重做）：
1. **符号化**：DIAG_NAMES（--profiling-funcs）→ DIAG_SOURCEMAP → 翻到 `dlsode.c:1618`，
   再用 `LSODE.cc` 的 BEFORE/AFTER 插桩把 trap **夹死在 `F77_XFCN (dlsode, …)` 内部**
   （BEFORE 打出来、AFTER 永远没有）。
2. **根因与修法**：ODEPACK 的 Fortran 调用户回调给 **4 个实参**（7 处 CALL F），
   Octave 的 `lsode_f` 有 **5 个形参**（多一个 `F77_INT& ierr`）—— 原生不查函数指针签名
   所以"看起来能用"，wasm 的 `call_indirect` 精确查类型 ⇒ `unreachable`。
   修法 = `build/113/patch-odepack-callback-arity.sh`（7 处补第 5 参）。
   修复后 5 个数值用例全对（含刚性问题 2.7e-08，与原生 11.3.0 同精度）。

**今日新鲜实测**（8768，浏览器）：`x = lsode(@(y,t) -y, [0;1], 1)` ⇒ **rc=0，无 trap** ——
修复在现役产物上活着。`accept-113-ode15.mjs` 第八节已从"已知缺陷复核"转成**正式断言**。
