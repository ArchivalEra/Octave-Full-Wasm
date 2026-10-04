# 62: **全量 clean rebuild 的 ABI 分叉**——供给树全新编译 55 条 signature mismatch（发运批仅 1 条），wasm-opt 拒收

**What to build:** 仓库架构批 B5（上游 fork 供给 + 等价性验证）实测：`wasm/11.3.0` 供给树
configure 与现役树**逐字节一致**（41b75ca6a2fd）、F77=emf77、F2C_PREFIX=/usr/local-w64 全对，
但全新 make 产出的树对象与 OpenBLAS 归档之间出现 **55 条 `function signature mismatch`**
（发运谱系仅 1 条且被 wasm-opt 容忍）⇒ wasm-opt 校验拒收（`relink-upstream-equiv.log`）。
**这不是供给机制的错**（供给/pin/witness 全部工作）——它暴露：**现役 w64 树的 .libs 是
10-01 时代增量构建的千层饼，全量 clean rebuild 无法复现其 ABI 混合**。仓库架构的升级 SOP
（上游更新 ⇒ 重编）被这个不可复现性阻断。

**Blocked by:** None

**Status:** ready-for-agent

**Settling:** `CCACHE_DISABLE=1` + 干净供给树重跑 rebuild w64（结算件 =
`OCT=<供给树> OCT_TREE=<供给树> relink.sh rebuild w64`，读
`w64-logs/relink-upstream-equiv2.log`）：mismatch 数 ⇒ 
- **≤1 且 wasm-opt 过** ⇒ 根因 = ccache 服务了旧旗标对象（构建缓存跨时代污染）⇒
  修法 = rebuild 入口强制 CCACHE_DISABLE=1（或 ccache 清洗），架构批 B5 补完；
- **仍 >1** ⇒ 根因 = 现役树相对分支树还有未收编的源码级手改（10-01 之后的直接编辑）⇒
  diff 现役树 vs wasm/11.3.0 分支的 .f/.cc 全集，把漂移补进 fork 分支再验。

**附注（已排除的假说）**：① configure 不符——两树逐字节同（41b75ca6a2fd）；
② `='-fPIC'` 裸行——pristine tarball 自带 3 处（潜伏、非本批引入）；③ F77/F2C_PREFIX
——日志证实 emf77 + /usr/local-w64 全对。
