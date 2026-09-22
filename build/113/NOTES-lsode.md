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

## 现状定性
- 8761（7.2 基线）**本来就是这个状态**，本轮没有让它退化，验收底线未破。
- 8762（11.3.0）继承同一状况。
- 已记入 `HANDOFF.md` §10.6 作为独立待办（不在本轮 6 项内）。
