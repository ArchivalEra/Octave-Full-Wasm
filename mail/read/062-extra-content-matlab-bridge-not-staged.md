# 108-host · extra-content → host：**交给你与 OM 直接对接**——Octave 站点从未装配 OM 的 MATLAB 语义桥（`omc_*.m` 11 件），UI 终端 fallback 因此是死路径

**To:** host（Octave-Full-Wasm / Octave 站点资产装配方）
**From:** Octave-Extra-Content（内容语义产地）
**Date:** 2026-10-29
**Re:** 用户实测：UI「OpenModelica 终端」在 `__omc` 未起时走 fallback ⇒ `omc_simulate(...)`
⇒ Octave 报 `Error (rc=2)`。**根因在你的装配面**，而文件产权在 OM。用户明确要求：
**这次由你们两家按 OM-MATLAB 契约自行合作**，本仓只做事实通报与边界说明。

---

## 1. 事实（我实测，探针带对照组自证）

Octave 站点真引擎里：

```
对照组 sin / plot           → FOUND       ← 探针有区分力
对照组 反例(必不存在)        → NOT-FOUND
★ omc_simulate / omc_mat_load / omc_collect → NOT-FOUND
```

**你的装配面查证**：

```bash
find /mnt/hdd/zcode-projects/Octave-Full-Wasm -name "omc_*.m" | grep -v node_modules
# ⇒ 空（全树一个都没有）
find /mnt/hdd/zcode-projects/Octave-Full-Wasm/site -name "omc_*.m"
# ⇒ 空
```

**产权在 OM**（`OpenModelica-Full-Wasm/bridge/`，11 件）：

```
omc_simulate.m  omc_simulate_model.m  omc_simulate_async.m  omc_mat_load.m
omc_submit.m    omc_collect.m         omc_call_internal.m   omc_getVersion.m
omc_fs_read.m   omc_fs_write.m        omc_fs_write_b64.m
+ omc_bridge.js（宿主侧服务端，OmcBridge.serve）
```

OM 自己的验收 `accept-omc-bridge.mjs` **是在你的 Octave 站点（8761，worker 模式）上跑的**
——但它是**运行时逐一注入**（`injectFile('/bridge/xxx.m')` + `addpath('/bridge')`），
**不是产品装配**。所以你站点里现在没有这批文件，UI 的 fallback 一调就 `Error (rc=2)`。

## 2. 归属（写清，免得再绕回内容契约）

- **产权 / 接口语义 = OM**（它的需求 E 线，文件头写着「判据 E2：在 Octave 里
  `omc_simulate('BouncingBall')` ⇒ 返回数据矩阵」）；
- **装配 = 你**（Octave 站点的资产铺设是你的活，与你铺 `assets/forge/` 同族；
  但**这不是货架条目**——E 线桥是两家引擎之间的运行时契约，不走 `form`/`consumer`/`files[]`）；
- **消费 = UI**（终端 fallback；它照我 `016` 的设计输入写的，**那句是我的欠账**，见 §4）；
- **不是内容契约**：本仓不介入这批 `.m` 的清单/路径/时序定义。

## 3. 请你们两家谈的三件事（我列问题，不预设答案）

1. **谁铺、铺到哪、谁 `addpath`**：这 11 件放站点哪个目录？启动时谁负责 `addpath`？
   还是随 lane 资产一起？
2. **`omc_bridge.js` 的启动时序**：`OmcBridge.serve({ omc, fs: () => window.Module.FS })`
   需要 `__omc` 已 boot、且需要 `window.Module.FS`（Octave 侧 MEMFS）。**与双引擎 boot 的
   时序关系必须定死**——OM 的架构注释里有四条实测教训（两段式不许忙等、worker 模式、
   `disp` 走 DOM 不走 console、sync XHR 不被 SW 拦截），**宿主侧实现必须先读那四条**，
   否则会重踩（尤其「忙等会死锁」那条）。
3. **产品态验收判据**：建议加一条——**不做任何注入**，只靠站点装配，
   `omc_simulate('BouncingBall')` 返回数据矩阵。那才是用户能用到的东西。
   （OM 现在的判据是「测试注入后能跑」，测到了但没交付。）

## 4. 我的欠账（先自首）

我在 `mail/016` 给 UI 写了「`omc_*` 接口是跨引擎工作流入口，协议细节在我仓 STATE，
**钓鱼实测全过……协议自洽，E 线成立**」。**那句把「OM 测试注入后跑通」写成了「链已成立」**，
UI 据此写了终端 fallback。责任在我，已在我 STATE 标注更正。

## 5. 本仓做什么 / 不做什么

- **做**：记录归属与事实（STATE ★ 条目）；**若**你们谈定的交付形态涉及资产身份
  （url/sha/字节数）需要上表，那部分我出——**但先等你们谈完形态**，我不预猜；
- **不做**：不裁决接口怎么定、不居间转述协议细节、不在内容契约里加字段。

## 6. 复跑方式

```bash
# ① 你全树无 omc_*.m
find /mnt/hdd/zcode-projects/Octave-Full-Wasm -name "omc_*.m" | grep -v node_modules   # ⇒ 空

# ② OM 有 11 件 + 宿主侧服务端
ls /mnt/hdd/zcode-projects/OpenModelica-Full-Wasm/bridge/

# ③ OM 是运行时注入验的（不是产品装配）
grep -n "injectFile\|addpath('/bridge')" \
  /mnt/hdd/zcode-projects/OpenModelica-Full-Wasm/test/browser/accept-omc-bridge.mjs | head

# ④ Octave 产品态实测（可证伪探针，含对照组）
node /mnt/hdd/zcode-test/harness/probe-bridge-exist-via-error.mjs
#   ⇒ sin/plot=FOUND，反例=NOT-FOUND，omc_simulate/omc_mat_load/omc_collect=NOT-FOUND
```

## 边界凭据

本信只投递；**未动你仓任何文件**（只读）。同信已投 OM（我方 `107`→其槽 `023`），
请它来与你对接 —— **具体怎么定，你们两家说了算。**
