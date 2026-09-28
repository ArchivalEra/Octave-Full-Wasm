# NOTES-threads.md · 线程化/并行度实验档（branch `Slay`，2026-09-25）

> 本文件记 **PLAN-threads.md 第一批（B1/B2/B3）**的实测结果：探针输出原文 + 判据 + 结论 + 踩过的坑。
> 复跑环境：Chromium **152.0.7977.82**（`/usr/bin/chromium`）、emcc **5.0.7**（容器 `o113`）。
> 产物零改动：**当时 8761 全程未动**（那时的现役 = `45d288b1…`；⚠️ 2026-09-26 起现役是 `1ed3e528…`）。
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
> **★ 2026-09-26（批次 A1）起：这条命令已经"搬进代码"了** ——
> `bash build/113/relink.sh link product` 就是它（模式表逐字对得上；
> `relink.sh explain product` 可以把 22 个变量打出来对照）。下面这段是当时的原始记录。
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


---

## 我方站点在 COI 下实测：require-corp 就够，三引擎都能拿 COI（2026-09-26）

**做法**（不装 SW、不动任何 lane）：用一个小服务（`/tmp/coi-server.mjs`）把**真实站点目录**
带 `COOP: same-origin` + `COEP: require-corp` 发出来（等价于 coi-serviceworker 注头的效果），
然后跑开机自检 + 代表性套件。

| 检查 | 结果 |
|---|---|
| `check-boot.sh` | **BOOT OK：0.9 s 就绪，`eval_string("2+2")` rc=0**（比平常 1.5 s 还快） |
| `accept-113-boot` | 10 / 0 |
| `accept-worker`（worker 模式） | 11 / 0 |
| `accept-idbfs`（持久化） | 9 / 0 |
| `accept-plotv2`（图形） | 92 / 0 |
| `accept-embed-multi`（多实例） | 13 / 0 |
| `accept-net` | 29 / **1**（★ 见下，**非 COI 回归**） |

**★ 结论 1：自家站用 `require-corp` 就够，而且这是三引擎唯一都能拿 COI 的档。**
自家资产全部同源（无 CDN 依赖）⇒ require-corp "要求子资源带 CORP" 这条**拦不到任何东西**；
而 `credentialless` 在 WebKit 上拿不到 COI（`probe-coep-engines.mjs` 实测）⇒ **对自家站，
require-corp 反而比 credentialless 更通用**（三引擎全支持，含 Safari 家族）。
⇒ C8 从"宿主 + credentialless 的小心翼翼"简化为：**自家站注 require-corp 头（或装
coi-serviceworker 走 require-corp）**。

**★ 结论 2（诚实标注）：accept-net 那 1 条失败是我的测试服务造成的，不是 COI 回归。**
失败判据是"服务器不支持 POST 时如实回报 postok=0"，实测 postok=1 —— 因为我这个临时服务对
**任何方法**都返回 200（不像 `python -m http.server` 会 501）。同一套件在 8761（python 服务）
上是 30/0。
⚠️ 但它提醒了一条**真代价**：COI 之后跨源网络访问要满足 CORP 或走 CORS ——
产品里那些"取外部 URL"的功能（网络桥 / 同步 XHR）在 COI 站点上会受这条约束
（本轮没有专门测它，留给 B6 落地的验收项）。


---

## B5 phase 2 达成：worker 里有**真渲染后端**（2026-09-26，**不需要重链**）

**结论先写**：worker 模式下 `graphics_toolkit() = 'webgl'`、无 GL 回落信号、绘图成品经 postMessage
上屏。**没有改一行 C++、没有加任何链接旗标、没有重链** —— 只改了 worker 宿主的 DOM shim。

**机制（读 Emscripten 5.0.7 源码得出，不是猜）**：图形后端要 canvas 时走
`findCanvasEventTarget(target)` → `specialHTMLTargets[target] || document.querySelector(target)`，
拿到对象后**由胶水自己调 `canvas.getContext('webgl2', attrs)`**。
而 `OffscreenCanvas.getContext('webgl2')` **在 worker 里可用** ⇒ 只要 shim 把
`document.createElement('canvas')` / `getElementById` / `querySelector('#…')` 指向一个
**真的 `new OffscreenCanvas(w,h)`**，整条链就通了。
（`transferControlToOffscreen` 那条路是给 pthread 设计的：主线程 transfer → pthread_create 时把
`GL.offscreenCanvases` 搬过去 —— 我们的 worker 宿主不是 pthread，所以那个表不会自动填；
但它也不需要填，见上面的机制。）

**实测自证**（新增 `diagnose` 消息通道，专门读 **worker 内部**状态 —— 页面读不到 worker 的 FS/GL）：
| 量 | 值 |
|---|---|
| `graphics_toolkit()` | `webgl` |
| 无 GL 回落信号 `/tmp/p5_nogl.txt` | **不存在**（= 真拿到了上下文） |
| 我们自己交出的 OffscreenCanvas 上的 WebGL2 上下文 | **存在**（尺寸 560×420） |
| 绘图 | 成品经 postMessage → 页面 `<img>` 上屏 |

**顺带澄清一条**：`get: unknown axes property __legend_handle__` 这句在**单页模式与 worker 模式
完全一样**（专门对比过）⇒ 是既有的良性消息（plot 桥的探测路径），不是 worker 回归。

**判据升级**：`accept-worker` 的 H 从"要么上屏要么降级干净"升级为**强断言**：
`tk==='webgl' && nogl===0 && glCtx===true && plots≥1 && imgs≥1`（三条缺一条就翻面）。


---

## B5 加固 + E2 根因线索（2026-09-26，外部咨询回音后的实测处理）

外部咨询（Gemini）回来了，按本仓纪律**逐条对照实测**（不照抄），结果如下。

### 一、A 节已被我方自解决（批注已加在需求书顶部）
它给出的方向与我们的实测一致（worker 内自建 OffscreenCanvas、**不需要** OFFSCREENCANVAS_SUPPORT），
但**注入方式不同**：它主张 `specialHTMLTargets['#id'] = canvas`；我们的做法是让 `document.querySelector`
返回真 OffscreenCanvas（胶水的查找链 `specialHTMLTargets[target] || document.querySelector(target)` 两条都通）。
两条路都对；我们保留现方案（改动更小、不动胶水内部表）。

### 二、B 节（binaryen）——**它给的决定性仲裁实验一次就推翻了它自己的主假设**
- 用 V8（Node 26）直接编译未优化产物：**产物非法**，不是 binaryen 的锅 ——
  `Compiling function #12022 "ztrti2_" failed: expected 0 elements on the stack for fallthru, found 1 @+7774673`。
- WABT `wasm-validate --enable-all`（已装到 `/mnt/hdd/crossbuild-tools/wabt`）给出**三处**类型错
  （`076a1d2` 块尾多 i32、`078a0db` 多 4 个 i32、`078bcfe` drop 空栈）⇒ 系统性签名不匹配。
- 已排除（都实测）：atomics（0 处）、与 LAPACK 的重复符号（交集 0）、OpenBLAS 单方（最小链通过）、
  **删掉重名的 `z_abs.o`（`c_abs`/`z_abs` 与 f2c 重名）仍错**。
- **新线索**：OpenBLAS 的 `{c,z}rotg`（Givens 旋转，`interface/zrotg.c` 四种 -D 组合）引用
  **`__addtf3`/`__multf3`/`__getf2`/`__letf2`/`__trunctfdf2`** —— 即 **`long double`(fp128)** 软件例程；
  emscripten 的 `libcompiler_rt.a` 里**有**这些符号，但调用点/实现的约定在链接后产生类型错
  （wasm 无 f128 ⇒ LLVM 用 i64 对软化）。**注**：wasm32 上 `-mlong-double-64` **不被 clang 支持**
  （实测报 `unsupported option`），所以"改成 64 位 long double"这条路要**源码级**做。
- **下一步方向（留给后续/外部）**：① 用 `wasm-objdump -d` 定位三处类型错的具体调用点与 callee；
  ② 试 OpenBLAS 的 **CMake** 构建路径（旗标组合不同，可能避开 `-m32`/`F_INTERFACE_GFORT`）；
  ③ **源码级**把 `interface/zrotg.c` 的 `long double` 换成 `double`（最省事，代价是溢出裕度略降）。
- 结论：E2 仍**未跑通**；但"不是 binaryen 的锅"这条现在有**两个独立裁判**（V8 + WABT）背书。

### 三、C 节（验收矩阵挑刺）——**采纳 4 条，已落地并全绿**
`accept-worker` 从 11 条扩到 **16 条**（16 PASS / 0 FAIL）：
| 新判据 | 实测 |
|---|---|
| ★ C1 **重入防护**：挂起期间派第二条命令 ⇒ **排队**，不许撞 `Suspend error` | 两条都 rc=0、无 Suspend error（**修前是真洞**：会崩实例） |
| ★ C4a **纯计算**下主线程 tick ≈ 满额（≥0.7×应得） | 34/35（1000² 349ms）—— C3 的核心主张 |
| ★ C4b stdout 洪泛（5 万行）：不丢字 + 主线程仍活 | tick=11 / 222ms（**如实记**：输出密集时两线程争 CPU，达不到满额） |
| ★ C3 `terminate()` 结算 + 重启 | 待办 **201ms 内**以 `AbortError` reject；新实例照常 eval 且**同样拿到真渲染后端** |
**为修 C4 顺带修掉的真问题**：`octaveUiAppend` 每条都读 `scrollHeight`（**强制同步布局**）+ 页面侧无合批
⇒ 5 万行输出时主线程被占 ~170ms。修法：滚动跟随**按 200ms 节流** + worker 模式上屏改 **rAF 合批**
（结果到达前强制 flush，保证测试立即读到 `#output`）。纯计算那条证明主线程是真自由的（tick 满额）。
**未采纳/待办**（它提的另 4 条）：MEMFS 产物 `unlink`（我们的图路径固定为 `/tmp/p5_fig.png`，
天然不增长，但值得一条循环测试）、图像与完成信号的 FIFO 单调性、worker 崩溃的快速失败
（已实现 `onerror` → 立即 reject 待办，尚未写判据）、多 worker + IDBFS 隔离
（已实现 `opts.home` 按实例换挂载点，尚未写判据）。


---

## E2 悬案（2026-09-26 收手时的完整证据链与下一步阶梯）

**结论**：E2 **未跑通**。但根因从"玄学"推进到"工具链点名的 76 个符号 + 一个反直觉的不变量"。

### 已证（都可复跑）
1. **不是 binaryen 的锅**（两个独立裁判）：
   - V8（Node 26）：`WebAssembly.Module(bytes)` 报
     `Compiling function #12022 "ztrti2_" failed: expected 0 elements on the stack for fallthru, found 1 @+7774673`；
   - WABT（已装 `/mnt/hdd/crossbuild-tools/wabt`）：`wasm-validate --enable-all` 给三处类型错
     （`076a1d2` 块尾多 i32、`078a0db` 多 4 个 i32、`078bcfe` drop 空栈）。
2. **`wasm-ld` 亲口点名了 76 个"同名不同签名"**：反汇编里写着
   `call 390 <signature_mismatch:lsame_>`；字节 grep 未优化产物得到 76 个
   `signature_mismatch:*`（`dgemm_`/`daxpy_`/`lsame_`/`ztrsm_` … 清一色 BLAS 符号）。
   ⇒ 在 `--allow-multiple-definition` 下**同名不同签名被静默合并**成一个非法函数。
3. `liblapack.a` **不**定义 BLAS 符号（`dgemm_=0`、`lsame_=0`）；BLAS 由 `-lrefblas` 提供。
4. **已排除**：atomics（构建日志 0 处）、与 LAPACK 的重复符号（交集 0）、
   "删掉与 f2c 重名的 `z_abs.o`"（删了仍错）、fp128 软例程（源码级改掉 `zrotg.c` 的
   `long double` 后**偏移一字未变**）、OpenBLAS 的 Fortran 接口 ABI
   （用 **`F_COMPILER=G77`** 重建——f2c 时代的 ABI——归档 sha/大小确实变了
   `e316789d`/2,016,902 vs `20d2bf57`/2,001,060，**失败偏移仍是 `0:7912702`**）。
5. **反直觉的不变量（下一位的关键线索）**：三种**实质不同**的 OpenBLAS 归档
   （gfortran 接口 / 打了 fp128 补丁 / G77 接口）失败**偏移完全相同** ⇒ 报错点对 OpenBLAS
   内容不敏感。同时"同一命令**不带** OpenBLAS 就成功"。
   ⚠️ 附注：改 make **变量**（如 `F_COMPILER`）**不会让旧对象失效** ⇒ 第一次"G77 重建"
   是空操作（归档 sha 不变），必须**重新解包**才真重编（已踩过）。

### 下一步阶梯（照着做，别再从头猜）
1. 取**未优化**产物：重链时 `EMCC_DEBUG=1`（中间件留在 `/tmp/emscripten_temp/emcc-0*-*.wasm`；
   不带该变量则不留）。
2. 列全部嫌疑符号：`grep -ao "signature_mismatch:[A-Za-z0-9_]*" <unopt.wasm> | sort -u`。
3. 找**每个符号的第二个定义来自谁**：`emnm` 扫**全部**输入（含 Octave 自己的目标文件、
   `liboctave`、blas-xtra 等）——我此前只比对了 OpenBLAS × {lapack,f2c,arpack,qrupdate,pcre2}，
   **没扫 Octave 自身的对象**，而 76 个符号的"另一半"极可能在那里（Octave 自带 BLAS 副本）。
4. 定向验证：把冲突的那一份从链接里去掉（或让它与另一份**签名一致**），再看
   `signature_mismatch:*` 是否归零、产物是否变合法（`wasm-validate --enable-all` / V8）。
5. 只要产物合法，后续就回到常规：DGEMM 基准（`test/browser/bench-dgemm.mjs`，与现役
   SIMD 版比）+ 5 套数值回归（boot/libs/hdf5/slicot/ode15）+ 独立车道 877x 上跑。

---

## ★ Firefox × 多线程：实测重估（2026-09-26，用户点名"要兼顾 Firefox 的体验"）

**起因**：用户在"多线程这一块"上要求兼顾 Firefox。先把事实量清楚，不猜。

### 1) 线程产物 × Firefox（决定性对照）
用现成的 E3 探针产物（`/mnt/hdd/octave-wasm-build/threads-probe/`：pthread + 运行期 dlopen），
同一个 runner 分别喂 Chromium 与 Firefox（**顶层页** + 注入 `COOP: same-origin` /
`COEP: require-corp`）：

| 引擎 | pre | ok（期望 100） | missing（期望 0） | busy | runMs |
|---|---|---|---|---|---|
| chromium 152 | `{coi:true, sab:function, sabNew:ok}` | 100 | 0 | 47 | 28 |
| **firefox 155** | `{coi:true, sab:function, sabNew:ok}` | **100** | **0** | 42 | **23** |

⇒ **Firefox 跑 pthread 产物与 Chromium 完全平齐**（这一格甚至略快）。
对照：**无 COI** 时两个引擎**同样**失败 —— chromium `DataCloneError: … SharedArrayBuffer
transfer requires self.crossOriginIsolated`；firefox `DataCloneError: The WebAssembly.Memory
object cannot be serialized. The Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy…`
（Firefox 的报错信息更清楚，还直接点名了那两个头）。

### 2) coi-serviceworker（"宿主设不了响应头"时唯一的路）× 三引擎
`probe-coi-sw.mjs`（三引擎 × 三档，**7 PASS / 2 FAIL**，2026-09-26 复跑）：

| 引擎 | off | default（require-corp） | credless 定制 |
|---|---|---|---|
| chromium | 无 COI，CDN ✓ | **coi=true, sab=function**，CDN ✓ | **coi=true**，CDN ✓ |
| firefox | 无 COI，CDN ✓ | **coi=true, sab=function**，CDN ✗被拦 | **coi=true**，CDN ✗被拦 |
| webkit | 无 COI，CDN ✓ | **coi=true, sab=function**，CDN ✗被拦 | **coi=true**，CDN ✗被拦 |

⇒ **三个引擎装上 SW 后都能拿到 `crossOriginIsolated` + `SharedArrayBuffer`**（同源 iframe 也继承）。
被拦的**只有跨源且无 CORP 的第三方脚本（CDN）**；credentialless 定制在 Firefox/WebKit 上
救不回 CDN（那两条 C 断言 fail 就是记录这件事）。

### 3) 由这两条得出的结论（并更正一处旧判断）
- **多线程本身不歧视 Firefox**：两个引擎都要 COI，拿到就都能跑 ⇒ 翻闸门③**不会**造成
  "Chromium 能用 / Firefox 不能用"的分裂。
- ★ **更正**：`PLAN-arch.md` / `HANDOFF.md` 曾写"线程档在 GitHub Pages 上跑不起来" —— **错**。
  真实约束是"**装了 SW 之后页面不能引跨源 CDN 资源**"，而本站页面的 script 全是同源本地文件
  ⇒ 这条对我们无影响。
- Firefox 的 COI 选项比 WebKit 宽：**require-corp 与 credentialless 都支持**（`probe-coep-engines` 6/0）。
- B6 仍**不做**，但理由改成"收益有限（SIMD 已到手）+ 双产物是长期成本 + 要不要为多线程要求 COI
  是产品取舍"，而不是"Firefox/Pages 不支持"。

### 复跑方式
```sh
# ① 线程产物 × 两引擎（有/无 COI 对照）：见本次的一次性 runner 形态
cp /tmp/ff-threads.mjs /mnt/hdd/octave-wasm-build/harness/ && \
  cd /mnt/hdd/octave-wasm-build/harness && COEP=require-corp sh run.sh /tmp/ff-threads.mjs
# ② coi-serviceworker × 三引擎 × 三档
PLAYWRIGHT_BROWSERS_PATH=/mnt/hdd/crossbuild-tools/pw-browsers \
  sh run.sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-coi-sw.mjs
# ③ 双引擎对齐（日常回归网）：probe-engine-parity.mjs（A3 起在仓库里）
```

---

## ★ 线程版 BLAS 缩放：实测数字（2026-09-26）—— 回答"多线程到底快多少"

**为什么测**：B6 的取舍缺这个数 —— 而 `E2`（OpenBLAS **链进 Octave**）卡在 binaryen 的
76 个 `signature_mismatch` 悬案上。那是"进主模块"这一步的问题，**与线程 BLAS 本身的性能无关**
⇒ 立一个**独立探针**绕开它（不碰 Octave、不翻闸门、不动现役产物）。

**怎么来的**（全部可复跑）：
1. 线程版 OpenBLAS：干净副本 + `USE_THREAD=1`（配方见 `build/113/probe-blas-threads.sh` 头部）
   —— 产物名带 `p`：`libopenblas_wasm128p-r0.3.34.a`（3.1MB，**408 个 pthread/exec_blas 符号**，
   非线程版那份是 0）。
   ⚠️ **必须先打可移植性补丁**：`driver/others/blas_server.c` 用了 `struct rlimit` / `raise` / `SIGINT`
   ⇒ Emscripten libc 没有（三条编译错，整个库编不出来）。
   补丁脚本：`build/113/patch-openblas-threads.py`（3 处 `__EMSCRIPTEN__` 守卫，那段只是
   `pthread_create` 失败后的诊断 ⇒ wasm 里无意义）。
2. 探针：`build/113/probe-blas-threads/{main.c,run.html}` + `build/113/probe-blas-threads.sh`
   （`-pthread -sSHARED_MEMORY=1`，池 12）。
   ⚠️ **第二个坑**：OpenBLAS 的默认线程数是编译期烘进去的 `-DMAX_CPU_NUMBER=<nproc>`（本机 24）
   ⇒ 它一上来就要 24 个 worker，池不够 ⇒ `pthread_create` 失败 ⇒ 走"起不来"分支 ⇒ **整个程序 exit**
   （实测：`blas_thread_init: pthread_create failed for thread 13 of 24: Resource temporarily unavailable`）。
   修法：`main.c` 里 `setenv("OPENBLAS_NUM_THREADS","1",1)` 压默认，再由每个格子显式
   `openblas_set_num_threads(T)` 拉起。⚠️ 别用 `-sENV=…`：emcc 5.0.7 **没有**这个设置项。
3. 跑：`test/browser/probe-blas-threads.mjs`（自托管 + 注入 COOP/COEP；chromium 与 firefox 各跑一遍）。

**数字**（DGEMM，列主序 NoTrans，每格 1 次热身 + 3 次取最快；GFLOPS = 2N³/t）：

| N | 引擎 | T=1 | T=2 | T=4 | **T=8** |
|---|---|---|---|---|---|
| 512 | chromium | 22ms / 12.1GF | 1.84× | 3.07× | 3.95× (47.9GF) |
| 512 | firefox | 23ms / 11.8GF | 1.10× | 2.47× | 4.93× (58.1GF) |
| 1024 | chromium | 179ms / 12.0GF | 2.13× | 3.50× | **6.77×** (81.0GF) |
| 1024 | firefox | 166ms / 12.9GF | 1.94× | 3.60× | **6.68×** (86.2GF) |
| 2000 | chromium | 1219ms / 13.1GF | 1.95× | 3.59× | **7.16×** (94.0GF) |
| 2000 | firefox | 1226ms / 13.1GF | 2.03× | 3.72× | **7.18×** (93.7GF) |

**结论**：
- ★ **收益是真的、而且很大**：N=2000 上 **T=8 = 7.2×**（13.1 → 94.0 GFLOPS）；
  T=4 = 3.6×、T=2 ≈ 2×（次线性，正常）。
- ★ **Firefox 与 Chromium 几乎完全一致**（7.18× vs 7.16×）⇒ 用户点名的"兼顾 Firefox"**成立**。
- ★ 同时纠正一个容易搞混的说法："翻闸门③就能变快" —— **不对**。现役 refblas/lapack 是 f2c 出来的
  **标量**代码，运行时支持线程也**没有并行可给**；真正的收益来自**换成线程版 BLAS**（本探针）。
  两件事要一起做：线程运行时（⇒ COI）+ 线程版 BLAS。
- ⚠️ **还没链进 Octave**：本探针证明"线程版 OpenBLAS 在 wasm 里能跑、能缩放到 7.2×"，
  但把它放进产品还要过 `E2`（链进主模块）那一步 —— 悬案仍在（76 个 `signature_mismatch`）。
- 复跑：`bash build/113/probe-blas-threads.sh` → `cd /mnt/hdd/octave-wasm-build/harness && sh run.sh <repo>/test/browser/probe-blas-threads.mjs`
  （`NOCOI=1` 那档是反证：不注入 COI ⇒ 起不来，证明线程硬依赖 COI）。

---

## ★ E2 悬案：根因锁定（2026-09-26，**推翻两次旧猜测**）

**旧猜测 1（错）**："重复符号 vs LAPACK，交集 0" ⇒ 据此排除"重复定义"。
实测：那次查的是 `liblapack.a`（交集确实 0），但**重复的另一半不是它**。
本轮实测到的真实重复对：`-lrefblas`（`/usr/local/lib` 那份 **f2c** 约定）与
`/src/work/blas-nof2c/lib/librefblas.a`（**gfortran** 约定）**共享 156 个同名符号**；
而 E2 的 5 次尝试（`m2fc-ob*`）**每次都有同一个缺陷：只换 BLAS、没删 `-lrefblas`**
⇒ 它们的失败里混着"两份 BLAS"这个额外变量。

**旧猜测 2（错）**：换 Fortran 接口（G77/GFORT）能解决。
实测：干净副本 + `F_COMPILER=G77` 重编（构建日志里 `-DF_INTERFACE_G77` 出现 **1689** 次、
`-DF_INTERFACE_GFORT` **0** 次 ⇒ 接口真的换了），再**删掉 `-lrefblas`** 重链
⇒ `function signature mismatch` **仍是 78 个，一个不少**。

**★ 真根因（wasm-ld 自己写在警告里）**：**只是返回类型不一致** ——

```
wasm-ld: warning: function signature mismatch: dswap_
>>> defined as (i32,i32,i32,i32,i32) -> i32   in /usr/local/lib/liblapack.a(dlaqps.o)
>>> defined as (i32,i32,i32,i32,i32) -> void  in /openblas.a(dswap.o)

wasm-ld: warning: function signature mismatch: ztrsv_
>>> defined as (…11 个 i32…) -> i32  in /src/deps/qrupdate/lib/libqrupdate.a(zlup1up.o)
>>> defined as (…8 个 i32…)  -> void in /openblas.a(ztrsv.o)
```

**参数一致，差别只在"子程序返回 `int`（f2c 约定）"vs"返回 `void`（OpenBLAS 约定）"。**
这一条解释了三件事：
① **为什么"错误点对 OpenBLAS 的内容不敏感"** —— 它只关乎**声明**，不关乎代码；
② **为什么换 G77/GFORT 接口无效** —— 那两个宏不动返回约定；OpenBLAS 里唯一与 f2c 相关的
   `NEED_F2CCONV`（`common.h:668`）只改 `FLOATRET`（"函数返回 float 还是 double"），
   不管 `void` 子程序；
③ **binaryen 那句 `popping from empty stack`** —— 调用方按"返回 i32"调用一个 `void` 函数，
   栈上多出一个值（`expected 0 elements on the stack for fallthru, found 1`）。

**下一步（最小改动方向，本轮未做，如实记）**：让两边的返回约定一致。现成开关**没有**，所以：
· 方案 A：给 OpenBLAS 的 `interface/*.c` 的这 78 个入口加 `int` 返回 ——
  **必须同时保证 `return 0;`**（只改声明不改函数体会让 clang 发 `unreachable` ⇒ 运行期 trap）；
· 方案 B：在链接层加一层"int 返回的薄包装"（把 OpenBLAS 的符号改名后由包装层转发）——
  需要给 OpenBLAS 的 78 个符号做重命名，机械但可行；
· 方案 C（不改 ABI）：**放弃把 OpenBLAS 链进主模块**，改用"side module 自包含"那条既定架构
  （像 `__ode15__` 内嵌 SUNDIALS 那样，见 `rebuild-pic-blas.sh` 的注释）—— 但那样多线程 BLAS
  只能被**走 dlopen 的 .oct** 用到，而 Octave 自己的 `A*B` 走的是主模块里的 BLAS ⇒ 收益不到手。

**实验产物（容器内，均未 promote、站点零改动）**：
`/src/websrc/e2-one-blas`（单 BLAS：删了 `-lrefblas`）、`/src/websrc/e2-g77`（G77 接口 + 单 BLAS）。
容器里的 `link-web.sh` 实验期间被临时 sed 过，**已从仓库恢复**（sha 双侧一致 `0eaa1f0e…`）。

### 方案 A 的首次尝试（自动化补丁）—— 失败，原因记档（别再重走）

思路：把 `interface/*.c` 里所有 `void NAME(...)` 改成 `int NAME(...)` 并补 `return 0;`
（f2c 的调用方按 `int` 返回调用；不补 `return 0;` 的话 clang 会发 `unreachable` ⇒ 运行期 trap）。

两版都编不过（`BUILD_EXIT=2`）：
1. **第一版把函数原型也当成定义了**：`void NAME(...);` 这种声明也被匹配 ⇒ 花括号配对从声明一路
   跑到**下一个函数体** ⇒ 括号失衡（报 `expected identifier or '('` / `extraneous closing brace`）。
2. **第二版修正为"先配对参数表、再看 `)` 到 `{` 之间是否纯空白（原型以 `;` 结束 ⇒ 跳过）"**：
   73 处真定义都改到了，但**仍有 63 个编译错** ⇒ 原因是**花括号配对会被注释/字符串里的
   `{`/`}` 骗到**（例：`interface/copy.c` 的裸计数 3 对 2）。
   ⇒ 要自动化就必须**先剥注释与字符串**再配对，或者用生成器把 `return 0;` 插在函数末尾的
   明确标记处；否则就得**方案 B**（`SYMBOLPREFIX` 改名 OpenBLAS 的符号 + 生成 78 个 int 返回的
   薄包装）。两者都是**正经工程**，不是探针。

**本轮到此收手**（如实记）。容器状态已恢复：`interface/` 从干净源取回、`make` 重编 **EXIT=0**、
`/src/bin/link-web.sh` 与仓库 sha 一致（`0eaa1f0e…`）；站点零改动（8761 部署件仍 `1ed3e528…`，
三列 parity 绿）。实验产物留在容器：`/src/websrc/e2-{one-blas,g77,ret,ret2}`。

---

## B5 · side module（`.oct` 的形态）**必须**带 `-pthread` 吗？（branch `threads` 第一批，2026-09-27）

**为什么先问这个**：它是**整批的规模开关**。`.oct` 车道有 49 条资产（13 个包 + 核心 dldfcn），
如果"非 atomics 编的 side module 载不进 shared-memory 主模块"成立，这 49 条**全部**要重编；
而 `probe-threads/side.c` 的注释与 `PLAN-threads.md` 里那句"side 也必须带 `-pthread`"**只有正向证据**
（E3 两档都带了 `-pthread`）⇒ 这是本批第一个要证伪的断言。

**做法**：`build/113/probe-side-atomic.sh` —— **只变 side 的旗标**，主模块三档共用同一份线程档
（`-pthread -sSHARED_MEMORY -sMAIN_MODULE=2 -sPTHREAD_POOL_SIZE=2 -sPTHREAD_POOL_SIZE_STRICT=2`）。
三档：

| 档 | side 的旗标 | 角色 |
|---|---|---|
| `threads` | `-pthread -sSHARED_MEMORY` | E3 基线（已知绿） |
| `plain` | **无** | **现役 `.oct` 资产的编法** ← 要回答的就是它 |
| `atomics` | 只 `-matomics -mbulk-memory` | 若 `plain` 红，这是最便宜的修补 |

**判据**（每档跑 `test/browser/probe-threads.mjs`，从仓库原路径直跑）：
```sh
cd /mnt/hdd/octave-wasm-build/harness && \
  PROBE_DIR=/mnt/hdd/octave-wasm-build/side-atomic/<档> sh run.sh \
    /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-threads.mjs
```

**实测结果（2026-09-27，chromium + COI）**：

| 档 | 结果 | 关键数字 |
|---|---|---|
| `threads` | **6 PASS / 0 FAIL** | `ok=100`、`busy=48`、`missing=0` |
| `plain` | **5 PASS / 1 FAIL** | **`ok=0`** —— dlopen 第一步就失败 |
| `atomics` | **5 PASS / 1 FAIL** | **`ok=0`** —— 与 `plain` 同 |

失败原文（`plain`，`run.html` 的 wasm 日志）：
```
[e3] 第 0 轮 dlopen 失败：could not load dynamic lib: /side.wasm
TypeError: tlsInitFunc is not a function
```

**结论（两条，都是"能证伪但没被证伪"）**：
1. **"side module 必须带 `-pthread`"成立** —— 非线程档的 side module 在 shared-memory 主模块里
   **连 dlopen 都过不去**：加载器要调 side 的 **TLS 初始化入口**（`tlsInitFunc`），而它只在
   `-pthread` 编出来的 side module 里存在。
2. **"只加 `-matomics -mbulk-memory`"不够**（`atomics` 档与 `plain` 同结果）⇒ 最便宜的修补被排除，
   `.oct` 车道必须按 `-pthread` 整档重编。

**⇒ 对批量的影响**：线程档 = **依赖库 farm + Octave + `.oct` 车道**三者全部重编（不是"重编 Octave"）。
两档的 prefix 必须分开（现役 farm 一字不动）：`/usr/local-threads`、`/src/deps-threads`。

**踩到的假红（记下来，差点污染结论）**：第一版脚本的源码路径写成
`SRC="$(dirname $0)/probe-threads"; [ -d "$SRC" ] || SRC=/src/probe-threads` —— 容器里那份
`/src/probe-threads/run.html` 是 **preload 时代的旧件**（没有 `fetch`/`writeFile`）⇒ 三档**全部**
因"dlopen 找不到 `/side.wasm`（fetch 根本没发生）"而红，看起来像"三档都不兼容"。
现在脚本里**找不到正确源码就 FATAL**，并显式检查 `run.html` 里有 `writeFile`。

---

## B6 验收期抓到的三条**车道专属**机制缺陷（2026-09-27，全部有复跑方式）

三条的共同形状：**构建/加载全绿，只有真正调用那条代码路径才崩**（"能编过 ≠ 能用了"的教科书）。
每条的判据都落在**产物字节**上，并且都进了某个 `--selftest`。

### ① `.oct` 引用两档主模块都不提供的 `__cxa_guard_*` ⇒ `TypeError: resolved is not a function`

现场：`accept-dldfcn` 线程档 `65/6`，失败集中在 audio（基础档同套件 `71/0`）：
`CRASH | audiowrite 写 wav :: Error: page.evaluate: TypeError: resolved is not a function
at stubs.<computed> (threads/octave.js:1:…)` —— 动态链接的导入代理把符号解析成了 undefined。

容器里三行可复跑（`g2.cpp` = 带**动态** static 初始化的函数）：

| 旗标 | 目标文件里 `__cxa_guard` 出现次数 |
|---|---|
| `em++ -O2 -fwasm-exceptions -c` | **0**（emcc 默认就是 `-fno-threadsafe-statics`） |
| 加 `-pthread` | **3**（clang 改回线程安全静态） |
| 再加 `-fno-threadsafe-statics` | **0** |

而**两档主模块都不定义**这两个符号（`llvm-nm --defined-only --extern-only` 在基础/线程两份
`octave.wasm` 里都没有）⇒ 线程档里那个引用了守卫的 `.oct` 第一次动态静态初始化就崩。
实测范围：44 个车道 `.oct` 里**只有 `audioread.oct`**（基础档 44 个都没有）。

修法与判据：车道影子必须带 `-fno-threadsafe-statics`（`build-oct-lane.sh` 第⑧条，缺则 FATAL）；
产物侧由 `check-oct-lane.py` **判据②** 保证（两档 `.oct` 都不许出现这两个串）。
复跑：`python3 build/113/check-oct-lane.py <车道目录…> --base <基础目录…>`（自证里有一条专门
拿"旧配方重建的 `audioread.oct`"验它会红）。

### ② 车道清单照抄了基础档的 **install 前缀** ⇒ 线程档 `help` 读不到 docstrings

现场：`accept-help` 线程档 `5/7`（基础档 `12/0`）：
`failed to open docstrings file: /src/work/octave-install-threads/share/octave/11.3.0/etc/built-in-docstrings`。

实测（`grep -ao` 直接扫两份 wasm）：基础产物烤 `/src/work/octave-install`、线程档烤
`/src/work/octave-install-threads`；基础清单把 `built-in-docstrings`/`doc-cache`/`macros.texi`
挂在前者下（对），而车道清单是**从基础清单生成的**，把 `mount` 照抄了 ⇒ 线程档按自己烤的路径
去读，必然没有。

修法与判据：`make-lane-manifest.py` 增加第三类改口（起步于基础前缀的 `mount` → 车道前缀），
前缀**从两份 wasm 里读**（`baked_prefix()`，读到多种/读不到就 FATAL —— 不猜）；
`--check` 新增判据⑤（产物烤的前缀必须有挂载 / 不许残留另一档前缀 / 基础清单不许出现车道前缀）。
自证 12 → 18 条。

**附带的坑（自证当场抓到）**：`/src/work/octave-install` 是 `/src/work/octave-install-threads`
的**前缀** ⇒ 只判 `startswith(基础)` 会把**正确产物**判成"残留基础前缀"，而改口那步会把
`…-threads/share` 再改成 `…-threads-threads/share`。两处都补了"排除更长的那个"。

### ③ slicot 调度模块**没把静态库链进去** ⇒ `step` 也崩在同一个 `resolved is not a function`

现场：`accept-forge2` 线程档 `43/1`，唯一红是 `★ step 与解析解 1-e^-t 一致`。

实测（两档同一模块对照）：

| | 体积 | `dgemm_/dlamch_/lsame_/dggev_` |
|---|---|---|
| 基础 `__control_slicot_functions__.oct` | 8,115,591 B | **定义在模块里**（4/4） |
| 车道第一版 | 2,966,696 B | **全是导入**（0/4） |

主模块**不导出** BLAS/LAPACK（两档都不导出）⇒ 226 个符号解析成 undefined ⇒ 首次 BLAS 调用崩。
根因：第一版只链了 `slicotlibrary.a`，而配方（`NOTES-slicot.md` §5.8）是五段：
`common.oct.o → slicotlibrary-nodup.a → liblapack.a → librefblas.a → libf2c-subset.a → f2c-io-shim.c`。

修法与判据：`build-oct-lane.sh` ④b 补齐整条链，新增**判据⑨**：模块里必须**定义**（不是导入）
≥3 个 BLAS/LAPACK 入口，否则 FATAL。重编后 `8,097,627 B`、4/4 定义。

**为什么 BLAS/LAPACK 用基础档的 PIC 归档**：车道那套 `lapack-simd` **不是 PIC** ⇒ side module
链接直接报 `relocation R_WASM_MEMORY_ADDR_LEB cannot be used against symbol …; recompile with
-fPIC`（实测）。基础档 slicot 用的也是这份 PIC 归档 ⇒ 两档 slicot 路径**算得完全一样**；
side module 自带 BLAS 副本是设计使然（主模块不导出 BLAS）。

### 顺带记一条**部署态**的坑（不是车道专属，但本轮差点踩到）

`build/promote-webgl.sh` 的默认 `SRC_OUT=/src/websrc/out`、`GL_OUT=/src/websrc/out-webgl`
停在 **9-23 那条带 GL 的旧车道**（wasm 36.8MB）；现役基础档是 9-25 链的 M2 SIMD 产物
（`/src/websrc/m2fc-simd-out` = 改名前的 `product`）。**裸跑 promote 会把 8761 静默换成 9-23 那份**，
而脚本内所有自检（gl4es/字体/桥资产/开机）照样全绿 ⇒ 加了 §1b 判据（产物要变时，容器里那份的
构建时间不得早于站点现役那份的落件时间；硬推要显式 `FORCE_OLD_ARTIFACT=1`）。
本批正确姿势：`SRC_OUT=/src/websrc/m2fc-simd-out GL_OUT=$SRC_OUT`（与现役三件逐字节相同）。

### ④ **选档只传给"第一个上下文"** ⇒ 其余上下文各自再判一次（两个套件由红转绿）

现场两条红，形状**同一个**：`Module.eval_string is not a function`，而单页单实例全绿。
- `accept-embed-multi`：第二实例 `i2Ready=false`；
- `accept-worker`：worker 模式 4 PASS / 12 FAIL。

**第二实例那条（实测根因）**：`createOctaveHost` 转发的是 `opts.lane`；而嵌入者/套件调
`createOctaveHost({mount:'#host2', home:'/home/web_user/i2', id:'i2'})` 时**不带 lane** ⇒ 内核
缺省回**基础档**，可页面上 `document.write` **只加载了本档的胶水**（线程档）⇒ **线程胶水 +
基础产物** ⇒ 第二个实例拿不到导出。修：缺省值 = 页面的选档计划
（`opts.lane || window.__octaveLanePlan`）⇒ `accept-embed-multi` **13/0**。

⚠️ 这条同时**推翻我自己先前的一个猜想**："pthread 胶水不能在同页再入（两个实例必然坏）"。
实测量到的是**错配的症状**，不是再入的限制 —— 两个 pthread 实例同页共存**没问题**
（状态隔离、FS 隔离、资产进对实例、交替 100 次 eval 全绿）。**"能编过/能起来 ≠ 用得了"，
反过来也成立：看起来像"能力不支持"的现象，先怀疑"两边配置不一致"。**

**worker 那条（实测根因，两条结论）**：
1. worker 里的 `location.search` 是 **worker 脚本自己的** URL ⇒ 页面写 `?lane=base` 对 worker
   **无效**（worker 照旧按 `crossOriginIsolated` 选线程档）⇒ 现象与"线程档进 worker"混淆在一起。
   修：页面把选档结果写进 Worker URL（`octave-worker.js?lane=<plan>`），worker 的 `override()`
   读得到 ⇒ 两边**必然同档**。
2. 同档之后真相露出来：**线程产物在 DedicatedWorker 里当主宿主确实起不来**
   （`ready:false` + `Module.eval_string is not a function`）。所以 `lane.js` 的 picker 加一条：
   **worker 宿主缺省基础档**（判据 `typeof env.importScripts === 'function'` —— worker 专有；
   页面没有）。显式 `?lane=threads&worker=1` 仍然选线程档并**硬失败**（实测 worker 永不 ready），
   不做静默降级 ⇒ `accept-worker` **17/0**。

**为什么用 `importScripts` 而不是只看 `?worker=1`**：手搓 `new Worker('octave-worker.js')` 也是
真实用法（套件 C3b 重启就是手搓的，没有查询串）⇒ 只靠 URL 会漏。

**⇒ 线程档的两条已知边界（都写进断言，改回去就会红）**：
- worker 宿主：自动落基础档（`probe-lane` 格 5 + `accept-worker` 的 B6 那一条）；
- 同页多实例：**支持**（13/0），前提是选档缺省取页面计划（否则错配）。

### ★ 反例：**手抄桥文件到 8761 会让基线"半新半旧"**（2026-09-27，我自己踩的，已回退）

为了在 8768 上试 worker 修法，我顺手把 `bridge/{lane.js,index.html}` 也 `cp` 进了
`/mnt/hdd/octave-wasm-build/site`（**8761 那个站点**），而那个站点上**没有 `threads/`**：
8761 正由 `serve-coi.py` 带头服务 ⇒ 页面按"COI + SAB"选**线程档** ⇒ 去取 `threads/octave.js`
**404** ⇒ **验收底线当时是坏的**（实测：`curl -I` 头在、`threads/octave.js` 404、
`lane.js` 200、页面里 0 处档引用回退后才成立）。

回退（实测三步，全都不需要浏览器）：
```bash
cp <仓库>/site/index.html /mnt/hdd/octave-wasm-build/site/index.html   # 回到 8e93b8da（入库存档那份）
rm -f /mnt/hdd/octave-wasm-build/site/lane.js                          # 摘掉多出来的选档文件
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8761/lane.js  # 期望 404
grep -c 'threads/' /mnt/hdd/octave-wasm-build/site/index.html          # 期望 0
```

**规则（写进操作习惯）**：**8761 只由 `build/promote-webgl.sh` 改**。想在 8768 上试页面改动，
就只 `cp` 到 `siteWebGL/`；手抄到 `site/` 等于把"页面认档 + 站点没有线程档"这种**半新半旧**状态
装上基线 —— 它不会自己报错，只在浏览器里 404（而 `check-site-parity --strict` 事后能抓到：
它的部署件清单里现在有 `lane.js` 与 `threads/*`，一处缺就是红）。

---

## ★ E2 落地：线程版 OpenBLAS 链进主模块（2026-09-27，branch `e2-openblas`）

### 一句话结论

**78 条 mismatch 的根因是返回约定**（f2c/F77_RET_T 按"子程序返回 `int`"调、OpenBLAS 定义成
`void`）。方案 A（改 `interface/*.c` 的返回类型）在**共享函数体**上撞墙（体里有裸 `return;`，
改成 `int` 会打破 CBLAS 那趟）；**方案 B 落地**：给 OpenBLAS 的 Fortran 入口加 `ob_` 前缀 +
生成薄包装接回既有 ABI。**产物 verdict=ok，且链接警告与车道基线逐条相同（E2 零新增警告）**。

### 配方（可复跑；全部在容器内）

```bash
# ① 干净副本（★ 必须从原始树取；在跑过一轮构建的树里继续构建会踩 config.h/旧对象）
rm -rf /src/work/OpenBLAS-e2 && mkdir -p /src/work/OpenBLAS-e2
tar -C /src/work/OpenBLAS-0.3.34 --exclude='*.o' --exclude='*.a' --exclude='*.so' \
    --exclude='config.h' --exclude='Makefile.conf' -cf - . | tar -C /src/work/OpenBLAS-e2 -xf -

# ② 两个补丁（都是工具，都带 --check/--revert/--selftest）
python3 /src/bin/patch-openblas-symbol-prefix.py --apply /src/work/OpenBLAS-e2 ob_
python3 /src/bin/patch-openblas-emscripten.py   --apply /src/work/OpenBLAS-e2

# ③ 构建（线程 + SIMD；NUM_THREADS=4 与主模块的 PTHREAD_POOL_SIZE 对齐；E2PREFIX 让 NAME 带前缀）
cd /src/work/OpenBLAS-e2 && make TARGET=WASM128_GENERIC USE_THREAD=1 NO_LAPACK=1 NO_SHARED=1 \
     NUM_THREADS=4 E2PREFIX=ob_ CC="ccache emcc -pthread" FC="/src/bin/emf77 -pthread" HOSTCC=gcc -j12
#   ⇒ libopenblas_wasm128p-r0.3.34.a（utest/*.exe 编译失败无妨：我们不需要测试程序）

# ④ 包装（签名从**两次预言机**量出；见下"怎么量签名"）
python3 /src/bin/gen-f77-wrappers.py --from-log <harvest+oracle 合成日志> \
        --extras <相同签名的那批.tsv> --out /tmp/e2-f77-wrappers.c

# ⑤ 组装 E2 的 librefblas.a = 前缀 OpenBLAS（**摘掉 c_abs.o**）+ 包装对象
ar d librefblas.a c_abs.o
emar r librefblas.a e2-f77-wrappers.o

# ⑥ 链接（车道模式 + E2 口子；★ 车道影子必须进 PATH：`main.cc` 不带 -pthread 会被 shared-memory 拒）
SHIM=$(PATH=/src/bin:$PATH bash /src/bin/lane-shim.sh "-pthread -fno-threadsafe-statics" \
        /src/libwork/lane-shim-guards); export PATH="$SHIM:$PATH"
E2_OPENBLAS=/src/work/e2-openblas-lib bash /src/bin/relink.sh link threads --out /src/websrc/e2-ob-out
```

### 怎么量签名（**两次预言机**）

`wasm-ld` 的 mismatch 报文只报**有冲突**的符号 ⇒ "当时就相符"的那批（加前缀后**原名没人提供**）
必须在第一轮链接后从 `warning: undefined symbol:` 里捞出来，再量它们的签名。量法：

```c
/* 用 0 参调用去逼链接器把**定义侧**签名打出来（C 里 `void f()` 是不带原型的声明） */
extern void zhemm_();  int main(void){ zhemm_(); return 0; }
```
```bash
emcc this.c <要量的那份库> -o t.wasm --no-entry -sERROR_ON_UNDEFINED_SYMBOLS=0
# 输出里 `>>> defined as (i32,…,i32) -> void in …/librefblas.a(zhemm.o)` 就是定义侧签名
```

**要量两次**：对**车道**的库量一次（= **调用方**约定：f2c 的 LAPACK / flang 的 qrupdate），
对 **OpenBLAS** 量一次（它自己的约定）。两者合起来才能判"该走哪条规则"：

| 车道（调用方） | OpenBLAS | 处理 |
|---|---|---|
| `(n×i32) -> i32` | `(m×i32) -> void` | 规则①：转发前 m 个 + `return 0;`（**子程序，多数**） |
| `(n×i32) -> f64` | `(n×i32) -> f32` | 规则②：加宽 `(double)`（单精度函数返回 doublereal） |
| `(n×i32) -> i32` | `(m×i32) -> i32`，m<n | 规则③：丢隐藏字符长度（`lsame_`） |
| `(n×i32) -> f64` | `(m×i32) -> void`，m=n+1 | 规则④：sret 结果区、返回 `r[0]` |
| 两侧**相同** | 相同 | **透传**包装（名字没了、签名不变） |
| 形状不在表里 | — | **拒绝生成**（"另一侧参数表必须是前缀关系"是硬判据） |

### 三个必须记的坑

1. **`zdotu_` 有约定互斥的两个调用方**：lane 的 LAPACK 按 `(6,void)`（sret）、qrupdate 按 `(5,f64)`。
   去包装会让**两个引用互相打架**（`error: function signature mismatch`，链接直接失败）⇒ 按
   **OpenBLAS 的签名透传**，复现车道现状。**这条 mismatch 是既有的**：车道基线链接（无 E2）
   也只有它，产物 wasm sha 复现现役的 `c2899a71…`。
2. **`c_abs` 交给 libf2c**：调用方（lane LAPACK，`clahqr.simd.o`）要 `(1)->f64`，OpenBLAS 自带一份
   **f32** 且**没被加前缀**（所以也没有 `ob_c_abs`）⇒ 包装会同名冲突。车道基线里它来自
   `/usr/local-threads/lib/libf2c.a`（f64 ✓，实测 lane refblas 不定义它）⇒ **摘掉 OpenBLAS 那个成员、
   不包装**，与基线逐条一致。
3. **`ob_c_abs` 那类"内部引用被加了前缀、定义没有"** 的错配，判据是"存档里有没有这个名字"，
   不要靠猜（我第一版就是猜它有 ⇒ 25 个 undefined）。

### 判据（全部是"产物侧/可证伪"）

- `check-build-manifest.py`：声明 `e2_openblas: true` ⇒ `inputs.blas.resolved_dir` 必须含
  `openblas`（**输入侧溯源**：声明换了库、实际还是车道 refblas 这种情况，构建/链接全绿）；
- **链接警告与基线逐条一致**：E2 与车道基线的 undefined 集合（gl4es / cgejsv_ / zgejsv_）与
  mismatch 集合（`zdotu_`）**完全相同** ⇒ 零新增；
- 出厂核对 `verdict=ok`；产物实测 `shared_memory=true`、`pthread_glue=54`、`v128=5296`
  （车道那份是 4756 ⇒ OpenBLAS 的 SIMD 更密）。

### ★ E2 实测结果（两轮，含一条**否证**）

**A/B 方法**：同一台机器、同一条车道模式，只把站点的 `threads/` 三件换成 E2 产物
（`site-e2`，带头服务 ⇒ 页面选线程档）⇒ 用 `test/browser/bench-core.mjs` 量。

| 用例（中位数） | 车道基线（现役，refblas SIMD+atomics） | E2（线程版 OpenBLAS） | 比 |
|---|---|---|---|
| 矩阵乘 500×500 | 0.0400 s | **0.0060 s** | **6.7×** |
| `lu(800)` | 0.0600 s | **0.0200 s** | **3.0×** |
| FFT 1e6 | 91.7 s | 90.2 s | 同（**说明那 90 秒是车道既有特性，不是 E2 引入**） |
| ODE45 摆 | 0.0220 s | 0.0210 s | 同 |

**线程版的实测（两条，都只是"超时未完成"，**别写成"挂死"**）**：
· `accept-113-oct` 在线程版 E2 站点上 **> 300 s 未完成**（车道基线同套件 **83 s**），卡在
  "**第一次真正调用 dlopen 的 `.oct`**"那一格、chromium 100% CPU；
· `bench-core.mjs` 在线程版下 **> 300 s 未完成**，但**基线本身就要约 420 s**（它那个 `FFT 1e6`
  一项 3 次 × 90 s = 270 s）⇒ 这条**不构成**"跑不动"的证据，是我给的超时太紧。

**结案实验①（本条已做，2026-09-27）**：给线程版 `accept-113-oct` **600 s** 预算 ⇒ **跑满 600 s
仍未完成**（`rc=124`、`real 10m0s`），而**同一条链接**的单线程变体同套件**数秒级通过**、车道基线
83 s ⇒ **线程版在这条路上不返回**（不是"慢"）。

**结案实验②（本条已做，2026-09-28）—— 结论：不是多线程唤醒。**

做法：先按工单 01 给入口加 `DIAG_EXPORTS` 口子（`--diag` 时并入 `--export-if-defined`），
链一份**带那个导出的诊断档**（`85e64295…`，`verdict=ok`；wasm 导出表 735 条，对照线上 725），
再用 `test/browser/probe-e2-threads.mjs` 跑两格（同一份产物 ⇒ 诊断档更慢这件事在 A/B 之间抵消）：

| 格 | 做什么 | 结果 |
|---|---|---|
| A | 裸跑 dlopen 的 `.oct` 路径 | **>300 s 未返回**（复现既有实测） |
| B | 先 `Module._openblas_set_num_threads(1)` 再跑同一路径 | **>300 s 未返回**（且导出确实可调：`typeof=function`、调用返回 ok） |

⇒ **设成单线程仍然不返回** ⇒ 卡点在**线程版代码路径本身**，**与线程数无关**。
（探针 7 PASS / 0 FAIL；跑法：起一个带 COI 的站点把诊断档放进它的 `threads/`，
然后 `sh test/browser/run.sh test/browser/probe-e2-threads.mjs <那个站点URL>`。）

⚠️ **被推翻的推断（原文保留在下面，但别当结论读）**：曾推断"像 OpenBLAS 的 worker 唤醒/自旋等待
在 wasm 下的行为（线程同步用忙等；emscripten 主线程 `Atomics.wait` 受限）"。
**实验②证伪了它**：如果卡在唤醒/自旋，设成 1 个线程就该返回。已登记进 `build/lib/retractions.json`。

**下一个问题（工单 16）**：既然与线程数无关，那 `USE_THREAD=1` 那份 OpenBLAS 到底在
**哪一段**改变了行为？可能的形状（都要实测，不许当结论）：`blas_server` 的启动期副作用、
`USE_THREAD=1` 编出来的代码路径差异（例如条件编译的分支）、或者与 `.oct` 的
side-module 装载/符号解析之间的交互。

### 单线程变体（`USE_THREAD=0`）的实测：**交付形态定为它**

同法 A/B（同一台机器、同一条车道模式，只换站点 `threads/` 三件）：

| 用例（中位数） | 车道基线 | E2 单线程 OpenBLAS | 比 |
|---|---|---|---|
| 矩阵乘 500×500 | 0.0400 s | **0.0210 s** | **1.9×** |
| 矩阵分解 `lu(800)` | 0.0600 s | **0.0430 s** | **1.4×** |
| FFT 1e6 | 91.745 s | 91.09 s | 同 |
| ODE45 摆 | 0.0220 s | 0.0250 s | 同 |
| 循环 1e6 | 0.665 s | 0.654 s | 同 |
| `sort 2e6` | 0.234 s | 0.227 s | 同 |

数值回归（E2 单线程站点，带头 ⇒ 页面跑线程档）：**`accept-113-oct 8/0`**（★ 线程版在同一步
>300 s）、`accept-113-libs 17/0`、`accept-hdf5 16/0`、`accept-113-ode15 29/0`、`accept-slicot 25/0`
—— **全绿**，且出厂核对 `verdict=ok`（wasm sha `e570905e…`、29.5 MB）。

⇒ **单线程 OpenBLAS 是能用的交付形态**：SIMD 收益 1.4–1.9×、无新警告、数值全过。
线程版（小尺寸 6.7×）留在"多线程唤醒"那条独立课题里 —— 见上面那两条结案实验。
