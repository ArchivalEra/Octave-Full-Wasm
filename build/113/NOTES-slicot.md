# NOTES · SLICOT（control 包）探针结果：**根因被更正，且比文档写的复杂一档**

> 2026-09-22。计划里 P3 写的是"先探针，能过就修"。**探针做完了，结论有三条**，
> 其中第一条推翻了文档里记的根因，第三条给出了确切的工作量。全部有实测。
>
> **2026-09-23 续：第四节那个"CHARACTER 隐藏长度参数"卡点已经修掉了**（对齐脚本 + 零警告重链），
> 修完之后又露出**两层新的卡点**，见文末**第五节**（含"step 已经出真值"这条好消息）。

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

---

## 五、2026-09-23 续：第四节那个卡点**已修好**，然后又露出两层新卡点

### 5.1 冲突面被精确量化（原来只知道"约 47 个候选符号"）

工具：**`build/113/fix-slicot-abi.py`**。它把两边的元数逐个对比：

* 包装器侧：`sl_*.cc` 里手写的 `F77_FUNC (name, NAME) (…)` 声明（**注意要跳过同名的"调用"**，
  否则会把调用当成声明——第一版脚本就踩了这个，`nchar` 全变 0）；
* f2c 侧：`/src/libwork/f2c-probe/*.P` 里 `extern <ret> name_(…)` 的原型。

实测结果（`--check`）：

| | 数量 |
|---|---|
| TU 内声明（47 个 `sl_*.cc` 被调度模块 `#include` 成一个 TU） | **51 处 / 48 个符号** |
| 本来就一致 | 14 |
| 需要补尾部参数 | 37 处（含 3 处重复声明） |
| 返回类型要改 | 1（`ab13ad`） |
| 违反"Δ == CHARACTER 个数"这条规则的 | **0** |

* **Δ 完全等于该声明里 CHARACTER 形参的个数**（`ab08nd` +1、`dggev` +2、`sb02rd` +9…）——
  f2c 给每个 CHARACTER 形参补一个尾部 `ftnlen`，包装器一个都没写。
* 包装器里**所有** CHARACTER 参数都是 `char&`（指向单字符，不是字符串）
  ⇒ 隐藏长度**恒为 1** 是正确的，脚本里对此有硬自检（见到 `char*` 就拒绝改）。
* **返回类型**：`ab13ad` 声明成 `int`，而 `AB13AD.f:1` 是 `DOUBLE PRECISION FUNCTION AB13AD`
  （返回 Hankel 范数）。包装器只用 `F77_XFCN (ab13ad, AB13AD, (…));` 一句话调用
  （`f77-fcn.h:45` 的宏展开就是 `F77_FUNC(f,F) args`，**裸调用语句、返回值被丢弃**），
  所以改成 `double` 语义不变 —— wasm 的 `call` 做精确类型检查，i32 结果 vs f64 结果是硬分歧。
  `ab13bd` 那处是**虚警**（`doublereal` 就是 f2c 的 `double`，脚本做拼写归一）。

### 5.2 做法：只补**声明**、给尾部参数**默认值 1**（调用点一个字都不改）

```cpp
int F77_FUNC (ab08nd, AB08ND) (…, F77_INT& INFO, F77_INT ab08nd_len1 = 1);
//                                                 ^^^^^^^^^^^^^^^^^^^^^^^ C++ 默认实参
```

两条 C++ 规则同时管着这事（都实测踩过）：
1. 同一函数的**多次声明参数类型必须一致** ⇒ 每一处都要补同样多的尾部参数；
2. 默认实参**只能出现在一处** ⇒ 只有 **include 顺序里的第一处**写 `= 1`，
   其余写成不带默认值的形参。第一版只补第一处 → `error: conflicting types for 'dggev_'`。

`dggev_`（唯一不在 SLICOT 归档里的、由**主模块**提供的 LAPACK 符号）的真实元数是从
`/usr/local/lib/liblapack.a` 的 `dggev.o` 反汇编读到的 **19**（该 .o 里唯一的函数定义就是
19 个 i32 参数；旁证：同 .o 导入的 `lsame_` 是 4 参、`dlamch_` 是 2 参，都是 f2c 口径）。

**结果**：`build-oct.sh --cc` 链接**零警告零错误**，产物 2.98MB。
脚本幂等（第二次跑报"已打过补丁 37 处、需补 0 处"）。

### 5.3 新卡点 ①：主模块**没有把 LAPACK/BLAS 导出**（`.oct` 调用落到 stub）

修完签名后装载没问题，但一调就报（浏览器实测）：

```
TypeError: resolved is not a function
    at stubs.<computed> (octave.js:1:109106)
```

这是 emscripten 动态链接器的 stub —— **导入解析不到就是它**。实测（解析主 wasm 的导出段）：

| | |
|---|---|
| 主 wasm 函数总数 | 50533 |
| **导出**总数 | **44738**（`malloc`/`deflate`/34547 个 C++ 名都在） |
| `dgemm_` / `dgetrf_` / `dggev_` / `dlamch_` / `lsame_` | **都不在导出表里** |
| 162 个 Fortran 风格导出名 | 只有 libf2c 的 `xerbla_`/`xstopx_`、qrupdate、ARPACK、glpk |

`link-web.sh` 里早就记过同一类教训（zlib 那条）：**"既不在主模块里、也不在导出表里"**。

> ⚠️ **判据上的一个坑（差点误判）**：主 wasm **根本没有 name 段**（只有 `dylink.0`），
> 所以 `emnm` 读到的 44737 个名字**就是导出段**，不是"所有符号"。未导出的函数连名字都不存在。
> 另外 `comm` 比对前必须 `LC_ALL=C sort`，否则 Python 的码点序与 shell 的 locale 序不一致，会出一堆假缺口。

### 5.4 做法（走用户拍板的"重编 LAPACK"路线）：让 `.oct` **自包含**

与 `__ode15__` 内嵌 SUNDIALS 同型：**主 wasm 一个字节都不动**。
新脚本 **`build/113/rebuild-pic-blas.sh`**：重编 Fortran 三库带 `-fPIC`，
输出到**独立 prefix `/src/deps/lapack-pic/`**（**绝不覆盖 `/usr/local`** —— 主链还在用那份）。

| 库 | 为什么必须 PIC | 结果 |
|---|---|---|
| librefblas / liblapack | side module 必须 PIC，非 PIC 报 `R_WASM_MEMORY_ADDR_SLEB … recompile with -fPIC` | 149 + 1660 个 `.f`，30 个被 f2c 拒编（与原构建同一上限） |
| **libf2c** | `.oct` 里 f2c 产物要调 `pow_di`/`s_cmp`/`do_fio`… 而主模块**只导出了其中 3 个** | 1404 个符号 |

**实测耗时约 65 秒**（并行 + ccache 吃掉重复部分），比预想便宜得多。

还有两个**非 LAPACK** 的缺口，都是"控制包自己/Octave 自己"的：
* `_Z3maxii`/`_Z3minii`/`_Z9error_msg…`/`_Z11warning_msg…` —— 控制包 `common.h` 声明、
  **`common.cc` 定义**，而调度模块只 `#include` 了 `sl_*.cc`，**没编 common.cc**。
  ⇒ 单独编成 `common.oct.o` 一起链进去。
* `blas_*_x__`（Octave 自己的 `blas-xtra` 包装）—— 见 5.6 的候选路线。

### 5.5 ★ 好消息：`step` 已经出**真数值**（精确）

用 `oct-b-lapack.oct`（8.10MB = ABI 对齐 + `slicotlibrary` + `common.o` + PIC LAPACK/BLAS）
在 staging 8762 上实测：

```
ss(-1,1,1,0)            → a = -1, c = 1（真对象）
class(ss(-1,1,1,0))     → ss
pole(tf(1,[1 1]))       → -1
step(ss(-1,1,1,0), 0:0.5:2) → 0  0.3935  0.6321  0.7769  0.8647
```
后者的解析解是 `1-exp(-t)`：`0 / 0.39347 / 0.63212 / 0.77687 / 0.86466` —— **逐位吻合**。
（在此之前 `ss`/`step` 是**整页崩**。）

### 5.6 当前卡点（就停在这里，留给下一次）

把 **PIC libf2c** 也链进去（`oct-c-lapack-f2c.oct`，8.16MB）之后，**装载期**就失败了：

```
could not load dynamic lib: …/__sl_td04ad__.oct
TypeError: Cannot read properties of undefined (reading 'value')
```

而且**会连累同一页后续的 dlopen**（`is_real_matrix.oct` 也跟着报同一句）。
**线索（已比对 dylink.0 MEM_INFO）**：

| 产物 | MEM_INFO |
|---|---|
| oct-a（2.98MB，能装载） | `tableSize=0 tableAlign=0` |
| oct-b（8.10MB，能装载） | `tableSize=0 tableAlign=0` |
| **oct-c（8.16MB，装载失败）** | **`tableSize=13 tableAlign=0`** |

⇒ libf2c 带进了**模块自己的表条目**，而 emscripten 的加载器
（`octave.js` 里 `loadModule()`：`tableBase = metadata.tableSize ? wasmTable.length : 0;`
`if(metadata.tableSize){wasmTable.grow(metadata.tableSize)}`）在 `tableSize>0` 那条路上出问题。

**下一次的三条候选路线**（按代价排序）：

1. **只链 libf2c 里真正要用的那几个目标文件**（缺的符号就 40 来个：
   `pow_di/s_cmp/s_copy/do_fio/e_wsfe/f_open/i_len/d_sign/d_lg10/c_abs/z_div…`），
   而不是整库 1404 个符号 —— 很可能就绕开那个"模块自己的表"。
2. **改成"主链导出"路线**（`link-web.sh` 的口子已经加好：`EXPORT_IF_DEFINED="…"`
   → `-Wl,--export-if-defined=<sym>`；注意 **`-s EXPORT_IF_DEFINED=` 是内部设置、命令行会被拒**）。
   把 libf2c 缺的那批 + `blas_*_x__` 一起导出，`.oct` 就回到 oct-b 的形态（能装载）+ 补上缺符号。
3. 弄清 `tableSize=13` 到底该不该出现在 side module 里（可能要在链接行上做文章，
   比如让间接调用全部走主模块的表）。

诊断手段（本轮新加、可复用）：给 staging 的 `octave.js` 打一句补丁，
让 stub 把**缺失符号名**打出来 —— 这是本轮唯一能拿到符号名的办法：

```js
// 原：stubs[prop]=(...args)=>{resolved||=resolveSymbol(prop);return resolved(...args)}
stubs[prop]=(...args)=>{resolved||=resolveSymbol(prop);
  if(typeof resolved!=="function"){console.error("MISSING-OCT-SYMBOL: "+prop);
    var _m="MISSING-OCT-SYMBOL: "+prop;resolved=()=>{throw new Error(_m)}}
  return resolved(...args)}
```
（`site113/octave.js` 的原始副本留了 `octave.js.orig`。**注意**：`norm` 报的是
`MISSING-OCT-SYMBOL: pow_di`，而 `pow_di` 只有 libf2c 有 —— 这就是 5.6 的来由。）

### 5.7 产物留档（断电前落盘）

`/mnt/hdd/octave-wasm-build/slicot-fix/`：`oct-a-abi-only.oct`(2.98MB)、
`oct-b-lapack.oct`(8.10MB)、`oct-c-lapack-f2c.oct`(8.16MB) + `README.txt`（复现命令）。
容器检查点：`octave-build:113-slicot-abi`。
