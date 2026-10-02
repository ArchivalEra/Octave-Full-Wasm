**Type:** task
**Status:** resolved（2026-10-02 夜间批：三杠杆零采纳，现役 -O2 即甜点）
**Blocked by:** 01

## Question

**链接侧优化旗标实验**：LTO、wasm-opt 档位、-O3 vs 现役档、其他 emcc 5.0.7 未上的性能
旗标。每配置 relink + bench + 数值回归。产出：安全可用的旗标组 —— 且必须配一条
**从产物读出来**的自检（AGENTS 铁律：旗标"赋值了但没被引用"会静默失效，
先例 = JSPI 的 `grep WebAssembly.promising`）。

## 进度（2026-10-02 夜间批）

- **现状盘点**：主链接行 `em++ --bind` **没有显式 -O**；唯一 `-O2` 在 `EXC_FLAGS`
  （同喂 main.o 编译 + 链接行）⇒ 链接侧优化 = O2（wasm-opt 跟随）。旋钮：链接 -O3、LTO、后置 wasm-opt。
- **实验法**：容器内临时 sed 改字面量（不进 repo），重链到**全新 out 目录** → boot → bench →
  数值回归子集；赢了的才进受管辖模式表（同 MAXIMUM_MEMORY 的先例）。
  ⚠️ 跨实验状态：容器 link-web.sh 被实验改过 ⇒ 下一实验前必须先归位（或按赢家固化）。
- 基线（现役 3b0d5e2f）：matmul 0.006 / lu 0.018 / boot 1.2s / 30917770 字节。
- **06a（链接 -O3）**：进行中。流程小坑如实记：`&&` 链接在 `&` 前 ⇒ 整链后台化（AGENTS 明坑，
  又踩了一次）—— 已用 `tail -f --pid` 挂完成哨。

- **06a（链接 -O3）：❌ 不采纳**（三连实验，fail-closed 全程拦截，未上线）：
  · 首试：metadce 剥掉 6 个"只有 .oct 侧模块引用"的支撑符号
    （`__cpp_exception`/`__cxa_throw`/`__cxa_rethrow`/`fileno`/`memcmp`/`realloc`）⇒ 保活核对红。
  · +`-s REVERSE_DEPS=all`：救回 4 个，`memcmp`/`realloc` 仍被剥。
  · +`EXPORTED_FUNCS` 强制导出：反而**非单调倒退**（异常符号又缺 —— emcc 的 metadce
    图分析对 EXPORTED_FUNCTIONS 覆盖敏感）。
  · **结论**：链接级 -O3 与 MAIN_MODULE=2 + dlopen 的组合需要逐符号对抗 emcc 内部管线，
    成本/收益不成立（wasm 代码本体早已按 TU 编译优化，链接级 -O3 只动 glue 压缩与 wasm-opt 档位，
    预期收益本就是个位数 %）。转 06b（后置 wasm-opt，干净路径：wasm-opt 把导出当活性根，
    无 metadce 剥导出问题）。

- **06b（后置 wasm-opt -O3）：❌ 不采纳**：binaryen 129 校验器不认 `-fwasm-exceptions` 产物
  （`--enable-exception-handling` 不够）⇒ `--no-validation` 硬跑成功，**数值回归全绿**
  （oct 8/0、libs 17/0、ode15 29/0、slicot 25/0 —— 无校验优化也没伤正确性，如实记），
  但**体积 +315KB（+1%）**、速度噪声级（matmul 0.007 vs 0.006 略差、lu 0.017 vs 0.018 噪声内、
  svd 单项 -11% 不翻盘）。emcc 链接时已跑过 wasm-opt -O2，二次优化已优化代码 = 膨胀。
  复跑：`w64-logs/relink-w64-o3link*.log`；实验站 8856（site-w64-opt，sha b23be2ed…）。
- **06c（LTO）：进行中**（`-O2 -flto`；预建库无 bitcode ⇒ LTO 只覆盖 main.o/p5 + 链接期，
  本就是兼容性最小实验）。

- **06c（LTO `-O2 -flto`）：verdict=ok ✅ 但边际不采纳**。意外全绿（预建库无 bitcode ⇒
  metadce 图完好，与 06a 的 -O3 形成对照）。**交替 A/B ×2 轮**（8854 现役 vs 8857 LTO，
  `w64-logs/lto-ab-bench.log`）：五项里只有 **matmul 1000 复现 ~10% 优势**
  （0.056/0.059 → 0.052/0.048），matmul500/lu800/lu1500/svd 400 全持平，boot +0.2 s
  （1.2→1.4）。单项边际收益 vs 工具链复杂度 + 开机变慢 ⇒ **不采纳，留档待重复测量**。
- **结论**：三根链接侧杠杆全部试完，**无一采纳** —— 现役 `-O2` 链接管线就是 emcc 5.0.7
  （binaryen 129）在这套 MAIN_MODULE=2 + dlopen 架构上的甜点。旗标组的"安全集" = 现状；
  本票没有产生需要从产物读出的新旗标（这正是负结果的一部分：不加旗标就无须防"赋值未引用"）。
