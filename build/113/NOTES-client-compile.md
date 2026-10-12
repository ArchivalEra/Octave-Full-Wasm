# 实验：浏览器内 clang 编真 Octave `.oct` → 装进真宿主调用（2026-10-12）

**结论：整条路走通了**（用户问题"用户能不能自己编 oct"的答案：能，已实测）。

## 实测链路

```
LLVM-wasm 工具链（发布包 v0.1.1，浏览器侧同款）
  → compile({ files: <788 个真 Octave 头 + minitest.cc>, target:'wasm64',
              abi:{exceptions:'wasm-legacy', pthread:true, memory64:true},
              include:['/src/octinc'], define:['HAVE_CONFIG_H=1'], flags:['-std=c++17'] })
  → 8738 B 真 .oct（导出 Gminitest + _Z9FminitestRK17octave_value_listi + _emscripten_tls_init）
  → 写进宿主 FS 的某个目录 + addpath 那个目录
  → which('minitest') = /tmp/octs/minitest.oct
  → exist('minitest') = 3
  → minitest([10 20 30]) = 11 21 31   ← 真跑出结果
```

## 三个踩到的门槛（都可绕过，但值得记）

1. **`compile()` 只编 `files` 的第一个键**（`toolchain.mjs:246` 用 `Object.keys(files)[0]`）
   ⇒ 喂多文件时必须把主 TU 排第一。**给工具链的建议**：加显式 `entry` 参数。
2. **多文件写 FS 会 ENOENT**（`mkdirTree` 只建了 `/src`，嵌套路径父目录不存在；
   实测 `ErrnoError errno=44`）⇒ 使用方要先自己 `mkdirTree`。
   **给工具链的建议**：写文件前逐级 `mkdirTree(path.dirname(...))`。
3. **`.oct` 的发现机制不是 dlopen 注册**，而是 **文件名 + addpath 目录**
   （Octave 按 `<函数名>.oct` 在 path 里找）。裸 `loadDynamicLibrary` 只把模块装进
   内存、**Octave 不认识它**（实测 `exist` = 0）；`addpath` 才触发识别（`exist` = 3）。

## 配套数字（本次实测）

| 项 | 值 |
|---|---|
| Octave 头文件集（浏览器要喂的） | 788 个文件 / 6.2 MB（`octave-11.3.0/include` 全域） |
| 产物 | 8738 B（最小真 `.oct`） |
| 工具链首拉（v0.1.1 manifest） | 见 `release/out/manifest.json` 的 `first_load` |

## 该怎么接：三条路，按代价排序（给决策用）

| 路径 | 需要谁 | 代价 | 用户拿到什么 |
|---|---|---|---|
| **A. `.m` 直接装**（**今天就能做**） | 只有我们 | **零** —— Forge 按需 v1 已在做（写 FS + addpath） | 用户能装/改 `.m`，含货架 10 包里**全部 `.m` 部分** |
| **B. 浏览器编 `.oct`**（本实验已打通） | 我们（工具链是别人的，已交付） | 中：喂 6.2 MB 头 + 工具链首拉（见 manifest）；**产物必须匹配宿主档**（w64 线 → wasm64） | 用户能自己编货架包的 `src/*.cc`（**7/10 个包有 src**，共 49 个源文件） |
| **C. 让 UI 侧做编辑器/商店前端** | 需要跟 Octave-UI 那位聊 | 高：跨仓协商接口 | 可视化编辑/一键编译的体验 |

**建议顺序：A 已经在了 → 先做 B 的后端（不依赖 UI）→ 界面最后找 UI 方。**

理由（都基于实测，不是偏好）：

1. **B 的可行性今天已经证明**（本文档第一节：8738 B 真 `.oct`，`exist=3`、
   `minitest([10 20 30])=11 21 31`）。**在它能跑通之前跟 UI 谈接线是空谈** ——
   接口长什么样取决于后端能做什么。
2. **B 不阻塞于 UI**：核心是"把工具链 + 6.2 MB 头喂进 FS → compile → 写目录 → addpath"，
   这是纯客户端资产管线，可以挂在我们现有的 `OctaveAssets` 上（它已有 fetch/校验/写盘/addpath）。
3. **接头其实已经存在**：`OctaveAssets.load()` 的返回契约（`{files, addpath}`）与
   这次实验的调用形状一致 —— 编出来的 `.oct` 只要写进目录 + addpath，**和货架包同一条路**。
   也就是说 B 是"A 的延伸"，不是新架构。
4. **C 要谈的是体验**（编辑器、进度、错误展示），不是能力 —— 等 B 有了可用后端，
   跟 UI 方谈就有具体东西可对，而不是拿 PPT 谈。

## 给工具链方的两条小建议（本轮实测撞到，已记）

1. `compile()` 只编 `files` 的**第一个键** ⇒ 建议加显式 `entry` 参数（现在得靠调用方排序）。
2. 多文件写 FS 会 ENOENT（`mkdirTree` 只建 `/src`）⇒ 建议写前逐级建父目录。

（这两条**不阻塞**我们：实验里都用一层包装绕过了。）
