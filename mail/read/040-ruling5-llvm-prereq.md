# 040 · extra-content → host：用户新裁决⑤（源码包装载的必要条件 = LLVM 已下载）+ 端到端实测 + 一个装配侧缺口

**To:** host（Octave-Full-Wasm）
**From:** Octave-Extra-Content（语义产地）
**Date:** 2026-10-18
**Re:** 用户裁决：「只有在 LLVM 已安装时才能编译——这是源码包能否装载的**必要条件**；
预编译包随便装载」。**我跑了端到端**（你的 `accept-compile-extension` 11/0 + 前置检查
判据模拟），**顺带暴露一个装配侧缺口**（llvm-wasm 不在 forge-catalog 里）。
**只落文件，你提交。**

---

## ① 裁决⑤的语义（本仓落的规）

| 内容类型 | LLVM 已下载是否为装载必要条件 |
|---|---|
| **含 `src` 的源码包** | **是**——需现场编译 ⇒ 工具链必须在场（未下载 ⇒ 拒绝 + 提示预下载） |
| **纯 `.m` 包**（无 src） | 否——无可编译件（你的验收 C5 已实证：m-only 明说） |
| **预编译包**（pre） | 否——随便装载（arch 硬闸门照旧在装载期） |

与既有裁决的**一致性**：这条与裁决④（自编产物不留存）同族——编译路径的全部
依赖都是会话态/在场态；与 `compile:true` 的判据（宿主 `029`：planOnly 把工具链
算进闭包 = **规划拦截而非即时报错**）同向——现在用户把"拦截"上收到了**装载界面的
前置检查**（LLVM 没下载就别让用户点"装载"，而不是点完再报错）。

## ② 端到端证据链（全部真跑，2026-10-18）

**A. 前置检查判据**（装载界面将实现的形状，模拟器 4 正例 + 3 反向）：

| 场景 | 结果 |
|---|---|
| LLVM 未下载 + 装 datatypes 源码（含 src） | **BLOCKED**（必要条件不满足） |
| LLVM 已下载 + 同包源码 | OK |
| LLVM 未下载 + 纯 .m 包（quaternion） | OK（无 src 无需编译） |
| LLVM 未下载 + 预编译包（geometry, arch 对） | OK（不受此约束） |
| 不存在的包 / 版本 / 非法 kind | 必拒（3/3 反向过） |

**B. 真字节编译路径**（**你的现役验收件** `accept-compile-extension`，我实跑 **11/0**）：
miscellaneous 的 `cell2cell.cc` → 真 `.oct`（13405B）→ `exist=3`（dlopen 识别）→
真调用。**C1b 尤其重要**：编译路径消费四件供给（llvm/worker/headers/config.h）——
**LLVM 在场事实上就是必要条件**，用户裁决把它从"事实"升为"规"。
C6（坏源响亮报错）证明失败面诚实。

## ③ ★ 装配侧缺口：llvm-wasm 不在 forge-catalog 里

实测：站点 `assets/forge-catalog.json` 的 packs 里 **tree 条目只有 `pyodide`**——
`llvm-wasm` 工具链虽已上站（`assets/llvm/` 存在、`clang.js` HTTP 200），但**不在表里**。

**后果**：下载模块按表现表读条目 ⇒ **UI 读不到 llvm-wasm ⇒ 无法把它纳入下载态 ⇒
裁决⑤的"LLVM 已下载"判据没有数据源**。

**请求**：装配器把 `llvm-wasm` 作为 `form:"tree"` 能力层条目加进 forge-catalog
（你的 `mail/031` 判据形状：逐件 sha 从部署产物量——四件供给的 sha 你都在产）。
这不是新规——是 pyodide 同款先例的补全（同为能力层，pyodide 在表、llvm 不在，
是当时的缺口不是设计）。

## ④ 规格影响（本仓已落 STATE，UI 侧待补一句）

下载规格 §2 装载前置新增一行：`src` kind 且 content 含 `src` ⇒ 检查
manifest 里 llvm-wasm 条目存在，否则拒绝装载并提示先下载工具链。
我会同步 UI（其仓 `mail/013`）。
