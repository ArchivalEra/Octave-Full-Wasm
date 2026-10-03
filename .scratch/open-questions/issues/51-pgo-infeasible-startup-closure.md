# 51: **PGO 不可行判定 + 启动链方向收口**（LAPACK 拆分数字与阻塞）

**What to build:** 用户批准 PGO+LTO 探索（brotli 已由 EdgeOne 承担，撤销 A1）。本单 =
① PGO 可行性探针（生死门）；② 启动链懒加载方向的量化与可行性；③ 出口判定。

**Blocked by:** None

**Status:** resolved（2026-10-03：**PGO 不可行（工具链缺 profile 运行时，链接器硬错误为证）**；
LTO 维持票 06 否决；懒加载方向量化后**不立项**——收益首屏 -20% 对上"主→side 静态调用面"
大手术成本）

**Settling:** 复现 PGO 判定（三步，均在容器 o113）：
```sh
emcc -O2 -fprofile-instr-generate -sEXIT_RUNTIME=1 pgo-probe.c -o x.js   # 链接通过
LLVM_PROFILE_FILE=/tmp/t.profraw node x.js                               # 干净退出但无 profraw
emcc ... "-sEXPORTED_FUNCTIONS=_llvm_profile_write_file" ...             # wasm-ld: symbol not found
```
⇒ 第三步报 `symbol exported via --export not found: llvm_profile_write_file` 且
`find /emsdk -name "*profile*"` 为空 ⇒ 运行时缺失坐实。若未来 emsdk 带上了 runtime
（或装上 compiler-rt-wasm 构建），重跑三步：出 profraw ⇒ PGO 复活。

## Answer

（2026-10-03 结案。）

**① PGO：不可行。** 因果链完整：
- `-fprofile-instr-generate` 被接受、链接通过（38.5KB 探针 wasm）⇒ 插桩计数器在；
- `EXIT_RUNTIME=1` + `LLVM_PROFILE_FILE` 下干净退出**无 profraw**；
- `EXPORTED_FUNCTIONS=_llvm_profile_write_file` ⇒ **wasm-ld: symbol not found**；
- `find /emsdk -name "*profile*"` ⇒ **emsdk 5.0.7 全目录无 libclang_rt.profile***
  （sysroot/wasm32-emscripten 只有 crt1* 变体）。
⇒ 编译器给了插桩、**写盘运行时整个缺失**。补齐需自建 compiler-rt-profile-wasm
（工具链工程）或 JS 侧手写 profraw 序列化器——为一个 5–15% 的赌注，投入产出比崩塌。
**LTO** 维持票 06 否决（边际 + 票 41 事故）；PGO+LTO 组合随 PGO 死亡失效。

**② 启动链懒加载：量化完成，不立项。**
- 构成（归档字节数，wasm64 原件）：**liblapack.a 10.86MB**（单件最大 ≈ 产物 1/3）、
  e2 librefblas.a 3.33MB、f2c/pcre/refblas 等 deps 合计 11.7MB；产物 30.9MB 剥名
  （--strip-debug）⇒ 产物级按符号归账不可行，归档口径为准。
- **真阻塞**：emscripten dylink 只支持 **side→main** 导入；Octave 调 LAPACK 是**编译期
  静态调用**，拆成 side module 需把全部 BLAS/LAPACK 调用点改 GOT 间接（大手术）。
- 收益上限 = 首屏 wasm 30.9 → ~24MB（-22%）且**总下载不变**（LAPACK 教学场景必用）。
  收益/成本比对不过 ⇒ 记档。**重评条件**：emscripten 支持 main→side GOT 或 Octave 上游
  把 BLAS 调用面改成可注入。

**③ 新优化方向清单最终态**（每条都有数字/判决）：
| 方向 | 判决 | 出处 |
|---|---|---|
| brotli | ✅ EdgeOne 已开（用户确认） | 本单 |
| PGO | ⛔ 工具链缺运行时 | 本单 |
| LTO | ⛔ 边际+事故 | 票 06/41 |
| 懒加载 LAPACK | ⛔ 首屏 -20% vs 大手术 | 本单 |
| Rust/faer BLAS | ⛔ 内核输 1.6× | 票 49 |
| WGSL compute | ⛔ 无 f64 | 票 50 |
| DOM 挪 wasm | ⛔ 类别错误 | 票 48 |
| 几何画图通道 | ✅ 已立项（功能向） | 票 50 |
| 解释器重写 | ⛔ 放弃验收资产 | 票 46 判 |
