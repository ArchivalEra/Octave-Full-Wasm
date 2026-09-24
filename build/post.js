// Closure Compiler will minify the File System API code.
Module["FS_init"] = FS.init;
Module["FS_cwd"] = FS.cwd;
Module["FS_chdir"] = FS.chdir;
Module["FS_mkdir"] = FS.mkdir;
Module["FS_mount"] = FS.mount;
Module["FS_readdir"] = FS.readdir;
Module["FS_readFile"] = FS.readFile;
Module["FS_rename"] = FS.rename;
Module["FS_rmdir"] = FS.rmdir;
Module["FS_stat"] = FS.stat;
Module["FS_unlink"] = FS.unlink;
Module["FS_syncfs"] = FS.syncfs;
Module["FS_writeFile"] = FS.writeFile;
Module["FS_isDir"] = FS.isDir;
Module["FS_isFile"] = FS.isFile;
Module["FS_chmod"] = FS.chmod;
Module["FS_utime"] = FS.utime;
Module["FS_lookupPath"] = FS.lookupPath;
Module["FS_mkdirTree"] = FS.mkdirTree;
Module["FS_trackingDelegate"] = FS.trackingDelegate;

// ── P5：把**动态链接入口**暴露给页面（2026-09-23 加）───────────────────────────
// 为什么需要它：Chrome 禁止在**主线程同步编译**大于 8MB 的 wasm 模块 ——
//     RangeError: WebAssembly.Compile is disallowed on the main thread,
//     if the buffer size is larger than 8MB.
// 而 Octave 的 dlopen 走的是**同步**路径（emscripten 的 `__dlopen_js` 恒传
// `{loadAsync:false}`）⇒ 超过 8MB 的 `.oct` 一装载就报上面那句，表现成
//     "could not load dynamic lib: … .oct" + 一句和符号毫无关系的 RangeError。
// （实测边界就在这里：control 包的 SLICOT 模块 8.1MB 能装载，P5 的 OSMesa
//   toolkit 10.8MB 不行。）
// 解法：**页面侧异步预加载**。`loadDynamicLibrary()` 开头就查
// `LDSO.loadedLibsByName[libName]`，命中就直接返回 ⇒ Octave 之后同步 dlopen
// 时不再触发编译。资产加载器对 >8MB 的 `kind: oct` 正是这么做的
// （见 `bridge/assets-loader.js` 的 `SYNC_COMPILE_LIMIT`）。
Module["loadDynamicLibrary"] = loadDynamicLibrary;