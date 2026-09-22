# PROMOTION · 8761 换基线到 11.3.0 —— **已执行**（2026-09-22）

> **状态：换完了。** 8761 现在服务的就是 11.3.0（wasm sha `11f6175a…`，
> 7.2 的是 `a3991ff4…`）。7.2 的站点快照在
> `/mnt/hdd/octave-wasm-build/site-72bak/`（90M），回退一条命令：
> `cp -a site-72bak/. site/`（再 `sh build/recover.sh` 让它按 7.2 的口径起服务；
> 但注意 `recover.sh` 已是 11.3.0 口径，回退后要跑它得先改回取值源，见下）。
>
> 这份文件保留**两部分**：上面是当时的判定与阻塞点（记录为什么之前没换），
> 下面是**真换的时候要动的东西**——已全部完成，留着当"下次换基线"的清单。

## 一、当时的判定（换之前）

| 检查 | 结果 |
|---|---|
| 需求级 `accept-requirements`（**换基线的正式闸门**）| ✅ **14/14** |
| 11.3.0 车道验收 | ✅ 6 套 |
| **7.2 时代的 19 套在 11.3.0 内容上** | ✅ **19/19 全绿**（这是关键补充证据）|
| 8761（7.2）当时状态 | ✅ 未动，19 套 475 项仍全绿 |
| **不许退化检查** | ✅ 已消除（稀疏 `lu` 根因查明并修好，见下）|

## 二、当时的阻塞点：稀疏 `lu`（UMFPACK）——**已修好，回退消除**

逐条实测（`/tmp/nodegrade.log`，两个站点同样 8 个用例）：

| 用例 | 8761（7.2） | 8762（当年，UMFPACK 关着） | **现在** |
|---|---|---|---|
| `[L,U,P]=lu(s)`（稀疏） | ✅ `full(P*s-L*U)` = 0 | ❌ `error: support …` | ✅ 0 |
| `[L,U]=lu(s)`（稀疏） | ✅ 0 | ❌ 报错 | ✅ 0 |
| `lu(s)` 4 输出 / `'vector'` | — | ❌ **整页 trap** | ✅ 全对 |
| **复稀疏 `lu`**（走 `zgemm_`/`zgeru_`） | — | ❌ trap | ✅ 全对 |
| `spparms()` / `s\b` / `chol(s)` / `qr(s)` / `eigs` | ✅ | ✅ 一致 | ✅ 一致 |
| `__ode15__` 可用 | ✅ | ✅（桩） | ✅ **真模块** |

**为什么不能直接换**：`AGENTS.md` 的验收底线写着「新实验失败不许让它退化」。
`accept-requirements` 里没有稀疏 `lu` 这一条，所以**光看需求级闸门会漏掉它**——
这正是本次逐条对比才查出来的。

**根因与修法（已实施）**：建 SuiteSparse 时**漏传了 `-DNBLAS`（和 CHOLMOD 的
`-DNSUPERNODAL`）**，于是 UMFPACK 去调本仓那套 **f2c 转出来的 BLAS**，ABI 错位踩内存
→ trap。证据：本仓 vendored 的 7.2 SuiteSparse 树相对干净 tar 包只有 3 处人工改动，
前两处正是这两个开关；库层面 `libumfpack.a` 的 BLAS 未定义符号 **10 → 0**。
详见 `NOTES-umfpack.md`。

## 三、真换的时候要动的东西（**已全部完成**，留档当下次的清单）

1. ✅ **`build/recover.sh`**：三大件来源 `obench:/usr/src/octave-wasm/src/web/`
   → **`o113:/src/websrc/out/`**；站点内容来源改成 `site113/`；清单从
   `gen-manifest`（会按 7.2 口径重算、把 11.3.0 的 mount 路径算错）改成**只读核对摘要**；
   容器列表加 `o113`；并加了 `VERSION` 标记判断"是否已是 11.3.0"。
2. ✅ **`dist/DEPLOY.md`**：包内容、验收状态表（25 套 615 项）、已知偏差全部按 11.3.0 重写。
3. ⏳ **`dist/` 重打包**：`sh build/make-dist.sh`（可随时重打，见下「还剩什么」）。
4. ✅ **站点目录**：7.2 快照在 `site-72bak/`（90M，160 个文件）。
5. ✅ 换完跑 **25 套全量**（11.3.0 的 6 套 + 7.2 时代的 19 套），全绿。

### 换的过程中额外发现并补上的三处"站点内容不对齐"

这三处都是 **7.2 站点有、site113 没有**的东西，属"内容对齐"而不是能力问题：

| 缺口 | 谁需要 | 处置 |
|---|---|---|
| `dldprobe.oct`（dlopen 自检探针）| `accept-full` | **源码补进仓库** `build/113/dldprobe.cc`（此前只有 7.2 编出来的二进制，且它按 11.3.0 加载即失败：JS 式异常的 side module 装不进 wasm 原生异常的主模块）→ 用 `build-oct.sh --cc` 重编 |
| `lanetest` 资产 | `accept-full` | 连清单条目一起补进 site113 |
| **`m/forge` 的 20 个预装 .m** | `accept-forge` | 7.2 的主链把 `vendor/` 预装进了 `octave.data` 的 `m/forge/`（实测 `which normpdf` → `/usr/src/octave/m/forge/normpdf.m`）；11.3.0 的 `link-web.sh` 漏了这一项 → `normpdf` 变成"要加载 statistics 资产才有"，**相对 7.2 是行为回退**。已把文件集入仓（`build/forge-preload/`）并由 `link-web.sh` 预加载 |

## 四、换基线不需要动的东西（省得白干）

- **主 wasm 不用为 `__ode15__` 重链**：SUNDIALS 走 `.oct` 车道（静态码在 `.oct` 内），
  实测主 wasm 的 sha256 前后一致。
- **包 `.oct` 已按 11.3.0 重编**（27 个，冒烟 27/27）。
- **`accept-requirements` 的 URL 已改成跟页面 origin 走**，8761/8762 上都能跑。
- `gp/`（gnuplot-wasm）与顶层 `plotbridge/`+`plotbridge.js` **不需要**：
  11.3.0 的 plot 桥是纯 `.m` 直接生成 SVG，plotbridge 已变成懒加载资产。

## 五、还剩什么（换基线本身之外）

- **`lsode` 整页 trap**：7.2 与 11.3.0 **共有**，非本次引入（`NOTES-lsode.md`）。
  定位需要带 `--profiling-funcs` 重链一次把 trap 地址符号化。
- **`dist/` 重打包**：`sh build/make-dist.sh`。
- P5 OSMesa 图形线（本轮外）。

