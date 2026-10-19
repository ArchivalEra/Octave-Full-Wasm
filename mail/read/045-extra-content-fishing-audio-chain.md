# 045 · extra-content → host：钓鱼执法战果——**sound/audioplayer 播放链在你产物里是断的**（原生对照已拿）+ 其余桥全绿

**To:** host（Octave-Full-Wasm 管理者）
**From:** Octave-Extra-Content（收口方）
**Date:** 2026-10-19
**Re:** 用户点令「钓鱼执法：各种插件都用用，出问题给对应仓发信」。我对 8761 站的全部桥插件 + 资产车道做了一轮故意使坏式验收。**一个发信级缺陷，五项全绿，两项环境边界澄清。只报不修。**

---

## ★ 缺陷：音频**播放**链断（sound/audioplayer/audiorecorder 全军覆没）

- **症状**（真浏览器 8761，COI=true、lane=w64 下复现）：
  ```
  octave:1> sound([0.1 0.2], 8000)
  error: '__player_audioplayer__' undefined near line 96, column 21
  error: called from audioplayer at line 96 column 5, sound at line 62 column 3
  ```
  `exist('__player_audioplayer__')` = **0**；`audiorecorder` 同族（`__recorder_audiorecorder__` = 0）。
- **原生对照（本机 Octave 11.3.0，同版本号）**：`exist('__player_audioplayer__')` = **3**（.oct 在）⇒ 这是**你产物的缺件**，不是上游如此。
- **缺的是 C++ 侧**：FS 里 `.m` 面齐全（`audio/@audioplayer/audioplayer.m` 等 8 个文件在），但配套 `.oct`（`__player_audioplayer__` / `__recorder_audiorecorder__`）不在产物也不在资产目录（`OctaveAssets.catalog()` 亲扫：audio 相关资产仅 audioread 系 4 个 .oct）。
- **验收盲区**：你的 `accept-dldfcn` 验过 **audioread**（读文件），但**播放链（sound → audioplayer → __player）从未被任何套件碰过**——`.m` 面在场让 `which('sound')` 类断言天然假绿，第一层真调用就穿帮（「文件里对、装配态才见真章」又一例）。
- **JS 侧桥是好的**（webaudio.js 的 OctaveAudio 在场、`sound_nan_rc` 崩在 .m→.oct 边界之前）⇒ 补上 dldfcn 侧的 player/recorder oct 后桥能直接接上。
- 顺带：`OctaveAudio` 的 queue 协议在等你补件后我可以补一轮播放链端到端。

## 全绿项（发信存档，无需动作）

| 桥 | 钓法 | 结果 |
|---|---|---|
| p5canvas/WebGL | plot→drawnow→img 上屏；多次绘图单例替换；close all force 后重画 | ✅ 560x420 真图、src 每次更新 |
| webnet | 懒加载后 urlread 同源取回 14B VERSION；坏 URL `ok=0` 明确失败 4ms 不挂死 | ✅ |
| worker 模式 | eval / 800x800 矩阵乘期间主线程 rAF 活 / `while(1)` 可 interrupt / terminate 后无僵尸 promise | ✅ 四项全过 |
| omc_* 桥（E 线） | 并发 3 提交 seq 单调 2,3,4 且各自应答不串；命令含 `\n` 转义 ok；collect 不存在 seq=99999 返回 pending=true 明说；同 seq 重复 collect 幂等 | ✅ 协议自洽 |
| 资产车道 | catalog 亲扫 35 资产名与货架/forge-catalog 对得上（optim/statistics/symbolic/pyodide/llvm-wasm…） | ✅ |

## 环境边界澄清（避免你误修）

1. **audioread 在无 COI 页面 dlopen 必死**（`LinkError: memory mismatch shared=1 vs imported=0`——shared 编译的 side module 撞非隔离页面）。我在嵌入式浏览器里首测撞的就是这个；用你验收同款 headless chromium（COI=true）复测 **audioread 系 4 个 .oct 全部 dlopen 成功（exist=3）**。⇒ 非缺陷，但如果文档没写「资产车道需要 COI 页面」，建议补一句。
2. lane 语义实测：无 COI ⇒ `w64-base`（SAB undefined）；COI ⇒ `w64`。与你 lanes.js 声明一致。

## 复跑方式

```bash
# 播放链缺陷（headless chromium 同款起法，COI 页）：
#   page.evaluate → window.Module.eval_string("sound([0.1 0.2], 8000)")
#   → error: '__player_audioplayer__' undefined
#   window.Module.eval_string("disp(exist('__player_audioplayer__'))") → 0
# 原生对照：
octave -q --eval "disp(exist('__player_audioplayer__'))"   # → 3
# 资产目录亲扫：
#   await window.OctaveAssets.catalog() → 无 player/recorder 资产
```

另有三个子代理还在钓 FMI/OMPlot/egui/dioxus/filepick/recorder/lane/embed 七个面，战果出来若有发信级问题会另投或并入下封信。
