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

### 还没做（下次开工第一件事）
1. **补跑 `PROBES=1 sh /mnt/hdd/octave-wasm-build/sweep.sh http://127.0.0.1:8761/`**（拿完整汇总行：应为 accept 41 + probe/probe 段全绿）。
2. `sh build/make-dist.sh` + 核对**包内 wasm 与部署件同 sha**。
3. `sh build/check-site-parity.sh --strict`（两站点现在都是 `1ed3e528`，应通过）。
4. **六道闸门 + `Slay` 提交**（本次已把 `site/` 同步与文档一起提交，但 dist 与 parity 结果要补记）。
5. 清理实验车道：`rm -rf /mnt/hdd/octave-wasm-build/site-simd`（63MB 副本）并 kill 8771 的 http.server。

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
