## 下游独立复验：修复确认有效（v0.1.1）

我按 issue 里的最小复现重跑了一遍，**三条修法都在真产物上验证过**：

**① 反向断言生效**（缺档时明确拒绝，不再静默降级）：
```
[模拟只用 wasm32 tar 要 wasm64]
ok=false  error: sysroot for wasm64 is missing in this toolchain's sysroot source
                   (available: wasm32). Refusing rather than linking a module without
                   the TLS init entry.
```
⇒ 正是报告里那句"比选口径更要紧"的判据，现在硬失败了。

**② 两档 sysroot + 驱动自选（口径 A）生效**：
```
targetsAvailable: [ 'wasm32', 'wasm64' ]
wasm32  ok=true  942 B
wasm64  ok=true  966 B        ← 同一份 bundle，驱动按 target 自选
```

**③ 端到端：装进下游真宿主（这一步是关键）**
把 `wasm64` 产物送进我们的真宿主（`MAIN_MODULE=2` + `wasm-legacy EH` + pthread + memory64，
即 8761 现役 w64 档），在 Chromium 里 `loadDynamicLibrary`：

```
host ready: true | dlopen OK ✓
```

⇒ **修复前**：同一路径报 `tlsInitFunc is not a function`（缺 `_emscripten_tls_init`）。
**修复后**：干净装载。

这条闭环对我们尤其重要，因为**我们两条主线都是 wasm64** —— 也就是说这个发布缺口
不是"下游第三方才会遇到"，而是一直挡在我们主路径上。v0.1.1 之后我们可以两线各取本档
sysroot 使用，不需要任何本地特判。

（复跑方式与原报告一致；宿主侧我们已把"架构纯度"做成常设闸门
`check-lane-purity.py`，宿主 / `.oct` / 站点资产三处必须同档 —— 这类混编从此会在
发运前被点名，而不是留到浏览器里。）
