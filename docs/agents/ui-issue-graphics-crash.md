## 环境

- 引擎侧：Octave-Full-Wasm（纯客户端 GNU Octave 11.3.0 → wasm，三线：wasm32-final / wasm64-NEXT(master) / IllegalPerformance）
- UI 侧：本仓（Octave-UI，`SafePlotSinkPolyfill` 影子绘图管线）
- 复现站点：isui.ren 部署件（非 COI 兼容档）

## 现象（上游 issue 已记：Octave-Full-Wasm#5）

`title` / `xlabel` / `ylabel` / `grid` / `legend` / `axis` / `hold on` / `subplot` / `bar`
**全部**报 `figure: function called with too many outputs`；裸 `plot(0:1:10)` 正常。

```
error: figure: function called with too many outputs
error: called from
    figure
    gcf at line 57 column 5
    gca at line 52 column 3
    title at line 55 column 7
```

## 根因（引擎侧已实测钉死）

本仓 `src/modules/semantic/SafePlotSinkPolyfill.ts` 在每次运行前，用 `supervisor.fsWrite`
往引擎文件系统写 4 个桩函数到各 3 条路径（共 12 处），其中：

```js
static readonly FIGURE_SCRIPT = `% Safe Figure Stub
function figure (varargin)
  % No-op safe stub preventing GL4ES window init
endfunction
`;
```

**这个桩声明了 0 个输出**。而 Octave 核心 `plot/util/gcf.m:57` 写的是：

```matlab
h = figure ();
```

Octave 的**输出个数检查发生在函数体之前** —— 对一个只声明 0 个输出的函数做 `h = f()`
会在进函数体之前直接抛错。于是凡经 `gca → gcf → figure` 的句柄路径（title/xlabel/grid/
legend/axis/hold/subplot/bar 全在内）一律崩；裸 `plot` 因为本仓也用桩换掉了它、不走
figure 路径，反而幸存。

两条解析规则（引擎侧本机实测）：
1. **调用者目录优先** —— `gcf.m` 调 `figure()` 先在 `plot/util/` 里找 ⇒ 本仓覆盖
   核心 `plot/util/figure.m` 就直接命中桩，**改 path 顺序救不了**；
2. **path 顺序**（`.` = cwd 永远第一）—— 本仓往 cwd 根 / `/home/web_user` 写的同名桩
   会盖住引擎的 plotbridge 与核心实现。

## 请本仓处理的两件事（引擎侧已自行修好，不要求本仓改代码）

1. **重新 vendor 引擎胶水**：引擎侧已在 `bridge/octave-core.js` 加了"图形核心 m 树守卫"
   （开机快照核心 m 文件 + 每次用户 eval 前把退化成 0 输出的桩还原 / 删除）。
   本仓 `scripts/sync-bridge.sh` 从引擎仓库 `bridge/` 同步胶水 —— 跑一次即可拿到修复
   （**本仓无需改任何代码**）。
2. **`figure` 桩建议删除**：既然引擎的 `webgl` toolkit 在（`graphics_toolkit()` 返回
   `webgl`），`figure` 不必再用 no-op 桩挡 —— 它现在只制造上述崩溃。
   `plot` / `drawnow` 桩若仍要保留作数据通道（`__octave_web_plot__`）请保留，但注意
   它们**声明 0 个输出**，凡核心内部 `h = plot(...)`（`fplot`/`comet`/`feather`/`voronoi`
   等）也会撞同一个错 —— 建议把 `plot` 桩声明改成 `function h = plot (varargin)`。

## 引擎侧配套

- 引擎仓 `Octave-Full-Wasm`：commit `f3a4851`（守卫 + embed 资产链修复），
  验收 `test/browser/accept-gfx-isolation.mjs` 6/6（含"注入桩后矩阵仍全绿"与反向断言）。
- 附带修了 embed 路径的第二层缺陷：`octave-page.js` 的 `assets` 工厂在 isDefault 时
  复用文件级别名，而它惰性绑 `global.Module`（embed 不设 ⇒ `Module.FS 尚未就绪` ⇒
  plotbridge/webgraphics/pkgfix 整链装不上）。判据已改为 `G.Module === mod`。
