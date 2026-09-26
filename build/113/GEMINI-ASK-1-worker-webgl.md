> **★ 2026-09-26 更新（发文后自解决）**：**A 节已被我方自行实测解决，不必再答** ——
> 读 Emscripten 5.0.7 源码得出关键机制：胶水只要一个"能 `getContext('webgl2')` 的对象"
> （`findCanvasEventTarget` → `specialHTMLTargets[target] || document.querySelector(target)`），
> 而 **`OffscreenCanvas` 在 worker 里可用** ⇒ worker 宿主只要把 DOM shim 的
> `createElement('canvas')`/`getElementById`/`querySelector` 指向一个**真的 OffscreenCanvas**，
> **无需任何新旗标、无需重链**就拿到真渲染后端。实测自证（worker 内部状态）：
> `graphics_toolkit()='webgl'`、无 GL 回落信号、`OffscreenCanvas` 上确有 WebGL2 上下文（560×420）、
> 绘图成品经 postMessage 上屏。
> ⇒ **请只回答 B 节（binaryen 解析失败）与 C 节（挑刺验收矩阵）**。

# 外部咨询请求 #1：WebAssembly 解释器搬进 DedicatedWorker 的两处硬骨头（+ 挑刺我的验收矩阵）

> 请用中文回答。**每个判定必须配至少一条可证伪判据**（能做成红/绿对照测试的那种）。
> 时间预算：每条"第一步最小实验"我们只留半天；**不接受"理论上应该可以"**。
> 我们**没有**把代码给你，也不需要你写代码 —— 要的是**做法、坑清单、以及最小实验的设计**。

## 0. 我们是谁（自包含描述，无需背景知识）

一个**大型成熟 C++ 数值计算解释器**（数十万行），编译成 WebAssembly 跑在浏览器单页里。技术栈事实：

- **Emscripten 5.0.7**，`-O2`，主模块 wasm ≈ **29 MB**；异常用 **wasm EH**（`-fwasm-exceptions`）。
- **运行期 `dlopen`** 一批 **side module**（可选功能库）：`-sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1`；
  side module 用 `-sSIDE_MODULE=2 -fPIC`，**不链任何库**。
- 数值库是 **Fortran 经 f2c 翻译成 C** 再编的（容器里没有 gfortran，只有 f2c 包装器）。
- **手搓 JSPI**（刻意**不**链 `-sJSPI`）：把**唯一**的挂起 import（一个返回 Promise 的
  `sleep(ms)`）在宿主层包成 `new WebAssembly.Suspending(...)`，把可挂起的解释器入口用
  `WebAssembly.promising(...)` 包。理由（实测）：5.0.7 里 `-sJSPI` 会把 `dlopen` 变成挂起点，
  连带把开机资产装载整批炸掉。
- 图形：**固定管线 GL → 翻译层 → GLES2 → WebGL2**；渲染结果 **PNG 落虚拟 FS**，页面贴 `<img>`。
- 虚拟 FS 是主要数据面（几十 MB 资产按需写进去）；页面与解释器之间是"文件队列 + 回调"的松耦合。

## 1. 已经实测过的（请**不要**再推荐这些方向）

1. **JSPI 在 DedicatedWorker 里成立**：`Suspending`/`promising` 都在，100 次挂起/恢复全成，
   等待期间 worker 的定时器照常推进；未包 `promising` 的同步调用碰挂起点会抛
   `SuspendError: trying to suspend without WebAssembly.promising`（**这是我们要的行为**）。
2. **worker 里 `dlopen` 可用**，两种 FS 来源都通：运行时 `fetch → FS.writeFile` 写的、
   以及 `--preload-file` 烘进 `.data` 的；而且**挂起穿透 dlopen 边界**（side module 回调主模块的
   挂起 import 也正常）。
3. **主线程冻结问题已量化**：单页模式下跑一次 1400² 的矩阵乘法（约 4.3 秒）期间，
   页面 `setInterval(10ms)` 的 tick = **0**；同一段计算搬进 worker 后 tick = **435**。
4. `-sENVIRONMENT=worker` **单独指定**会把开机打坏（起函数里 `_environ_get` 抛
   `RangeError: Maximum call stack size exceeded`；在普通页面里同样复现）⇒ 我们用默认环境。
5. 非模块化胶水**污染全局作用域**（自带 `run`/`Module`/`FS`…），宿主里同名函数会覆盖它 ⇒ 已改名隔离。

## 2. 三件想请你出主意的事

### A（最想要）把"真渲染后端"搬进 DedicatedWorker

**现状**：渲染后端初始化时会
① 用内联 JS（EM_ASM）在**主线程** `document` 上建一个隐藏 `<canvas>`（固定 id、`position:absolute;
left:-9999px; width:16px; height:16px`、挂在 body 上）；
② `emscripten_webgl_create_context("#那个固定选择器", attrs)`；
③ 渲染完 `glReadPixels` → 用 stb 编 PNG → 写进虚拟 FS；
④ 通过 `emscripten_run_script("window.某桥.show('/tmp/x.png')")` 让页面贴 `<img>`。
**问题**：worker 里没有 `document` ⇒ 现在只能回落到一个"只出句柄、不出图"的旧后端（功能降级）。

**想要**（要具体到 API/旗标/调用顺序）：
1. 在 Emscripten **5.0.7** 下把这条链搬进 worker 的**正解**是哪种：
   (a) 主线程 `canvas.transferControlToOffscreen()` 把 `OffscreenCanvas` 传进 worker；
   (b) worker 内 `new OffscreenCanvas(w,h)` 自己建；两者对 Emscripten 的胶水要求有何不同？
2. `emscripten_webgl_create_context` 在 worker 里**target 参数该怎么给**？（主线程下我们传的是
   CSS 选择器字符串；胶水里 `specialHTMLTargets` 只认 0/1/2 三个特殊值或选择器 —— worker 里
   没有 `document.querySelector`，请给准确的写法与它背后的机制。）
3. 需要哪些**链接期旗标**（例如 `-sOFFSCREENCANVAS_SUPPORT`、`-sOFFSCREEN_FRAMEBUFFER`、
   `OFFSCREENCANVAS_SUPPORT`/`GL_ENABLE_GET_PROC_ADDRESS` 之类）？哪些是**必需**、哪些是
   "只在某些渲染路径下必需"？有没有哪个旗标会与 `-sMAIN_MODULE=2` / wasm EH / 运行期 dlopen 冲突？
4. `glReadPixels` → PNG → **读回内存**这条路在 worker 里是否照常（还是必须走
   `transferToImageBitmap`/`convertToBlob`）？
5. **已知坑清单**：OffscreenCanvas 一次性绑定、上下文与创建它的 worker 绑定、
   尺寸/resize 语义、帧同步、context lost、以及"同一页面里第二个实例"要注意什么。
6. **最小可证伪实验**（半天内能做完的那种）：我希望是一条**从零到出像素**的链路，
   例如"worker 内建 OffscreenCanvas → 拿 WebGL2 上下文 → 画一个三角形 → `readPixels` 得到
   非全 0 像素 → `postMessage` 回主线程 blit 上屏"，并给出**每步失败时的报错文本形态**
   （我们要写"该报错的必须报错"的反向断言）。

### B 一个**只在全量链接时出现**的 binaryen 解析失败

**现象**（可复现）：把一个第三方优化 BLAS 库（wasm32、SIMD128、单线程、Fortran 接口经 f2c）
静态链进主模块后，重链在 binaryen 那一步炸：

```
[parse exception: popping from empty stack (at 0:7912702)]
Fatal: error parsing wasm (try --debug for more info)
em++: error: '…/wasm-opt --strip-target-features --post-emscripten -O2 --low-memory-unused
  --zero-filled-memory --pass-arg=directize-initial-contents-immutable … --mvp-features
  --enable-bulk-memory --enable-exception-handling --enable-multivalue --enable-mutable-globals
  --enable-nontrapping-float-to-int --enable-reference-types --enable-sign-ext --enable-simd'
  failed (returned 1)
```

**已排除**（都实测过，别重走）：
- ✗ 该库带 atomics：构建日志 0 处 `-pthread/-matomics`，归档里 `atomics` 字符串 0 处；
- ✗ 与现有 LAPACK 的**重复符号**：两边定义集交集 **0**；
- ✗ "该库的代码 binaryen 不认"：把它单独链进一个最小程序（只调一个函数）时，**wasm-opt 通过**。

**想要**：
1. `popping from empty stack` 在 binaryen 的 wasm 解析器里**到底意味着什么**
   （读到未知 opcode？节结构/类型段异常？reloc 残留？），以及它为什么会在"全量链接"时才出现；
2. 一条**定位阶梯**：怎么把失败点缩到具体的库成员/section/offset（`wasm-objdump`/`wasm-dis`/
   `--debug`/逐成员 `emar d` 二分 各自的用法与预期输出）；
3. 已知的"**wasm-ld 的产物被 binaryen 拒**"的版本/特性组合（例如某些 `--extra-features`、
   data count 段、exception handling 编码差异、`-O2` 后处理 pass 的已知 bug）；
4. **判定实验**：给一条能区分"binaryen 版本问题"与"产物问题"的实验
   （例如换某个版本的 binaryen 跑同一份产物；或 `wasm-dis` → wat → `wasm-as` 回二进制，
   看是否报同一 offset），并说明两种结果各说明什么。

### C 挑刺：我的 worker 验收矩阵还缺什么

现有 11 条判据（都在跑，全绿）：
① 单页模式无回归（不带 worker 参数时行为不变）；② worker 就绪；
③ ★**主线程不冻**（worker 长计算期间页面 tick>5）；④ ★**反向**（同一计算在单页模式下 tick=0）；
⑤ stdout 经消息上屏；⑥ worker 里可选库资产可用；⑦ ★worker 里挂起入口真让出（≥200ms）；
⑧ ★**反向**：worker 里**同步**调用碰挂起点必须失败（`SuspendError`）；
⑨ 中断投递（长循环 + 中断 ⇒ 返回码 3，事后解释器存活）；⑩ 图形要么上屏、要么**降级干净**
（报错是解释器侧的清晰文字、且事后存活）；⑪ worker 模式下页面**没有**本地解释器实例。

**想要**：我**漏掉**的边界与反向断言。请给具体的、可证伪的形式，例如（不限于）：
同时开两个 worker 会怎样？worker 被 `terminate()` 之后主线程是否干净？长任务期间消息队列膨胀/
背压？stdout 顺序与交错？worker 崩溃的可观测性（怎么让"卡死"变成"可断言的失败"而不是超时）？
虚拟 FS 与持久化在 worker 里的语义变化？资源回收（重复创建/销毁）？

## 3. 交付格式

按 A/B/C 分节；每条判定给：**推荐做法 | 关键坑 | 第一步最小实验（≤半天，可证伪）| 失败时我们该看到什么**。
若某条你也不确定，**请直接说不确定**并给出"怎么验证"的办法，而不是给一个听起来合理的答案。
