# 36: **E2 包装名单的收割口径**：必须在"未打前缀补丁"的配置下收，且树必须是好的

**What to build:** `w64` + 线程版 OpenBLAS 的产物**链得过（`verdict=ok`）但页面起不来**：
`Import #4 "env" "zdrot_k": function import requires a callable`（以及 29 个未定义符号：
`ddot_`/`dnrm2_`/`dasum_`/`idamax_`… 那批 Level-1 入口）。本单 = 把包装名单的**收割口径**钉死。

**Blocked by:** None（工单 32/34/35 已修；树与补丁现在都对了）

**Status:** ready-for-agent（配方已明确，正在按它重跑）

**Settling:** 按下面"正确配方"重跑后：`relink.sh link w64`（带 `E2_OPENBLAS`）⇒ `verdict=ok`
**且** `sh build/check-boot.sh http://127.0.0.1:<实验站点>/` ⇒ 开机过（**这一条才是判据**）。

**Type:** research

## 现象与根因（2026-10-01 实测）

打完**符号前缀补丁**后，OpenBLAS 的 Fortran 入口**全部**变成 `ob_*`（298 个）。其中：

- **签名与我们的 f2c 调用方不同**的那批 ⇒ 需要包装（f77 包装对象）——这是已知的 76 个；
- **签名本来就一致**的那批（`ddot_`/`dnrm2_`/`dasum_`/`idamax_`…）⇒ **以前不需要包装**，
  因为调用方直接绑到 OpenBLAS 的**同名未加前缀**入口上；一旦加前缀，它们**没有定义**了
  ⇒ 29 个未定义符号 ⇒ 模块把它们留成 **JS 导入** ⇒ 运行期 `requires a callable` / 递归栈溢出。

对比两份归档（一格定案）：

| 符号 | wasm32 E2 归档（**能用**） | w64 E2 归档（当前） |
|---|---|---|
| `ddot_` / `dnrm2_` / `dasum_` | **有未加前缀的定义** ✓ | 只有 `ob_*`，未加前缀的**没有** ✗ |
| `dgemm_` / `zdrot_` | 有（包装对象） | 有（包装对象） |

⇒ 差别**不在补丁**，在**收割时机的口径**：我的 76 个包装名单是在**树还坏着**的时候收的
（`F2C_PREFIX` 未修 ⇒ 隐藏长度宽度分叉 ⇒ 不匹配集合被污染），漏掉了"本不需要包装"那批的
**透传壳**。wasm32 那份名单是在**正确配置**下收的。

## 正确配方（本单要求固化的那条）

1. **收割**：树必须是好的（`F2C_PREFIX` 跟车道、`WITH_THREADS=1`、emscripten 补丁**已打**），
   而**符号前缀补丁必须处于"未打"状态**（`patch-openblas-symbol-prefix.py --revert`）——
   这时调用方全部绑到 OpenBLAS 的同名入口，**签名差异全部显形**为 `function signature mismatch`；
   `pack-raw` 后链一次、把日志收下来；
2. `gen-f77-wrappers.py --from-log <该日志> --abi wasm64` ⇒ 包装 C（含"透传壳"那批）；
3. 编包装对象（**同一个 ABI**：`emcc -pthread -sMEMORY64=1 …`）；
4. **再打前缀补丁**（`--apply`）⇒ `build`（**必须 clean**，`-DNAME` 不是文件依赖）⇒ `pack`（挂包装）；
5. 重链 ⇒ `verdict=ok` ⇒ **装机开机自检**（判据）。

⚠️ 第 4 步的 clean 与第 1 步的 revert 都不能省：前者漏了会"零重编"（工单 35 第 5 条），
后者漏了收割就退化成"只收签名不同的那批"，于是本单的 29 个未定义符号会原样出现。
