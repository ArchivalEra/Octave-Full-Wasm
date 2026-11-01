# 72 · GitRoll 剩余技术债（issue #7 的未完成部分）

**Status:** ready-for-agent
**Settling:** `node build/113/var-audit.mjs`
rc=0 ⇒ 本仓自写 JS/TS 里**零 `var`**（第三方/生成物按产地排除，排除清单必须能说出"谁产出它"）
rc=1 ⇒ 还有 `var`（逐条点名，并区分"可证等价可自动改"与"必须人工写显式形态"）
rc=2 ⇒ 读不到 TypeScript（判据工具缺失，**不降级成正则匹配**）

---

## ★ 2026-11-01 用户点令："补上 var 那 35 条，隐式改显式，不准有任何合法例外"

这一令推翻了本单原来的口径：原先把 20–35 条 `var` 登记成"**合法例外**"（`for(var)`
闭包风险 / 顶层隐式挂全局 / 注释里），并在 `var-to-let.mjs` 里写着 `TOP_LEVEL_GLOBALS`
白名单。**用户不接受**。理由是对的：例外一旦写进工具，就再没人回头看它是真是假。

### 先纠三笔错账（都是我自己造的）

| 原账面 | 实测 | 怎么错的 |
|---|---|---|
| "363 → 剩 35 条" | 自写 JS 里其实 **72 处 `var`** | 旧工具按**行**正则匹配，只扫了部分目录；又漏了 `build/`、`test/` 整片 |
| "`for(var)` 16 处" | **17 处** | 漏数 |
| "`G` 靠隐式挂全局，必须留 `var`" | **完全错** | `var G` 是 `tsc --target ES5` **降级造的**，源码 `.ts` 里一直是 `const G`。`grep window.G`/`self.G` 全仓**零命中** ⇒ 它从未被任何外部脚本读过。我上次直接手改**产物**（把 29 处 var 手改成 let），又给 `G` 加白名单 —— 两处都是错上加错 |

⇒ 教训写进工具注释：**产物不许手改**（改 `.ts` 或改编译目标）；**判据不许用 grep**（注释/字符串
里的 `var` 会污染，`window.G` 出现在注释里也会被误判成"有人在读"）。

### 现在怎么做到的

**工具换了**：`build/113/var-audit.mjs`（AST 判据，TypeScript 5.9 真解析器）取代
`var-to-let.mjs`（行正则 + 手写白名单）。旧工具已 `git rm`。

三种 `var`、三种机器判据（每条都能红，自证 10/0）：

| 形状 | 判据 | 判定 |
|---|---|---|
| `for (var i …)` | ① 循环体里**创建的函数**有没有引用 `i`；② 循环**之后**同一作用域还有没有引用 | 都无 ⇒ 可证等价，改 `let`；任一有 ⇒ **拒绝自动改**，红并点名 |
| 顶层 `var`（classic script） | 全仓有没有 `window.X`/`self.X`/`globalThis.X` **在代码里读**（剥注释与字符串） | 有 ⇒ **必须写显式赋值**（`self.X = …; const X = self.X;`）；无 ⇒ 改 `let` |
| 其余（函数/块内） | 声明块**之外**、同函数内有没有引用；同作用域有没有重声明 | 都无 ⇒ 改 `let`；有 ⇒ 红 |

⚠️ `.mjs` 是 **ESM**：顶层声明在模块作用域，`var`/`let` 等价、不产生全局属性 ⇒ 单独放行
（这不是"例外"，是判据里写明的语义差别）。

### 实际改动

| 文件 | 改动 |
|---|---|
| `bridge/octave-worker.js` | `var Module = core.module;` → **`self.Module = core.module; const Module = self.Module;`**（隐式挂全局 → 显式两行，行为逐字节等价） |
| `bridge/octave-page.ts` | `var loader` → `const loader` |
| `build/build-embed-ts.sh` | `--target ES5` → **`--target ES2020`**（用户已定 Chrome 123 下限；ES5 目标把每条 `const/let` 降级成 `var`，那 29 条 `var` 是编译器造的，不是源码要的） |
| `bridge/{assets-loader,lane,octave-core,octave-embed,octave-omc-bridge}.js` | 10 处 `for(var)` → `for(let)`（AST 证明无捕获、无循环后引用） |
| `site/` 镜像 | 同步 7 件（`promote-pages.sh` 的下游） |
| `build/113/probe-jspi-worker/worker.js` | 13 → 0 |
| `build/webjslib.js` | 2 → 0（**容器实测** emcc 6.0.12 `--js-library` 接受 `let`，RC=0） |
| `test/browser/{accept-113-oct,accept-embed-multi,accept-worker}.mjs` | 15 → 0 |

### 实测证据（不是推断）

- `node build/113/var-audit.mjs` ⇒ **0 处 var / 0 个文件**
- `node build/113/var-audit.mjs --selftest` ⇒ **10 PASS / 0 FAIL**（含 5 条反向：捕获 ⇒ 拒改、
  循环后引用 ⇒ 拒改、`self.X` 读 ⇒ 必须显式、块外引用 ⇒ 拒改、manual 不被自动改）
- emcc 探针（容器 `o113` / emcc 6.0.12）：`--js-library` 喂 `let` ⇒ **RC=0**，产物里 `let q` 原样保留
- 闸门自证台 **55/55**
- 浏览器全量回归（见 STATE）

### 按产地排除的清单（**每条都能说出谁产出它**）

不是本仓自写代码、因此不在本闸门判据内：`site/octave.js` / `site/w64/octave.js`
（emcc 胶水，`link-web.sh`）、`site/assets/llvm/`（`provision-llvm-wasm.sh`）、
`site/assets/pyodide/`（`provision-pyodide.sh`）、`site/assets/pkg/` 与 `site/assets/m/`
（`build/assets.py bundle-*`，内含上游 `.m` 文本）、`site/omc/`（`provision-omc.sh`，wbindgen）、
`upstream/`（上游子模块）。

⚠️ 排除靠**产地正则**，不靠文件名手工列举。新增一个生成目录必须在这里登记并写明产地 ——
说不出产地的排除就是藏污纳垢。

---

## 仍未做的两项（本单保持 open 的原因）

### ① Cognitive Complexity 57 条 —— 真可读性债

**为什么不是缺陷**：不影响行为正确性，但确实是维护成本。
**为什么不能混在本单**：重构老函数需要**先有自证**（本仓 AGENTS 纪律：改承重代码要能证明没改坏），
且本仓 56 套验收覆盖的是浏览器行为，不是函数的圈复杂度 —— 重构的判据得另造。

**结算件候选**：挑复杂度最高的 3 个函数（报告里 357/109/84 那几个）逐个重构，
每改一个跑一次全量 + 对比行为（这本身就是判据）。

### ② 其余 ~447 条风格建议

可选链（114）、`RegExp.exec`（27）、`startsWith`/`endsWith`、嵌套三元（21）等。
**判据**：`npx eslint` 之类工具能做，但本仓没装 —— 引入工具链是独立决定。
**或者**：不做，并在 issue #7 里明确"这批不改"（记账比沉默好）。

## 不要做的事

- **不要**为了"清空扫描告警"而把 `for(var)` 机械替换 —— `let` 的块作用域会真改行为。
  改之前必须有 AST 判据（本工具的三个判据就是为此写的）。
- **不要**把复杂度债塞进"已修"清单 —— 那是把没做的事说成做了。
- **不要**手改 `bridge/octave-page.js`（它是 `octave-page.ts` 的产物）。
- **不要**给 `var` 留白名单 —— 用户 2026-11-01 明令"不准有任何合法例外"。判据必须机器算。
