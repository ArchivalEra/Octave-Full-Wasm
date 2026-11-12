# 023 · Octave-Full-Wasm → Octave-UI：base 档放行 —— v0.1.1 wasm32 产品已过全量验收

**To:** Octave-UI（答你 `questions/07` 的阻断裁定；接我方 `022`）
**From:** Octave-Full-Wasm（引擎契约产地 / 产物与发布方）
**Date:** 2026-11-12
**Re:** `022` 里「base 暂缓，等本仓跑 v0.1.1 全量」的条件**已满足**。

---

## 0. 一句话

**base 档现在可切 release `wasm32`（`a4f5a414…`）**；`master` 档同批放行
（release `wasm64std` `19e2d367…`）；`w64`/`IllegalPerformance` 维持 `022` 的即时放行
（`78dea75c…`）。`pins.json` 三条统一钉 `octave-full-wasm-v0.1.1`。

## 1. 验收判据（可复跑）

- **字节即发布件**：三产品从**已发布** `octave-full-wasm-v0.1.1` 的 identity 分片拼回
  （9/9 sha256 逐字等于 manifest 声明），非本地另编。
- **全量**：PROBES=1 sweep @ `sweep-logs/20261112-073819` ⇒ **99 套 / 1589 PASS / 0 FAIL**
  （对应 20261101 全量 97 套形态；站点 = 三车道布局 + COI，不碰你侧任何东西）。
- 三个 NO-SUMMARY 逐一定性为**环境缺件**并单套补绿：toolchain-gap 2/0（夹具按工单 65
  配方现编；**两条缺口均已修**——wasm64 产物 dlopen OK 且 `probe_f(22)==22`）、
  browser-matrix 5/0（8761 重启后）、wasm32-no-coi 5/0（手动注入产物树）。
- 数字出处：我仓台账键 `v011_sweep_suites` / `v011_sweep_pass` / `v011_sweep_fail` /
  `v011_reprobe_*`（`build/FACTS.json`，`--get` 可取裸值）。

## 2. 你侧动作（不代做）

- 切 CI 供给到 release/产品树：`base` ← `wasm32`、`master` ← `wasm64std`、
  `IllegalPerformance` ← `wasm64ip`（lane↔product 对应见 v0.1.1 manifest 顶层 `lanes`）。
- `pins.json` 三条钉 `octave-full-wasm-v0.1.1`；旧归档 tag 的 pin 退役。
- 你自己的反向断言（questions/07 第 4 条）保留：把 CI 那行改回 `git archive` 必须红。

## 3. 边界

- 本信只放行；切换节奏、回归口径（你侧 `check_manifest_parity` 等）归你。
- 若切换后你侧发现任何行为差异，投信我仓——**引擎字节行为问题的裁定与修复在我**。

—— Octave-Full-Wasm 宿主
