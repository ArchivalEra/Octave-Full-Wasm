# NOTES · T10（G2）Asyncify 最小实验 —— **结论：这条路被 `-fwasm-exceptions` 堵死**

> 2026-09-22。计划里 T10 写的是"只实验不采用：用 `ASYNCIFY_IMPORTS/ONLY/REMOVE`
> 限制插桩范围，测体积/性能/回归"。**实验做完了，结论比预期干脆：它在这个构建里
> 根本链不出来。** 下面是实测记录。

## 一、为什么要做这个实验（它现在比计划里更重要）

计划里 T10 只是"看看能解锁什么"。但 T7 的实测把三件事串成了一条链，
**`recordblocking` 与 `uigetfile` 都卡在它上面**：

1. 实测 **`pause()` 期间浏览器事件循环完全停摆**（区间内 tick = 0，三种写法都一样）。
2. 所以"Octave 阻塞式等待一个**异步**浏览器 API"这件事做不到 ——
   页面被冻住，异步操作没机会推进。
3. 而 `recordblocking`（等页面录完）与 `uigetfile`（等用户选完文件）**都是这一形态**。
4. 反过来也解释了 `input()` 为什么能用：`window.prompt` 是**同步**的浏览器 API。

⇒ 唯一已知的出路就是 Asyncify（把 wasm 栈 unwind/rewind，让同步代码能"暂停"）。
所以这个实验的结论直接决定 T8 怎么做。

## 二、做法（在 `o113` 里，**输出到独立目录，不碰部署产物**）

`build/113/link-web.sh` 已经留了 `EXTRA_LDFLAGS` 口子（未加引号展开，
所以里面可以写 `-s NAME=value` 这种带空格的形式）：

```sh
cd /src/bin && PATH=/src/bin:$PATH \
  EXTRA_LDFLAGS="-s ASYNCIFY=1" bash link-web.sh /src/websrc/asyncify-out
```

日志：`/src/libwork/asyncify-link.log`。无需重编任何 `.o`（Asyncify 是**链接期**的
binaryen 变换）。

## 三、结果：**失败，而且是硬失败**

### 1) Emscripten 自己先给了明确警告（原文）

```
em++: warning: ASYNCIFY=1 is not compatible with -fwasm-exceptions. Parts of the
      program that mix ASYNCIFY and exceptions will not compile. [-Wemcc]
```

来源可查：`/emsdk/upstream/emscripten/emcc.py:438`
（同文件 427/429 行是 `DISABLE_EXCEPTION_*` 与 `-fwasm-exceptions` 的同类互斥检查）。

### 2) 链接真的断了（原文）

```
Fatal: Module::getFunction: __asyncify_get_call_index does not exist
em++: error: '/emsdk/upstream/bin/wasm-opt ... --asyncify ... ' failed (returned 1)
```

`wasm-opt --asyncify` 这一步直接返回 1 —— 产物 `octave.js` **没生成**，
只有中断的半成品 `octave.wasm`。

### 3) 体积数据（**只能当"下界"，不能当结论**）

| | 基线 | 本次 |
|---|---|---|
| 中间产物 wasm（**Asyncify pass 之前的**） | — | 41,172,887 字节 |
| 部署版 wasm | 35,970,251 字节 | — |
| 差 | | **+5,202,636（+14.5%）** |
| octave.data | 13,829,164 | 13,829,164（未变，合理：没改源码） |

⚠️ **别把这 +14.5% 当成 Asyncify 的代价**：那个 41MB 是 `wasm-opt` 优化**之前**的
输出，Asyncify pass 没跑成，所以**我们从未得到过一个有效的 Asyncify 产物**。
能说的只有："光换链接旗标、还没做 Asyncify 变换，产物就已经大了 5.2MB。"

## 四、结论（这是要记住的那一条）

**Asyncify 与本构建的必要条件互斥，因此不可采用。**

- 本构建**必须**用 `-fwasm-exceptions`（wasm 原生异常），这是第二轮换基线时
  用血换来的结论（HANDOFF §10.3 坑 1）：JS 式异常（`-fexceptions`）会引入
  `invoke_*`/`__cxa_*` 这些**只存在于 JS 胶水里**的符号，而 `.oct` 是 side module，
  靠主模块的导出表解析导入 → **装载即崩**。
- Emscripten 明确说 `ASYNCIFY=1` 与它不兼容，实测也确实链不出来。
- 于是"上 Asyncify"的真实代价不是体积，而是**整条 `.oct` 资产车道**：
  dldfcn 核心组、全部 Forge 包编译件、`__ode15__`（SUNDIALS）、录/放音桥……
  **代价与收益完全不成比例。**

⇒ **T8（`uigetfile`）不走 Asyncify**，改走外部审核当时并列的**路线 B**：
一个**非标准异步 API**（例如 `web_uigetfile()` 返回 Promise/两段式），
并把它如实标注为"与 MATLAB 语义不同"。`recordblocking` 维持"如实报错"。

## 五、复现命令

```sh
sudo docker exec o113 bash -lc 'cd /src/bin && PATH=/src/bin:$PATH \
  EXTRA_LDFLAGS="-s ASYNCIFY=1" bash link-web.sh /src/websrc/asyncify-out'
# 期望：看到 emcc.py 的 -fwasm-exceptions 警告 + wasm-opt --asyncify 失败
```

**安全**：全程只写 `/src/websrc/asyncify-out/`；实验前后部署件
（`site/octave.wasm` 与 `o113:/src/websrc/out/octave.wasm`）
sha256 都是 `bac48adb960c9c79…`，**未受影响**。
