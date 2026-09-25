# 浏览器内 WebAssembly 多线程化路线评审（数值解释器 · BLAS / Worker / SIMD）

> 请用中文回答。**每个判定必须配至少一条可证伪判据**（要能做成红/绿对照测试的那种）。
> 时间预算：每个"第一步最小实验"只留半天；不接受"看起来可行"，只要能证伪的答案。

## 0. 我们是谁、要什么

我们有一个**大型成熟 C++ 数值计算解释器**（数十万行），编译成 WebAssembly（Emscripten **5.0.7**，
`-O2`，主模块 wasm 约 29 MB）跑在浏览器页面**主线程**。异步交互问题上一轮已经解决并全量回归通过
（手搓 JSPI，见 §2）。现在要探索**多线程**，按优先级：

1. **数值内核提速**：大矩阵乘法/分解是主要耗时；现链的 BLAS 是**纯标量 reference 实现**。
2. **主线程自由**：计算密集段仍会冻结页面——JSPI 只在挂起点让出，挂起点之间照样卡。
3. 解释器内部真并行若存在正路也请指出（我们预判不可行，见 C5，请复核）。

**环境与底线**：

- 部署：**纯静态 https 托管（GitHub Pages）+ 本地 localhost**；纯客户端，没有任何服务端执行端点。
- **上轮约束正式重开**：上轮评审时"任意静态 http ⇒ 不能依赖 COI"、因此把"Worker 化 / COI+pthreads"
  列为"明确不做"。现在部署面已收窄为 https + localhost，**这两条约束本次解除**，正是本评审的由来。
- **现有全绿回归不许退化**：约 70 个自动化浏览器套件 + 若干自检闸门；任何路线必须可回退。
- **优雅降级**：能力不足的浏览器上功能不能死（JSPI 已这么做：单产物 + 运行期能力门 + 清晰报错），
  多线程路线必须同样可降级，不许抬全站浏览器下限。
- 浏览器基线：Chrome≥137 / Firefox≥153 / Safari≥27（JSPI 基线）。

## 1. 现栈（全部实测过）

- 链接模型：`-sMAIN_MODULE=1` + `-sALLOW_TABLE_GROWTH`，**运行期 `dlopen` 装载一批 side module
  数值扩展插件**（side module 用 `-sSIDE_MODULE=1 -fPIC -shared`，不链任何库）。
- 异常：`-fwasm-exceptions`（wasm EH）。
- BLAS/LAPACK：自建 **reference BLAS + reference LAPACK + f2c**；configure 显式
  `--with-blas/-with-lapack` 指过去，且 `--disable-threads`（AX_PTHREAD 已补丁剔除）。
- 内存：`INITIAL_MEMORY=128MB` + `ALLOW_MEMORY_GROWTH=1`（未设 MAXIMUM_MEMORY）。
- 全链接行**零** pthread / SHARED_MEMORY / msimd128 / PROXY_TO_PTHREAD。
- 图形：WebGL2（固定管线经翻译层跑 GLES2/WebGL2）；渲染 canvas 由 wasm 侧内联 JS 在**主线程**
  document 上创建；渲染成品 PNG 落虚拟 FS，页面贴 `<img>`；字体（FreeType+fontconfig）是进程内纯计算。
- 页面接触面：点击/键盘事件队列（window 级）、stdin 队列、IndexedDB 持久化（`FS.syncfs` 全在页面 JS）、
  资产 fetch→sha256→写 FS→addpath、`emscripten_run_script` 回调页面全局。
- 测试：约 70 个 playwright 套件，`page.evaluate` 直调 `Module.eval_string / eval_async`。

## 2. 已实测的机制与已证伪的路（别推我们走回头路）

1. **手搓 JSPI 成立**（不链 `-sJSPI` 胶水）：唯一挂起 import 用 `new WebAssembly.Suspending()` 包、
   挂起入口用 `WebAssembly.promising()` 包；`-sJSPI` 胶水与 dlopen 的坑已逐档实测（调用链里有 dlopen
   ⇒ 上游整条入口被穷举标记为挂起点；静态初始化期间碰 dlopen ⇒ 模块初始化直接死）——所以绕开胶水。
   单产物 + 运行期能力门（`typeof WebAssembly.Suspending`）优雅降级，已全量回归通过。
2. **Asyncify 死路**：与 `-fwasm-exceptions` 不兼容（emcc 明确拒绝、链接失败）。不要推荐。
3. **dlopen 全部发生在解释器调用线程**（目前 = 主线程）。
4. 我们有"最小探针车道"的习惯：每个机制先在最小复现程序上验证，再上真产物。

## 3. 候选路线（请逐个判定）

### C1 · COI 基建 + 线程能力门（铺路石）
coi-serviceworker 式 service worker 注 COOP/COEP（静态托管变通）+ 运行期能力门
（`typeof SharedArrayBuffer && crossOriginIsolated`，复刻已验证的 JSPI 能力门模式）。纯增量、可回退。
要审：**Q6**（SW 方案的坑清单与更干净的替代）。

### C2 · 多线程 BLAS（OpenBLAS-pthread 替换 reference BLAS）★ 请重点审
数值内核提速的正路：BLAS 后端换 OpenBLAS（pthread 后端），主模块加 `-pthread -sSHARED_MEMORY`
重链。解释器/图形/资产层零改动——BLAS 是唯一"不碰 DOM、纯计算"的并行切面，LAPACK ABI 本来就是
现成接口。
**我们已知的风险**（请逐条判断真假与解法）：
- **R1 pthread × MAIN/SIDE_MODULE 运行期 dlopen**：emscripten#9582 记录两者历史互斥；现代版本
  支持到什么程度？5.0.7 呢？side module 需要哪些旗标与主模块匹配？
- **R2 `ALLOW_MEMORY_GROWTH` × pthreads**：shared memory growth 的现状？是否必须 `MAXIMUM_MEMORY`
  预留？浏览器地址空间预留有哪些平台差异？
- **R3 无大厂先例**：Pyodide 至今默认单线程（官方文档明说线程需 COI/SAB、包要打补丁）。是没人需要，
  还是有暗坑？
- **R4 数值一致性**：LAPACK 实现差异 ⇒ 我们有全量回归 + 数值探针可兜底，但请指出已知的常见差异类型。

### C3 · 解释器整体搬 Worker（主线程自由）
wasm + 虚拟 FS + JSPI 钩子整体迁 DedicatedWorker；主线程只留 DOM/事件/图形展示，四条 postMessage
桥（输入、点击、图形成品、中断转发）；图形改 OffscreenCanvas 路线（`transferControlToOffscreen` 或
Worker 直建）；测试加一层 Worker RPC 垫片保持 `Module` API 面不变。
要审：**Q4**（JSPI×Worker）、**Q8**（WebGL2×OffscreenCanvas×Worker 成熟度）、以及"工程量 vs 收益"
的排序判断（相对 C1+C2）。附带问题：解释器侧目前仅存的一处同步 XHR 在 Worker 里是否反而合法？

### C4 · wasm SIMD（`-msimd128` 重编）——非线程，相邻杠杆
同一目标（数值提速）上的正交杠杆：BLAS1/2 内核常见 1.5-3×，不碰 SAB/COI/线程模型，单线程优雅降级
天然成立。请作为 C2 的**对照基线**一起评：如果 SIMD 够用，pthread 的 R1–R4 复杂度是否可不背？
风险：数值位型差异、29 MB 大模块的 codegen 回归。

### C5 · 解释器内部真并行（我们预判不可行，请复核）
三条证据：① 解释器求值状态非线程安全（单一符号表；上游明确不支持线程化解释）；② 上游并行扩展包用
`fork()`，wasm 无 fork；③ 多 Worker 多实例 = N×29 MB + 数据交换要序列化或 SAB 数据平面（堆指针
跨线程不可传）。**请确认我们没漏掉路**（值得注意的先行者、线程安全子解释器先例等）。

## 4. 具体技术问题（请逐条给可证伪答案）

- **Q1** pthreads × 运行期 dlopen（MAIN_MODULE/SIDE_MODULE）在 Emscripten 5.0.x 的真实支持状态？
  #9582 之后补了什么？side module 侧需要哪些旗标匹配？有没有"已知能跑"的最小配置？
- **Q2** `ALLOW_MEMORY_GROWTH=1` × pthreads：现在支持吗？必须设 `MAXIMUM_MEMORY`？128 MB 初值
  合理吗（无 MAXIMUM_MEMORY 现状要不要改）？
- **Q3** 运行期 `dlopen` 能否从 **pthread 工作线程**调用（我们所有 dlopen 都在解释器线程）？
- **Q4** JSPI（`WebAssembly.Suspending` / `promising`）在 **DedicatedWorkerGlobalScope** 的可用性？
  同一产物既挂起又开 pthread，有没有已知冲突？
- **Q5** OpenBLAS 在 emscripten/wasm32 上带 pthread 后端有没有成熟构建先例（上游、发行版、知名项目）？
- **Q6** coi-serviceworker 的完整坑清单（首访 reload、scope 与 **iframe 嵌入**、SW 缓存与资产指纹缓存
  的交互、bfcache、Safari）？若托管层可换成支持自定义头的静态托管（如 Cloudflare Pages），是否显著更干净？
- **Q7** refblas → OpenBLAS(pthread) 与 `-msimd128` 各自的期望加速比（≤2000×2000 double 矩阵）？
  叠加是乘法关系吗？
- **Q8** WebGL2 + OffscreenCanvas 在 DedicatedWorker 的成熟度与坑（`transferControlToOffscreen`
  一次性绑定、context lost、帧同步、字体渲染替代）？
- **Q9** 红线检查：以上哪些路线会破坏"纯静态托管 / 纯客户端 / 优雅降级 / 现有回归不退化"四条底线？

## 5. 交付格式

判定表：**路线 | 推荐度（推荐 / 有条件推荐 / 不推荐）| 关键风险 | 第一步最小实验（≤半天、可证伪）**。
若存在我们没想到的更优路线，请单独给出并配判据。
