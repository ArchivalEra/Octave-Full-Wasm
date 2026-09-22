# 11.3.0 上 R6 归档 / gzip 路径的当前状态（实测）

> 每个结论都来自浏览器实测；对照物是**能用的 7.2 基线（8761）**与本机同版 11.3.0。

## 结论速览

| 函数 | 11.3.0（8762） | 7.2（8761） | 说明 |
|---|---|---|---|
| `tar` / `untar` | ✅ 可用 | ✅ | 走 `webshell/tar.m` → `__web_tar__`（`webio.oct`） |
| `unzip` | ⚠️ 依赖 zip 产物，zip 挂了它自然挂 | ✅ | 机制本身没问题 |
| `zip` | ❌ **trap**（`TypeError: resolved is not a function`） | ✅ | 见下 |
| `gzip` / `bzip2` | ❌ **原本来自 Octave 自带 `gzip.oct`，它 trap** → 现已从发布集中撤掉，变成 `undefined` | ✅ | 见下 |
| `gunzip` / `bunzip2` | 机制在（`.m` → `__web_gunzip__`，`which` 正确），但需要一个 `.gz`/`.bz2` 才可测——而生成它们要靠 gzip | ✅ | 依赖上游压缩 |

## 两个缺陷（都还没修）

### 1. Octave 自带的 `gzip.oct` 一调用就整页 trap
- 7.2 上 `which gzip` → `/usr/src/octave/m/oct/gzip.oct`，**能用**；
  11.3.0 上同样由 `libinterp/dldfcn/gzip.cc` 编出的 `.oct`，**一调用就 `RuntimeError: unreachable`**。
- 现在已把它从 site113 的发布集中移除（**干净报错优于整页 trap**），代价是 `gzip`/`bzip2` 变成 `undefined`。
- 注意：`accept-113-assets` 里只验过 `exist('gzip')==3`，**没真正调用过**——这个 trap 是后来在
  `accept-fileops` 的回归护栏那一步才暴露的。教训：装载类断言不够，**必须真调用**。

### 2. `zip` 在 wasm 里 trap（JS 侧 `TypeError: resolved is not a function`）
- `tar`/`untar` 同一个 `webio.oct` 路径却正常 → 不是"整个 webio 不可用"，而是 **zip 那条分支**的问题。
- `webio.cc` 的 zip 走 zlib raw deflate + 自实现中央目录；`TypeError: resolved is not a function`
  是 **JS 侧**的报错（不是 C++ 断言），怀疑与 emscripten 的 invoke/异常胶水或我们传给
  `emscripten_run_script` 的胶水有关（R6 的 zip 实现里有 JS 侧配合），待查。

### 顺带发现：`__web_gzip__` 从来就不存在
`webio.cc` 的导出是 `__web_gunzip__` / `__web_bunzip2__` / `__web_zip__` / `__web_unzip__` /
`__web_tar__` / `__web_untar__` —— **只有解压，没有"压缩成 .gz"**。
所以 7.2 的 `webshell` bundle 里也只有 6 个 `.m`（没有 `gzip.m`/`bzip2.m`）：
**7.2 的 .gz 压缩一直是靠 Octave 自带的 `gzip.oct`**。
→ 11.3.0 上若要恢复 `gzip`，要么修好那个 `.oct`，要么**新写 `__web_gzip__`**（zlib deflate），
  属新功能而非移植。

## 已补的仓库缺口

`webshell` 的 6 个 `.m` **此前只存在于 7.2 站点的压缩 bundle 里**，仓库没有源码
（与 `post.js` 同一类可复现性缺口）。现已抽进 `build/webshell/`：
`bunzip2.m gunzip.m tar.m untar.m unzip.m zip.m`。

## 当前发布集（site113/assets）

```
assets/oct/  convhulln __delaunayn__ __voronoi__ __glpk__ fftw audioread webio
             （**不含 gzip.oct** —— 它会 trap）
assets/m/   webfile(T3) pkgfix(T4) webshell(6 个 .m)
assets/data/ built-in-docstrings doc-cache
assets/meta.json  manifest.json
```

`accept-113-assets` 16/16 仍绿（那 6 个 dldfcn 的装载与数值不受影响）。
