# CONTEXT.md · 术语表（权威定义 + 可复跑的证据）

> **为什么有这份文件**：一位不参与日常的人读完文档说了一句"我咋听不懂" —— 那句话就是本文件的
> 验收标准。根因不是"代码写得乱"，而是**关键术语只在叙述里、从没被定义过**：同一个词"闸门"
> 在仓库里至少指 **6 种**互不相同的东西（实测见 `build/113/PLAN-arch.md` §4.7）。
>
> **约定**：
> · 每个术语给**一条权威定义 + 一行可复跑的证据**；证据优先指向**产物身份证**
>   `site/octave.build.json` 的字段（机器可读、造不了假），其次 `file:line` 或一条命令。
> · **代码 / DOM 名字不改**（改名的收益小于成本）；"闸门"这类多义词在这里**拆成具名术语**，
>   旧写法保留为别名。
> · 证据行统一写成 `证据：` 开头。`.githooks/check-consistency.py` 会检查其中出现的**仓库路径
>   确实存在** —— 防"术语表退化成散文"。
> · 这里只放**活状态**的定义；历史与过程在 `HISTORY.md`。

---

## 多义词"闸门"拆成五个具名术语

### 提交前六项检查（别名：六道闸门）
提交代码前必须全绿的六个 python 检查（README/HANDOFF 的机器块、活状态断言、路径一致性、
断言可证伪性、白名单覆盖）。
**证据：** `.githooks/check-consistency.py`

### 机制门①②③（别名：三道闸门）
换基线时要过的三件底层能力：① 能编能跑数值对；② `.oct` side module 能被 dlopen 装载；
③ **免 COI**（不要求 `SharedArrayBuffer`/跨源隔离）。
**证据：** `build/113/probe-side-module.sh`

### 运行时能力门
**页面在运行期**探测"这台浏览器能不能做某事"，缺了就**清晰降级**而不是崩。现役只有一条：
JSPI（单产物 + 运行时能力门 —— 不加 `-sJSPI`，包装发生在页面侧，见"B 姿势"）。
**证据：** `site/octave.build.json`

### 保活闸门
链接期检查：M2（DCE）产物是否把 `.oct` 需要的符号都导出了。判据是**与基线差分**
（"基线导得出、新构建导不出"才报错）。
**证据：** `build/113/check-oct-imports.py`

### 三列一致性闸门
`8761`（验收底线）/ `8768`（实验车道）/ **仓库 `site/`**（入库镜像）三处的**部署件**
逐字节一致。第三列堵的是"重构页面后忘了同步入库镜像，而两站点之间照样 parity 绿"。
**证据：** `build/check-site-parity.sh`

---

## 构建与产物

### 口径
"唯一权威的构建旗标组合"。**它已经不是文档，而是代码**：`relink.sh` 的模式表推出全部
环境变量（条数见 `build/FACTS.json` 的 `env_vars`；★ 曾写 22 是**错的** —— A1 加了 `BUILD_MODE`
标签变量；另有 `P5_OBJS` 是脚本内数组不算），一个都不许手设（漏一个会**静默退化**，而构建/链接/自检全绿）。
**证据：** `build/113/relink.sh`

### 双档（线程档 / 基础档）
同一个站部署**两份产物**：`threads/` 子目录里的线程档（`-pthread` ⇒ wasm 内存 **shared**）与根目录的
基础档（现役形态）。**文件名相同**，靠子目录区分 —— 因为 Emscripten 胶水内部**写死了 `octave.data`**，
换名就得改胶水。**线程档不许是唯一产物**（红线：基础档要能在任何静态托管上跑）。
**证据：** `bridge/lane.js`

### 选档（lane）
页面/Worker 在**加载胶水之前**、用**同步**判据定档：`crossOriginIsolated === true` +
`typeof SharedArrayBuffer === 'function'` ⇒ 线程档，否则基础档。不能等异步探测：线程档胶水在
被 import 的那一刻就会建 shared 内存，没有隔离**当场抛**。URL 上 `?lane=threads|base` 可显式覆盖
（测试/调试用；覆盖不改物理前提，选错档**必须响亮失败**）。
**证据：** `test/browser/probe-lane.mjs`

### COI 头（跨源隔离）
宿主发 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`
⇒ 页面拿到 `crossOriginIsolated` + `SharedArrayBuffer` ⇒ 才可能用线程档。**这是本项目的产品决定**
（B6，2026-09-27）：要求宿主发头，而不是装 service worker。自家站点用 `build/serve-coi.py` 起
（同一份目录可 `--no-coi` 起第二台，专门测基础档）。
**证据：** `build/serve-coi.py`

### 产物身份证
`octave.build.json`：与产物放在一起的机器可读记录。**只记量到的事实**（不抄旗标 ——
抄一遍就是又一份会漂的拷贝）。字段：`measured.simd.v128`、`measured.jspi_entry`、
`measured.exported_functions`、`measured.fonts`、`measured.files.*.sha256`、
`inputs.blas.resolved_dir`、`verdict`。**`verdict == "ok"` 才可部署**。
**证据：** `site/octave.build.json`

### M1 / M2
`MAIN_MODULE=1`（不做 DCE，导出全部符号）/ `=2`（DCE，只导出保活集）。判据**从产物量**，
不看命令行：导出段条目数 M2 ≈ 710、M1 ≈ 44987（63× 差距）。
**证据：** `site/octave.build.json`

### 重链
把 Octave 的 wasm 目标重新链接成浏览器可用的三大件。**唯一入口**
`bash build/113/relink.sh link product`（模式决定全部旗标；`explain` 打出来就是口径）。
**证据：** `build/113/link-web.sh`

### 身份证里的 v128
现役产物的 SIMD 判据：反汇编里 `v128` 指令的条数 = `build/FACTS.json` 的 `wasm_v128`
（非 SIMD 那版 = 0）。
⚠️ 别用 `grep simd128`（那是**假**判据，产物里没有 target_features 段）。
**证据：** `build/113/write-build-manifest.py`

---

## JSPI 线

### A 姿势 / B 姿势
A = 链接期 `-sJSPI`（**已否决**：实测它把 `dlopen` 无条件变成挂起点，开机资产装载整批炸）；
B = **页面/宿主侧包装** —— 只把唯一的挂起 import（`web_sleep_ms`）包成 `Suspending`，
入口用 `promising()` 包。现役是 B 姿势，且**胶水里 `Suspending` 必须 0 处**。
**证据：** `bridge/octave-core.js`

### D9 门槛
Octave 层可问的一句"本页有没有可挂起的等待能力"（`__web_suspend_ok__`）；没有就退回
**内建阻塞 pause**，而不是让用户撞上难懂的 TypeError。
**证据：** `test/browser/accept-ginput.mjs`

### 挂起 / 让出
JSPI 的"挂起"= wasm 栈整体让出，页面定时器照常跑（验收判据：等待期间 `ticks > 0`）。
**证据：** `test/browser/probe-jspi-b.mjs`

---

## 宿主与页面

### 内核 / 宿主
`bridge/octave-core.js` 是**内核**（页面宿主与 Worker 宿主共用同一份）；宿主只提供
9 件"只有它才知道的"东西（`base`/`print`/`printErr`/`note`/`stdinLine`/`clicks`/`doc`/
`assets`/`onReady`）。加新宿主时改的是宿主，不是内核。
**证据：** `bridge/octave-core.js`

### 桥
页面侧与 Octave 侧通过 **MEMFS 队列**通信的那几个 JS（音频、录音、文件选择、网络、
图形上屏）。协议无关的那部分在 `queue.js`。
**证据：** `bridge/queue.js`

### side module（`.oct`）
单独编译的 wasm 共享模块；`dlopen` 装载，符号**靠主模块解析**（所以主模块的导出面
就是它的能力边界）。`.oct` 走**资产车道**（懒加载），不在主链命令行上。
**证据：** `build/113/rebuild-pic-blas.sh`

### P5（图形线代号）
真渲染后端那一整条：`gl4es → GLES2 → WebGL2/GPU`，外加 plot 桥把渲染结果贴到页面。
**证据：** `bridge/p5canvas.js`

### 资产车道
不是"页面一次装全部"，而是**用到哪个才 fetch 哪个**（核心组与 help 组随页面装，其余懒加载）。
**证据：** `bridge/assets-loader.js`

---

## 流程与文档

### 活状态 / 历史
`HANDOFF.md` = 活状态（那里的断言必须与产物一致，否则 pre-commit 直接拦）；
`HISTORY.md` = 历史（append-only，里面的数字是"当时如此"，检查器不查）。
**证据：** `.githooks/check-handoff.py`

### AUTO:STATE
`HANDOFF.md` 文末由 `.githooks/update-handoff.py` **机器维护**的区块（部署件 sha/体积、
最近一次全绿回归、交付包、包内 wasm 与部署件同 sha）。**别手写、别手改**。
**证据：** `.githooks/update-handoff.py`

### 白名单（仓库策略）
`.gitignore` 是**白名单**：默认拒绝一切（`*`），逐项放行（`!路径`）。新增文件必须同步放行，
否则 pre-commit 拒。
**证据：** `.githooks/check-whitelist.py`

### 快回环
改胶水层时的**秒级**自检（跑 `.m` 文件自带的 `%!test`），别一上来就跑 29MB 的端到端。
**证据：** `build/glue-selftest.sh`

### PROBES=1
`sweep.sh` 的环境变量：默认只跑 `accept-*`（日常快），`PROBES=1` 时用 `*` 把
`probe-*` 与 `bench-*` 也扫一遍（探针是"当班实况"，会腐烂 ⇒ 每批跑一次）。
**证据：** `build/113/PLAN-arch.md`

### 验收底线
`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建；新实验失败**不许**让它退化。
**证据：** `build/check-boot.sh`

### 部署件 SHA 铁律
跑验收**前**先验产物 SHA（磁盘 / HTTP / 页面实例化字节三层）——"改完程序用老产物跑"
已经踩过多次，每次都是 SHA 一查就现形。
**证据：** `build/check-deploy-sha.sh`

---

## 历史遗留的名字（不改，但别被字面误导）

| 名字 | 它其实是什么 |
|---|---|
| `m2fc-simd-out` | 现役产物的**目录名**（M2 + 字体 + fontconfig + JSPI + SIMD）。A1 起新的重链产出到 `product/`，这类名字由模式名取代 |
| `B 姿势` | 就是"宿主侧 JSPI 包装"（见上）；名字来自第三轮复审的方案编号 |
| `P5` | 图形线代号，不是"Processing.js" |
| `webshims` / `pkgfix` | 无 shell 构建的**报错清晰化**与 pkg 数据库修复包（`.m` 资产，不是 polyfill） |
| `x86_64` 出现在产物里 | 容器里 emcc 的宿主三元组，与浏览器无关 |
