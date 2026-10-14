# PLAN · 补剩下的缺口（2026-10-14 制定）

> **性质**：工作令（不是设计稿）。每条缺口带**实测现状** + **可复跑的验收/反向断言**；
> 写不出复跑命令的条目不进本单（本仓事实纪律）。
> **上游文档**：需求单（商店契约 + MATLAB 贴近度）= `REQUIREMENTS-store-and-matlab.md`；
> 差距盘点的三条轴 = `NOTES-plugin-survey.md` §8；自编 `.oct` 设计 = `NOTES-client-compile-design.md`；
> OM 路线探查 = `NOTES-experiment-omc-wasm.md`（**OM 本体已由独立仓接管**，见 §4）。
>
> **本单只覆盖"缺口"这一半** —— 用户 2026-10-14 已裁定 CUDA / App Designer / 硬件支持包 / pthread
> 分档**不是缺口**（是"不要/更好"）；台账键 `hw_apis_available` / `webgpu_*` 是那次裁定的实测底座。

---

## §0 一句话结论

**三条缺口各自的"能不能做"都已用实测回答了，本单是把它们变成可排期的批次**：

| # | 缺口 | 现状（实测） | 本单给的形状 |
|---|---|---|---|
| ① | **符号计算**（`sym`=0） | **路线前提已实测通过**：浏览器里 Pyodide+SymPy 真算对 `diff(sin(x),x)`=cos(x)（COI/无 COI 双模式 5/0）；**.pyc 预编译 = 7.26×** （2757→380 ms，编译 472→0 次），代价 = 字节 3.28× | §1：v1 = Pyodide 挂上 `symbolic` 包；`sympref` 那条 IPC 缝接我们的 JS 桥 |
| ② | **库的厚度** | 货架现状 12 包；上游**144 个包全部兼容 11.3.0**（实测过滤），其中 **102 个纯候选**（无包依赖、无系统要求） | §2：扩货架（纯工具）+ 摘随站（让"装"有真实意义）；v2 自编 `.oct` 另见设计稿 §9 |
| ③ | **计划内三件** | 引擎侧**全有**（`probe-blockdiag-backend` 6/0）；缺的是前端/装配 | §3：Simulink 前端（独立仓，复用本仓 embed）、`.mat` 端到端、OM 交给独立仓 |

**顺序建议**：①v1（本仓、独立、可验收）→ ②扩货架（纯工具，喂商店）→ ③前端（独立仓，本仓只出接口）。

---

## §1 缺口①：符号计算（用户点问 "transcrypt 预编译是不是更好" 的直接答案）

### 1.1 为什么 `symbolic` 包**原样装不上**（实测，不是推断）

| 事实 | 证据 |
|---|---|
| `symbolic` 是**纯 `.m`**（无 `.cc/.cpp`） | `tar -tzf symbolic-3.2.2.tar.gz \| grep -c "\.cc\|\.cpp"` ⇒ **0** |
| 但它的**全部功能**经 Python/SymPy | `inst/private/python_ipc_driver.m` 分派四个后端，**全都起 Python 进程** |
| 后端 `native` 用 `pyexec/pyeval/pycall` | `python_ipc_native.m:64-126` 逐行核过 |
| 后端 `system` 用 `system()` 起子进程 | `python_ipc_system.m` 逐行核过 |
| **本构建三样全没有** | wasm 里 `pyexec`/`pyeval`/`pycall` 字节数 **= 0/0/0**（实测 `octave.wasm` 扫描）；`system`/`popen` webshim **直接清晰报错**（无 shell，`build/webshims/system.m`） |

⇒ **结论**：这不是"包没装"，是"**引擎里没有 Python**"。两条现实的补法：

| 补法 | 判决 | 依据 |
|---|---|---|
| **A. Pyodide 挂 `symbolic`**（浏览器里起真 CPython） | **选它** | 本批实测通过（下表） |
| **B. 静态编译成 JS**（Transcrypt 那类） | **不可行**，不是"慢几倍" | Transcrypt 官方 README 第 45 行原文 *"**No eval and exec of Python code.** This is again part of the concept."*；而 SymPy 1.14.0 实测 `eval(` **340 处**、`exec(` **61 处**（去 benchmarks/testing，89 个文件）⇒ 静态翻译器无法翻译运行期构造的代码串 |

### 1.2 前提实测：Pyodide + SymPy 在浏览器里真算对（2026-10-14，5/0）

```
test/browser/probe-pyodide-sympy.mjs（三种模式，同一探针）
  COI 模式（有 COOP/COEP）    : ok=true  diff="cos(x)"  sympy=1.14.0  pyodide=314.0.7
  无 COI（发不了 COOP/COEP）  : ok=true  diff="cos(x)"   ← 基础档用户也有份
  反向（拿掉 sympy 轮子）      : ok=false（**响亮失败**，不静默）
复跑：sh test/browser/run.sh test/browser/probe-pyodide-sympy.mjs
读数：/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json
```

**耗时构成**（冷启动，COI 模式）：Pyodide 装载 **1771 ms** → 装 sympy 包 **569 ms** →
首次 `import sympy` + 算 **2916 ms**（这最后一段就是 §1.3 要优化的）。

⚠️ **两条实测坑（已写进探针注释，别改回去）**：
1. **必须 module worker** —— pyodide 314 的启动器在 classic worker 里直接拒绝
   （原文 *"Classic web workers are not supported"*）。
2. **`about:blank` 不是安全上下文** ≠ 结论（WebGPU 那次教训的同款形状）：本探针先 `goto` 真页面再探。

### 1.3 用户点问："预编译 python 是不是更好、能快几倍" —— 实测答案

**能，但只有一半的"预编译"成立**：

| "预编译"指什么 | 判决 | 实测 |
|---|---|---|
| **静态编译成 JS**（Transcrypt） | **不可行**（不是快慢问题） | 官方禁 eval/exec × SymPy 340/61 处 |
| **预编译字节码（`.pyc`）** | ✅ **可行且现在完全没做** | `.pyc` 计数实测：pyodide 的 `python_stdlib.zip` = **0**、sympy/mpmath 轮子 = **0** |

**A/B 实测**（`test/fixtures/sympy-pyc-ab/`，唯一变量 = 轮子里有没有 `__pycache__`）：

| 档 | `import sympy` | 源码→字节码编译次数 | 轮子字节（sympy+mpmath） |
|---|---|---|---|
| 源码轮子 | **2757 ms** | 472 次（sympy 419 / mpmath 53） | 6.55 MB |
| **`.pyc` 轮子** | **380 ms** | **0 次** | 21.47 MB（**3.28×**，gzip 后仍 3.29×） |

⇒ **7.26×**（台账 `sympy_pyc_speedup`）。**仪器可信度**：`.pyc` 档 `source_to_code` 调用
**0 次**（不为 0 则探针 rc=2 判仪器失效 —— 这是这条 A/B 的"反向断言"）。

⚠️ **做这条 A/B 踩到的两个真坑（都在夹具注释里）**：
- `.pyc` 必须用 **Pyodide 自己的 CPython** 编（magic 要匹配，否则静默回落现编）；
- 必须 **hash 校验模式**（timestamp 模式 mtime 对不上 ⇒ CPython **静默拒绝** `.pyc` 回落现编
  ⇒ A/B 看起来"没差别" = 假阴性）。

### 1.4 v1 批次（建议形状，每步独立验收）

```
① 供给（纯宿主，无客户端改动）
   provision-pyodide.sh 按 URL+sha256 取 Pyodide core + sympy/mpmath 轮子（可选 .pyc 版）
   → 落站点 assets/pyodide/（同源；COEP 下跨域 fetch 会被拦 —— 与工具链同款约束，实测过）
   → pin 载体：upstream-lock.json 新增一组（check_locks.py 接手）
② IPC 缝（**一个**接缝，接在 symbolic 已定义的位置）
   symbolic 的接缝**已经存在**：sympref('ipc') 的四个后端里加我们的第五个（或覆写 system 后端）。
   我们的原语 = `__web_run_js__`（点火）+ `__web_pause_ms__`（挂起等 Promise —— JSPI 已实测可用）。
   ⚠️ 铁律（T4 实测教训）：**同步入口挂起会抛 SuspendError 且 Octave 侧抓不住** ⇒
   这条缝必须走 eval_async/页面队列，且**不许放在开机路径**。
③ 验收（三档）
   a. 端到端：`pkg load symbolic` ⇒ `syms x; diff(sin(x),x)` ⇒ `cos(x)`（与宿主 Octave 逐字比对）
   b. 无 COI 站同样通过（基础档用户有份）——探针已证装载可行，这里验的是**我们的缝**
   c. 反向：不装 Pyodide ⇒ 清晰报错（点名"符号计算需要 Python 运行时"，不许 makeinfo 式误导）
④ 台账：sympy_pyodide_* / sympy_import_ms_* / sympy_pyc_speedup 已有（本批落），v1 再加端到端键
```

### 1.5 已知边界（诚实清单）

- **体积**：Pyodide core 压缩 6.44 MB + 轮子（源码 6.71 MB / `.pyc` 22.11 MB）
  ⇒ **必须懒加载**（用户真调 `syms` 才拉），且**不进开机路径**（铁律）。
- **速度 vs 体积是权衡，不是免费**：`.pyc` 7.26× 换 3.28× 字节 —— **建议 v1 用源码轮子**
  （先能用），把 `.pyc` 版作为"用户点加速"的可选档（与工具链懒加载同款）。
- **Pyodide 慢在哪**：sympy 首次 import 的 2.9 s 是**纯 CPython 执行**（不是网络）——
  这是浏览器里跑"真 Python"的固有代价，预编译只解决其中编译一段。
- **本次只验了 `diff` 一条**；`solve`/`int`/`simplify` 等要 v1 端到端逐条过（判据同 ③a）。

---

## §2 缺口②：库的厚度

### 2.1 现状与机会（实测）

| 项 | 实测 |
|---|---|
| 货架现有 | **12 包**（`cgi datatypes geometry matgeom miscellaneous nan optim quaternion splines statistics struct tsa`） |
| 与随站重合 | 10/12（随站 12 个 `assets/pkg/*.js`）；独占 = `cgi`（+`datatypes` 随站没有） |
| 上游兼容面 | 索引 **144 个包，全部兼容 11.3.0**（`octave (>= …)` 过滤，实测 0 个不兼容） |
| 纯候选（无包依赖 + 无系统要求） | **102 个** |

### 2.2 批次（两条不互斥）

```
批次 B1 · 扩货架（纯工具，零风险）
  工具已有：shelf/tools/forge-shelf.py --add <名> --probe（kinds + verified）
  顺序：先挑"纯 .m、无依赖、体积小"的（`cgi` 是样板）→ 过 144 兼容名单
  验收：每个新包 --probe 记 kinds 且 verified 非空；`--verify` 逐包核 sha；
        站点 forge-catalog.json 包数上升；`check-forge-catalog.py` 绿
  反向：故意放一个 sha 不对的条目 ⇒ 装配期拒绝（闸门已有，复跑即可）

批次 B2 · 摘随站（让"装"第一次有真实意义；**大改，单独一批**）
  做法：与货架重合的包从 site/assets/manifest.json 的随站条目摘掉（改走货架）
  ⚠️ 会连带改 **19+ 个验收套件**（它们现在 OctaveAssets.load('statistics') 之类）——
     摘之前先改套件，否则一片红（需求单 §2.B2 已点名这是最大工作量）
  验收：干净站 `pkg load optim` ⇒ 网络审计见 **1 个 .tar.gz** ⇒ 装好可用
```

### 2.3 与 v2（自编 `.oct`）的关系

`datatypes` 的 `datetime` 需要 `__datetime__.cc`（+ `tz.cpp` 4392 行，依赖 `/usr/share/zoneinfo`
时区库路径）⇒ **v2 的实物样本**。设计见 `NOTES-client-compile-design.md`（§10 已用真包源码
验证过链路）；本单不重复，只标依赖关系：**v1（扩货架 + 摘随站）不依赖 v2**。

---

## §3 缺口③：计划内三件

| 件 | 现状 | 本仓要做的 | 谁做 |
|---|---|---|---|
| **Simulink 式前端** | 引擎侧**全有**（`probe-blockdiag-backend` 6/0：`ss`+`step` / `tf` / `ode45` / **刚性 `ode15s`** / `lqr` / `zpkdata`） | **只出接口**（`octave-embed.js` 已在：`accept-embed-api` 13/0）；前端是**独立仓**（用户点令，2026-10-13） | 新仓（前端）+ 本仓（引擎） |
| **`.mat` 端到端** | 两边都能读写 `.mat`（OM 出 MAT4；我们 v4 也通）—— **但端到端没连过** | 等 OM 侧有产物后再连（**不该先做**：没有产物可读） | OM 仓先行 |
| **OM 自产 `omc.wasm`** | 官方 CMake wasm 目标已查证（`NOTES-experiment-omc-wasm.md` §11） | **已交独立仓**（`OpenModelica-Full-Wasm`，用户点令 2026-10-13） | 独立仓 |

⇒ **本仓在这三件里只剩"接口/验收"角色**；不要在本仓重复造前端或 OM 构建。

---

## §4 明确不做（本单范围外）

- **不碰 OM 仓**（`/mnt/hdd/zcode-projects/OpenModelica-Full-Wasm`，已交另一 agent；用户点令）。
- **不做 Transcrypt/Skulpt 那类"把 Python 翻译成 JS"**（§1.1 有判决）。
- **不做服务端**（纯客户端铁律）；Pyodide 的资产**同源托管**（COEP 实测过）。
- **不承诺"任意 Forge 包都能装/能编"**（`.oct` 形态的包属 v2，边界见需求单 §2.A4）。

---

## §5 验收判据汇总（可整段复跑）

| # | 判据 | 命令 |
|---|---|---|
| 1 | Pyodide+SymPy 在浏览器真算对（含无 COI 与反向） | `sh test/browser/run.sh test/browser/probe-pyodide-sympy.mjs`（5/0） |
| 2 | `.pyc` 预编译收益（仪器必须为 0 次编译） | `sh test/fixtures/sympy-pyc-ab/run-ab.sh`（rc=0；读数见 JSON） |
| 3 | 货架工具自证 | `python3 shelf/tools/forge-shelf.py --selftest` |
| 4 | 货架目录一致性 | `python3 build/113/check-forge-catalog.py` |
| 5 | 块图后端能力（引擎侧） | `sh test/browser/run.sh test/browser/probe-blockdiag-backend.mjs`（6/0） |
| 6 | 引擎文件锁（Pyodide 供给用） | `python3 zreflect/check_locks.py`（新条目接手后） |

---

## §6 复跑命令（本单每个数字的出处）

```bash
# ① symbolic 是纯 .m 但靠 Python（0 个 .cc + IPC 后端全文）
cd /tmp && curl -sL -o sym.tgz "https://downloads.sourceforge.net/project/octave/Octave%20Forge%20Packages/Individual%20Package%20Releases/symbolic-3.2.2.tar.gz"
tar -tzf sym.tgz | grep -c "\.cc\|\.cpp"          # ⇒ 0
tar -xzOf sym.tgz symbolic-3.2.2/inst/private/python_ipc_native.m | sed -n '60,130p'

# ② 本构建没有 Python 原语（字节扫描）
python3 -c "d=open('/mnt/hdd/octave-wasm-build/site/octave.wasm','rb').read(); print([d.count(x) for x in (b'pyexec',b'pyeval',b'pycall')])"   # ⇒ [0,0,0]

# ③ SymPy 里 eval/exec 计数（判"静态编译不可行"）
python3 - <<'PY'
import zipfile,re
z=zipfile.ZipFile('/mnt/hdd/octave-wasm-build/symprobe/cache/sympy-1.14.0-py3-none-any.whl')
ev=ex=0
for n in z.namelist():
    if not n.endswith('.py') or '/benchmarks/' in n or '/testing/' in n: continue
    s=z.read(n).decode('utf-8','ignore')
    ev+=len(re.findall(r'(?<![\w.])eval\s*\(',s)); ex+=len(re.findall(r'(?<![\w.])exec\s*\(',s))
print('eval(',ev,'exec(',ex)      # ⇒ eval( 340 exec( 61
PY

# ④ Transcrypt 禁 eval/exec（官方 README 原文）
curl -sL https://codeload.github.com/QQuick/Transcrypt/tar.gz/refs/heads/master | tar -xzO Transcrypt-master/README.rst | grep -n "No eval and exec"

# ⑤ 上游兼容面（144 全兼容）
python3 -c "
import json,urllib.request;pk=json.loads(urllib.request.urlopen('https://gnu-octave.github.io/packages/packages.json').read());print(len(pk.get('packages',pk)))"
```

---

## §7 建议的落地顺序（每步独立可验收）

1. **§1 v1**（符号计算：供给 → IPC 缝 → 端到端）—— 本仓独立、可验收、直接补最大一块空白。
2. **§2 B1**（扩货架，纯工具）—— 喂商店，零风险。
3. **§2 B2**（摘随站，改 19+ 套件）—— 单独一批，最大工作量。
4. **§3 前端**（独立仓；本仓只维护 embed 接口 + 块图后端验收）。
