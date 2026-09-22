# 闸门③ 未通过：11.3.0 的 wasm 是「共享内存（pthread）」构建

## ✅ 已解决（2026-09-22）—— 下面保留为「当时的分析与问题单」

**解法**（由外部审查指出，已实测通过）：把两件事**解耦**——
「有没有 `pthread.h`」保持 **yes**（gnulib 于是不生成替代头，patch 0010 不用碰），
只让 `AX_PTHREAD` 在 emscripten 下**不生效**。

实现：`build/113/patch-ax-pthread.sh` 在生成的 `configure` 里、
`AX_PTHREAD` 展开块的 ACTION-IF-FOUND 判定之前，对**每一处展开**（实测 2 处）
插入 `case $host in *-emscripten*) ax_pthread_ok=no; PTHREAD_CFLAGS=""; PTHREAD_LIBS="";; esac`。
（注意 release tarball 里 `configure` 是预生成的，只改 `configure.ac` 不生效。）

**实测结果**：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `BUILD_CFLAGS` | `-O2 -fPIC -pthread -fwasm-exceptions` | `-O2 -fPIC -fwasm-exceptions`（**无 -pthread**） |
| `PTHREAD_CFLAGS` / `PTHREAD_LIBS` | `-pthread` / `-lpthread` | **空** |
| `HAVE_PTHREAD_H` | 1 | **1（保持不变）** |
| 胶水 `shared:true` | 1 | **0** |
| wasm 内存 | shared（由 JS 提供） | `limits_flags=0x1` → **非 shared** |
| worker 文件 | — | **无** |
| 数值回归 | — | `x=2 1`、`det=5`、`svd=5.398345638`、`eig=5`，**与本机 11.3.0 逐位一致** |

**三道闸门现全部通过。** 本文余下部分保留作为分析与问题单的存档。

---

> 2026-09-22。给外部（GPT）看的问题单 + 我们已试过的记录。
> 结论先说：**闸门① 与 闸门② 都过了**；**闸门③（不引入 COI/SharedArrayBuffer）没过**，
> 根因已定位，但按「不死磕」的约定停在这里，把问题交出去。

---

## 一、目标与约束

把 GNU Octave **11.3.0** 编成浏览器可用的 wasm（本项目第四轮，从 7.2 换基线）。

约束（决定闸门③为何是硬要求）：
- 交付形态是**纯静态托管**的站点（页面 + octave.js/wasm/data + 懒加载资产），
  **服务端零计算**；
- 现有托管环境（EdgeOne）**没有 COOP/COEP 响应头**，而浏览器要
  `SharedArrayBuffer` 就必须 `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp`（即 cross-origin isolation）。
- 所以「产物必须不依赖 SharedArrayBuffer」是本项目的硬约束。

## 二、已经过的两道闸门（都有实测证据）

| 闸门 | 结果 | 证据 |
|---|---|---|
| ① configure + make 通过；数值正确 | ✅ | `octave-cli.wasm` 27.5 MB；`A\b` 得 `x=2 1`、`det=5`、`svd=5.398345638`，与**本机 11.3.0 逐位一致** |
| ② `.oct` 车道在新 emsdk 上可行 | ✅ | 自写探针（`build/113/probe-side-module.sh`）：主模块 `-sMAIN_MODULE=1 -sALLOW_TABLE_GROWTH=1` + side 模块 `-sSIDE_MODULE=1 -fPIC -shared`，node 里 dlopen→dlsym→回调主模块，得 **43** |
| ③ 不引入 COI/SharedArrayBuffer | ❌ | 见下 |

## 三、闸门③ 的确切现象

产物 `octave-cli.wasm` 的内存是 **imported**（由 JS 提供），胶水里是：

```js
wasmMemory = new WebAssembly.Memory ({ initial: …, maximum: …, shared: true })
```

`shared:true` ⇒ 浏览器必须 cross-origin isolated ⇒ 需要 COOP/COEP ⇒ 与静态托管前提冲突。

**对照实验（说明这不是 emsdk 的默认行为）**：同一 emsdk 5.0.7、普通 `emcc` 编出的
闸门②探针 `main.wasm`，其 memory 段 `limits_flags=0x1`（**非 shared**）。
所以共享内存是**这棵树**带进来的。

## 四、根因链（已定位）

1. Octave 11.3.0 的 configure 用 **`AX_PTHREAD`** 探测线程：
   日志原文 `checking whether pthreads work with "-pthread" and "-lpthread"... yes`
   → 于是在生成的 Makefile 里写下：

   ```make
   BUILD_CFLAGS  = -O2 -fPIC -pthread  -fwasm-exceptions
   BUILD_CXXFLAGS = -O2 -exceptions -fPIC -pthread
   PTHREAD_CFLAGS = -pthread
   PTHREAD_LIBS   = -lpthread
   ```

2. **`--disable-threads` 挡不住它**（我们已经传了 `--disable-threads`，pthreads 仍被启用）。
3. 注意 `PTHREAD_CFLAGS`/`PTHREAD_LIBS` 在**顶层 Makefile 里只出现在自己的定义行**，
   没有任何编译/链接规则引用它 → 到达链接的 `-pthread` 另有来源
   （`BUILD_CFLAGS`/`config.status` 里也各有一份）。
4. 我们**试过并失败**的覆盖（make 命令行变量优先于 Makefile）：
   ```
   PTHREAD_CFLAGS= PTHREAD_LIBS= \
   BUILD_CFLAGS="-O2 -fPIC -fwasm-exceptions" \
   BUILD_CXXFLAGS="-O2 -fexceptions -fPIC"
   ```
   重链成功（退出码 0），但胶水里 `shared:true` **仍在**。→ 源头不在这几个变量。

5. **反向的那条路也会撞墙**（这是关键的两难）：
   我们一开始沿用 emscripten-forge 10.3 recipe 的线程预设
   （`ac_cv_header_pthread_h=no` 等）。这样 pthreads 确实不被启用，
   但 **gnulib 认为「本机没有 pthread.h」，于是自己生成 `libgnu/pthread.h`**，
   与 Emscripten sysroot 的 `pthread.h` 撞车，make 死在 libgnu：
   ```
   ./pthread.h:718:13: error: typedef redefinition with different types
     ('int' vs 'struct __pthread *')
   ```
   （这正是 emscripten-forge **patch 0010「Remove-redundant-headers」** 在处理的事：
   删掉 gnulib 的替代头 `pthread.h`/`sched.h`/`signal.h` …，让系统头生效。）

6. **patch 0010 对 11.3.0 套不上完整的**。实测（`build/BASELINE-11.3.md` §3）：
   它的 `libgnu/Makefile.am` 那几处能带偏移应用，但 **`libgnu/Makefile.in`
   那 14 处全部失败**——那是 automake 生成的文本，11.3.0 与 10.3.0 漂移了。

## 五、要问的问题（给外部）

> 有没有**成熟做法**，能在 **emsdk 5.x（emcc 5.0.7）** 上把 **Octave 11.x** 编成
> **非共享内存（single-threaded）** 的 wasm？具体：
>
> 1. 怎么让 Octave 11.x 的 `AX_PTHREAD` 判定为「pthreads 不可用」？
>    有可用的缓存变量/环境变量吗？（我们没找到 —— `ax_pthread_ok` 是宏内部变量，
>    不是 cache 变量；`--disable-threads` 不生效。）
>    或者 emcc 侧有没有 `-sPTHREADS=0` 之类的**强制**关闭开关？
> 2. 或者：把 patch 0010 那个「删掉 gnulib 替代头」的改动**干净地**应用到
>    11.x 发布 tarball 的正确姿势是什么？（在 `Makefile.am` 层改 + 重跑 automake？
>    还是应该用 `--without-...` 让 gnulib 根本不检测线程？）
> 3. 有没有已知的、**用 emsdk 5.x 构建的非线程 Octave 11.x wasm** 的公开配方？
>
> **反面证据也一并给出**：Edge-Tools（edgetools.io 的 GPL 对应源码）建的是
> Octave 11.1.0，他们**就是 pthread 构建**，托管上明确带 COOP/COEP
> （`demo/serve.mjs` 里设了这两个头）。所以我们怀疑「11.x + 非线程」在所有公开
> 实现里可能根本没人做过。如果确实没有，我们要的答案就是「没有」，
> 那就该由我们来决定：接受 COI，还是回到 7.2 基线。

## 六、若答案是「没有」

三条路（需要产品决策，不是技术问题）：
- **A. 接受 COI**：托管加 COOP/COEP 两个响应头（EdgeOne 是否支持自定义头需确认），
  其余一切照 Edge-Tools 的形态——他们的 11.1.0 就是这么上线的。
- **B. 回到 7.2 基线交付**，11.3 作为实验留在 8762。7.2 基线是单线程、免 COI、
  19 套 475 项全绿。
- **C. 继续在 11.3 上做 gnulib 头文件手术**（就是在死磕，不推荐，但记下来）。

## 七、当前可复现的状态

```bash
sudo docker start o113
sudo docker exec o113 bash -lc 'cd /src/work/octave-11.3.0/src && node ./octave-cli --quiet --eval "disp([2,3;1,4]\[7,6]'"'"')"'
# → 2 / 1（数值正确）
```

- 容器 `o113`（emsdk 5.0.7）；源码 `/src/work/octave-11.3.0`（已打 Edge-Tools 的 4 处平台补丁）
- 依赖在 `/usr/local`：`libf2c.a` / `librefblas.a` / `liblapack.a` / `libpcre2-8.a`
- 复现脚本：`build/113/{apply-platform-patches.sh,emf77,build-deps.sh,configure-113.sh,probe-side-module.sh}`
- **8761（7.2 基线）全程未动，仍是 20/20 绿**
