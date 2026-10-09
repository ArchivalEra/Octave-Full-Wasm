# 35: **E2 车道驱动的四处静默缺陷**（w64+线程版 OpenBLAS 路上抓到的，全部已修）

**What to build:** 用户点名的目标形态（`w64` + `USE_THREAD=1` 的 OpenBLAS）在路上连续撞到四处
"**链得过 / `verdict=ok` / 自检全绿，但结果是错的或运行期崩**"的缺陷。四处都修了并配了自证。

**Blocked by:** None

**Status:** resolved （2026-10-01）

**Settling:** `sh build/gates-selftest.sh` ⇒ 相关闸门自证全绿：
`relink` 16/0、`patch-openblas-symbol-prefix` 9/0、`patch-openblas-emscripten` 9/0、
`gen-f77-wrappers` 13/0。链路判据：`relink.sh link w64`（带 `E2_OPENBLAS`）⇒ `verdict=ok`
**且**页面开机自检过（**这一条是本次血的教训：`verdict=ok` 不保证跑得起来**）。

**Type:** task

## 四处缺陷（按撞到顺序）

| # | 缺陷 | 症状（离根因多远） | 修法 |
|---|---|---|---|
| 1 | `rebuild` 不导出**车道依赖**（`DEPS`/`D`/`TARGET_HOST`） | configure 第①步就死在 Fortran 链接自检 | 从模式表取值 + export（工单 32a） |
| 2 | `rebuild` 的**线程开关**对 `w64` 错（`WITH_THREADS=0`，而 w64 是 pthread 车道） | 树自相矛盾；链到 wasm-opt 才炸 | `threads\|w64 ⇒ 1`（工单 32b） |
| 3 | 树构建没把**车道 `F2C_PREFIX`** 导出 | wasm64 下 `ftnlen` 宽度分叉（i64 vs i32）⇒ 26 条 mismatch ⇒ wasm-opt 判模块非法 | export F2C_PREFIX（工单 34） |
| 4 | `patch-openblas-symbol-prefix.py` / `patch-openblas-emscripten.py` 的 **`--check` 退出码不是契约**（一律返 0） | 驱动当"已打 ⇒ 跳过"⇒ ①符号不带 `ob_`（76 条 mismatch）②`blas_server.c` 在 wasm64 下编不过 ⇒ **库缺成员**⇒ 链接照过、**页面崩** | 按 0=已打/1=可打/3=不可打 的契约改，各配三条 CLI 级自证 |
| 5 | E2 驱动的 `stage_build` 把"**库文件存在**"当成"只有 utest 失败" | 缺成员的库被打包（第 4 条②的下游），`verdict=ok` 且运行期崩 | 判据落到**报错目标**：utest/tests 之外的 `Error 1` 一律 FATAL |

## 这次最有价值的排查链（可复跑）

页面报 `Cannot read properties of undefined (reading 'value')`
→ 栈指 `reportUndefinedSymbols`（Emscripten dylink 的 GOT 检查）
→ 给 glue 的 `typeof value.value` 加 undefined 守门后**点出符号名**：
`bad export type for 'blas_cpu_number'`
→ `emnm` 对比两份归档（wasm32 那份**有定义**、w64 这份只有 `U`）⇒ 库缺成员
→ `grep "Error 1" make.log` ⇒ `blas_server.c` 的 `struct rlimit`/`raise`/`SIGINT` 在 **wasm64 sysroot**
下编不过 ⇒ 该文件的对象没产出。

⇒ 结论：**"缺一个成员"这类缺陷，`verdict=ok` 与"库文件存在"都查不出来**，必须有
①按报错目标收紧的 make 判据 ②运行期开机自检。补丁的 `--check` **退出码必须是契约**（第二次踩）。
