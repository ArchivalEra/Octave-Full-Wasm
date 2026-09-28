# 需求书 · wasm64（memory64）迁移评估与落地

**写给**：接手这条线的 agent（新分支，独立车道）
**日期**：2026-09-28
**状态**：待接手。**本文只给目标、约束、判据与已知实测 —— 不给实现步骤**（那正是我不知道的部分，
也正是要你去查的）。

---

## 0. 一句话目标

**先给一个可证伪的可行性判决，再决定要不要迁移。** 交付物不是"把项目改成 64 位"，
而是"**能寻址内存上限这件事，在浏览器里到底能不能变好，能好多少**"。

---

## 1. 为什么考虑它

现役产物是 **wasm32**。wasm32 的线性内存上限是 4 GiB，而 Emscripten 还有自己的判定
（`tools/link.py:1667`：非 memory64 且 `MAXIMUM_MEMORY > 2 GiB` 时走另一条分支）。
Octave 跑全量数值 —— 大矩阵、稀疏分解、`fft` 大尺寸 —— 是**会撞内存墙**的负载。

wasm64 是这条墙上唯一的门。但要先说清楚：**memory64 的收益只有"可寻址上限"这一项**，
CPU 不会更快（指针还变宽了，理论上更慢）。所以如果拿不到 > 4 GiB，这件事**零收益**。

### Emscripten 里的两种形态（实测自 emcc 5.0.7 的 `src/settings.js:258-261`）

| 值 | 含义 |
|---|---|
| `MEMORY64=0` | 默认，wasm32 |
| `MEMORY64=1` | 真 wasm64（i64 指针 + 64 位内存）⇒ **需要支持 memory64 的引擎** |
| `MEMORY64=2` | clang/lld 按 64 位编、**Binaryen 降到 wasm32** ⇒ 内部用 i64 指针但能在 wasm32 引擎上跑 |

⚠️ **关于 `MEMORY64=2` 收益的一句推断（你要验证，不要照抄）**：既然降回 wasm32，
它的可寻址上限**很可能仍是 4 GiB** —— 那它只是"工具链兼容模式"，对内存墙没有帮助。
这一条是本需求书里**最重要的待证伪假设**：如果 2 也拿不到更多内存，那真正的门只有 1，
而 1 的门槛是引擎版本（见 §2 实测）。

---

## 2. 我已经实测的（你不用重做，但都可以复跑）

环境：容器 `o113`，`emcc 5.0.7 (263db4cffa6f)`。以下命令都在容器里跑。

### 2.1 链接层：**三种组合全部通过**

| 实验 | 命令要点 | 结果 |
|---|---|---|
| ① 平凡程序 | `emcc -sMEMORY64=1 -O2 a.c -o a.js` | **rc=0** |
| ② 线程 | `emcc -sMEMORY64=1 -pthread -sSHARED_MEMORY=1 -O2 a.c -o p.js` | **rc=0**（并生成 `libsockets-mt.a` 的 wasm64 版） |
| ③ side module + 主模块 | `emcc -sMEMORY64=1 -sSIDE_MODULE=1 s.c -o s.wasm` + `emcc -sMEMORY64=1 -sMAIN_MODULE=2 a.c -o m.js` | **两个都 rc=0**（并生成 `pic/libsockets.a` 的 wasm64 版） |

⇒ 工具链层面**不挡**。emcc 为 wasm64 准备了完整的 sysroot（含 `-mt` 与 `pic` 变体）。

### 2.2 运行层：**挡的是引擎版本，不是工具链**

| 引擎 | 平凡 memory64 模块 | memory64 + **dlopen** |
|---|---|---|
| `node v22.16.0`（容器内） | ❌ `CompileError: WebAssembly.instantiate(): invalid table elements limits flags` | ❌ 同 |
| `node v26.8.1`（宿主） | ✅ rc=0 | ✅ **`dlopen OK, f()=42`** |

dlopen 那条是**对照实验**：同一份 `main2.c` 分别用 memory64 与 wasm32 链，
在 node 26 上**都**输出 `dlopen OK, f()=42` ⇒ memory64 的 side module 装载**与 wasm32 行为一致**。

### 2.3 Emscripten 自己声明的限制（源码里明确报错的）

- `tools/link.py:765` —— `MEMORY64 does not yet work with ASAN`
- `tools/link.py:1736` —— `wasm2js does not support MEMORY64`
- `tools/link.py:1678` —— 有 Chrome 版本判定，但只影响一个 WebGL 旗标，不影响构建

⚠️ **我全树 grep 过 `memory64 × {side, dylink, dynamic, shared, pthread}`：没有任何显式报错或守卫。**
"没有守卫"通常意味着**没人测过**，比有守卫更危险 —— 所以 §3 的 Q2 必须真跑。

---

## 3. 你必须先回答的三个问题（按此顺序，每条都要可复跑的证据）

### Q1 · 浏览器里到底能不能跑？

**为什么**：§2.2 是 **node** 的结果。本项目的目标是浏览器，node ≠ 浏览器。

**做什么**：照 `test/browser/probe-jspi-b.mjs` 或 `probe-lane.mjs` 的骨架写一个最小页，
加载一个 `-sMEMORY64=1` 的平凡模块，记录：能否实例化、`crossOriginIsolated` 与
**`SharedArrayBuffer` 还在不在**（线程档的物理前提）、引擎版本与报错原文。

**判据（fail-closed）**：能实例化 **且** 双档选档仍按 `bridge/lane.js` 生效 ⇒ 过；
否则如实记录引擎版本 + 报错原文，**并到此停下写否证**（Q2/Q3 没意义了）。

### Q2 · `.oct` 在 memory64 下还活得了吗？（**本项目的命门**）

**为什么**：`.oct` 是 side module，走 `dlopen` 装载、符号**靠主模块导出面解析**，
线程档还要求每个 `.oct` 带 `_emscripten_tls_init` 入口。
§2.2 只证明了"最小 side module 能装载"，**没有**证明这三者叠加成立：
`memory64 × dylink × 主模块 pthread`。

**做什么**：在 memory64 产物上重跑本仓已有的判据，一个都别省：
`build/113/check-oct-lane.py`（TLS 入口 / `__cxa_guard_*` / 导入集）、
`build/113/check-oct-imports.py`（保活闸门，与基线差分）、
以及 `accept-113-oct`、`accept-dldfcn`、`accept-full` 三套。

**判据**：三套全绿 **且** `check-oct-lane.py` 无报 ⇒ 过。任一红 ⇒ 记录是哪一条规则、
用最小复现说清是 memory64 引入的还是既有的。

### Q3 · 收益到底有多少？（**这条决定整件事值不值**）

**做什么**：在浏览器里实测可寻址上限。把 `MAXIMUM_MEMORY` 设到 5 GiB / 8 GiB，
分别测：① 构建能否过；② 运行时**实际能分配多少**（不是"声明了多少"）；
③ `MEMORY64=2` 同样测一遍，验证 §1 那条推断（2 是否真的拿不到 4 GiB 以上）。

**判据**：给出一个**数字**（能分配到的上限）+ 复跑方式。
⚠️ **若 memory64 拿不到 > 4 GiB ⇒ 整件事没有收益，写否证并停止。**
这是本需求书的 fail-closed 出口，请认真用它，别为了"做完"而硬推。

---

## 4. 硬约束（违反直接拒收）

1. **纯客户端计算** —— Octave 恒跑在浏览器 wasm 内，禁止任何服务端执行代码的端点。
2. **不 force-push / 不删 git 对象 / 不改历史**；**禁用 `--no-verify`**。
3. **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`，否则 pre-commit 直接拒。
4. **六道闸门 + `sh build/gates-selftest.sh` 必须全绿**（每批都要，闸门自己也要能证明会红）。
5. **新分支**（建议 `wasm64`），从 `open-questions` 或 `e2-openblas` 切出。
   **不动 8761 / 8768，不 promote**，直到判决为"过"。
6. **一次只动一个轴**：不要同时做 E2 多线程或 B5。wasm64 与 SIMD/线程**不互斥**，
   但"pthread × memory64"的运行时组合**没有任何人测过** —— 那是独立的一格，别混进来。
7. **事实纪律五条**（见 `AGENTS.md`）：数值只认实测、复跑方式写在断言旁边、
   **推断**写进 `build/113/NOTES-wasm64.md` 并注明哪个实验能结案、
   被推翻的登记进 `build/lib/retractions.json`、探测**不许**放在开机路径上。

---

## 5. 交付物

1. **`build/113/NOTES-wasm64.md`**：Q1/Q2/Q3 的结论，每条旁边写**复跑命令**；
   实测与推断**分开写**。写不出复跑方式的句子，只能当历史读。
2. **若判决"过"**：新分支上的 memory64 产物 + 产物身份证（`octave.build.json`，`verdict=ok`）
   + 六道闸门绿 + **一次完整的 8768 验绿**（`sh build/sweep.sh http://127.0.0.1:8768/`，
   **仍然不 promote**）。
3. **若判决"不过"**：一份否证记录（引擎版本 / 组合 / 报错原文 / 复跑方式），
   并按事实纪律第 5 条登记翻案（如果它推翻了"wasm64 可用"这类断言）。
4. **不确定的**写成 `.scratch/open-questions/issues/NN-*.md` 工单，头部挂
   `**Settling:**` 行（格式见 `docs/agents/issue-tracker.md`）。

---

## 6. 已知的坑（本仓踩过的，别再来一次）

- ★ **`relink.sh verify --out <副本>` 会假红，并把 `verdict` 写成 `rejected`** ——
  本文件写下当天实测踩到。根因：`check-build-manifest.py` 的「清单与产物配对」检查按
  **身份证里记录的 `build.out`** 找兄弟文件（`check-build-manifest.py:207`），
  而 `relink.sh verify` **不转发 `--out-dir`**。⇒ **要验副本，必须在产物原位验**（在容器里）；
  或者先把 `cmd_verify` 里那次调用补上 `--out-dir "$out"`（这是一处**真 bug**，
  修它要有反向断言：验一个副本必须绿）。
- **容器里的构建脚本是另一份拷贝**：改完仓库的 `relink.sh` / `link-web.sh` / `configure-113-full.sh`
  / `main.cc` 必须 `docker cp` 进容器；改完先比两侧 `sha256sum`（本次实测两侧一致才敢用）。
- **禁止 `sleep`**（任何形式）：长任务用 `setsid nohup … &` 或后台任务，靠完成通知收尾。
- **测试用例从仓库原路径直跑**，经 `harness/run.sh`（`import 'playwright-core'` 按**脚本所在目录**解析）。
- **跑验收前先验产物 SHA**（磁盘 / HTTP / 页面自证三层），"改完程序用老产物跑"踩过多次。
- **别用 `grep simd128` 当 SIMD 判据**（假判据）；SIMD 判据是 `llvm-objdump -d | grep -c v128`。
- **探测/自检不许放在开机路径上**：坏产物会让整页卡死，连带所有浏览器验收全挂。
- **跑验收时别并行干重活**（并发压缩/docker commit 曾让套件假崩）。

---

## 7. 预算与判据之外的话

这条线的**风险不是"难"**，是"**做完发现没收益**"。所以 §3 的 Q3 被放在交付物里
而不是放在最后：**先量收益，再谈迁移**。如果你在 Q1 或 Q2 就撞墙，
那也是一份合格的交付 —— 一份写清了墙在哪、怎么复跑的否证，比一份"编过了"的产物有用。
