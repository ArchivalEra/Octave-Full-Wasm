# NOTES · `lsode` 调用即整页 trap（**两代基线共有**，2026-09-22 发现）

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
> 这正是 HANDOFF §10.3 坑 4 说的那件事的第二次复现：
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
   重复定义（见 HANDOFF §10.3），**被丢弃的那份定义里如果含状态，行为就不对了**。
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
（HANDOFF §10.3 坑 5 早就写过这条教训：**别用"符号在不在"推断 trap**。）

### 下一步（精确版，还没做）
1. **带 `-g -gsource-map` 重链**（复用 `DIAG_NAMES` 那套开关），把
   `octave.wasm:wasm-function[NNNN]:0x1344e1d` 里那个 **wasm 偏移**映射到
   源码行 —— 这样就能直接看出是 `rwdata()` 还是 `F77_XFCN` 那一行。
2. 或者在 `LSODE.cc` 的 `F77_XFCN (dlsode, …)` **前后各加一句 `fprintf(stderr,…)`**，
   重建 `liboctave` 后看它停在哪一边（代价：改一行 + 重编 1 个文件 + 重链，
   别把改动留在树上）。
3. 若确认在 `dlsode` 内部：重点查 f2c 回调 ABI —— `lsode_f`/`lsode_j` 是作为
   **函数指针**传给 Fortran 的，在 wasm 里走 `call_indirect`；**签名不匹配会直接
   trap 且报在调用点**。可对照 `liboctave/numeric/LSODE.cc` 里两个回调的签名与
   f2c 版 `dlsode.f` 里 `EXTERNAL LSODE_F, LSODE_J` 的调用点。

## 现状定性
- 8761（7.2）与 8761/8762（11.3.0）**都是这个状态**：`lsode` **从来没在这个项目里
  工作过**（不是本轮换基线引入的，也不是回归）。
  此前没被发现，是因为 7.2 的 `accept-ode15` 对 `lsode` **只断言了 `exist`**。
- 已记入 `HANDOFF.md` §10.6 作为独立待办；`accept-113-ode15` 第八节单独隔离复现它、
  不计入 PASS/FAIL，避免它一 trap 就把整个套件打死。
- 诊断用的两个临时站点（8763/8764，`diagsite`/`diagsite2`）**不参与验收**，
  部署产物（8761/8762）全程未被诊断构建污染。

