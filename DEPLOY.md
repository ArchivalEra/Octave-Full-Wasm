# DEPLOY · 可部署站点（`site/` 目录）

> **`site/` 是验收底线 8761 的逐字节镜像**（wasm sha = `build/FACTS.json` 的 `wasm_sha`，
> **三处** parity `--strict` 绿：8761 / 8768 / 本目录）。
> 仓库因此**自带全部可部署产物**：配好 yml 后不需要任何构建步骤，部署 = 把这个目录原样发布。

## 这个目录是什么

| 文件/目录 | 说明 |
|---|---|
| `octave.wasm` / `octave.js` / `octave.data` | 主产物（Octave 11.3.0 + JSPI 交互线；wasm sha 见 `check-deploy-sha.sh`） |
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

## ★ 双档（B6）：`threads/` 子目录 + **宿主必须发 COI 头**

本站点带**两档产物**，文件名相同、目录不同：

| 档 | 文件 | 什么时候用 |
|---|---|---|
| 基础档 | 根目录 `octave.wasm` / `octave.js` / `octave.data` | **任何**静态托管；页面默认回落到它 |
| 线程档 | `threads/octave.{wasm,js,data}` | 宿主发了下面两个响应头时**自动**选它（多线程**运行时**就绪） |

页面按**同步**判据选档（`crossOriginIsolated === true` 且 `SharedArrayBuffer` 可用），
判据与两档的文件表都在 `bridge/lane.js`；显式覆盖用 `?lane=base` / `?lane=threads`。

要**启用线程档**，宿主必须对**整站**发这两个头（缺一个都不行）：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

- 本地参考实现：`python3 build/serve-coi.py --dir <站点目录> --port 8761`（要测"基础档那一侧"
  另起一台加 `--no-coi`）。**别用 `python3 -m http.server` 测线程档** —— 它发不了这两个头，
  页面会**静默**落回基础档（不报错，只是没线程）。
- GitHub Pages **发不了**这两个头 ⇒ 在线版本跑的是基础档（`threads/` 目录在那儿等于闲置，
  不影响任何功能）。要线程档就得用能改响应头的托管（Cloudflare Pages / 自己的 nginx 等）。
- ⚠️ **线程档的已知边界**：① worker 宿主（`?worker=1` 或手搓 `new Worker('octave-worker.js')`）
  **自动落基础档** —— 线程产物在 DedicatedWorker 里当主宿主未验证；② 同页多实例**支持**，
  但每个实例都必须拿到页面的选档计划（页面内部已处理）。细节见 `build/113/NOTES-threads.md`。
- ⚠️ 线程档现在是 **refblas/lapack 的「SIMD + atomics」版**（不是 OpenBLAS）⇒ 多线程**运行时**已就绪，
  但**数学还没并行化**；真正提速那一步（线程版 OpenBLAS 链进主模块）见 `build/113/NOTES-threads.md` 末两节。

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
node test/browser/probe-artifact-sha.mjs <URL> <sha>     # 页面实例化字节的自证
```

## 更新流程（以后每一批）

重链/promote 到 8761 之后：`rsync -a --delete /mnt/hdd/octave-wasm-build/site/ site/`
→ 提交（本目录随之演进，永远等于"最近一次通过浏览器实测的构建"）。
**规则**：本目录与 8761 不一致 = 不能宣称验收通过（AGENTS.md 验收底线）；
**这条规则现在由 `build/check-site-parity.sh --strict` 强制**（第三列就是本目录，
它一落后就红 —— 2026-09-26 批次 A0 加的）。
