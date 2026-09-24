# NOTES · `lsode` 调用即整页 trap —— **已修好**（2026-09-22）

## ✅ 结论（先说答案）

**根因：ODEPACK 的用户回调参数个数与 Octave 的不一致 —— 4 个 vs 5 个。**

- 本树 `liboctave/external/odepack` 的 Fortran 调 `F` 时给 **4 个**实参：
  `dlsode.f:1393  CALL F (NEQ, T, Y, RWORK(LF0))`，
  `dstode.f:257/311/470  CALL F (NEQ, TN, Y, SAVF)`，
  `dprepj.f:107/129/172  CALL F (NEQ, TN, Y, FTEM|WM(3))` —— 共 7 处。
  f2c 因此生成 **4 参**函数指针调用（wasm 类型 `(i32,i32,i32,i32)->void`）。
- Octave 的 `lsode_f`（`liboctave/numeric/LSODE.cc`）有 **5 个形参**
  （多一个 `F77_INT& ierr`，导数为空时回 -1）→ wasm 类型是多一个 i32。
- 原生 x86 上 C **不检查**函数指针签名，第 5 个实参只读到一段垃圾，
  而 `lsode_f` 只在导数为空时才写它 —— 所以"看起来能用"。
  **wasm 的 `call_indirect` 会做精确类型检查 → 类型不符即 `unreachable` → 整页死。**
- 旁证：同批的 `lsode_j` 是 **7 参**，而 `dprepj` 的 `(*jac)(…)` 恰好也是 **7 参**
  → **只有 `f` 这一侧不匹配**，这正解释了为什么只有 F 的调用点会 trap。

**修法**：`build/113/patch-odepack-callback-arity.sh` —— 给那 7 处 `CALL F` 补上
第 5 个实参（与 Octave 本来期待的 `F(NEQ,T,Y,YDOT,IERR)` 接口对齐）。
用不声明的 `JERR`（这些文件都没有 `IMPLICIT NONE`，J 开头按隐式类型即 INTEGER），
避免动声明区。DLSODE 本身不读它（stock 版本没有 IERR 语义），所以**行为与原生一致**，
只是让那个引用指向一个真实存在的变量而不是垃圾指针。

**修复后的实测**（`http://127.0.0.1:8761/`，主 wasm `bac48adb960c9c79…`）：

| 用例 | 结果 |
|---|---|
| `x=lsode(@(y,t) -y,1,[0 2])`，`\|x(2)-e^-2\|` | **4.301e-08**（原生 11.3.0 同题也为 4.3e-08）|
| `[x,ist,msg]=lsode(...)` | `istate=2`，`msg="successful exit"` |
| 两状态 `[-y1;-2y2]`，`\|y2(1)-e^-2\|` | 精确吻合（0.135335）|
| 非刚方法 | 正常 |
| **刚性问题** `-1000(y-cos t)-sin t`，`max\|x-cos t\|` | **2.744e-08** |

⚠️ 一个**测法陷阱**（第一版就踩了）：`lsode` 的返回约定是 **`[x, istate, msg]`**，
**不是 `[t, y]`**。写成 `[t,y]=lsode(...)` 会把 `istate`(=2) 当成 `y(end)`，
于是量出 `err≈1.865` 而误判"算错了"。本机原生 11.3.0 复核过同一坑。

---

## 附录：完整诊断过程（留档，别重复走）

## 一句话
`lsode` 在 11.3.0（8762）**和 7.2（8761）上都把整页打死**：
`RuntimeError: unreachable`，wasm 栈 `wasm-function[27711] → [27715] → …`。
**不是本轮引入的**，与 SUNDIALS / `__ode15__` 无关。

## 证据（全部浏览器实测，逐条可复现）

| # | 事实 | 怎么测的 |
|---|---|---|
| 1 | 8762 上 `[t,y]=lsode(@(y,t) -y,1,[0 2])` → 整页 trap | `test/browser/accept-113-ode15.mjs` 第八节 |
| 2 | **8761（7.2 已验收基线）同样 trap** | 同一探针换 URL，判定一字不差 |
| 3 | **不装载 `__ode15__` 时也 trap** | 探针第 [1] 步先测、再装载 |
| 4 | `lsode_options("relative tolerance")` = 1.4901e-08，正常 | 单独一页 |
| 5 | `lsode_options()` 正常列出全部选项 | 单独一页 |
| 6 | `quad(@(x) x.^2, 0, 1)` = 0.333333333，正常 | 单独一页 —— 证明 **Fortran + 回调这条路是通的** |
| 7 | `exist("lsode")` = 5 | 单独一页 |
| 8 | **trap 前控制台没有任何 Fortran/f2c 报错** | 探针把 trap 前的 console 全量打出来，只有资产装载日志 |
| 9 | 参数顺序不是原因：lsode 的约定就是 `f(x,t)`（与 ode45 的 `f(t,x)` 相反），探针用的就是 `@(y,t) -y` | 同上 |

## 为什么一直没被发现
7.2 的 `test/browser/accept-ode15.mjs` 对 lsode **只断言了 `exist("lsode")==5`**，
从没真的调用过；`build/CLIBS.md` 批次 3 写的"`ode45`/`ode23`/`lsode` 无回归"
也只覆盖到存在性。
> 这正是 HISTORY §10.3 坑 4 说的那件事的第二次复现：
> **「装载类断言不够，判定缺陷的唯一可靠手段是装载之后真的调用」**。

## 已经排除的解释（都验过）
- ✗ 不是 SUNDIALS / `__ode15__.oct` 装载引起（不装载也炸）。
- ✗ 不是 11.3.0 的回归（7.2 一样炸）。
- ✗ 不是"Fortran 整体不可用"（`quad` 用回调、跑得好好的）。
- ✗ 不是参数顺序写错。
- ✗ 不是 Fortran 主动报错（trap 前零输出，是**静默** `unreachable`）。

## 还没做的（下一步）
把 trap 地址符号化，定位到具体函数。可走的路子（按代价从小到大）：
1. 带 `-g` 重编主 wasm，用 `wasm-function[27711]` 的索引去 `.name` 段查名字；
2. 或者用 `-sASSERTIONS=1` / `-fsanitize=…` 的精简重链跑一次，让 abort 带上下文；
3. 重点怀疑方向：ODEPACK（`dlsode`/`dls001_`）的 f2c COMMON 块处理
   —— 最终链接用了 `-Wl,--allow-multiple-definition` 来压 `dls001_`/`globe_` 的
   重复定义（见 HISTORY §10.3），**被丢弃的那份定义里如果含状态，行为就不对了**。
   值得先看 `liboctave/external/odepack/` 里 COMMON 块的编译产物。

---

## 🔬 第二轮诊断（2026-09-22，已把 trap **符号化**）

### 做法：带函数名重链一次（**不影响部署产物**）
`link-web.sh` 加了两个诊断开关（默认关，只写独立目录、不碰 `site/` 与 `site113/`）：
- `DIAG_NAMES=1` → 加 `--profiling-funcs`，产物里保留 **name 段**。
  为什么必须这么做：线上产物是 `--strip-debug` 的，wasm 里只有 `dylink.0` 一个
  custom 段，浏览器只能报 `wasm-function[27711]` 这种索引，**没法翻译成函数名**。
- `DIAG_ASSERT=1` → 加 `-s ASSERTIONS=1`。
- `EXTRA_LDFLAGS="..."` → 追加任意链接旗标（用于做定点实验）。

### 结果 1：trap 位置已符号化
```
RuntimeError: unreachable
  at LSODE::do_integrate(double)                    ← 就是这里
  at LSODE::do_integrate(ColumnVector const&)
  at octave::Flsode(...)
  at tree_evaluator::execute_builtin_function ...
```
**栈里没有更深的一帧** —— 说明 trap 就发生在 `do_integrate(double)` 自己的代码里
（而不是在某个被调函数里）。

### 结果 2：开断言也**没有**可读原因
`DIAG_ASSERT=1` 之后 trap 前的 console **依然空**（不是越界/未捕获异常/栈溢出的
那类 emscripten 断言 abort）。⇒ 是一句**裸的 `unreachable`**。

### 结果 3：用**错误路径**把 trap 夹在 `dlsode` 调用那一步
`do_integrate(double)` 初始化块里的检查，逐个用非法输入戳：

| 试验 | 期望 | 实测 |
|---|---|---|
| C) 回调返回长度与状态不匹配 `lsode(@(y,t) [1;2], 1, [0 2])` | 在**回调之后**立刻报错 | ✅ 干净报错 `inconsistent sizes for state and derivative vectors` |
| B) `lsode_options("absolute tolerance",[1 2 3])` + 标量状态 | 在**更靠后**报错 | ✅ 干净报错 `inconsistent sizes for state and absolute tolerance vectors` |
| A) `lsode_options("maximum order", 99)` | 在**再靠后**报错 | ✅ 干净报错 `invalid value for maximum order` |
| 正常调用 | — | ❌ trap |

⇒ **回调调用（`(*user_fcn)(m_x, m_t)`）与初始化块的全部检查都正常通过**；
A/B/C 之所以不炸，是因为它们在 `dlsode` 之前就 `return` 了。
代码里这三处之后只剩 `px/pabs_tol/piwork/prwork = *.rwdata()` 与
`F77_XFCN (dlsode, DLSODE, …)`。
⇒ **trap 就夹在 `F77_XFCN(dlsode, …)` 这一步（或其紧邻的 `rwdata()` 取值）。**

### 结果 4：**否掉**了"符号没链进来"这个候选
`dlsode_` 的**名字串在整个 wasm 里 0 次命中**（而同族的 `dcfode_`/`dintdy_`/`dsolsy_`
各命中 1 次），看着像"入口没被链进来"。但：
- `emnm --defined-only liboctave.a | grep dlsode_` → **有定义**（在 `liboctave.a` 里）；
- `emnm liboctave.a | grep "^ *U .*dlsode"` → **有未定义引用**（来自 LSODE.o）；
- 链接日志里**没有** `undefined symbol: dlsode_`；
- **定点实验**：`EXTRA_LDFLAGS="-Wl,-u,dlsode_"` 重链一次 → 产物与不加时
  **sha256 完全相同**（`977307585df89acd…`）⇒ 链接器认为它已被引用/已定义，
  `-u` 是空操作。
⇒ 所以"漏链"**不成立**；名字串缺失是**命名表的表现**，不能当证据。
（HISTORY §10.3 坑 5 早就写过这条教训：**别用"符号在不在"推断 trap**。）

### 结果 5：**插桩把 trap 夹死在 `dlsode` 调用内部**（决定性）
在 `LSODE.cc` 的 `F77_XFCN (dlsode, …)` **前后各插一句 `fprintf(stderr,…)`**，
重编 `liboctave` + 重链到独立目录（`/src/websrc/diag4`，走 8765，**不碰部署产物**）。
实测 console：

```
LSODE-DIAG-BEFORE n=1 lrw=32 liw=21 mf=22      ← 打出来了
（LSODE-DIAG-AFTER 始终没打出来）
RuntimeError: unreachable at wasm-function[27711]
```

⇒ 代码**走到了调用前那一行**，trap 发生在 `F77_XFCN (dlsode, …)` **内部**。

**顺带确认工作区大小是对的**（不是"给的空间不够"这类错）：
`n=1`，方法 `mf=22`（stiff + 内部生成满 Jacobian），
DLSODE 对 MF=22 的要求是 `LRW ≥ 22 + 9n + n² = 32`、`LIW ≥ 20 + n = 21` ——
**实测给的正好是 lrw=32 / liw=21**，一个不多一个不少。

### 插桩的善后（**别把改动留在树上**）
1. 插桩前先存了 `LSODE.cc.orig`；测完 `cp -f LSODE.cc.orig LSODE.cc` 还原。
2. 重编 `liboctave`，确认 `emnm liboctave.a | grep -c LSODE-DIAG` = **0**。
3. **重链一次并与部署产物比 sha256**：`/src/websrc/verify/octave.wasm` =
   `11f6175ac9b6a3e5`，与站点上正在服务的**逐字节相同**
   ⇒ 树已完全还原，且**这个构建是可复现的**。

### 下一步（**已完成** —— 下面是当时写的方向，留档）
> 实际走的路线：`DIAG_SOURCEMAP=1` 出 source map → 翻成 `dlsode.c:1618` →
> 认出是 `(*f)(...)` 回调调用 → 对比实参个数（4 vs 5）→ 打补丁。见本文开头「结论」。
trap 已确认在 `dlsode` 内部（f2c 转出来的 odepack），且输入工作区大小正确。
剩下的方向按可能性排序：
1. **f2c 回调 ABI**：`lsode_f`/`lsode_j` 是作为**函数指针**传给 Fortran 的，在 wasm 里走
   `call_indirect`；**签名不匹配会直接 trap**。对照 `LSODE.cc` 里两个回调的签名与
   f2c 版 `dlsode.f` 里 `EXTERNAL LSODE_F, LSODE_J` 的调用点。
   （旁证：最终链上确实存在同类问题 —— `wasm-ld` 报过
   `function signature mismatch: zdotu_`：`libqrupdate` 里是 `(i32×5)->f64`，
   `librefblas` 里是 `(i32×6)->void`。f2c 的隐藏长度约定在这个工程里是真实存在的坑。）
2. **f2c 的"未实现例程"**：odepack 出错路径会调 `xerrwv`/`s_stop` 一族，
   若 libf2c 里对应实现缺失或签名不符，走到就 trap。
3. **COMMON 块**：最终链接用 `-Wl,--allow-multiple-definition` 压 `dls001_`/`globe_`
   的重复定义（HISTORY §10.3）；被丢弃的那份里若含状态，行为就不对了。
   可以对比 `/src/deps` 之外 7.2 那份 odepack 的编译方式。
4. 最快的定位：在 `dlsode.f` 的 f2c 产物里按 `wasm-function` 索引反查
   （用 `DIAG_NAMES=1` 那份带名字的构建，trap 栈里会直接出现 `dlsode` 或其被调函数）。

## 现状定性（修复后）
- 8761/8762（11.3.0）与 7.2 **都是这个状态**：`lsode` **从来没在这个项目里工作过**
  （不是本轮换基线引入的，也不是回归）。
  此前没被发现，是因为 7.2 的 `accept-ode15` 对 `lsode` **只断言了 `exist`**。
- 已记入 `HISTORY.md` §10.6 作为独立待办；`accept-113-ode15` 第八节单独隔离复现它、
  不计入 PASS/FAIL，避免它一 trap 就把整个套件打死。
- **诊断过程对部署产物零污染**：所有诊断构建都写到 `/src/websrc/diag*`、由临时站点
  （8763/8764/8765）服务，用完即停并清理；插桩后还原并**用 sha256 复验**
  （见上「插桩的善后」）。

