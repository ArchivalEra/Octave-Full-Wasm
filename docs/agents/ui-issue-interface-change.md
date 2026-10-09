# 告知 UI 仓的接口/行为变化（2026-10-09）

> 正式提交：<https://github.com/ArchivalEra/Octave-UI/issues/2>
> 触发：用户点名"如果有接口变化就给 UI 仓提 issue"。
> 关联：本仓 gh #5（图形崩溃）+ Octave-UI #1（原始崩溃单）。

## 判定：确实有 UI 可观察的变化（但 Embed API 签名未变）

引擎侧为修 issue #5 的静默失败族，把**图形核心 m 树改成引擎权威**（宿主影子桩被清）。
由此产生**两处 UI 可观察的变化** + 一个隐藏坑：

| # | 变化 | 实测证据（UI 拓扑：UI dist + 引擎 bridge + UI serve.py） |
|---|---|---|
| A | `__octave_web_plot__` 数据通道**失效** | `exist('__octave_web_plot__')` = **0**；`__get_plot_data__().count` = **0**；`which('plot')` = 引擎 `plotbridge/plot.m` |
| B | 引擎图**插入 DOM**：`#p5figure` + `<img>` 560×420，容器挂 **BODY**（UI 页无 `#output`） | `p5Parent = "BODY"`（`p5canvas.js` 找 `#output` 找不到则 append 到 body） |
| C | **裸 `plot` 不 flush**（本构建无 GUI 事件循环） | 8761：`plot(1:10)` → 0 张图；补一次 `drawnow` → 1 张 |

⇒ 组合效果：UI 现在跑 `plot(1:10)` **什么都没画**（他们的卡片没数据、引擎图没 flush）。
这是必须告知的行为变化（不是 bug 隐藏，详见 issue 正文）。

## 为什么不擅自改引擎去"迎合"UI

- 挂载点（`#output` vs `#octave-raw-output`）是**跨仓页面约定**。按本仓与 UI 仓的惯例
  （gh #1 的讨论：契约面改动要两边同时知道），引擎侧**不单方面**引入新约定；
  在 issue 里给了两个提案（`window.__octaveP5Mount` 选择器 / UI 页加 `<div id="output">`），
  等 UI 拍板再发版。
- **Embed API 面零改动**（`bridge/octave-embed.js` 本轮无提交；`docs/embed-api.md` 亦未动）。

## 给 UI 的三条可选路（issue 正文有全文）

1. **最小**：执行器在含画图命令的单元格末尾补一次 `drawnow`（一行）。
2. **几何通道**：用已落地的 `octave.figures.geometry(figH?)`（工单 50）自渲染，彻底不依赖 m 桩。
3. **PNG + 可配挂载点**：选项 1 的形态 + 上面的提案。

顺带建议：`SafePlotSinkPolyfill` 可整体退役（`install()` 已是空操作、`extractData` 恒 null）。

## 复跑方式（引擎侧，对任意站点 URL）

```bash
sh test/browser/run.sh test/browser/accept-gfx-render.mjs <URL> ui   # 期望 14 PASS / 0 FAIL
```
