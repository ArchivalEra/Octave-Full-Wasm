# DEPLOY · 可部署站点（`site/` 目录）

> **`site/` 是验收底线 8761 的逐字节镜像**（wasm sha = `build/FACTS.json` 的 `wasm_sha`，
> **三处** parity `--strict` 绿：8761 / 8768 / 本目录）。
> 仓库因此**自带全部可部署产物**：配好 yml 后不需要任何构建步骤，部署 = 把这个目录原样发布。

## 这个目录是什么

| 文件/目录 | 说明 |
|---|---|
| `octave.wasm` / `octave.js` / `octave.data` | 主产物（Octave 11.3.0 + JSPI 交互线；wasm sha 见 `check-deploy-sha.sh`） |
| `threads/` `w64/` `w64-base/` | **另外三档产物**（同名文件、子目录区分；选档表见下节与 `bridge/lane.js`） |
| `lanes.js` | **档清单**（生成物）：这个站点**真的**部署了哪几档，页面同步读它 —— 别手改，要改跑 `build/gen-lanes.sh` |
| `octave.build.json` | **产物身份证**（A1/A2）：只记**量到的事实**（`simd.v128` / `jspi_entry` / gl4es 命中 / 8 个字体 / IDBFS / fontconfig / 三件套 sha / BLAS 归档 sha / 导出条目数），`verdict=="ok"` 表示它被某个模式的声明核对过。页面开机读它填 `Capabilities`（缺了不致命） |
| `octave-core.js` | **内核**（A2）：页面与 worker 共用的那一份；`index.html` 与 `octave-worker.js` 都依赖它 |
| `matrix-android.html` | 矩阵自测页，**由 `build/113/gen-matrix-android.py` 生成**（= 当前 index.html + 尾块）—— 别手改 |
| `index.html` + `assets-loader.js` + `queue.js` + `p5canvas.js` + `web*.js` | 页面与桥 |
| `assets/` | 清单 + 懒加载资产（Forge 包、`.oct`、`.m` bundle、help 数据…） |

| `dldprobe.oct` / `minioct.oct` | 历史诊断用 side module（保留，不影响运行） |

来源与构建配方：**唯一入口 `bash build/113/relink.sh link product`**（2026-09-26 批次 A1 起；
模式决定全部环境变量（条数见 `build/FACTS.json` 的 `env_vars`；★ 曾写 22 是**错的** —— A1 加了
`BUILD_MODE` 标签变量；另有 `P5_OBJS` 是脚本内数组不算），`relink.sh explain product` 打出来就是口径 —— **别照抄文档拼命令**，
漏一个变量会**静默**做出非现役形态的产物而构建/链接/自检全绿）。底层是 `build/113/link-web.sh`；
链接末尾写出 `octave.build.json`（只记量到的事实），**`verdict=="ok"` 才可部署**。
现役 `octave.wasm` 的 sha 与 `measured.simd.v128` 见 `build/FACTS.json` 的 `wasm_sha` / `wasm_v128`（手查：
`llvm-objdump -d octave.wasm | grep -c v128`）。

## ★ 四档（工单 30，2026-10-01）：同名文件、按目录分档 + **宿主发 COI 头才吃到多线程/64 位**

本站点带**四档产物**，文件名逐字相同，只有**目录**不同（选档表在 `bridge/lane.js` 的 `FILES`）：

| 档 | 文件 | 什么时候用 | 硬前提 |
|---|---|---|---|
| `base` | 根目录 `octave.{wasm,js,data}` | **任何**静态托管的底线（页面默认回落到它） | 无 |
| `threads` | `threads/octave.{wasm,js,data}` | 宿主发了 COI 头、但引擎**没有 memory64** | COI + `SharedArrayBuffer` |
| `w64` | `w64/octave.{wasm,js,data}` | 宿主发了 COI 头 **且** 引擎支持 memory64（memory64 + pthread 的目标形态；**当前不比 wasm32 快、堆也仍是 2 GiB**，见下） | COI + `SharedArrayBuffer` + memory64 |
| `w64-base` | `w64-base/octave.{wasm,js,data}` | 引擎支持 memory64 但宿主**没发** COI 头（单线程 64 位回退） | memory64 |

**选档判据是同步的**（加载胶水**之前**就得定档）：`crossOriginIsolated === true` 且
`SharedArrayBuffer` 可用（轴 1）× `WebAssembly.Memory({address:'i64'})` 可用（轴 2）×
**这个站点到底部署了哪几档**（轴 3 = `lanes.js`，由 `build/gen-lanes.sh` 按磁盘生成）。
轴 3 存在的原因：只按能力选档会在"只部署了 base+threads"的站点上挑 `w64` 并 **404**
（实测代价见工单 23）。显式覆盖：`?lane=base|threads|w64|w64-base`。

- ⚠️ **覆盖不改物理前提**：在没有 COI 的页面上强选 `threads`/`w64` 会**响亮地失败**
  （不是静默降级）—— 这是有意的可证伪档（`test/browser/probe-lane.mjs` 的 Cell 6/7）。
- ⚠️ **无 memory64 的引擎必须落 `threads`**（不许选 `w64`）：真 Chromium 125（`mem64=false`）
  实测过这一格（`w64-logs/floor-8761-old-chromium.log`）。

要**吃到多线程 / 64 位档**，宿主必须对**整站**发这两个头（缺一个都不行）：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

- 本地参考实现（两条，口径相同）：
  · 仓库里：`python3 build/serve-coi.py --dir <站点目录> --port 8761`；
  · **交付包自带**：`python3 serve.py [端口] [目录]` —— B6 起它**默认就发这两个头**，
    加 `--no-coi` 才是"不发头"的那一侧（那条路径正是"宿主不发 ⇒ 页面落 `w64-base`/`base`"的本地复现）。
  **别用 `python3 -m http.server` 测多线程档** —— 它发不了这两个头，页面会**静默**落回基础档
  （不报错，只是没线程、也没有 64 位地址空间）。
- GitHub Pages **发不了**这两个头 ⇒ 在线版本跑的是 `base`（其余三档在那儿等于闲置，
  不影响任何功能）。要多线程/64 位就得用能改响应头的托管（Cloudflare Pages / 自己的 nginx 等）。
- ⚠️ **已知边界**：① worker 宿主（`?worker=1` 或手搓 `new Worker('octave-worker.js')`）
  **自动落基础档** —— 线程产物在 DedicatedWorker 里当主宿主未验证；② 同页多实例**支持**，
  但每个实例都必须拿到页面的选档计划（页面内部已处理）。细节见 `build/113/NOTES-threads.md`。
- ⚠️ **两档 BLAS 的现状**（别再抄旧话）：`threads/` 那份**就是 OpenBLAS**（来源见台账
  `threads_blas_dir`），但交付形态是 **`USE_THREAD=0`（单线程）** ⇒ 收益来自 OpenBLAS 的内核
  （见台账 `e2_matmul500_ratio` / `e2_lu800_ratio`），**不是**多线程；`USE_THREAD=1`（约 6.7×）
  的技术判据已全过（工单 27 / 19），**发运决定待定**。
- ⚠️ **`w64` 的两个"想当然"都要收回**（2026-10-01 实测，工单 31 / 翻案 R-013）：
  · **不比 wasm32 快** —— 同一份工作中位数：matmul 慢 1.17–1.20×、lu 慢 1.18–1.34×、
    解释器循环慢 1.72×（i64 指针/索引的代价）。四档里**最快的是 `threads`**（OpenBLAS 内核，
    BLAS 上快 1.7–2.0×），但它在 `sort`/循环上反而慢。
  · **也没有更大的堆** —— 四个档的 wasm 内存上限**都是 2 GiB**（`w64/octave.js` 的
    `new WebAssembly.Memory({..., maximum:32768n, ...})`），逐块分配实测的**存活上限同为 1.49 GiB**
    （台账 `mem_live_ceiling_gib` / `w64_big_heap`）。引擎级探针能拿 5 GiB（`w64_mem_5g_bytes`）
    证明的是**引擎能力**，不是产物配置 —— 要兑现 >2 GiB 得显式抬 `MAXIMUM_MEMORY` 重链（工单 31 第二半）。
  · 复跑：`test/browser/bench-lanes.mjs`（四档竞速）与 `test/browser/probe-heap-ceiling.mjs`（堆上限）。

## 怎么部署（GitHub Pages）

1. 仓库 Settings → Pages → **Source 选 "GitHub Actions"**（一次性手工步骤）。
2. 用本仓库自带的 `.github/workflows/pages-deploy.yml`
   （**只在手动触发时运行**，不会在 push 时自动部署）。
3. 部署后：`https://<user>.github.io/<repo>/` 即为本目录的镜像。
   Pages 对 `.wasm` 会以 `application/wasm` 提供 ✓（本站无需任何服务端逻辑，
   纯客户端计算 —— 红线之一）。

## 部署前自检（三条，都是现成脚本）

```sh
sh build/check-boot.sh <URL>                      # 页面起得来 + 解释器可算
sh build/check-deploy-sha.sh <站点目录> <期望sha> <URL>   # 磁盘/HTTP 层 SHA
node test/browser/probe-artifact-sha.mjs <URL> [sha]     # 页面实例化字节的自证
#   ★ 四档站点：带头 ⇒ 页面跑 w64/ ⇒ 第二个参数留空（走 ③a 身份证判据：
#     页面实例化的字节 == 那一档自己 octave.build.json 记的 sha），或传 **w64 档** 的 sha。
```

## 更新流程（以后每一批）

重链/promote 到 8761 之后：`rsync -a --delete /mnt/hdd/octave-wasm-build/site/ site/`
→ 提交（本目录随之演进，永远等于"最近一次通过浏览器实测的构建"）。
**规则**：本目录与 8761 不一致 = 不能宣称验收通过（AGENTS.md 验收底线）；
**这条规则现在由 `build/check-site-parity.sh --strict` 强制**（第三列就是本目录，
它一落后就红 —— 2026-09-26 批次 A0 加的）。
