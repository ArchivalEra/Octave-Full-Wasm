# NOTES · `MAIN_MODULE=2` 实测：**体积收益真实（−1.81MB gzip），但被两道墙挡住，本轮不采纳**

> 2026-09-22。计划里 P2 是"把 44 个 `.oct` 放到主链命令行上，让 Emscripten 自己生成保活集"。
> 实测做成了，**体积收益是真的**，但连着撞了两道墙。全部数字是实测，不是估算。

## 一、结论

| | 结果 |
|---|---|
| 体积 | ✅ **真省**：wasm 35.97 → **27.73MB**（−8.24MB）；js 683,614 → **339,118**（−344KB）；三大件 gzip 9.62 → **7.82MB（−1.81MB）** |
| 保活清单机制 | ✅ **能自己生成**（`wasm-dis` 读 import 段，1093 个符号） |
| 能不能跑起来 | ⚠️ **部分不行**：`.oct` 装载/调用、`accept-full` 20/20 都过，但**网络那一路（R5）挂了** |
| 本轮是否采纳 | ❌ **不采纳** —— 8761 保持 M1（P1 那版），M2 留档待续 |

## 二、走过的三条路（都实测过）

### 路 A：把 44 个 `.oct` 放主链命令行（文档设想的做法）

Emscripten **确实**会替我们生成保活集（`tools/link.py:2829-2881` 读每个 side module 的
import 段喂进 `SIDE_MODULE_IMPORTS`/`EXPORT_IF_DEFINED`）。链出来：
wasm 27,672,087 / js 474,656 —— 但**开页就死**：

```
[pageerror] Error: 404 : http://127.0.0.1:8764/__bfgsmin.oct
```

因为 Emscripten 把这些 `.oct` 记成了**要在启动时加载的 dylib**（`loadDylibs`）。
后果有三条，都不能接受：① 44 个 `.oct` 全变成**非懒加载**（1.3MB 进首包）；
② 站点根目录得摆 44 个 `.oct`；③ 与 Octave 自己那套 dlopen 并存，语义混乱。

### 路 B：自己生成保活清单（**这条成功了**）

```
wasm-dis <每个 .oct> | grep import          # 1093 个导入符号（含 GOT.mem/GOT.func）
剔除 8 个加载器机制/JS 库符号后剩 1085 个
→ -Wl,--export-if-defined=<每个>            # 用 if-defined：未定义也不报错
→ -s MAIN_MODULE=2
```
结果：wasm **27,726,775** / js **339,118**（比路 A 的 js 还小 —— 没有 dylib 记录）。
**开页正常**，`accept-full` **20/20**（含 `.oct` 的 dlopen 装载与真调用 `dldprobe()=42`）。

> 顺带记一条**文档更正**：`CLIBS.md` 说"从 `.oct` 的 `dylink.0` 段读 imported symbols"——
> **错的**。实测 `dylink.0` 段只有 **7 字节**（不含符号名），导入符号在 **IMPORT 段**里，
> 而能读它的工具是 **`wasm-dis`**（Binaryen 自带）：`emnm -u` 读不出来（"no dynamic symbol
> table"）、`wasm-objdump` 在 o113 里**根本不存在**。

### 路 C：想补上 JS 库符号 —— **撞上第二道墙**

路 B 的构建在**网络**上挂：`accept-requirements` 的 **R5（urlread 系列）** 与
**二进制往返**两项失败（`accept-net` 整篇跑不出结果）。

根因（实测逐条确认）：

1. `webnet.cc` 那个 `.oct` 要导入的 `emscripten_run_script` **不是 wasm 导出**，
   而是 **JS 库函数**。
2. **M1 下所有 JS 库函数都对 side module 可见**（`tools/emscripten.py:868-884`：
   `if settings.MAIN_MODULE == 1: for f in library_symbols: …` 全塞进 JS 符号表）。
3. **M2 下只塞 `EXPORTED_FUNCTIONS + SIDE_MODULE_IMPORTS` 里的那些**。而
   `SIDE_MODULE_IMPORTS` 只有在 side module 上了主链命令行时才被填充（= 路 A，
   会把 dylib 拖成启动加载）；`EXPORTED_FUNCTIONS` 又**要求那个名字是真实的 wasm 导出**——
   实测直接报错：

   ```
   em++: error: undefined exported symbol: "__assert_fail"      [-Wundefined] [-Werror]
   em++: error: undefined exported symbol: "emscripten_run_script" [-Wundefined] [-Werror]
   ```

   （第一版把这三个名字写进 `EXTRA_LDFLAGS` 也没用 —— link-web.sh 后面那行
   `-s EXPORTED_FUNCTIONS='["_main"]'` 会**覆盖**它；本轮已给它开了正规口子
   `EXPORTED_FUNCS`。）

## 三、所以「下一步」应该是什么

差的就是**一件事**：让 M2 的 JS 胶水把 side module 需要的**JS 库函数**也暴露出来，
但**不要**触发 dylib 自动加载。可选做法（未实测，供下一轮挑）：

1. 读 `tools/link.py` 的 `process_dynamic_libs`，看 `DYLIBS`（启动要加载的清单）是在哪里
   从 `options.dylibs` 填的 —— 能否只取 `SIDE_MODULE_IMPORTS` 而清掉 `DYLIBS`
   （例如 `-s FAKE_DYLIBS=1` 挡掉整段？但那样保活集也没了）。
2. 或者：仍然自己生成保活清单（路 B），把 JS 库函数**改走别的暴露途径** ——
   例如给 `webnet.cc` 那条路换成纯 `.m`（像 webaudio/webaudiorec 那样走"队列 + 页面轮询"），
   彻底不需要 `emscripten_run_script`。**这条路更符合本项目的既定架构**（宿主层一律走资产车道），
   代价是重写 R5 的网络实现。
3. 或者：放弃 M2 的 1.81MB，接受 M1。

**本轮决定：不采纳，留档。** 产出与复现命令见下。

## 四、复现命令

```sh
# ① 生成保活清单（wasm-dis 是唯一的工具）
sudo docker exec o113 bash -lc '
for f in /src/octs-deployed/*.oct; do
  /emsdk/upstream/bin/wasm-dis "$f" 2>/dev/null | grep -oE "^ \(import \"(env|GOT\.mem|GOT\.func)\" \"[^\"]+\"" | sed -E "s/.*\"([^\"]+)\"$/\1/"
done | sort -u > /src/libwork/imports-all.txt'

# ② 用 --export-if-defined 喂主链（剔除 8 个机制/JS 库符号）
sudo docker exec o113 bash -lc 'cd /src/bin
NAMES=$(grep -vE "^(memory|__indirect_function_table|__stack_pointer|__memory_base|__table_base|emscripten_run_script|exit|__assert_fail)$" /src/libwork/imports-all.txt)
FLAGS=""; for n in $NAMES; do FLAGS="$FLAGS -Wl,--export-if-defined=$n"; done
PATH=/src/bin:$PATH M_SRC=/src/work/m-prerendered/m EXPORTED_FUNCS="_main,emscripten_run_script,exit" \
  EXTRA_LDFLAGS="-s MAIN_MODULE=2 $FLAGS" bash link-web.sh /src/websrc/m2d-out'
# 期望：这一步现在会以 `undefined exported symbol: "emscripten_run_script"` 失败
#（本文第三节第二道墙）；把 EXPORTED_FUNCS 退回 "_main" 就能链出来，但网络那一路会挂。

# ③ 路 A（Emscripten 自动保活）——能链出来但开页 404，留档：
#    EXTRA_LDFLAGS="-s MAIN_MODULE=2 /src/octs-deployed/*.oct"
```

**产物留档**（都在 o113 里）：`/src/websrc/m2b-out`（路 B，27.73MB，网络挂）、
`/src/websrc/m2out`（路 A，27.67MB，开页 404）、`/src/websrc/m2d-out`（未链成）。
