# 34: `rebuild w64` 建出的树**链不出可校验的模块**（现役 9/28 产物却过得了）

**What to build:** 把 `relink.sh rebuild w64` 的树与官方车道脚本 `build-w64-lane.sh:stage_tree`
的树做成**等价**，或者把差异找出来钉成判据。

**Blocked by:** None（A/B 实验在跑）

**Status:** ready-for-agent

**Settling:** `bash relink.sh rebuild w64 --out <目录> --yes-rebuild` ⇒ 末尾 `verdict=ok`
**且**产物能过 wasm-opt 校验：
```bash
/emsdk/upstream/bin/wasm-opt $(<link-web.sh 里那串 --mvp-features…>) <产物>/octave.wasm -o /dev/null
```
反向断言（现状即反证）：今天的树链出来的模块**必须**在校验这一关红
（`call param types must match`，实测就是红）。
另一条可判的：`rebuild w64` 与 `build-w64-lane.sh tree` 两次建树后，
**同一份链接输入**产出的模块必须**逐字节相同**（现在不是）。

**Type:** research

## 实测（2026-10-01）

- **现役（9/28）`site-w64/w64/octave.wasm` 过校验**：同一串 `--mvp-features … --enable-memory64 …`
  下 `wasm-opt … -o /dev/null` ⇒ 通过（"no passes specified, not doing any work" 后退出 0）。
- **今天 `relink.sh rebuild w64` 的产物不过**：wasm-ld 写出 38,568,894 B 的模块，
  然后 wasm-opt 的校验器报
  `[wasm-validator error in function 27422] call param types must match, on argument 3` ⇒ `Fatal: error validating input`。
- **链接输入与 9/28 逐字节相同**（所以差异只能在**树对象**）：
  · `link-web.sh` sha `a04488c9625cde86`（仓库 / 容器 / 产物记录三处一致）
  · emcc `5.0.7 (263db4cffa6f9fc2ec514a70abac81362ea41849)`（一致）
  · `keep-w64.txt` sha `3eb11d42c6495d4f`（一致）
  · BLAS：`/src/deps-w64/lapack-simd/lib/librefblas.a` `46665dbd0121ec23…`、`liblapack.a` `3a00f2e9d52ac96f…`（与产物 `inputs.blas` 记录一致）
- 链接里有 **26 条 `function signature mismatch` 警告**（`dgemm_` / `sgemm_` / `zgemv_` /
  `zlange_` / `clange_` / `ilaenv_` / `slange_` / `xstopx_` …）—— 正是 f2c ABI 那一族
  （E2 的 f77 包装就是为它而生的）。wasm-ld 容忍它们，wasm-opt 的校验器不容忍。

## 下一步实验（在跑）

`build-w64-lane.sh tree`（官方车道脚本那条路）建同一棵树，然后用**同一份** E2 库链 w64：
- 若**过** ⇒ 差异确认在 `rebuild` 的配置里，逐条比配方；已发现的差异候选：
  `rebuild` 传 `WITH_GL2PS=1`（车道脚本**不传**）；车道脚本传 `SKIP=`（空，等价于不传）。
- 若**也不过** ⇒ 是环境/依赖侧的漂移（不是入口的锅），另查（emcc/emsdk 未变 ⇒ 可能在某份 `.a` 的
  重编上，虽然 sha 相同……那就得看树对象的目标特性了）。
