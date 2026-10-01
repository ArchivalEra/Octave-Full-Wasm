# 32: `rebuild <车道>` 缺三条**车道前置**（依赖 / 线程开关 / 目标三元组）—— 全是"只在车道脚本里"的口径

**What to build:** `bash relink.sh rebuild w64 --yes-rebuild` 在容器里跑不起来：
configure 第①步就死（`configure: error: linking to Fortran libraries from C fails`）。

**Blocked by:** None

**Status:** resolved（2026-10-01，本批修掉，带自证）

**Settling:** `bash build/113/relink.sh --selftest` ⇒ 13 PASS / 0 fail（新增的两条：
「rebuild w64 从模式表取车道依赖」+「`explain w64` 的 E2 钩子」）。
反向断言：`rebuild w64` 在 `--yes-rebuild` 缺席时的输出里**必须**出现
`DEPS=/usr/local-w64 … TARGET_HOST=wasm64-unknown-emscripten`（没有它就是这条又烂回去了）。

**Type:** task

## 根因（实测）

`configure-113-full.sh` 吃三个环境：`DEPS`（f2c/refblas/lapack/pcre2 的 prefix）、
`D`（其余库的 deps root）、`TARGET_HOST`（`--host`）。而 `relink.sh rebuild` **只传**
`WITH_OPENGL/WITH_GL2PS/WITH_FREETYPE/WITH_FONTCONFIG/WITH_THREADS` 与 install 前缀
（工单 28 补的那个）⇒ `DEPS` 落回默认 `/usr/local`、`D` 落回 `/src/deps`（都是 **wasm32 farm**），
而编译器已被车道影子加成 `-pthread -sMEMORY64=1` ⇒ Fortran 自检链接 **架构错配**，当场失败。

同样的口径在**官方车道树构建脚本**里是对的（`build-w64-lane.sh:stage_tree`：
`DEPS="$PREFIX_W64" D="$DEPS_W64" TARGET_HOST=wasm64-unknown-emscripten`）——
即"这条前置只活在车道脚本里、受管辖入口没有"的老形状（与工单 26/28 同族）。

## 修法（口径搬进入口）

`cmd_rebuild` 从**模式表**取 `DEPS` / `DEPS_ROOT`（不另抄一份），按模式定 `TARGET_HOST`，
并把这一行**在 `--yes-rebuild` 闸之前**打出来（操作员下决心前就该看见会用什么依赖，
自证也靠这一行）。

## 踩到的第二个坑（同一行代码里）

第一版写 `${_droot:+D="$_droot"}` —— 展开结果是**一个词**（带引号），shell 把
`D=/src/deps-w64` 当命令执行（`No such file or directory`）。赋值只能逐个写死：
`DEPS="$_deps" D="${_droot:-/src/deps}" TARGET_HOST="$_thost"`。

## 第二处（同日实测）：`WITH_THREADS` 对 `w64` 也算错

修完依赖后第一次重编跑到了链接，死在 **wasm-opt 的类型校验**：

```
[wasm-validator error in function 27422] call param types must match, on (on argument 3)
Fatal: error validating input
```

根因：`cmd_rebuild` 里线程开关写的是 `[ "$m" = threads ] && th=1 || th=0` ——
**`w64` 是 memory64 + **pthread** 车道**（declared.threads=true），却被配成 `WITH_THREADS=0`，
同时编译器又被车道影子加上 `-pthread` ⇒ 树自相矛盾（configure 的 AX_PTHREAD 覆盖与
`--enable-threads` 都没开），那批**本来被容忍的 f2c ABI 不匹配**（`dgemm_`/`sgemm_`/`zlange_`…
26 条 `function signature mismatch` 警告）就在 wasm-opt 这一关硬炸。
官方车道脚本里是对的（`build-w64-lane.sh:stage_tree` 传 `WITH_THREADS=1`）——
仍是同一条形状。修法：`case "$m" in threads|w64) _th=1; *) _th=0`（**w64-base 保持 0**，它是单线程回退档），
并加两条反向自证（w64 ⇒ 1；w64-base ⇒ 0）。
