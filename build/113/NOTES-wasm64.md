# wasm64（memory64）迁移评估与实测实录

> ⚠️ **本文里的数字是「当时如此」，不是「现在如此」** —— 产物在 2026-09-28 之后**又被重编过一次**
> （`build.when` 12:49Z），所以导出数 / i64 密度 / `.oct` 计数都变了
> （散文里的 734 / 4,189,800 / 44 → 台账现值 **732 / 4,040,751 / 46**）。
> **现值的唯一真源是台账**：`build/FACTS.json` 的 `w64_*` 组（10 条，含复跑命令），
> 查法 `python3 build/facts.py show w64_wasm64`。**别再手抄这里的数字进任何活状态文档。**


> 依据需求书 `build/113/PLAN-wasm64.md` §3 及工单 Issue 14 / Issue 17，记录 Q1/Q2/Q3 的实测事实与工程结论。
> 纪律：实测与推断分开写，每条旁边附带复跑命令。

---

## 阶段零 · 农场与工具链全量重编（Issue 17 / probe-wasm64-link）

### 1. 实测结论
- **全量重编闭环**：基础依赖库（`/usr/local-w64` 与 `/src/deps-w64` 共 96 个 `.a` 归档）、Octave 树（`liboctave.a`, `liboctinterp.a`, `liboctmex.a`）以及 44 个 `.oct` side modules 全量编译为 64 位 WebAssembly。
- **符号与指令量测**：
  - `octave.wasm` (29,944,672 字节) 反汇编量出 **4,189,800** 条 `i64` 指令。
  - `octave.build.json` 出厂身份证核验通过（`verdict: ok`），且具备确凿的 `measured.wasm64 = true` 属性（通过 memory import limits flags `0x04` 提取）。
- **真链探针通过**：`bash build/113/probe-wasm64-link.sh w64` 在宿主与容器内均执行成功（`rc=0`，产物包含 410 万+ 条 `i64` 指令）。对照组 `bash build/113/probe-wasm64-link.sh threads` 稳定重现 wasm32 对象的混编拒绝（`wasm32 object file can't be linked in wasm64 mode`，`rc=1`）。

### 2. 复跑命令
```bash
# 1. 验证主模块架构与 i64 指令密度
sudo docker exec o113 /emsdk/upstream/bin/llvm-readobj --file-headers /src/websrc/w64-out/octave.wasm | grep -E "Arch|AddressSize"
sudo docker exec o113 sh -c '/emsdk/upstream/bin/llvm-objdump -d /src/websrc/w64-out/octave.wasm | grep -c i64'

# 2. 跑探针真链
bash build/113/probe-wasm64-link.sh w64
# 对照组（证伪：混编 wasm32 必失败）
bash build/113/probe-wasm64-link.sh threads || echo "预期失败 rc=$?"

# 3. 闸门与身份证自核
bash build/113/relink.sh verify w64
bash build/113/relink.sh --selftest
python3 build/113/check-build-manifest.py --selftest
bash build/gates-selftest.sh
```

---

## Q1 · 浏览器里能跑吗？

### 1. 实测结论
- **实例化支持**：
  - 宿主 Chromium 153.0.8010.12 在默认启动参数下**完全支持** WebAssembly memory64（无须 experimental flags）。
  - 在无 COI 环境下，单线程 memory64 实例可正常创建并绑定线性内存。
  - 在 COI 环境下（由 `build/serve-coi.py` 下发 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`），多线程共享 64 位内存（`shared: true, address: "i64"`）成功创建，内存缓冲区确凿为 `SharedArrayBuffer` 实例。
- **浏览器内 dlopen 动态加载**：
  - 最小 memory64 主模块 + side module 在 Chromium 浏览器环境中通过 `dlopen` 装载成功，正确执行 side module 函数并输出 `dlopen OK, f()=42`。

### 2. 复跑命令
```bash
# 在 harness 目录下启动 Chromium 跑浏览器内存探针
cd /mnt/hdd/octave-wasm-build/harness && node -e '
import("playwright-core").then(async pw => {
  const b = await pw.chromium.launch({headless: true});
  const page = await b.newPage();
  const res = await page.evaluate(async () => {
    const mem64 = new WebAssembly.Memory({initial: 1n, maximum: 2n, address: "i64"});
    return { ok: true, byteLength: mem64.buffer.byteLength };
  });
  console.log("Q1 Chromium memory64 result:", res);
  await b.close();
});
'
```

---

## Q2 · `.oct` 还活得了吗？

### 1. 实测结论
- **全量 44 个 `.oct` side modules 编译成功**：
  - 目标文件全部位于 `/src/libwork/octs-w64` 与 `/src/libwork/octs-w64-pkg`。
  - `llvm-readobj` 检查全部 44 个 `.oct` 均为 `Arch: wasm64, AddressSize: 64bit`。
- **符号导出与 TLS 入口满足规范**：
  - `check-oct-lane.py` 核验：44/44 模块均具备 `_emscripten_tls_init` 入口（线程安全 TLS 支撑）。
  - 44/44 模块均未引入 `__cxa_guard_*` 运行时守卫破坏。
  - `check-oct-imports.py` 核验：0 个新缺导出（主模块通过 `keep-w64.txt` 导出 734 个函数，与 44 个 wasm64 `.oct` 的导入契约严格对齐）。

### 2. 复跑命令
```bash
# 检查所有 .oct 架构
sudo docker exec o113 python3 -c '
import os, subprocess
bad = []
for d in ["/src/libwork/octs-w64", "/src/libwork/octs-w64-pkg"]:
    for f in os.listdir(d):
        if f.endswith(".oct"):
            res = subprocess.run(["/emsdk/upstream/bin/llvm-readobj", "--file-headers", os.path.join(d, f)], capture_output=True, text=True)
            if "Arch: wasm64" not in res.stdout: bad.append(f)
print("Bad .oct count:", len(bad))
'

# 检查 .oct 线程车道准入规则
sudo docker exec o113 python3 /src/bin/check-oct-lane.py /src/libwork/octs-w64 /src/libwork/octs-w64-pkg
sudo docker exec o113 python3 /src/bin/check-oct-imports.py
```

---

## Q3 · 收益到底有多少？（可寻址上限实测）

### 1. 实测结论
- **API 规范踩坑与关键发现**：
  - WebAssembly JavaScript API 对于 64 位内存的定义属性为 **`address: "i64"`**（注意：部分旧草案及文档提及的 `index: "i64"` 会被 V8 当作未知属性忽略，从而退回 32 位内存检查，在上限超过 65536 页时报 `Property "maximum": value X is above the upper bound 65536`）。
  - 当指定 `address: "i64"` 时，`initial` 和 `maximum` **必须为 BigInt**（例如 `80000n`）；传普通 Number 会直接抛出 `TypeError: Cannot convert X to a BigInt`。
- **实测上限数字**：
  - **单线程配置（Single-threaded wasm64）**：
    - `new WebAssembly.Memory({initial: 80000n, address: "i64"})` 成功分配 **5,242,880,000 字节（4.88 GiB）**。
    - `new WebAssembly.Memory({initial: 131072n, address: "i64"})` 成功分配 **8,589,934,592 字节（8.00 GiB）**。
  - **多线程配置（Shared-memory wasm64 + COI）**：
    - 在启用了 COI 头的页面中，`new WebAssembly.Memory({initial: 80000n, maximum: 131072n, shared: true, address: "i64"})` 成功分配 **5,242,880,000 字节（5 GiB）** 的 `SharedArrayBuffer` 共享内存。
- **判决**：确凿突破 4 GiB 内存边界，在单线程与多线程两种配置下均可拿到 >4 GiB 堆空间，**Q3 判定过（rc=0，确认有显著内存容量收益）**。

### 2. 复跑命令
```bash
# 在 Chromium 中实测单线程与多线程 5 GiB / 8 GiB 内存分配
cd /mnt/hdd/octave-wasm-build/harness && node -e '
import("playwright-core").then(async pw => {
  const b = await pw.chromium.launch({headless: true});
  const page = await b.newPage();
  const res = await page.evaluate(async () => {
    const m5G = new WebAssembly.Memory({initial: 80000n, address: "i64"});
    const m8G = new WebAssembly.Memory({initial: 131072n, address: "i64"});
    return {
      m5G_bytes: m5G.buffer.byteLength,
      m8G_bytes: m8G.buffer.byteLength
    };
  });
  console.log("Memory allocation measurement:", res);
  await b.close();
});
'
```
