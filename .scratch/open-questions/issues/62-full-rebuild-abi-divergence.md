# 62: **全量 clean rebuild 的 ABI 分叉**——供给树全新编译 55 条 signature mismatch（发运批仅 1 条），wasm-opt 拒收

**What to build:** 仓库架构批 B5（上游 fork 供给 + 等价性验证）实测：`wasm/11.3.0` 供给树
configure 与现役树**逐字节一致**（41b75ca6a2fd）、F77=emf77、F2C_PREFIX=/usr/local-w64 全对，
但全新 make 产出的树对象与 OpenBLAS 归档之间出现 **55 条 `function signature mismatch`**
（发运谱系仅 1 条且被 wasm-opt 容忍）⇒ wasm-opt 校验拒收（`relink-upstream-equiv.log`）。
**这不是供给机制的错**（供给/pin/witness 全部工作）——它暴露：**现役 w64 树的 .libs 是
10-01 时代增量构建的千层饼，全量 clean rebuild 无法复现其 ABI 混合**。仓库架构的升级 SOP
（上游更新 ⇒ 重编）被这个不可复现性阻断。

**Blocked by:** None

**Status:** resolved （2026-10-05：ccache 假说被 equiv2 推翻（R-014）；真根因 =
`f77-fcn.h` 的 `F77_CHAR_ARG_LEN_TYPE` 未收编手改，已收编 fork `a5a7208`；
equiv3 确认供给树 rebuild 可复现——1 条容忍 mismatch + wasm-opt 绿 + `verdict=ok`）

**Settling:** `CCACHE_DISABLE=1` + 干净供给树重跑 rebuild w64 —— mismatch ≤1 且 wasm-opt 过 ⇒ ccache 假说成立；mismatch >1 ⇒ 源码级手改未收编。
`OCT=<供给树> OCT_TREE=<供给树> relink.sh rebuild w64`，读
`w64-logs/relink-upstream-equiv2.log`）：mismatch 数 ⇒ 
- **≤1 且 wasm-opt 过** ⇒ 根因 = ccache 服务了旧旗标对象（构建缓存跨时代污染）⇒
  修法 = rebuild 入口强制 CCACHE_DISABLE=1（或 ccache 清洗），架构批 B5 补完；
- **仍 >1** ⇒ 根因 = 现役树相对分支树还有未收编的源码级手改（10-01 之后的直接编辑）⇒
  diff 现役树 vs wasm/11.3.0 分支的 .f/.cc 全集，把漂移补进 fork 分支再验。

**附注（已排除的假说）**：① configure 不符——两树逐字节同（41b75ca6a2fd）；
② `='-fPIC'` 裸行——pristine tarball 自带 3 处（潜伏、非本批引入）；③ F77/F2C_PREFIX
——日志证实 emf77 + /usr/local-w64 全对。

## Answer

（2026-10-05 结案。结算件两轮重编，全程 `CCACHE_DISABLE=1`，产物落 `w64-equiv{2,3}-out`
实验目录，8761 一字未动；日志 `w64-logs/relink-upstream-equiv{2,3}.log`。）

- **equiv2（CCACHE_DISABLE 对照，6 分 31 秒）**：**53 条** `function signature mismatch`
  （B5 55 条，核心集合逐条相同），wasm-opt 仍拒收 ⇒ **第一分支（ccache 跨时代污染）
  被推翻**（retractions R-014），走第二分支。
- **真根因（两树源码全集 diff 仅一个文件）**：`liboctave/util/f77-fcn.h` 的
  `F77_CHAR_ARG_LEN_TYPE`——现役树有未记录手改（wasm64/LP64 ⇒ `int`），fork 没有。
  供给树的 C++ 调用方按 `long`(i64) 传 Fortran 隐藏字符串长度，而 /usr/local-w64 的
  f2c ABI（`ftnlen=int` i32，Sep-28 建造的 refblas/lapack 归档）按 i32 ⇒ 53 条
  c/z 复数族符号分叉。现役树手改后与归档一致（发运谱系仅 1 条被容忍）。
- **修法（按本单处方）**：收编进 fork `upstream/octave` `wasm/11.3.0` = 提交 **`a5a7208`**
  （+4 行守卫式，与现役树该段逐字节同）→ push → `provision-upstream.sh --only octave`
  重供给（印章 a5a7208/dirty=0）→ `witness-upstream-pin` ok。
- **equiv3（确认重编）**：mismatch **1 条（zdotu_，被 wasm-opt 容忍）**、wasm-opt
  零报错、`verdict=ok`（11 项声明全有实测背书）、`octave.wasm` sha `088aa6c31774fa8b…`。
  **供给树 rebuild 恢复可复现 ⇒ 上游升级 SOP 解锁**（emcc6 仍不立项，见 maintaince 方向）。
- **守护**：这类漂移今后由 `witness-upstream-pin.py` 拦（fork↔容器树每提交对章）；
  供给树是 pin 管辖物，改动只有 fork commit 一条路（过程插曲见 HISTORY §5.89）。
