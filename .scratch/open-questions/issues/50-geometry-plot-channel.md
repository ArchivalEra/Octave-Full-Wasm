# 50: **E6 推荐形状：几何数据通道**（UI RFC #1 采纳项）——opengl_renderer 几何流导出

**What to build:** UI 侧 RFC（本仓 gh issue #3）提出"绘图管线解耦"：Embed API 提供**纯几何/
点阵 Buffer 通道**，UI 用 WebGPU/WGSL 自己渲染，embed 路径**整条绕开 GL 栈**。引擎侧评估
**采纳为 E6 图形线的推荐形状**（比"修好 GL 纹理边界"更聪明：绕开而非修复；与工单 48 的
OutputSink 缝同构）。本单 = 该方向的立项单与第一实验。

**Blocked by:** None（但实现批次 = E6 图形线开图时；v1 上线仍守"不在 embed 页画图"约定）

**Status:** resolved（2026-10-03：**第一实验通过——几何通道可行已证**。本单范围（立项+第一实验）
完成；完整契约定稿与 UI 渲染器对接属 E6 实施批次后续单）

**Settling:** 不存在 —— 本工单第一交付物。形状：embed 形态下加载一个探针页，对
`opengl_renderer` 注册"几何 sink"后端（与 GL toolkit 并列），跑 `plot(1:10); print` 级别的
最小用例，验证能抽到折线顶点流（flat [x,y…] + 颜色/线宽数组）⇒ 抽到 = 通道可行（进入
契约定稿）；抽不到（renderer 深度耦合 GL 上下文）= 如实记档，E6 回到"修 GL 边界"路线。

## Answer

（未结案——立项单。）

- **为什么是它**（对比"修 GL 边界"与"-sUSE_WEBGPU=1 重写"）：绕开而非修复；不动 wasm GL
  栈；与 OutputSink 同构；UI 渲染层（WebGPU/WGSL 120FPS）由 UI 侧自由实现。
- **数据形状建议**（给 UI 侧设计的输入，未定稿）：折线 = flat [x,y…] + 颜色/线宽数组；
  面片 = 顶点+索引；文本 = 位置+字符串。定稿以第一实验的实际产出为准。
- **gh 讨论**：本仓 issue #3 的引擎侧评估回复（采纳 #1 / 否决 #2 #3，含数字）。
- **否决项备忘**：#2 `-sUSE_WEBGPU=1`（无 GL 1.x→WebGPU 翻译层，重写整个 toolkit 后端，
  收益与 #1 重叠；#1 落地后重评）；#3 WGSL compute（**WebGPU/WGSL 无 f64**，无 shader-f64
  扩展，f32 模拟连指数域都是 f32 的 8 位——Octave 是 f64-first，精度不可接受；且 compute
  非瓶颈，结算表 matmul 已达原生参考 7.8–9.1×）。

## Answer

（2026-10-03 第一实验结案，**全部 10 断言 PASS**，复跑：
`xvfb-run -a env HEADLESS_GPU=1 HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh
test/browser/probe-figures-geometry.mjs http://127.0.0.1:8865/wgsl-demo.html`）

- **几何通道落地**：`bridge/octave-embed.js` 增 **`figures.geometry(figH?)`**——把导出函数
  （m 源内嵌）写 `/tmp` → `addpath` → 调用 → `jsonencode` 回读（evalJSON 值通道同款管道）。
  **全程不过 drawnow/GL** ⇒ embed 页 GL 纹理边界对本通道**不适用**（结构性绕开，非修复）。
- **数据契约 v1（实测）**：`{xlim, ylim, xscale, yscale, xgrid, ygrid, title, xlabel, ylabel,
  objects[]}`；objects v1 = `line`（x/y/color/linewidth/linestyle/marker/markersize）与
  `text`（position/str/color/fontsize）。⚠ axes children **后画的在前**——UI 按 color/type
  匹配，别按顺序（实测踩过）。
- **WebGPU 参考渲染器**：`bridge/embed-wgsl.html`（站点 `wgsl-demo.html`）——WGSL line-strip、
  数据坐标→clip 映射、逐线颜色；**GPU 侧回读**（离屏纹理 → copyTextureToBuffer → mapAsync）
  red=777 / blue=573 ⇒ 线真画上了。合成器截图在 headless/Xvfb 不可靠（连 clear-to-red 都
  截不到，环境限制如实记档）——**回读才是验证通道**。
- 三个坑：mapAsync 需钉住 adapter/device 防 GC（"external Instance reference"）；swiftshader
  合成器截图全黑；axes children 逆序。
- **后续**（E6 实施批次，未立项）：surface/patch/legend/对数轴/3D 的契约扩展；渲染器性能
  （120FPS 目标的 instancing/合并 draw）；与几何通道并行的"修 GL 边界"仍待 E6 主线。
