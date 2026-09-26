# DEPLOY · 可部署站点（`site/` 目录）

> **`site/` 是验收底线 8761 的逐字节镜像**（wasm sha `1ed3e528…`，**三处** parity `--strict` 绿：
> 8761 / 8768 / 本目录）。
> 仓库因此**自带全部可部署产物**：配好 yml 后不需要任何构建步骤，部署 = 把这个目录原样发布。

## 这个目录是什么

| 文件/目录 | 说明 |
|---|---|
| `octave.wasm` / `octave.js` / `octave.data` | 主产物（Octave 11.3.0 + JSPI 交互线；wasm sha 见 `check-deploy-sha.sh`） |
| `index.html` + `assets-loader.js` + `queue.js` + `p5canvas.js` + `web*.js` | 页面与桥 |
| `assets/` | 清单 + 懒加载资产（Forge 包、`.oct`、`.m` bundle、help 数据…） |
| `matrix-android.html` | 浏览器矩阵自测页（自动跑能力门并把结果写进 DOM，供截图/无头读取）。⚠️ **手工维护、无生成器**（三处手工同步）⇒ 已配探针 `test/browser/probe-matrix-android.mjs`（`PROBES=1` 时跑，8 项，含一条反证）。2026-09-26 把 8768 的 C6 版同步到三处，三份同 sha `5d2dca7f…`（旧版 `f6eaf0e3…` 见 git 历史） |
| `dldprobe.oct` / `minioct.oct` | 历史诊断用 side module（保留，不影响运行） |

来源与构建配方：**唯一入口 `bash build/113/relink.sh link product`**（2026-09-26 批次 A1 起；
模式决定全部 22 个环境变量，`relink.sh explain product` 打出来就是口径 —— **别照抄文档拼命令**，
漏一个变量会**静默**做出非现役形态的产物而构建/链接/自检全绿）。底层是 `build/113/link-web.sh`；
链接末尾写出 `octave.build.json`（只记量到的事实），**`verdict=="ok"` 才可部署**。
现役 `octave.wasm` sha `1ed3e528…`、`measured.simd.v128` = **4752**（手查：
`llvm-objdump -d octave.wasm | grep -c v128`）。

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
