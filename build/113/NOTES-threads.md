# NOTES-threads.md · 线程化/并行度实验档（branch `Slay`，2026-09-25）

> 本文件记 **PLAN-threads.md 第一批（B1/B2/B3）**的实测结果：探针输出原文 + 判据 + 结论 + 踩过的坑。
> 复跑环境：Chromium **152.0.7977.82**（`/usr/bin/chromium`）、emcc **5.0.7**（容器 `o113`）。
> 产物零改动：**8761 全程未动**（现役 `45d288b1…`）。
> 逐条判据的来源见 `GPT-REVIEW-4-threads-reply.md` 与 `PLAN-threads.md` §2。

---

## 0. 三条结论（先看这里）

| 实验 | 结果 | 一句话 |
|---|---|---|
| **Q4** JSPI × DedicatedWorker | **6 PASS / 0 FAIL** | B 姿势手搓 JSPI 在 worker 里**完全成立** ⇒ C3（解释器搬 Worker）的最后一个未知数清除 |
| **E3** pthread × dlopen | **6 PASS / 0 FAIL** | `-pthread -sSHARED_MEMORY` + `MAIN_MODULE=2` 下，2 个 pthread 存活时 100 轮 dlopen 无死锁 ⇒ emscripten#9582 的"硬互斥"在 5.0.7 **不成立** |
| **E1** SIMD | **绿（判据达成）** | 只给 BLAS 对象加 `-msimd128`：DGEMM **512→1.62×、1024→1.75×、2000→1.31×**，数值回归 **97 PASS / 0 FAIL** |

**因此（对 PLAN §0.5 的影响）**：C4 是"最便宜的真提速"，且**不需要** COI/SAB/宿主改动 ⇒ 优先级维持最高；
C3 可以放心动手（JSPI 在 worker 里没问题）；C2（pthread BLAS）的**前置未知数已清**，但因为 C4 已经够用，
按判据它仍是"可选增强"，且只该在 COI 成立的环境里开。

---

## B1 · Q4 探针：JSPI（B 姿势）在 DedicatedWorker 里

**产物**：`build/113/probe-jspi-worker/{main.c,jslib.js,worker.js,run.html,run-page.html}` +
`build/113/probe-jspi-worker.sh`（旗标 = `probe-jspi-b.sh` 同族，**无 `-sJSPI`**）。

**复跑**：
```sh
sudo docker cp build/113/probe-jspi-worker o113:/src/probe-jspi-worker
sudo docker cp build/113/probe-jspi-worker.sh o113:/src/probe-jspi-worker/probe-jspi-worker.sh
sudo docker exec o113 sh -c 'export PATH=/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:$PATH; \
  cd /src/probe-jspi-worker && sh probe-jspi-worker.sh /src/libwork/jspi-worker'
rm -rf /mnt/hdd/octave-wasm-build/jspi-worker-probe
sudo docker cp o113:/src/libwork/jspi-worker /mnt/hdd/octave-wasm-build/jspi-worker-probe
sh /mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-jspi-worker.mjs \
   /mnt/hdd/octave-wasm-build/jspi-worker-probe          # worker host
HOSTPAGE=run-page.html sh .../harness/run.sh test/browser/probe-jspi-worker.mjs <同目录>   # 页面对照组
```

**产物自检**：`main.js=72,118 B`、`main.wasm=19,119 B`、胶水里 `Suspending` **0 处**。

**输出（worker host，原文）**：
```
worker 回报：{"apiSuspending":true,"apiPromising":true,"ok":100,"fails":[],"ticks":100,
             "wallMs":389,"ping":42,"unpromising":"throw:SuspendError: trying to suspend without WebAssembly.promising","error":null}
PASS | ★ W1 worker 里存在 JSPI API（Suspending/promising） :: Suspending=true promising=true
PASS | W2 对照组：同步入口在 worker 里照常（35+7=42） :: ping=42
PASS | ★ W3 100 次挂起/恢复全部成功（返回值 = ms+1） :: ok=100/100 fails=[]
PASS | ★ W4 等待期间 worker 的 tick 递增（真让出，不是 busy-loop） :: ticks=100
PASS | W5 墙上时间下界（≥100×1ms） :: wallMs=389
PASS | ★ W6 反向：未包 promising 的直调在 worker 里同样抛（穷举语义成立） :: throw:SuspendError: …
=== 6 PASS / 0 FAIL ===
```
**页面对照组（`run-page.html`，同一份产物在页面里跑）**：同样 **6 PASS / 0 FAIL**（ok=100、ticks=100、wallMs=400）
⇒ 结果与"跑在 worker 还是页面"无关，纯机制验证。

### 踩过的三个坑（都写进产物注释了）

1. **`-sENVIRONMENT=worker` 单独指定会把开机打坏**：`initRuntime → wasm 起函数 → _environ_get` 抛
   `RangeError: Maximum call stack size exceeded`；**页面对照组同样复现** ⇒ 与 worker 无关，是该旗标的锅。
   ⇒ 用**默认环境**（web,worker,node）。第一版据此白查了一轮。
2. **非模块化胶水污染全局作用域**（自带 `run`/`doRun`/`Module`/`FS`/`environ_get`…）。宿主页/worker 里
   第一版把自己的 async 函数命名成 `run` ⇒ **覆盖胶水的 `run()`** ⇒ 重入 `initRuntime` ⇒
   同一个 `RangeError`（栈顶显示 `_environ_get`，误导性极强）。⇒ 自定义名字一律加前缀（`q4*`/`e3*`）。
3. **`Object.assign({}, info)` 复制 env 也不行**（env 上的惰性 getter 被复制触发自引用）。
   ⇒ 必须**原地改 `info.env` 并把 `info` 原样传下去**，与产品 `bridge/index.html:100-131` 的钩子逐字同形。

---

## B2 · E3 探针：pthread × 运行期 dlopen

**产物**：`build/113/probe-threads/{main.c,side.c,run.html}` + `build/113/probe-threads.sh`
（main `-pthread -sSHARED_MEMORY -sMAIN_MODULE=2 -sPTHREAD_POOL_SIZE=2 -sPTHREAD_POOL_SIZE_STRICT=2`；
side 同样 `-pthread`）。

**复跑**：与 B1 同形（`docker cp` → `probe-threads.sh /src/libwork/threads` → 取回 →
`harness/run.sh test/browser/probe-threads.mjs <目录>`）。runner **给顶层页注入 COOP/COEP**
（顶层是唯一能拿到 COI 的位置 —— 见 `probe-iframe-coi.mjs` 的九格实测）。

**产物自检**：`main.js=97,656`、`main.wasm=37,303`、`side.wasm=253`；胶水里 `pthread` 88 处、`PThread` 54 处、
`new Worker(pthreadMainJs,{workerData:"em-pthread"…})` 在 ⇒ pthread 真的开了。

**输出（原文）**：
```
回报：{"pre":{"coi":true,"sab":"function","sabNew":"ok"},"ok":100,"missing":0,"busy":47,"runMs":27,"totalMs":28,
      "log":["[e3] ok=100/100 busy=47"]}
PASS | ★ T1 前置：顶层 crossOriginIsolated=true
PASS | ★ T1 前置：SharedArrayBuffer 可用
PASS | ★ T2 100 轮 dlopen/dlsym/dlclose 全部成功（41+1=42） :: ok=100
PASS | ★ T3 期间 2 个 pthread 真在跑（busy>0） :: busy=47
PASS | ★ T4 无 hang（40s 硬超时未触发） :: totalMs=28
PASS | ★ T5 反向：dlopen 不存在的模块必须失败 :: missing=0
=== 6 PASS / 0 FAIL ===
```

**一个坑**：`dlopen` 之前必须**把 side.wasm 写进虚拟 FS**（`Module.FS.writeFile('/side.wasm', …)`），
否则得到 `could not load dynamic lib: /side.wasm` + `file not found, and synchronous loading of
external files is not available`。（这条与"C3 里 worker 侧 dlopen 看不到主线程 FS 会回退网络"是同一族问题。）

**判读**：本探针刻意贴产品形态 —— **所有 dlopen 都发生在解释器/主线程**，pthread 只在旁边做计算
（BLAS 线程的样子）。"loader 跨线程同步"这条机制被真实触发（T3 证明线程在跑），仍 100/100 无死锁。

---

## B3 · E1 基准：只给 BLAS 对象加 `-msimd128`

### 1) 编 SIMD 版三个库（**不覆盖 `/usr/local`**）
`build/113/build-blas-simd.sh`（与 `rebuild-pic-blas.sh` 同结构，把 `-fPIC` 换成 `-msimd128`）：
```sh
sudo docker cp build/113/build-blas-simd.sh o113:/src/bin/build-blas-simd.sh
sudo docker exec o113 sh -c 'export PATH=/src/bin:/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:$PATH; \
  bash /src/bin/build-blas-simd.sh /src/deps/lapack-simd'      # 约 55 秒
```
**v128 抽样自检**（脚本自带）：`dgemm.simd.o` **16 条**、`daxpy.simd.o` 5 条、`dgetrf.simd.o` 3 条、`dscal.simd.o` 0 条
⇒ LLVM 对 f2c 出来的标量 C **确实做了部分自动向量化**（不是全有也不是全无）。
库体积对比：`librefblas.a` 679,866 vs 556,594（+22%）、`liblapack.a` 9,884,660 vs 9,539,546（+3.6%）。

### 2) 重链（权威口径 + JSPI + 一个口子）
```sh
sudo docker exec o113 bash -lc 'export PATH=/src/bin:$PATH; cd /src/bin && \
  M_SRC=/src/work/m-prerendered/m GL_LIBS=1 GL_BACKEND=webgl P5_TOOLKIT=1 \
  MAIN_MODULE_LEVEL=2 KEEP_LIST=/src/libwork/keep.txt \
  LIB_FUNCS="emscripten_run_script,__assert_fail,abort,exit" \
  OCT_SCAN_DIRS=/src/octs-site BASELINE_WASM=/src/websrc/m2fc-jspb-out/octave.wasm \
  WITH_FREETYPE=1 WITH_FONTCONFIG=1 WITH_JSPI=1 \
  EXTRA_LDFLAGS="-L/src/deps/lapack-simd/lib" \
  bash link-web.sh /src/websrc/m2fc-simd-out'
```
- `BASELINE_WASM` 取**现役产物**（`m2fc-jspb-out/octave.wasm` = 29,464,307 B = `45d288b1…`），
  保证 keep-list 口径与线上一致；
- `WITH_JSPI=1` 必须有：现役 octave.js 里含 `eval_wait`（B 姿势导出），不带就会做出一版"少 JSPI 面"的产物；
- `EXTRA_LDFLAGS` 是 `link-web.sh:526` 的口子，**在 `LIBS`（含 `-L/usr/local/lib`）之前** ⇒ 我们的 `-L` 赢搜索顺序。
- 自检全绿：FreeType / IDBFS / fontconfig / 符号解析（无新增解析不了）。

### 3) ★ 决定性验证（否则"SIMD 进没进产物"只能是猜）
```sh
sudo docker exec o113 sh -c '/emsdk/upstream/bin/llvm-objdump -d /src/websrc/m2fc-simd-out/octave.wasm | grep -c v128'
# → 4752
sudo docker exec o113 sh -c '/emsdk/upstream/bin/llvm-objdump -d /src/websrc/m2fc-jspb-out/octave.wasm | grep -c v128'
# → 0
```
产物体积：29,632,229（SIMD）vs 29,464,307（基线）。**4752 vs 0** ⇒ SIMD 对象真的进了链接。
⚠️ 反例：`grep -c simd128 <wasm>` 这个字符串判据**无效** —— 两版都没有 `target_features` 自定义段
（`python3` 直接扫字节：`target_features`/`simd128` 命中数均为 0），拿它当判据会得出错误结论。

### 4) 车道与基准

- 车道：`rsync -a siteWebGL/ site-simd/` + 换上 SIMD 三件 → `setsid nohup python3 -m http.server 8771 …`
  （**新目录、新端口**；8761/8768 只读，未被修改）。
- 基准脚本：`test/browser/bench-dgemm.mjs`（口径照 `bench-core.mjs`：`rand` 在 `tic` 之外、3 次取中位数、
  计时用 Octave `tic/toc`、取数走虚拟 FS 写回读）。

| DGEMM | 基线 8768 (A) | SIMD 8771 (B) | **B/A** |
|---|---|---|---|
| 512² | 0.0840 s | 0.0520 s | **1.62×** |
| 1024² | 0.6220 s | 0.3560 s | **1.75×** |
| 2000² | 5.0610 s | 3.8680 s | 1.31× |

页面自证 wasm sha：基线 `45d288b1…`、SIMD `1ed3e528…`（`window.__octaveWasmSha`，防"用旧产物跑"）。

### 5) 数值回归（在 8771 上跑）
| 套件 | 结果 |
|---|---|
| `accept-113-boot` | 10 PASS / 0 FAIL |
| `accept-113-libs` | 17 PASS / 0 FAIL |
| `accept-hdf5` | 16 PASS / 0 FAIL |
| `accept-slicot` | 25 PASS / 0 FAIL |
| `accept-113-ode15` | 29 PASS / 0 FAIL |
| **合计** | **97 PASS / 0 FAIL** |

**E1 判定：绿**（数值全过 **且** 512/1024 中位数 ≥1.5×）。按 PLAN §2 的红线（"全尺寸 <1.1× 或数值回归"= 红），
不触发。**E2（OpenBLAS）的触发条件（v128=0 或提速不足）不成立** ⇒ 维持"可选增强"。

---

## 下一步（PLAN §0.5 的更新）

1. **C4 已证**（本批）⇒ 可以进入"要不要把 SIMD 打进产品"的决策：它需要一次重链 + 全量回归 + promote，
   且**不改任何接口**（可回退）。注意浏览器下限：SIMD 在 Chrome≥91 / Firefox≥89 / Safari≥16.4 都有，
   低于 JSPI 基线（137/153/27）⇒ **不抬全站下限**。
2. **C3（解释器搬 Worker）**：JSPI 在 worker 已证（本批 Q4）⇒ 剩下的未知数只有"worker 侧的 dlopen 与
   preload FS"（E4，必须带真实 side module + 真实 preload FS）。
3. **C6（去单例嵌入契约）**：页面层（mount/base/别名）可独立先做；wasm 侧的 canvas 契约改动建议与
   **下一次重链合并**（省一次 29MB 链接）。
4. **C2（pthread BLAS）**：前置未知数已清（本批 E3），但按判据只在 COI 环境（C8/第一方）里开。

---

## C4 落地（SIMD 打进产品）：2026-09-25 15:54 关机中断点

**状态：已 promote 到 8761，验证未跑完（用户关机叫停）。**

### 已完成（都有产物证据）
1. `sh build/glue-selftest.sh` → **91/91 全过，badfiles=0**。
2. **回退快照**（promote 脚本自带那份 `site-prewebgl-bak` 是"最早那份"，不够精确）：
   `/mnt/hdd/octave-wasm-build/site-baseline-45d288b1/{octave.wasm,octave.js,octave.data}`（= `45d288b1…`）。
3. **8768 验绿**：siteWebGL 换成 SIMD 三件后 `sweep.sh http://127.0.0.1:8768/` →
   **41 套 / 1047 PASS / 0 FAIL**（日志 `/mnt/hdd/octave-wasm-build/sweep-logs/20260925-152502`）。
4. **promote 8761**（`SRC_OUT=GL_OUT=/src/websrc/m2fc-simd-out EXPECT_FREETYPE=1 sh build/promote-webgl.sh`）：
   站点 wasm sha 与容器一致 = `1ed3e528…`；gl4es ✓ / FreeType 预载 ✓ / 桥与 webgraphics 资产 ✓ / p5canvas.js ✓；
   **D8 开机自检 OK（1.7s 就绪，`eval_string("2+2")` rc=0）**。日志 `/tmp/promote-simd.log`。
5. **仓库 `site/` 已同步**（`rsync -a --delete /mnt/hdd/octave-wasm-build/site/ site/`）⇒ 仓库镜像 = 8761 = `1ed3e528`；
   `git status` 只有 `site/octave.{js,wasm}` 两处改动（`.data` 与 `assets/m/*.js` 逐字节未变 = bundle 确定性 ✓）。
6. **8761 全量回归（PROBES=1）跑到一半被叫停**（进程已 kill）：
   **42 套有 PASS/FAIL 行、真 FAIL 行 = 0**；其中 41 套 `accept-*` 全绿（含 `accept-113-libs 17/0`、
   `accept-slicot 25/0`、`accept-113-ode15 29/0`、`accept-p5-graphics 65/0`），`probe-artifact-sha 2/0`；
   中断时正在跑 `probe-*` 段（`probe-bridge-svg-out`/`probe-browser-matrix`/`probe-cold-start`，均 rc=0 无 FAIL）。
   日志已落盘：`/mnt/hdd/octave-wasm-build/sweep-logs/INTERRUPTED-8761-simd-20260925-155420.log`。

### ~~还没做~~ → **全部补完（2026-09-26 新一天）**
1. ✅ **补跑 `PROBES=1 sweep.sh http://127.0.0.1:8761/`** → **76 套 / 1190 PASS / 0 FAIL**
   （比上一批多 5 套 = 新增 bench-dgemm / probe-jspi-worker / probe-threads / probe-iframe-coi 等；
   "有问题的套件"= 自托管/诊断型探针的 NO-SUMMARY，rc=0，与历史口径一致）。
2. ✅ `make-dist.sh` → `dist/octave-full-wasm-site-20260926/`，包内 wasm sha = 部署件 = `1ed3e528…`。
3. ✅ `check-site-parity.sh --strict` → **两站点完全一致**（部署件 + 资产包 + 清单，清单 49/49、sha 差异 0）。
4. ✅ 实验车道清理：`site-simd/`（63MB 副本）已删、8771 已停；8761/8768 重启后开机自检 OK（1.6s）。

### 回退（精确到本次基线）
```sh
cp -a /mnt/hdd/octave-wasm-build/site-baseline-45d288b1/. /mnt/hdd/octave-wasm-build/site/
rsync -a --delete /mnt/hdd/octave-wasm-build/site/ site/          # 仓库镜像跟着回退
```

### ★ 新的重链口径（**不改这条就会静默退回非 SIMD**）
现役产物 = 权威口径 **再加两处**：`WITH_JSPI=1`（B 姿势导出，现役 octave.js 里必须有 `eval_wait`）
与 `EXTRA_LDFLAGS="-L/src/deps/lapack-simd/lib"`（该口子在 `LIBS` 之前 ⇒ 赢搜索顺序）。
依赖：容器里 `/src/deps/lapack-simd/lib/{librefblas.a,liblapack.a}` 必须存在（由
`build/113/build-blas-simd.sh` 生成；**`/usr/local/lib` 那份仍是非 SIMD**，别搞混）。完整命令见 HISTORY §5.54。
自检（唯一可靠）：`llvm-objdump -d <wasm> | grep -c v128` —— 现役 `1ed3e528` 应为 **4752**（非 SIMD 那版 = 0）。


---

## C6 页面层落地（2026-09-26，产物不变；branch `Slay`）

**做了什么**：宿主层从"页面单例"改成**实例工厂**——
- `bridge/index.html`：`createOctaveHost(opts)`（opts = `base` 资源前缀 / `mount` 输出挂点 /
  `home` IDBFS 挂载点 / `id`）。第一个实例是**默认实例**，拿走全部 `window.*` 兼容别名
  （`window.Module`/`__octaveReady`(布尔 true)/`__octaveJspi*`/`__octaveClicks`/…）——
  **65 个旧套件一个没改**。G3 取点的 arm/pending/pop 三个 import 按**实例**覆写
  （pop 用本实例 memory 现建 Float64Array，天然免疫 growth 失效）；全局 pointerdown
  扇出给所有 armed 实例。IDBFS 按实例挂载（非默认实例必须换 `home`，否则同源
  两实例的 syncfs 互相覆盖同一批持久键）。
- `bridge/assets-loader.js`：状态（manifest/loaded/inflight）收进 `createOctaveAssets(module, base, isReady)`
  工厂；全部 fetch 走 base 前缀；`window.OctaveAssets` = 默认实例别名；
  `OCTAVE_M` 字面量保留原文（check-consistency.py 逐字比对）。
- `site/matrix-android.html`：由新 index.html + 尾块重拼（无生成器，手工同步）。
- 新套件 `test/browser/accept-embed-multi.mjs`（**13/0**）：同页两实例，交替 100 次 eval
  状态隔离（默认 x=1 / i2 x=2）、FS 互不可见、资产写进**对的**实例（i2 自己的账本含
  plotbridge、`exist('audioread')`=3）、别名不覆盖、反向断言（坏挂点必须 throw）+
  已知边界（非默认实例无图形上屏——wasm 侧 publish_png 硬编码 `window.OctaveP5`，
  分派要与下一次重链合并）。

**修过的三个 bug（都有教训）**：
1. `loadScript` 里 Promise executor 的 `resolve` 参数**遮蔽**了 `resolve(url)` 助手 ⇒
   `s.src = undefined` 且 promise 提前 settle ⇒ JS 包"装载成功"但 `__OCT_ASSETS__` 缺席。
   助手改名 `withBase`。
2. 资产装载器在 `inst.mod` 赋值**之前**创建 ⇒ i2 拿到 null ⇒ 回退 global.Module =
   **默认实例**（资产全写进默认 FS、addpath 串台）。⇒ 工厂末尾再建、直接绑 Module。
3. 坏挂点在 push **之后** throw ⇒ 注册表留幽灵实例（hosts=3）⇒ 挂点解析提前。

**验收**：`glue-selftest 91/91` → **8768 全量 42 套 / 1060 PASS / 0 FAIL（41 旧套零改动）** →
promote 8761（wasm sha 不变 `1ed3e528…`，页面层更新；D8 开机自检 OK 1.7s）→
**8761 全量 PROBES=1：77 套 / 1205 PASS / 0 FAIL** → dist 包内 wasm = 部署件 →
parity --strict 两站点完全一致。

**已知边界（记档，等下次重链）**：① 非默认实例**无图形上屏**（publish_png 硬编码
`window.OctaveP5`，要改 webgl_toolkit.cc 的分派 + canvas 契约）；② 四个队列桥
（audio/rec/filepick/net）与 stdin 队列、Ctrl-C 仍是默认实例单例；③ worker 化（C3/B5）
是下一个大车道，机制未知数已全部清零（Q4/E4）。


---

## C8 引擎能力底座 + coi-serviceworker 实测（2026-09-26，两个新探针）

**为什么做**：C8（宿主站装 service worker 换 COI）整条路押在两句行为断言上——① SW 注头后**同源**
iframe 继承 COI（线程可用）；② 用的是 credentialless 还是 require-corp 决定**宿主 CDN 活不活**。
README 只给定制示例，**默认值得读源码/实测**：`coi-serviceworker.js` 的选项对象里
`coepCredentialless: () => true`、`coepDegrade: () => true`（**默认就是 credentialless**，并会在
"受控首访拿不到 COI"时自动降级 require-corp 并重载）。

**探针 1 `probe-coep-engines.mjs`（静态响应头，绕开 SW ⇒ 只量引擎能力）= 6/0**

| 引擎 | require-corp | credentialless |
|---|---|---|
| chromium | COI ✓ / CDN ✗ | **COI ✓ / CDN ✓（支持）** |
| firefox | COI ✓ / CDN ✗ | **COI ✓ / CDN ✓（支持）** |
| webkit | COI ✓ / CDN ✗ | **COI ✗（拿不到 COI）/ CDN ✓** |

⇒ 引擎层：**Chromium 与 Firefox 都支持 credentialless，只有 WebKit（Safari 家族）不支持**。

**探针 2 `probe-coi-sw.mjs`（真装 v0.1.7 SW，三模式 × 三引擎）= 7/2**

| 引擎 | 不装 SW | 默认（=credentialless） | 显式 credentialless 定制 |
|---|---|---|---|
| chromium | COI ✗ / CDN ✓ | **COI ✓ / CDN ✓** | COI ✓ / CDN ✓ |
| firefox | COI ✗ / CDN ✓ | COI ✓ / **CDN ✗** | COI ✓ / **CDN ✗** |
| webkit | COI ✗ / CDN ✓ | COI ✓ / **CDN ✗** | COI ✓ / **CDN ✗** |

（三档里 SW 都接管了；`coiCoepHasFailed` / `coiReloadedBySelf=coepdegrade` 旗标**全 false**。）

**★ 结论（比早前写的更严格，早前的措辞要按这张表读）**：
1. **"COI + CDN 兼得"经 SW 只有 Chromium 成立**；Firefox 与 WebKit 装了 SW 会拿到 COI 但**打掉 CDN**。
2 引擎层与 SW 层在 **Firefox 上矛盾**（静态头支持 credentialless，走 SW 却拦 CDN）⇒ 这是**开放问题**，
  不是降级逻辑（旗标 false 排除了它）。待查方向：SW 注入与静态头在**子资源**处理上的差异。
3. ⇒ C8 当前只能承诺 **Chromium 系**的"线程 + CDN 共存"；Firefox/WebKit 上"要线程就得放弃 CDN"，
   或退到 C4/C3（SIMD + Worker，不需要 COI）。
4. WebKit 引擎已装好 ⇒ **E7（真书站验证）可以直接在第三引擎上跑**，不用再靠引文档。

**环境与工具（一次性安装位置，2026-09-26）**：
- 浏览器（playwright 托管，**不放 ~/.cache**）：`/mnt/hdd/crossbuild-tools/pw-browsers/`
  （`firefox-1543` 306MB、`webkit-2359` + 依赖修正、`ffmpeg-1011`）。用法：
  `PLAYWRIGHT_BROWSERS_PATH=/mnt/hdd/crossbuild-tools/pw-browsers <runner>`。
- **WebKit 依赖修正**（值得记）：playwright 的 webkit 是 Debian 13 构建，要 ICU **76** 与
  `libxml2.so.2`、`libbacktrace.so.0`，而本机是 Debian **sid**（ICU **78**、`libxml2.so.16`）。
  做法（**不动系统**）：把 trixie 的 `libicu76`/`libxml2`/`libbacktrace0` 三个 deb 用
  `dpkg-deb -x` 解到 `/mnt/hdd/crossbuild-tools/pw-browsers/webkit-libs/`，再把缺的 .so
  **拷进 WebKit 自带的 `minibrowser-*/sys/lib/`**（内层 wrapper **覆盖式**设 `LD_LIBRARY_PATH`
  ⇒ 光设环境变量没用，第一版就栽在这）。
- `coi-serviceworker` v0.1.7（MIT）：**进仓库** `build/embed/{coi-serviceworker.js,coi-serviceworker.min.js}`。
  ⚠️ **它不能放 /mnt/hdd**：SW 必须由**与页面同源**的站点提供（上游 README 明说"不能走 CDN、必须同源"）
  ⇒ 它是**站点资产**，宿主站要把它放到自己站点的根/相应路径。


### ★ 范围改判（2026-09-26，用户拍板）：目标是一方单页站，"宿主 CDN"约束作废

上面 C8 一节的分析是按"第三方教材站嵌入、不能改宿主"的约束写的——**那个约束不成立**：
目标一直是**自家单页完整 Octave 站**（教材那头将来走"拆 CLI 定制 UI"，比做嵌入便宜）。
改判后的实际影响：
1. **"CDN 被拦"这个问题对我方站点不存在**：我们全部资产同源自包含，require-corp 拦不到任何东西。
2. **COI 在三引擎都能拿到**（实测）：chromium/firefox 走 credentialless 或 require-corp 皆可；
   **webkit 必须走 require-corp**（credentialless 拿不到 COI，但 require-corp `coi=true`）。
3. **B6（真开线程）外部依赖清零**：coi-serviceworker 已在 `build/embed/`，装到自家站即可；
   前置只剩 E3（已绿）+ 线程版构建（OpenBLAS-pthread + `-pthread -sSHARED_MEMORY`，即 B6 本体）。
4. C6 的嵌入能力（工厂化 mount/base）**保留**——它是将来"拆 CLI / 定制 UI"的地基，但不再是
   被"宿主约束"驱动的工作。

---

## E2 探针（OpenBLAS-pthread/SIMD）：构建成功，链接阻塞（2026-09-26，时间盒到点）

**做了**（无人值守，长线丢后台）：
1. **核实外部事实**：评审说的 `WASM128_GENERIC` **存在**，但在 **OpenBLAS 0.3.34**（`TargetList.txt:159`，
   README 记为"Optimized SGEMM,DGEMM,DAXPY,SSUM/DSUM,SDOT/DDOT,SROT/DROT"）——**0.3.30 里完全没有 wasm 痕迹**
   （全树 grep 为空）⇒ 版本要对，评审那条成立。
2. **构建成功**（容器内，约 1 分钟）：
   ```sh
   make TARGET=WASM128_GENERIC USE_THREAD=0 NO_LAPACK=1 NO_SHARED=1 \
        CC="ccache emcc" FC=/src/bin/emf77 HOSTCC=gcc -j12
   # → libopenblas_wasm128-r0.3.34.a（2,016,902 B），**EXIT=0**
   # 符号：dgemm_ / daxpy_ / dtrsm_ / dsyrk_ 都在（gfortran 风格名字 ⇒ 与 Octave 的调用口径一致）
   # TARGET 自动带 -msimd128；`-m32`（wasm32）也对
   ```
   ⚠️ `NOFORTRAN=1` **不能用**：那会砍掉 Fortran 接口层，而我们要的正是 `dgemm_` 这类符号
   ⇒ 必须用容器里的 `emf77`（f2c 包装）当 `FC`。
   产物留档：`/mnt/hdd/octave-wasm-build/octave-wasm/third_party/blas-openblas/lib/libopenblas.a`
   （另存一份同内容的 `librefblas.a` 作"影子替换"，靠 `-L` 顺序抢在 `/usr/local/lib` 之前）。
3. **链接失败（阻塞点）**：全量重链（权威口径 + `EXTRA_LDFLAGS="-L/…/blas-openblas/lib"`）在
   **binaryen 那步**炸：
   ```
   [parse exception: popping from empty stack (at 0:7912702)]
   Fatal: error parsing wasm
   em++: error: wasm-opt --strip-target-features --post-emscripten -O2 … failed (returned 1)
   ```
**已排除的假设**（都实测过，别重走）：
- ✗ atomics：构建日志 0 处 `-pthread/-matomics`，归档里 `atomics` 字符串 0 处。
- ✗ 与 reference LAPACK 的**重复符号**：两边定义集交集 **0**（1627 vs 1642 个符号）。
- ✗ OpenBLAS 代码本身 binaryen 不认：最小程序（只调 `daxpy_`）链接时 **wasm-opt EXIT=0**。
⇒ 阻塞点是"**全量 Octave 链接 × OpenBLAS**"这个组合，**不是** OpenBLAS 单方问题。
**下一步方向（未做）**：① 二分归档（逐个 `emar d` 移除对象直到能链，定位到具体对象）；
② 换 binaryen 版本（emsdk 自带的那份；可把新版解到 `/mnt/hdd/crossbuild-tools/` 用 `BINARYEN_ROOT` 指过去）；
③ 试 OpenBLAS 的 CMake 构建路径（可能与 Makefile 的 codegen 不同）。
**结论**：E2 按计划本就是"触发条件不成立的可选增强"（C4/SIMD 已给 1.62×/1.75×/1.31×），
故**时间盒到点即转 B5**（计划主线：C3 Worker 化），把上面的方向留给后续。


---

## B5 phase 1 落地：解释器跑进 DedicatedWorker（2026-09-26，产物 wasm 不变）

**做了什么**（分支 `Slay`；产物仍是 `1ed3e528…`，只动页面层）：
- 新增 `bridge/octave-worker.js`：**worker 宿主**。wasm + 虚拟 FS + 资产装载 + JSPI 全在 worker 里；
  协议：主→worker `eval` / `evalAsync` / `loadAssets` / `interrupt` / `click`；
  worker→主 `ready` / `out`（stdout 流式）/ `plot`（图形成品字节）/ `result`。
- `bridge/index.html`：`?worker=1` 分流 —— **默认单页路径一字不动**（77 个旧套件全靠它）；
  worker 模式下页面**不创建本地解释器**（`window.Module` 缺席 ⇒ 主线程真的空着）。
- `bridge/assets-loader.js`：`kind:'js'` 的包（Forge 包）在 worker 里走 `importScripts`。
- `build/promote-webgl.sh`：拷贝清单补 `octave-worker.js`（**漏了就是部署后 404** —— 正是该脚本
  当初被写出来要防的那类事故）。

**验收 `accept-worker.mjs`（11 PASS / 0 FAIL）**，关键判据是**有区分力**的那对：
| 判据 | 实测 |
|---|---|
| ★ C 主线程不冻：worker 里跑 1400² 矩阵乘（约 4.3 s）期间页面 `setInterval(10ms)` | **tick=435** |
| ★ C2 **反向**：同一段计算在**单页模式**下 | **tick=0**（确实冻住） |
| ★ F worker 里挂起入口真让出 | rc=0、206 ms |
| ★ G0 反向：worker 里**同步** eval 碰挂起点必须失败 | `SuspendError: trying to suspend without WebAssembly.promising` |
| ★ G 中断投递（`evalAsync` 的 pause 循环 + interrupt） | rc=3、事后解释器存活 |
| B2 worker 模式下页面无本地解释器 | `window.Module === undefined` |
| D/E/H | stdout 上屏 ✓ / dldfcn 资产 ✓ / 图形**降级干净**（见边界） |

**踩到的坑（值得记）**：worker 宿主为让 toolkit 的 EM_ASM 不抛异常，装了 `document` shim；
而 assets-loader 原来用 `!document` 判断"我在 worker 里" ⇒ **判断失效** ⇒ JS 包走 `<script>`
注入路径（worker 里 `head.appendChild` 是空操作）⇒ **promise 永不 settle**：
`plotbridge`/`webshims` 静默装不上（表现为 addpath 找不到目录、`pause` shim 缺席 ⇒
中断判据假红、ready 永远不来）。修法：用**显式标记** `self.__octaveWorker` 而不是探测 document。

**phase 2 边界（未做，PLAN 留档）**：worker 模式**没有真渲染后端** —— 图形后端初始化要用
EM_ASM 在 `document` 上建隐藏 canvas，worker 里没有真 DOM ⇒ 回落到"只出句柄"的旧后端，
绘图报 `get: unknown axes property __legend_handle__`（Octave 侧清晰错误、解释器存活）。
把 WebGL 搬进 worker 需要改 `webgl_toolkit.cc`（canvas 契约 + OffscreenCanvas 目标）并**重链**。
外部咨询请求（去身份化）已发出：`build/113/GEMINI-ASK-1-worker-webgl.md`（含这条与 E2 的
binaryen 阻塞、以及"挑刺验收矩阵"）。

**验收链（全绿）**：`glue-selftest 91/91` → **8768 全量 43 套 / 1071 PASS / 0 FAIL**（含新套件）→
promote 8761（D8 开机自检 OK 1.5 s）→ **8761 全量 PROBES=1：80 套 / 1216 PASS / 0 FAIL** →
`make-dist` 包内 wasm = 部署件 = `1ed3e528…` → `check-site-parity --strict` 两站点完全一致。


---

## B6/C1 设计前提实测：线程版产物**硬依赖 COI** ⇒ 必须双档产物（2026-09-26）

**探针 `probe-threads-coi.mjs`（3 PASS / 0 FAIL）**：同一个 `-pthread -sSHARED_MEMORY` 产物，
用两种服务各发一次（带头 / 不带头）：

| 档 | 结果 |
|---|---|
| **带 COI 头** | `crossOriginIsolated=true`、SAB 可用、**线程程序跑通**（100 轮 dlopen + 2 个 pthread，busy=46） |
| **不带 COI 头** | **实例化硬失败**：`DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.` |

**★ 结论（推翻 C1 的原始设计）**：线程能力**不能**靠"运行时能力门把开关关掉"来降级 ——
线程版胶水在启动时就要把 SAB 传给 pthread worker，**没有 COI 直接抛异常**。
⇒ C1 的门必须做**产物选择器**而不是开关：**双档产物**（线程版 / 非线程版）+ 加载期按
`self.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function'` **二选一**，
并把上面那句失败文本作为"选错档"时的清晰报错素材。
**连带**：B6 = 线程版构建（`-pthread -sSHARED_MEMORY`，且 configure 目前是 `--disable-threads`）
+ 自家站开 COI（coi-serviceworker 已在 `build/embed/`，自家资产全同源 ⇒ require-corp 无副作用）
+ 加载期选档。Emscripten 官方也建议 threaded/non-threaded 分开构建（与本实测一致）。
