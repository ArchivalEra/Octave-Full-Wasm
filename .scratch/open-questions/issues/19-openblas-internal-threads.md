# 19: 让 `USE_THREAD=1` 的 OpenBLAS 产物**能用**（拿那 6.7× 内部多线程）

**What to build:** 现役线程档交付的是 OpenBLAS **`USE_THREAD=0`**（`threads_blas_dir` =
`/src/work/e2-openblas-lib-s`，收益 matmul ≈1.9×）。**`USE_THREAD=1` 那份有 ≈6.7×**
（台账 `e2_threaded_matmul500_ratio`）但**不可用**：装载 `.oct` 挂死（工单 16 定位）。
**用户指令（2026-09-29）：内部多线程要，不是可选项。** 本单 = 把那份产物修到可用。

**Blocked by:** None（工单 16 的定位已交付：`CELLS=C,E,F,D` 阶梯，见 NOTES-threads「工单 16 结案」）

**Status:** resolved

**Settling:** 两值可分辨 —— 修好后 —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
`CELLS=C,A PROBE_... sh test/browser/run.sh test/browser/probe-e2-threads.mjs <threaded产物站点>`：
格 C（只 dlopen）**返回**（干净报 "must be square"）⇒ A（裸跑）也返回 ⇒ rc=0 ⇒ 修好；
格 C 仍挂 ⇒ 未修（当前实测形状）。**反向断言**：现役 `USE_THREAD=0` 站点上格 C 必须**本来就返回**
（不许把"把线程关掉"当成修好）—— 且 `e2_matmul500_ratio` 必须仍 ≈1.9×（不能悄悄退回车道）。

**Type:** task

## 已知事实（2026-09-29，全部可复跑）

| 事实 | 复跑 |
|---|---|
| 墙 = 在 `USE_THREAD=1` 主模块上**装载 `.oct`（dlopen）挂死**，>90s、100% CPU 忙等形状 | `CELLS=C sh test/browser/run.sh test/browser/probe-e2-threads.mjs http://127.0.0.1:8792/` |
| **不是** BLAS 算术：同站点纯 `rand(300)*rand(300)` 返回 | 同上 `CELLS=D` |
| **不是** error 路径：纯 `error('boom')` 返回 | 同上 `CELLS=E` |
| **不是**线程数：先 `openblas_set_num_threads(1)` 仍挂 | 同上 `CELLS=B` |
| `.oct` 文件**两端逐字节相同**（`413eb730…`）⇒ 差别在主模块 | `sha256sum site-e2diag/threads/minioct.oct site/threads/minioct.oct` |
| 现役 `USE_THREAD=0` 站点上同一句**正常**（`accept-113-oct` 8/0） | `sh test/browser/run.sh test/browser/accept-113-oct.mjs http://127.0.0.1:8768/` |

## ★ 机制（2026-09-30 从 Emscripten 运行时读出来的，比原假设更准）

`libpthread.js` 里有 **dlsync** 一族：`_emscripten_dlsync_threads`（`proxy: 'sync'`）+
`__emscripten_dlsync_self`。含义：**动态链接动作（`dlopen`/`dlsym` 新模块）要求跨线程同步** ——
调用线程要**其它每个线程回到 JS 事件循环应答**。而 OpenBLAS（`USE_THREAD=1`）的池线程
自旋在**原生代码里**（`YIELDING` = 8×`nop`，`common.h:382`），**回不到事件循环** ⇒
应答永远不来 ⇒ **dlopen 永久阻塞**，且自旋线程把 CPU 打到 100%。
⇒ 这条**精确解释了"只有 dlopen 挂"**：纯 BLAS 算术、纯 `error()`、内存增长（见 G 格）
都**不需要 dlsync**。也解释了为什么 `USE_THREAD=0` 那份产物一切正常（**根本没有池线程**）。

**两个候选修法**（等 G 格结果定优先）：
- **A（旋钮，最便宜）**：让池线程**早点停**。`THREAD_TIMEOUT` 默认 **28**（`1U<<28` ticks
  ⇒ 实际上"几乎不停"），而 `OPENBLAS_THREAD_TIMEOUT` 环境变量可覆盖（被夹在 4..30，
  见 `driver/others/blas_server.c:162-166,554-580` + `openblas_env.c:65`）——但**自旋窗口
  只是变短**，不是消失；dlopen 撞上窗口照样挂。
- **B（正解）**：让 pool 的等待**走 Emscripten 能应答的原语**（`emscripten_futex_wait`
  一族，运行时会给它让出事件循环），或者干脆让 OpenBLAS 的 worker 空闲时**停在 JS 事件循环**里。
  这需要**打补丁**（本仓已有 `patch-openblas-*.py` 三件套的先例，都带 `--selftest`）。
- **C（绕过）**：把所有 `.oct` 的 dlopen **挪到任何 BLAS 调用之前**（启动期预热）。
  ⚠️ 只在"池是**首次 BLAS 调用**时创建"的前提下成立 —— 若池在**模块初始化**
  （OpenBLAS 的 ctor / `gotoblas_init`）就建好，则此法**无效**。**这一条本身就是一个可验的实验**。

## 待验假设（按可能性排序，**每条都写了判别实验**）

1. **★ 自旋的 worker 线程卡住共享内存增长**（最强候选；**已找到源码级旁证**）。
   **源码证据**（容器内 `sed -n '415,430p' /src/work/OpenBLAS-e2/driver/others/blas_server.c`）：
   worker 的无活等待是一个 `while(!tscq...) { YIELDING; ... }` 热循环，而
   `YIELDING` 的定义是 `__asm__ __volatile__("nop;...nop;")`（`common.h:382`）——
   **在 wasm 里不是真让出**（`sched_yield` 语义缺失），于是池线程持续自旋（实测 100% CPU 形状吻合）。
   机制：Emscripten 的 `-pthread` 共享内存在 `ALLOW_MEMORY_GROWTH` 下**要所有线程到安全点**才能
   增长；而 OpenBLAS `USE_THREAD=1` 的池线程用**自旋同步**（wasm 里 `sched_yield` 近似空转）
   ⇒ 永远到不了安全点 ⇒ 需要增长的 `dlopen` **永不完成**，且 CPU 100%（线程在自旋）。
   这也解释了"设成 1 线程仍挂"（池已建）。
   **判别实验（便宜、决定性）**：在 threaded 站点上**不碰 dlopen**、只强制内存增长
   （`a = zeros(1, 200e6); a(end)=1;`）—— 挂 ⇒ 假设成立（墙是"增长"而不是"装载"）；
   返回 ⇒ 假设否掉，看第 2 条。
2. **dlopen 自身在 shared-memory 下的锁**（dylink 互斥 + TLS 槽分配）与 OpenBLAS 初始化互锁。
   **判别**：把 `PTHREAD_POOL_SIZE` 加大/改 `PTHREAD_POOL_SIZE_STRICT`，看挂点是否移动。
3. **OpenBLAS 的 `pthread_create` 在主线程上做 `Atomics.wait`**（等 worker 可用）而 worker 起不来。
   **判别**：`-sPTHREAD_POOL_SIZE=0`（动态建线程）vs 固定池，两种产物的挂点对比。

## 修法方向（等 1/2/3 定案再选，别先写代码）

- 若第 1 条成立：让 OpenBLAS 的同步**可被打断**（`OPENBLAS_THREAD_TIMEOUT`/自旋次数，
  或改用 `USE_SIMPLE_THREADED_LEVEL3`/`USE_OPENMP=0` 的 park 型同步），或在 boot 期间
  **预增长内存**到目标值（把增长从 dlopen 那一刻挪走）。
- 若第 2 条成立：把 `.oct` 装载**挪到 boot 早期**（任何 BLAS 调用之前），或改内存增长策略。
- 若第 3 条成立：固定池 + `PTHREAD_POOL_SIZE_STRICT=2` 早建池，让 `pthread_create` 不再阻塞。

## 硬坑（照抄）

- **不许覆盖现役**：新产物落独立 prefix/目录（`e2-openblas-lib` 那份是实验档）。
- 一次只动一个轴（本单不夹带 E2 之外的活）。长任务后台 + 完成通知，**禁止 `sleep`**。
- 判据必须**两值可分辨**（修好/未修好），且必须带**反向断言**（见 Settling）。

## ★★ 根因确认（2026-09-30，插桩实测，**决定性**）

**做法**（本仓 LSODE 那套"插桩把墙夹死"的复用）：把诊断产物**复制**一份到 `/tmp/e2-inst`
（不碰 8792），在它的胶水 `octave.js` 里给两处插日志：`__emscripten_dlsync_threads()`
的每个 `__emscripten_proxy_dlsync` 前后、以及 `dlopenInternal` 进出。起 8793 跑同一格 C。

**实测输出**（挂死那一刻）：
```
[G1-DIAG] dlsync_threads START, pthreads=3
[G1-DIAG]   proxy_dlsync > 70320176
Blocking on the main thread is very dangerous, see …/pthreads.html#blocking-on-the-main-browser-thread
（之后 75 s 内**再也没有** "proxy_dlsync < … OK"，也没有 dlopenInternal LEAVE）
```
⇒ 挂点 = **对一个 pthread 的同步代理永不返回**。

**机制（三条合起来就是完整因果）**：
1. `dlopen` 在 Emscripten 里**必须**先 `__emscripten_dlsync_threads()`（`octave.js:12194`）——
   它遍历 `PThread.pthreads`，对**每个**线程发 `__emscripten_proxy_dlsync`（同步代理）；
2. 同步代理要求目标线程**回到 JS 事件循环应答邮箱**；
3. 而 OpenBLAS（`USE_THREAD=1`）的 worker 在**库初始化**时就进入 `thread_server` 的原生死循环
   （`blas_server.c`），**从此刻起永不回 JS** ⇒ 应答永远不来 ⇒ 代理阻塞、自旋线程把 CPU 打满。
   ⇒ 也解释了"设成 1 线程仍挂"（池在 boot 期已建好，运行期改线程数不消灭它）。

**已排除的其它候选**（都是实测）：
| 候选 | 判别 | 结果 |
|---|---|---|
| 共享内存增长被自旋挡住 | 格 G：只 `zeros(1,200e6)` 不 dlopen | **返回** ⇒ 否掉 |
| BLAS 算术/池不可用 | 格 H：大 dgemm 1200²（越过线程阈值） | **返回** ⇒ 否掉 |
| error 路径 | 格 E：纯 `error()` | 返回 ⇒ 否掉 |
| 线程数 | 格 B：`set_num_threads(1)` | 仍挂（池已存在） |

## 修法（据此重排）

- **A（正解，要重建 OpenBLAS）**：让 worker 的**等待路径对邮箱友好** —— 把 `blas_server.c`
  的空闲等待（`YIELDING` 纯自旋 / `pthread_cond_wait` park）改成**会回 JS 事件循环**的原语
  （Emscripten 的 `emscripten_thread_sleep()` 一族会处理邮箱）。本仓已有
  `patch-openblas-*.py` 三件套的先例（都带 `--selftest`）。
- **B（可能更省，需先验）**：让 OpenBLAS 的池**不在库初始化时创建**（延迟到首次 BLAS 调用），
  并在页面 boot 里**先 dlopen 全部会用的 `.oct`**，再让池出生。⚠️ 若池确实由 ctor 建，
  此法无效 —— **这一条本身是一个便宜的可验实验**（在页面最早时刻调 `dlopen`）。
- **C（兜底）**：给 `__emscripten_proxy_dlsync` 加超时并降级为警告 —— **不推荐**：
  dlsync 是 dlopen 正确性的一部分，跳过它可能带来难查的内存/重定位错。

**下一步（本单的下一交付物）**：先做 B 的判别实验（便宜）；不行就走 A（写
`patch-openblas-thread-yield.py` + 重建 + 重链 + 用同一格 C 判绿）。

## 后续判别（2026-09-30 晚，全部实测）

| 格 | 内容 | 结果 | 含义 |
|---|---|---|---|
| **G** | 只 `zeros(1,200e6)`（强制内存增长，**不 dlopen**） | **返回** | 否掉"增长被自旋挡住" |
| **H** | 大 dgemm 1200²（**越过线程阈值**，不 dlopen） | **返回** | 线程池**计算**可用 |
| **I** | 初始化前注入 `Module.ENV.OPENBLAS_NUM_THREADS=1` 后 dlopen | 仍挂 | ⚠️ 但**注入是否生效未验证**（读 `Module.ENV` 会把胶水打进 `unreachable`）⇒ 本格**不构成结论** |
| **L** | `pause(5)` 空闲 5s（让池从自旋转 park）后 dlopen | **仍挂** | ⇒ **park 后的线程也不应答邮箱** ⇒ 墙不是"自旋期"，而是**任何长驻原生等待** |

**开机期的反例（重要）**：boot 期间资产车道的 dlopen（`__init_web__.oct` / `webgraphics` / …）
**全都成功** ⇒ **池是 boot 期间出生的**，且"池出生之前 dlopen 正常"。

⇒ **修法据此收窄为三选一（都要动产物，不是页面侧能救的）**：
1. **让 worker 在空闲时回到 JS 事件循环**（能在事件循环里应答邮箱）—— 需要给 OpenBLAS 的
   空闲等待加"邮箱友好"的原语（Emscripten 侧提供 `_emscripten_thread_mailbox_await` /
   `checkMailbox` 机制，见 `libpthread.js:1270,1291`）；**这是正解，但要重建 OpenBLAS + 重链**。
2. **让池晚出生**：把"会用到的 `.oct` 全部 dlopen"挪到**池出生之前**（boot 早期）——
   与资产车道的懒加载冲突（用户随时可能调新能力），只能是**部分缓解**。
3. **避免 dlsync**：不用运行期 dlopen ⇒ 与 `.oct` 车道架构冲突。**不可选**。

**本单未完成的部分（交接要点）**：
- 上面第 1 条**尚未实施**（需要 `patch-openblas-thread-yield.py` + 重建 + 重链 + 用格 C 判绿）；
- 第 2 条的可行性可用一个**便宜的实验**判定：在 boot 最早的钩子里 dlopen 一个 `.oct`
  （若成功 ⇒ 池确实晚于它出生 ⇒ 可做"预热装载"）。

## ★ 修法设计（2026-09-30 定稿，可直接实施）

**两个事实合起来就给出修法**：
1. Emscripten 的 dlsync **跳过已结束的线程**：
   `octave.js:12196  if (!PThread.finishedThreads.has(pthread_ptr)) { … proxy … }`
   —— 死掉的线程不再是障碍；
2. Emscripten 的**池线程**在线程函数返回后**回到 JS 事件循环**（那时它能应答邮箱）；
   而 OpenBLAS 的 server 线程**永不返回**（`thread_server` 的 `while(1)`），
   所以只要池活着，dlopen 就永远等不到应答。
3. OpenBLAS **自带懒重建**：`exec_blas`/`goto_set_num_threads` 里都有
   `if (unlikely(blas_server_avail == 0)) blas_thread_init();`
   —— 池被关掉之后，下一次 BLAS 调用会自动把它建回来。

⇒ **补丁（`build/113/patch-openblas-idle-exit.py`，按本仓 `patch-openblas-*.py` 惯例带 `--selftest`）**：
改 `driver/others/blas_server.c` 的空闲超时分支
（`if ((unsigned int)rpcc() - last_tick > thread_timeout)` 那一支，当前行为是
`thread_status[cpu].status = THREAD_STATUS_SLEEP; pthread_cond_wait(...)`）：
- 改成**让该 worker 退出**：置 `queue = (queue_t)-1` 并让循环 `break`（与 shutdown 同一出口），
  同时把 `blas_server_avail = 0`（下一个 `exec_blas` 会重建池）；
- 并把 `thread_timeout` 从默认 `1U<<28`（≈0.27 s，纳秒计数器）**加大到 ~1–2 s**
  （否则池会被反复拆建，BLAS 性能崩）——即"活跃期保有池、空闲后解散"。

**代价与取舍（要如实写进 NOTES）**：空闲后首次 BLAS 调用要重建 4 个线程
（Emscripten 池里 `pthread_create` 便宜，但仍有一次延迟）。
换来的是**运行期 dlopen 不再挂死** ⇒ 资产车道与 `USE_THREAD=1` 可以共存。

**判据（用现成的格 C）**：打完补丁重建 + 重链后
`CELLS=C,E,F,D,G,H,L sh test/browser/run.sh test/browser/probe-e2-threads.mjs <该产物站点>`
⇒ 格 C 必须**返回**（"墙没了"），且格 D/H 仍返回（算术没退化）；
**反向断言**：`e2_matmul500_ratio` 必须仍在 6.7 量级（不许把线程偷偷关掉换绿灯）。

**备用方案（若上面的补丁让 BLAS 明显变慢）**：页面/宿主在"要 dlopen 之前"先显式
`blas_thread_shutdown()`（OpenBLAS 已导出该符号）—— 只在装载资产的那几个时刻付一次代价。

## ★★ Answer（2026-09-30）：修法落地并**实测通过** —— dlopen 的墙没了，收益完整保留

**交付物**：
1. `build/113/patch-openblas-idle-exit.py`（带 `--selftest` 4/0：能打 / 幂等 / **片段不在必须 FATAL** /
   **文件不存在必须 FATAL**）；
2. 补丁已应用于 `/src/work/OpenBLAS-e2`（标记 `OCTAVE-WASM-IDLE-EXIT` ×2）：空闲超时分支由
   "永久 park"改为**让该 worker 退出**（走 shutdown 同一出口 + `blas_server_avail=0`，
   OpenBLAS 自带懒重建），`THREAD_TIMEOUT` 由 ≈0.27 s 加大到 ≈1.5 s（避免池被反复拆建）；
3. 重新打包到**独立**目录 `/src/work/e2-openblas-lib-idleexit`（没覆盖现役）；
4. 线程车道树重编 + 重链（`--diag`）⇒ 产物 `verdict=ok`，sha `55b268ca81e42481…`。

**判据实测（新产物站点 8794）**：
| 判据 | 结果 |
|---|---|
| **格 C**（`.oct` 装载 = 原挂死点） | **returned**（`last_error=miniprobe: argument must be a numeric matrix` —— 函数跑到自己的参数检查 ⇒ 装载段活着） |
| 格 D / H（纯算术，含越过线程阈值的大 dgemm） | returned |
| **反向断言**：`bench-core` 矩阵乘 500² 中位数 | **0.006 s** —— 与补丁前 `e2_threaded_matmul500_s` **相同** ⇒ 相对车道的 ≈6.7× 收益**完整保留**（没有靠关线程换绿灯） |

**机制回顾（三条实测事实）**：Emscripten 的 dlsync **跳过已结束的线程**；池线程在**线程函数返回后
回到 JS 事件循环**（那时能应答邮箱）；OpenBLAS **自带懒重建**（`exec_blas` 里 `blas_server_avail==0`
就 `blas_thread_init()`）。⇒ "空闲即解散"同时满足"dlopen 拿得到应答"与"多线程不丢"。

**代价（如实记）**：空闲约 1.5 s 后池解散，下一次 BLAS 调用要重建 4 个线程（Emscripten 池里
`pthread_create` 便宜，但仍有首次延迟）。**活跃计算期间不受影响**（实测收益未变）。

**未做（本单范围之外，另开一张）**：把这套补丁**进正式车道流水线**（`build-w64-lane.sh` 同级的
E2 车道重建脚本 + 全量回归 + 是否把 `USE_THREAD=1` 作为交付形态上线）——那是一次**换产物批次**，
且是产品决定。
