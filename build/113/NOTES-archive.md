# 11.3.0 上 R6 归档 / gzip 路径（**两个整页 trap 已解决**）

> 每个结论都来自浏览器实测；对照物是能用的 7.2 基线（8761）与本机同版 11.3.0。

## ✅ 解决结果（2026-09-22）

**两个整页 trap 是同一个根因，现已修好：**

| 函数 | 修前 | 修后 |
|---|---|---|
| `gzip` | **RuntimeError: unreachable（整页死）** | ✅ |
| `zip` | **TypeError: resolved is not a function（整页死）** | ✅ |
| `gunzip` / `unzip` / `tar` / `untar` | tar/untar 可用；另两个依赖上游 | ✅ 全可用 |
| `convhulln` / `delaunayn` / `__voronoi__` / `glpk` / `fftw` | ✅（修复过程中一度被弄崩，见下） | ✅ |

回归：`accept-113-boot` 10/10、`accept-113-oct` 8/8、`accept-113-assets` **16/16**、
`accept-fileops` **19/20**（剩 1 条要 `webimage` 资产，属已知缺口）。

## 根因（一句话）

**zlib 实际上根本不在主模块里。**

两个环节叠加：
1. **我们建 zlib 时漏了 `-fPIC`**（zlib 的 configure 靠**环境变量**收 CFLAGS，不像 autoconf
   那样接受 `CC=...` 参数）。非 PIC 对象**进不了 PIC 主模块**——
   实测报 `relocation R_WASM_MEMORY_ADDR_LEB cannot be used against symbol 'crc_table';
   recompile with -fPIC`。
2. 即便修了 PIC，**Octave 核心自己只用到 zlib 的一小部分**（`save -z` 那条路），
   而 `.oct`（`gzip` / `webio`）需要的是**流式接口**
   （`deflate`/`deflateInit2_`/`deflateSetHeader`/`inflate*`/`gzopen`/`gzread`/`crc32`）
   —— 静态库按需拉取时这些对象**不会被带进来**，于是既不在主模块里、也不在导出表里
   → `.oct` 装载后一调用就打到 emscripten 的 stub → `resolved is not a function` / trap。

旁证：**7.2 的主模块导出了 31 个 deflate 相关符号**，我们（修前）几乎没有——
这就是为什么同一个 `gzip.cc` 编出的 `.oct` 在 7.2 能用、在我们这儿炸。

## 修法（两处，缺一不可）

```
build/113/build-libs.sh   zlib 构建加 CFLAGS="-O2 -fPIC"
build/113/link-web.sh     主链加定点拉取：
  -Wl,-u,deflate -Wl,-u,deflateEnd -Wl,-u,deflateInit2_ -Wl,-u,deflateSetHeader
  -Wl,-u,inflate -Wl,-u,inflateEnd -Wl,-u,inflateInit2_
  -Wl,-u,gzopen -Wl,-u,gzclose -Wl,-u,gzread -Wl,-u,crc32
  -Wl,-u,BZ2_bzCompress…（bz2 六个）
  -lz -lbz2
```

**⚠️ 不要用 `-Wl,--whole-archive -lz -lbz2`**：那样确实也修好了 gzip/zip，
但**把 `convhulln` 和 `glpk` 弄崩了**（实测：整库拉进来的符号与 qhull/glpk 撞车，
`.oct` 的导入解析到错的东西 → 调用打到 stub → 同样是 `resolved is not a function`）。
**定点 `-u` 只拉必需的那几个对象，没有附带损伤**——这是最终采用的方案。

## 走过的三条弯路（都被实测证伪，记下来别再走）

1. **"索引宽度错配"**：以为 `SuiteSparse_long`(32 位) 与 `octave_idx_type` 不一致。
   实读 `config.h` 发现 **`OCTAVE_IDX_TYPE` 就是 `int32_t`**，而 wasm32 上 `long` 也是 32 位
   → 本来就一致。那两条 `#undef` 是检测的**假阴性**。照它改反而制造真错配（见 `NOTES-umfpack.md`）。
2. **"缺导入就是病因"**：用解析 wasm 导入/导出段的办法查出 gzip.oct 缺 26 个。
   **但 7.2 能用的那一对缺 68 个**（更多！）→ 说明 side module 里自引用符号由 dylink
   本地解析，**"缺导入"根本不能预测 trap**。这个仪器对这个问题无效。
3. **"整库拉进来"**：`--whole-archive` 修好了目标缺陷，却引入新缺陷（见上）。

**唯一可靠的判定手段始终是：装载之后真的调用它。**
`accept-113-assets` 早期只验了 `exist('gzip')==3` 就放行，这个 trap 是到
`accept-fileops` 的回归护栏才暴露的——**装载类断言不够，必须真调用**。

## 顺带查清的事实 / 补的缺口

- `webio.cc` 的导出是 `__web_gunzip__`/`__web_bunzip2__`/`__web_zip__`/`__web_unzip__`/
  `__web_tar__`/`__web_untar__` —— **只有解压，没有"压缩成 .gz"**。
  所以 7.2 的 webshell bundle 里只有 6 个 `.m`（无 `gzip.m`/`bzip2.m`）：
  **7.2 的 .gz 压缩一直靠 Octave 自带的 `gzip.oct`**（现在 11.3.0 上也能用了）。
- `webshell` 的 6 个 `.m` 此前**只存在于 7.2 站点的压缩 bundle 里**，仓库无源码
  （与 `post.js` 同类缺口）。已抽进 `build/webshell/`。

## 当前发布集（site113/assets）

```
assets/oct/  convhulln __delaunayn__ __voronoi__ __glpk__ fftw gzip audioread webio
assets/m/    webfile(T3) pkgfix(T4) webshell(6 个 .m)
assets/data/ built-in-docstrings doc-cache
assets/meta.json  manifest.json
```
