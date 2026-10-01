# 34: `rebuild w64` 建出的树**链不出可校验的模块**（现役 9/28 产物却过得了）

**What to build:** 把 `relink.sh rebuild w64` 的树与官方车道脚本 `build-w64-lane.sh:stage_tree`
的树做成**等价**，或者把差异找出来钉成判据。

**Blocked by:** None（A/B 实验在跑）

**Status:** resolved（2026-10-01，根因确认并修掉；链路验证见"结论"）

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

## 结论（2026-10-01）：根因是 **`F2C_PREFIX` 没跟车道走** ⇒ Fortran 隐藏长度的类型分叉

**一行可复跑的证据**（wasm64 下解析两份 `f2c.h`）：

```bash
SHIM=/src/libwork/lane-shim-w64
for p in /usr/local /usr/local-w64; do
  PATH=$SHIM:$PATH emcc -pthread -sMEMORY64=1 -E -I$p/include -x c - <<< '#include "f2c.h"' \
    | grep -E "^typedef .* (ftnlen|integer|logical);" | head -4
done
# /usr/local      → typedef int integer; typedef int logical; typedef long int ftnlen;   ← i64
# /usr/local-w64  → typedef int integer; typedef int logical; typedef int ftnlen;        ← i32
```

`emf77` 用 `F2C_PREFIX`（默认 `/usr/local`）取 `f2c.h`。于是：

- **树里的 Fortran**（走默认前缀）把隐藏长度编成 **i64**；
- **车道的 refblas/lapack**（`build-deps.sh` 用 `F2C_PREFIX=/usr/local-w64` 建的）编成 **i32**；
- 两边一遇上就是 `(i64×15) -> i32` vs `(i64×13, i32, i32) -> i32` —— 实测里 26 条，
  wasm-ld 容忍（只 warning）、**wasm-opt 的校验器不容忍**（`call param types must match`）。

wasm32 之所以一直没露馅：32 位下 `long` 就是 32 位，**两种定义宽度相同**（i32）⇒ 分叉不可见。
9/28 那次 w64 能成，是因为当时环境里带着车道的 `F2C_PREFIX`（而 `relink.sh rebuild` 与
`build-w64-lane.sh:stage_tree` **都没设**）—— 又一条"前置只活在操作员环境/车道脚本里"。

**修法**：树构建入口把**车道的 f2c 前缀** export 出去（`F2C_PREFIX="$DEPS"`，且必须
**export** 而不是只传给 configure —— emf77 是在 **make** 阶段被调的）；自证里加了
"`rebuild w64` 必须打出 `F2C_PREFIX=/usr/local-w64`"（relink 自证 15 → 16/0）。
