**Type:** task
**Status:** open
**Blocked by:** 01

## Question

**链接侧优化旗标实验**：LTO、wasm-opt 档位、-O3 vs 现役档、其他 emcc 5.0.7 未上的性能
旗标。每配置 relink + bench + 数值回归。产出：安全可用的旗标组 —— 且必须配一条
**从产物读出来**的自检（AGENTS 铁律：旗标"赋值了但没被引用"会静默失效，
先例 = JSPI 的 `grep WebAssembly.promising`）。
