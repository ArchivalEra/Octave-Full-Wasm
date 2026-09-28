# 需求书 · wasm64（memory64）迁移评估

> **接手只读这一份。** 前 §0–§4 是完整工作令，一屏内。**不需要**先读本仓任何其他文档。

---

## §0 一句话

**先给一个可证伪的可行性判决，再谈迁移。** 不做迁移也可交付 —— 一份写清"墙在哪、怎么复跑"的
否证，比一份"编过了"的产物有用。

三问按顺序，**别跳**：**Q1 浏览器能跑吗 → Q2 `.oct` 还活吗 → Q3 内存上限能到多少**。
任何一问不过 ⇒ **停下写否证**，后面不用做。

- **产物**：`build/113/NOTES-wasm64.md`（实测/推断分开，每句旁边写复跑命令）。
- **分支**：新开一个（建议 `wasm64`），从 `open-questions` 切。
- **禁区**：不许动 `8761`/`8768`，不许 promote。一次只动一个轴（别混 E2 多线程或 B5）。

---

## §1 第一步：跑一条命令

```bash
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm
bash build/113/probe-wasm64-baseline.sh
```

**判据**：结尾 `=== 基线 OK（8/8）===` ⇒ 起点正常，去 §2 的 Q1。
否则 ⇒ 环境与需求书不一致 ⇒ **按 §0 写否证并停**，别在坏基线上做 Q2/Q3。

那个脚本做的事（你不必读它，除非要改）：三个 memory64 链接实验（平凡 / `-pthread`
+ `SHARED_MEMORY` / side module + 主模块）+ 两个运行时对照（memory64 平凡 + memory64 dlopen）。
**它证明了"工具链不挡"** —— emcc 5.0.7 三种组合全部链得过，emcc 甚至为 wasm64 备好了完整
sysroot（含 `-mt` 与 `pic` 变体）。

**它没有证明的事**（别读成通过）：`.oct` 在 memory64 下能用（那是 Q2）、
内存上限能超过 4 GiB（那是 Q3）。

⚠️ **运行时不能在容器里测**：容器里的 node 是 **22**，装不进 memory64 模块
（`CompileError: … invalid table elements limits flags`）。这是**引擎版本事实**，不是缺陷。
宿主 node 是 26，跑得动，且 `memory64 + dlopen` 与 wasm32 对照**行为一致**（脚本已验）。

---

## §2 三问与判据

### Q1 · 浏览器里能跑吗？

- **做什么**：照 `test/browser/probe-lane.mjs` 的骨架写一个最小页，加载 `-sMEMORY64=1` 的平凡模块，
  记录：能否实例化、`crossOriginIsolated`、**`SharedArrayBuffer` 还在不在**、引擎版本与报错原文。
- **怎么跑**：`cd /mnt/hdd/octave-wasm-build/harness && sh run.sh <你写的.mjs> <URL>`
  （**别 `node` 直跑**：`import 'playwright-core'` 按脚本所在目录解析）。
  自起站点用 `python3 build/serve-coi.py --dir <目录> --port <端口>`；
  探针要在**顶层页**上做（iframe 自带 COOP/COEP 无效）。
- **判据**：`rc=0` ⇒ 能实例化 **且** 选档仍按 `bridge/lane.js` 生效 ⇒ 进 Q2；
  `rc=7` ⇒ 引擎不支持 ⇒ **写否证并停**。

### Q2 · `.oct` 还活得了吗？（**本项目的命门**）

- **为什么**：`.oct` 是 side module，`dlopen` 装载、符号靠**主模块导出面**解析，线程档还要求每个
  `.oct` 带 `_emscripten_tls_init`。§1 只证明了"最小 side module 能装"，
  **没有**证明 `memory64 × dylink × 主模块 pthread` 三者叠加成立。
- **做什么**：在 memory64 产物上重跑已有判据，一个都别省：
  ```bash
  python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads \
          --base <站点>/assets/oct <站点>/assets/octdir
  python3 build/113/check-oct-imports.py
  # 再加三套：accept-113-oct / accept-dldfcn / accept-full（sh build/sweep.sh <URL> 能跑全套）
  ```
- **判据**：三套全绿 **且** `check-oct-lane.py` 无报 ⇒ `rc=0` ⇒ 过；
  任一红 ⇒ 记录**是哪一条规则** + 最小复现，说清"memory64 引入的"还是"既有的"。

### Q3 · 收益到底有多少？（**这条决定值不值**）

- **做什么**：浏览器里实测**可寻址上限**。`MAXIMUM_MEMORY` 设到 5 GiB / 8 GiB，分别测：
  ① 构建能否过；② 运行时**实际能分配多少**（不是"声明了多少"）；③ `MEMORY64=2` 也测一遍。
- **判据**：给出一个**数字** + 复跑方式。
  `rc=0`（拿到 >4 GiB）⇒ 有收益；`rc=7`（拿不到）⇒ **零收益，写否证并停**。
- ⚠️ **这是 fail-closed 出口，请认真用它**，别为了"做完"硬推。
- ⚠️ 一条**待你证伪的推断**（不是结论）：`MEMORY64=2` 是"按 64 位编、Binaryen 降回 wasm32"，
  我**怀疑**它的可寻址上限仍是 4 GiB ⇒ 只是工具链兼容模式，对内存墙没用。**测出来再说。**

---

## §3 五条硬约束（违反直接拒收）

1. **纯客户端计算** —— Octave 恒跑在浏览器 wasm 内，禁止任何服务端执行代码的端点。
2. **不 force-push / 不删 git 对象 / 不改历史**；**禁用 `--no-verify`**。
3. **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`，否则 pre-commit 直接拒。
4. **六道闸门 + `sh build/gates-selftest.sh` 必须全绿**（每批；闸门自己也要能证明会红）。
5. **一次只动一个轴**：别同时做 E2 多线程或 B5。

**事实纪律**：数值只认实测、复跑方式写在断言旁边；**推断与实测分开写**；被推翻的登记进
`build/lib/retractions.json`（那已有 10 条前车之鉴）；探测**不许**放在开机路径上。

---

## §4 四个"别踩"

1. ★ **跑工具前先读它的用法**。本仓刚踩过：`relink.sh verify --out <副本>` 会**假红并把
   `verdict` 写成 `rejected`**（它按身份证里记录的构建目录找兄弟文件）。
   ⇒ **验副本必须在产物原位验**。
2. **容器里的构建脚本是另一份拷贝**。改完仓库的 `relink.sh`/`link-web.sh` 必须 `docker cp`
   进 `/src/bin/`，改完先比两侧 `sha256sum`。
3. **禁止 `sleep`（任何形式）**；长任务用 `setsid nohup … &` 或后台任务，靠完成通知收尾。
   **跑验收时别并行干重活**（并发压缩曾让套件假崩）。
4. **探针/自检不许放在开机路径上**：坏产物会让整页卡死，连带所有浏览器验收全挂。

---

## §5 交付

1. **`build/113/NOTES-wasm64.md`** —— Q1/Q2/Q3 的结论，每条旁写复跑命令，实测与推断分开。
   写不出复跑方式的句子，只能当历史读。
2. **判决"过"**：新分支上的 memory64 产物 + 身份证（`octave.build.json`，`verdict=ok`）
   + 六道闸门绿 + **一次完整 8768 验绿**（`sh build/sweep.sh http://127.0.0.1:8768/`，**仍不 promote**）。
3. **判决"不过"**：否证（引擎版本 / 组合 / 报错原文 / 复跑方式），并按事实纪律登记翻案。
4. **不确定的**开成工单：`.scratch/open-questions/issues/NN-*.md`，头部挂 `**Settling:**` 行。

**`Settling:` 行怎么写**（本仓特有，闸门会拒不合格的）：必须是
`—— rc=0 ⇒ 结论A；rc=7 ⇒ 结论B` 的形状。只描述做法、不描述判据的**证伪不了任何事**。
结算件还不存在的悬案是**合法**的：写 `不存在 —— 本工单第一交付物就是造它`，**别编假路径**。

---

## 附录 · 真要看时再打开

| 想知道什么 | 看哪里 |
|---|---|
| 构建入口与模式（唯一真值来源） | `bash build/113/relink.sh explain <模式>` |
| 选档逻辑（Q1 要碰） | `bridge/lane.js` |
| `.oct` 为什么是命门（Q2） | `build/113/NOTES-threads.md` 的四段机制（TLS 入口 / `__cxa_guard_*` / slicot 静态链） |
| 什么话不能说（写否证时） | `build/lib/retractions.json` —— 10 条已被推翻的断言，重现即报错 |
| 悬案清单 | `.scratch/open-questions/issues/` —— 先读 **14**（就是本单） |
| `Settling:` 的完整约定 | `docs/agents/issue-tracker.md` 的 `Settling:` 一节 |
