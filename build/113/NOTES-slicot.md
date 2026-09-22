# NOTES · SLICOT（control 包）探针结果：**根因被更正，且比文档写的复杂一档**

> 2026-09-22。计划里 P3 写的是"先探针，能过就修"。**探针做完了，结论有三条**，
> 其中第一条推翻了文档里记的根因，第三条给出了确切的工作量。全部有实测。

## 一、先说结论

| 问题 | 文档里的说法 | **实测更正** |
|---|---|---|
| 为什么 `ss`/`step`/`tf2ss` 崩 | "side module 引用主模块 Fortran 符号时**签名不匹配**" | **错**：那些符号**根本不存在**（库从未编过）—— 主 wasm 里 48 个 SLICOT 例程**定义了 0 个** |
| `slicotlibrary.a` | （未提） | **从未编过**；本次**编出来了**（f2c + emcc 全绿） |
| 现在卡在哪 | "先做静态注册最小实验" | **静态注册救不了**；卡在一个**真实的 ABI 分歧**上（见第四节），且**与 side/static 无关** |

## 二、探针 ①：`sl_*.oct` 引用的 Fortran 符号在主 wasm 里**定义了 0 个**

`__control_slicot_functions__.oct`（调度模块，280KB，只含包装器）的导入表里，
以 `_` 结尾的 Fortran 例程共 **48 个**（`ab01od_`…`td04ad_`）。逐个到主 wasm 的符号表里查：

```
主 wasm 里有定义: 0 ；没有定义: 48
```

⇒ **不是"签名不匹配"，是"根本没有"**。真要调用，当然落到空导入 → 整页崩。
（文档里那句 `function signature mismatch: zdotu_` 的警告是**另一件事**：
libqrupdate 与 librefblas 对 `zdotu_` 的签名本来就不同，与本项无关。）

## 三、探针 ②：SLICOT 的 Fortran **能编**（这是最大的未知，答案是"能"）

把 control 包里的 SLICOT Fortran 全量过一遍（611 个 `slicot/src/*.f` + `TB01ZD.f`
+ `TG04BX.f` + `src_aux/dgegs.f`）：

| 步骤 | 结果 |
|---|---|
| `f2c -P`（.f → .c） | **614 / 614 成功，0 失败** |
| `emcc -O1 -fPIC -fwasm-exceptions -I/usr/local/include -w -c` | **613 / 613 成功，0 失败** |
| `emar rcs slicotlibrary.a *.o` | **5,019,126 字节 / 613 个目标文件** |
| 关键符号自检（`emnm`） | `td04ad_` / `ab01od_` / `ib01ad_` / `tb01id_` **全部 T（已定义）** |

⇒ "f2c 扛不住 SLICOT"这个担心**不成立**。库本身没问题。

## 四、探针 ③：真正卡住的是**CHARACTER 隐藏长度参数**造成的 ABI 分歧

把库静态打进调度模块（`build-oct.sh --cc` + `OCT_LIBS=slicotlibrary.a`）后，`wasm-ld` 拒绝：

```
wasm-ld: error: function signature mismatch: dggev_
>>> defined as (i32 ×17) -> i32 in __control_slicot_functions__.oct.o
>>> defined as (i32 ×19) -> i32 in slicotlibrary.a(AB13DD.o)
```

**17 vs 19 的差不是笔误，是两类声明对"Fortran CHARACTER 长度怎么传"的约定不同**：

- `sl_ab08nd.cc:53` / `sl_ag08bd.cc:53`（**控制包手写的**）：
  `int F77_FUNC (dggev, DGGEV) (char*, char*, …)` —— LAPACK 原样的 **17 参**，
  **没有**那两个隐藏的 `ftnlen`。
- 我们 f2c 生成的 `AB13DD.c:81`：`dggev_(char *, char *, …)` —— **19 参**，
  f2c 按惯例给 CHARACTER*1 补了两个 `ftnlen`。

原生构建里这两者能"跑"，原因是**原生链接器不做类型检查**，而且 LAPACK 对
`JOBVL`/`JOBVR` 的长度参数通常用不到（`lsame` 只比较首字符）—— **碰巧而已**。
**wasm-ld 做精确类型检查**，于是这个长期潜伏的不一致第一次变成硬错误。
（与 HANDOFF §10.3 坑 13 / `patch-odepack-callback-arity.sh` 同一类问题的**另一个实例**：
那次是实参个数 4 vs 5，这次是隐藏长度参数。）

**冲突面（粗查）**：调度模块 TU 的未定义符号 125 个，其中**归档也有定义的 47 个** ——
也就是说最多可能有 ~47 个符号存在同类分歧（不是每个都会冲突，但得逐个过）。

## 五、所以"下一步"应该是什么（结论 / 建议）

**不是**重加 `STATIC_DLD_FCNS`（那解决的是"装载路径"，而这里的错误发生在**链接期**，
static 与 side 都会撞同一堵墙；`CLIBS.md` 当年那句"静态注册那条路不受影响"就本项而言**不成立**）。

真正的做法（按代价排序）：

1. **统一 Fortran 声明口径**：把控制包里手写的 `F77_FUNC(...)` 声明补上隐藏长度参数
   （或反过来抑制 f2c 的 —— 但 f2c 侧是 47 个包装器全要动，前者只在冲突处动）。
   逐个冲突修、逐个重链 —— 与 `patch-odepack-callback-arity.sh` 同型的做法，
   可以写成一个幂等补丁脚本。
2. 修完再验 `ss`/`step`/`tf2ss` 的**数值**（`accept-forge2.mjs` 那两条"未发布"护栏要改成正向断言）。
3. 库体积：`.oct` 会因为内嵌 5MB 的 `slicotlibrary.a` 而变大（懒加载资产，可接受，
   与 `__ode15__` 内嵌 SUNDIALS 同理）。

**工作量诚实估**：这不是"半小时的小实验"，而是 **1–3 天的逐步对齐 + 数值验证**
（47 个候选符号 × 逐个重链），且中途可能冒出新的分歧类型。
**本轮到此为止并如实记录**：探针的三个目标（证实/证伪根因、量 f2c 可行性、找到确切卡点）**都达成了**，
本项从"原因不明的崩溃"变成了"位置精确、做法明确的待办"。

## 六、复现命令

```sh
# ① 符号存在性
sudo docker cp /mnt/hdd/octave-wasm-build/control-oct-holdback/__control_slicot_functions__.oct o113:/src/slicot-probe/
sudo docker exec o113 /emsdk/upstream/bin/wasm-dis /src/slicot-probe/__control_slicot_functions__.oct | grep -oE '^ \(import "env" "[a-z0-9_]+"' 
sudo docker exec o113 emnm -g /src/websrc/out/octave.wasm | ...   # 逐个查定义

# ② 编库（本次已编好：/src/libwork/slicotlibrary.a）
cd /src/libwork/f2c-probe && for f in $SRC/slicot/src/*.f $SRC/*.f $SRC/src_aux/*.f; do f2c -P "$f"; done
for c in *.c; do emcc -O1 -fPIC -fwasm-exceptions -I/usr/local/include -w -c "$c" -o "obj/${c%.c}.o"; done
emar rcs /src/libwork/slicotlibrary.a obj/*.o

# ③ 静态打进调度模块（这一步现在会以 signature mismatch 失败 —— 就是本文第四节）
OUT=/src/octs-slicot OCT_INCS="-I$SRC" OCT_LIBS=/src/libwork/slicotlibrary.a \
  CC_SRCS="__control_slicot_functions__:$SRC/__control_slicot_functions__.cc" \
  bash /src/bin/build-oct.sh --cc
```
