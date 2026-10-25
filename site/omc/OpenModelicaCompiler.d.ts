/* tslint:disable */
/* eslint-disable */

/**
 * Dispatch one typed OMEdit scripting call: the bridge posts
 * `{"fn": …, "args": […]}` and gets back `{"result": …}` or `{"error": …}`.
 * Present only with the `scripting_api` feature (the OMEdit C-ABI crate).
 */
export function omc_abi(request: string): string;

/**
 * Enable the cross-thread cancel poll for any blocking omc call (simulate, and
 * the frontend/loader/backend chokepoints). The worker must define
 * `globalThis.__omcPollCancel` first (OMEdit-wasm); the standalone simulator
 * cancels via `omc_sim_free` instead and doesn't call this.
 */
export function omc_enable_cancel_poll(): void;

/**
 * Let `buildModelFMU(..., platforms={"wasm", "linux64"})` serve native platforms
 * here: the component is compiled by a wasm32-wasip1 build of wasmtime in another
 * worker, and the loader libraries come from the bundle. The host must define the
 * globals first — see `wasm/fmu-aot.js`.
 */
export function omc_enable_fmu_aot(): void;

/**
 * Enable live progress reporting out of a blocking omc call: the runtime writes
 * permille + phase into the shared control block via `globalThis.__omcReportProgress`
 * (which the worker defines). The UI thread reads the block on its own timer.
 */
export function omc_enable_progress_sink(): void;

/**
 * Let a model's externals reach a library this omc does not embed, through
 * `globalThis.__omcWasmBlob(file)`. The host defines it — see `wasm/wasm-blobs.js`.
 */
export function omc_enable_wasm_blobs(): void;

/**
 * Evaluate one interactive command and return its reply — the same string the
 * `--interactive=zmq` server returns for a request. Evaluation errors and
 * panics are returned as `"Error: …"` text rather than thrown, so a REPL can
 * keep running.
 */
export function omc_eval(command: string): string;

/**
 * The `method=` values a Co-Simulation wasm FMU can be exported with, a subset of
 * [`omc_sim_solver_options`]'s `s`.
 */
export function omc_fmu_cs_solvers(): any;

/**
 * The native platforms an exported FMU can serve. Needs [`omc_enable_fmu_aot`].
 */
export function omc_fmu_platforms(): any;

/**
 * Initialise the compiler runtime. Returns `true` on success. Must be called
 * once before [`omc_eval`]. Mirrors `omc_compiler_init`, but additionally:
 *   * routes the compiler's stdout/stderr (and Rust panics) to the JS console,
 *   * defaults the code-generation target to `wasm-jit` — the only simCode
 *     target usable in-browser (the C/Cpp/FMU targets need an external
 *     toolchain and are unavailable here).
 */
export function omc_init(): boolean;

/**
 * Request cancellation of the running simulation (mirrors the native C ABI). The
 * simulator cancels via `omc_sim_free` instead; this is used by the SAB cancel path.
 */
export function omc_request_cancel(): void;

/**
 * Seed an environment variable in the wasm in-process environment (there is no
 * OS environment on wasm). Call before [`omc_init`] to point the runtime at its
 * install dir, e.g. `omc_set_env("OPENMODELICAHOME", "/")`.
 */
export function omc_set_env(name: string, value: string): void;

/**
 * Select the simulation driver: `1` in-wasm (the default here — the model is
 * reached wasm->wasm), `0` host (each model call crosses wasm->JS->wasm through
 * wasmer), `-1` the default. Applies from the next `omc_sim_start`/`omc_simulate`.
 */
export function omc_set_inwasm_driver(mode: number): void;

/**
 * Enable the per-run bench lines; the `OMC_WASM_SIM_BENCH` that arms them
 * natively is unreachable without an environment.
 */
export function omc_set_sim_bench(on: boolean): void;

/**
 * Integrate for about `budget_ms` of wall-clock, then return so the worker can
 * yield. Codes: `0` running (call again), `1` done, `2` terminated (`terminate()`),
 * `3` cancelled, `-1` error (read `getErrorString()`). On `1`/`2` the results are
 * ready via the `omc_sim_*` getters and the `.mat` is written; on `3`/`-1`/`1`/`2`
 * the session is freed.
 */
export function omc_sim_advance(budget_ms: number): number;

/**
 * The values of series `index` (as in [`omc_sim_series`]) as a `Float64Array`.
 * A time-invariant signal returns a length-1 array. `None` if out of range /
 * no run.
 */
export function omc_sim_column(index: number): Float64Array | undefined;

/**
 * Drop the active simulation session (freeing its external objects). Used by the
 * worker's Cancel path; safe with no active session.
 */
export function omc_sim_free(): void;

/**
 * `{ model, file, start, stop, rows }` for the last run, or `null` if none.
 * `file` is the result file the run actually wrote, whose suffix is the format
 * it was written in (`-outputFormat` can have moved it off the requested one).
 */
export function omc_sim_info(): any;

/**
 * The last resumable run's model output (prints, `LOG_ASSERT` blocks, chattering,
 * `-lv=LOG_STATS`). Valid until the next `omc_sim_start`; set even on failure.
 */
export function omc_sim_log(): string;

/**
 * The last run's editable initial conditions: an array of `{ name, comment,
 * unit, displayUnit, relativeQuantity, value }`, plus `enumNames` for an
 * enumeration (its value is the 1-based index). Feed edits back via
 * `-override=name=value` on the next simulate, in the variable's own `unit`.
 */
export function omc_sim_parameters(): any;

/**
 * The last run's result file as `format` (`arrow`, `mat` or `csv`), for a
 * download in a format other than the one the run wrote. The file's own format
 * is returned unconverted; converting to `mat`/`csv` drops the String variables
 * they cannot hold. `None` on failure — read `getErrorString()`.
 */
export function omc_sim_result_as(format: string): Uint8Array | undefined;

/**
 * Metadata for the last run's signals (excluding `time`): an array of
 * `{ name, comment, unit, displayUnit, relativeQuantity, constant, alias }`.
 * `unit` and `displayUnit` name entries of [`omc_sim_units`]. `constant` marks parameters/constants and
 * signals that never change; `alias` marks a signal that reads the *same stored
 * column* as an earlier one (the `.mat`'s `dataInfo` aliasing — distinct columns
 * are distinct signals). The plot shows only `!constant && !alias`. Empty if no run.
 */
export function omc_sim_series(): any;

/**
 * `{ s, nls, nlsLS, ls, lss }`: the values each solver flag accepts in this
 * build. KLU only appears where SUNDIALS is linked.
 */
export function omc_sim_solver_options(): any;

/**
 * Start a resumable run of a model already built by `buildModel` (keyed by its
 * `prefix`; `result_file` is where the `.mat` goes). `false` on failure — read
 * `getErrorString()`.
 */
export function omc_sim_start(prefix: string, result_file: string, simflags: string): boolean;

/**
 * The independent `time` column of the last run as a `Float64Array`, or `None`.
 */
export function omc_sim_time(): Float64Array | undefined;

/**
 * The display units of the last run's units: `{ "K": [{ name, factor, offset,
 * inverse }], ... }`, the same shape the FMI simulator gets from an FMU's
 * `<UnitDefinitions>`. A value in the unit shows as `factor * v + offset`
 * (`factor / v` when `inverse`); a `relativeQuantity` signal drops the offset.
 */
export function omc_sim_units(): any;

/**
 * `simulate(...)` without the string command's O(program) env build; errors returned as `"Error: …"`.
 */
export function omc_simulate(class_name: string, stop_time: number, number_of_intervals: number, tolerance: number, method: string, simflags: string): string;

/**
 * Drain the files the last command tried to download but did not find in the
 * VFS, as an array of `{ urls: string[], filename: string }`. `omc_eval` is
 * synchronous, so it cannot fetch over the network itself; instead the JS host
 * fetches each pending file (the browser streams it for download progress),
 * stages the bytes with [`wasi_write_file`], and re-runs the command, which then
 * finds them in the VFS. See `openmodelica_script_util::Curl` (Curl_wasm).
 */
export function omc_take_pending_downloads(): any;

/**
 * Drain the plot commands the last `omc_eval` recorded, as an array of string
 * arrays (each the 18 `PlotCallback` args in ABI order, result file at index 0).
 * A host with its own renderer (OMNotebook-qt) drains this, then reads each
 * result file from the VFS with [`wasi_path_open`]+[`wasi_fd_read`] and draws it.
 */
export function omc_take_plot_commands(): any;

/**
 * Unzip `data` into the VFS, mounting each entry under `mount` (e.g.
 * `mount="/lib"`, entry `Modelica 4.1.0/package.mo` → `/lib/Modelica 4.1.0/
 * package.mo`). One fetch + this call stages a whole Modelica library; point
 * MODELICAPATH at `mount` and `loadModel`. Returns the number of files written
 * or an error string.
 */
export function omc_vfs_load_zip(mount: string, data: Uint8Array): number;

/**
 * preview1 `fd_close`.
 */
export function wasi_fd_close(fd: number): void;

/**
 * preview1 `fd_read` (whole file) of an fd from [`wasi_path_open`], or `None`.
 */
export function wasi_fd_read(fd: number): Uint8Array | undefined;

/**
 * preview1 `path_filestat_get`'s `size` for absolute key `path`, or `-1` if
 * absent (a JS number; sizes here are small config/result files).
 */
export function wasi_path_filestat_get(path: string): number;

/**
 * preview1 `path_open` (read-only) of absolute key `path`. Returns the new fd,
 * or `-1` if the file is absent.
 */
export function wasi_path_open(path: string): number;

/**
 * List directory `path` (absolute; `"/"` is the root) as an array of
 * `{ name: string, isDir: bool }`. The worker-side of preview1 `fd_readdir` for
 * a JS caller (which cannot pass guest dirent buffers): drives the engine's
 * `QDir` enumeration of worker-owned paths.
 */
export function wasi_readdir(path: string): any;

/**
 * Remove `path`, whether it is a file or a directory (the store's directories
 * are implicit, so a directory means every key beneath it). Returns true if
 * anything was removed. Embedded builtins are immutable and unaffected.
 */
export function wasi_remove(path: string): boolean;

/**
 * Move `from` to `to`, either a single file or a whole subtree.
 */
export function wasi_rename(from: string, to: string): boolean;

/**
 * Create/overwrite absolute key `path` with `bytes` (preview1
 * `path_open`(O_CREAT|O_TRUNC) → `fd_write` → `fd_close` collapsed). Lets the JS
 * host stage downloaded library/result files into the store.
 */
export function wasi_write_file(path: string, bytes: Uint8Array): void;

/**
 * Write many files in one call, from an array of `{ path: string, bytes:
 * Uint8Array }`. Restoring a cached package tree is one postMessage rather than
 * one per file. Returns how many were written; a malformed entry is skipped.
 */
export function wasi_write_files(entries: any): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_trap_free: (a: number, b: number) => void;
    readonly omc_compiler_clear_cancel: () => void;
    readonly omc_compiler_eval: (a: number) => number;
    readonly omc_compiler_eval_keep: (a: number, b: number) => number;
    readonly omc_compiler_free_string: (a: number) => void;
    readonly omc_compiler_init: () => number;
    readonly omc_compiler_init_args: (a: number, b: number) => number;
    readonly omc_compiler_progress_permille: () => number;
    readonly omc_compiler_progress_phase: () => number;
    readonly omc_compiler_request_cancel: () => void;
    readonly omc_compiler_set_pump_callback: (a: number) => void;
    readonly omc_abi: (a: number, b: number) => [number, number];
    readonly omc_enable_cancel_poll: () => void;
    readonly omc_enable_fmu_aot: () => void;
    readonly omc_enable_progress_sink: () => void;
    readonly omc_enable_wasm_blobs: () => void;
    readonly omc_eval: (a: number, b: number) => [number, number];
    readonly omc_fmu_cs_solvers: () => any;
    readonly omc_fmu_platforms: () => any;
    readonly omc_init: () => number;
    readonly omc_request_cancel: () => void;
    readonly omc_set_env: (a: number, b: number, c: number, d: number) => void;
    readonly omc_set_inwasm_driver: (a: number) => void;
    readonly omc_set_sim_bench: (a: number) => void;
    readonly omc_sim_advance: (a: number) => number;
    readonly omc_sim_column: (a: number) => [number, number];
    readonly omc_sim_free: () => void;
    readonly omc_sim_info: () => any;
    readonly omc_sim_log: () => [number, number];
    readonly omc_sim_parameters: () => any;
    readonly omc_sim_result_as: (a: number, b: number) => [number, number];
    readonly omc_sim_series: () => any;
    readonly omc_sim_solver_options: () => any;
    readonly omc_sim_start: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_sim_time: () => [number, number];
    readonly omc_sim_units: () => any;
    readonly omc_simulate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly omc_take_pending_downloads: () => any;
    readonly omc_take_plot_commands: () => any;
    readonly omc_vfs_load_zip: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly trap___wbg_wasmer_trap: () => void;
    readonly wasi_fd_close: (a: number) => void;
    readonly wasi_fd_read: (a: number) => [number, number];
    readonly wasi_path_filestat_get: (a: number, b: number) => number;
    readonly wasi_path_open: (a: number, b: number) => number;
    readonly wasi_readdir: (a: number, b: number) => any;
    readonly wasi_remove: (a: number, b: number) => number;
    readonly wasi_rename: (a: number, b: number, c: number, d: number) => number;
    readonly omrs_add_runtime_error: (a: number) => void;
    readonly omrs_add_runtime_error_pos: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly omrs_runtime_abort: () => void;
    readonly daxpy_: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly dcopy_: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly ddot_: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly dgbsv_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly dgecon_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly dgees_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => void;
    readonly dgeev_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly dgegv_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => void;
    readonly dgehrd_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly dgels_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly dgelsx_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly dgelsy_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly dgemm_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly dgemv_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly dgeqp3_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly dgeqpf_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly dgeqrf_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly dgesdd_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly dgesv_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly dgesvd_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly dgesvx_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number) => void;
    readonly dgetrf_: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly dgetri_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly dgetrs_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly dggev_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => void;
    readonly dggevx_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number) => void;
    readonly dgglse_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly dgtsv_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly dhgeqz_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => void;
    readonly dhseqr_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly dlange_: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly dlarnv_: (a: number, b: number, c: number, d: number) => void;
    readonly dorghr_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly dorgqr_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly dormqr_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly dpotrf_: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly dpotrs_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly dscal_: (a: number, b: number, c: number, d: number) => void;
    readonly dsyevx_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => void;
    readonly dsygvx_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number) => void;
    readonly dsymm_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly dsytrf_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly dsytrs_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly dtrevc_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly dtrmm_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly dtrsm_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly dtrsyl_: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly ModelicaAllocateString: (a: number) => number;
    readonly omrs_sim_external_begin: () => void;
    readonly omrs_sim_external_end: () => void;
    readonly ModelicaAllocateStringWithErrorReturn: (a: number) => number;
    readonly omc_Error_getCurrentComponent: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly omc_abi_free_string: (a: number) => void;
    readonly omc_abi_has_exception: () => number;
    readonly omc_abi_take_exception: () => number;
    readonly omc_scripting_GC_expand_hp: (a: bigint) => number;
    readonly omc_scripting_GC_gcollect_and_unmap: () => void;
    readonly omc_scripting_GC_set_max_heap_size: (a: number) => number;
    readonly omc_scripting_addEquation: (a: number, b: number, c: number) => number;
    readonly omc_scripting_alarm: (a: bigint) => bigint;
    readonly omc_scripting_basename: (a: number) => number;
    readonly omc_scripting_buildEncryptedPackage: (a: number, b: number) => number;
    readonly omc_scripting_buildLabel: (a: number, b: number, c: number, d: bigint, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly omc_scripting_buildModelFMU: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly omc_scripting_cd: (a: number) => number;
    readonly omc_scripting_checkAllModelsRecursive: (a: number, b: number) => number;
    readonly omc_scripting_checkCodeGraph: (a: number, b: number) => number;
    readonly omc_scripting_checkInterfaceOfPackages: (a: number, b: number) => number;
    readonly omc_scripting_checkModel: (a: number) => number;
    readonly omc_scripting_checkTaskGraph: (a: number, b: number) => number;
    readonly omc_scripting_classAnnotationExists: (a: number, b: number) => number;
    readonly omc_scripting_clear: () => number;
    readonly omc_scripting_clearCommandLineOptions: () => number;
    readonly omc_scripting_clearDebugFlags: () => number;
    readonly omc_scripting_clearMessages: () => number;
    readonly omc_scripting_clearProgram: () => number;
    readonly omc_scripting_clearVariables: () => number;
    readonly omc_scripting_closeSimulationResultFile: () => number;
    readonly omc_scripting_compareFiles: (a: number, b: number) => number;
    readonly omc_scripting_compareFilesAndMove: (a: number, b: number) => number;
    readonly omc_scripting_compareSimulationResults: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_scripting_convertPackageToLibrary: (a: number, b: number, c: number) => number;
    readonly omc_scripting_convertUnits: (a: number, b: number) => number;
    readonly omc_scripting_copy: (a: number, b: number) => number;
    readonly omc_scripting_copyClass: (a: number, b: number, c: number) => number;
    readonly omc_scripting_countMessages: () => number;
    readonly omc_scripting_createModel: (a: number) => number;
    readonly omc_scripting_deleteClass: (a: number) => number;
    readonly omc_scripting_deleteComponent: (a: number, b: number) => number;
    readonly omc_scripting_deleteFile: (a: number) => number;
    readonly omc_scripting_deleteInitialState: (a: number, b: number) => number;
    readonly omc_scripting_deleteTransition: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: bigint) => number;
    readonly omc_scripting_deltaSimulationResults: (a: number, b: number, c: number, d: number) => number;
    readonly omc_scripting_diffSimulationResults: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly omc_scripting_diffSimulationResultsHtml: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_scripting_directoryExists: (a: number) => number;
    readonly omc_scripting_dirname: (a: number) => number;
    readonly omc_scripting_disableNewInstantiation: () => number;
    readonly omc_scripting_dumpXMLDAE: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly omc_scripting_echo: (a: number) => number;
    readonly omc_scripting_enableNewInstantiation: () => number;
    readonly omc_scripting_existClass: (a: number) => number;
    readonly omc_scripting_exit: (a: bigint) => void;
    readonly omc_scripting_exportToFigaro: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_scripting_extendsFrom: (a: number, b: number) => number;
    readonly omc_scripting_filterSimulationResults: (a: number, b: number, c: number, d: bigint, e: number, f: number) => number;
    readonly omc_scripting_generateCode: (a: number) => number;
    readonly omc_scripting_generateEntryPoint: (a: number, b: number, c: number) => void;
    readonly omc_scripting_generateHeader: (a: number) => number;
    readonly omc_scripting_generateJuliaHeader: (a: number) => number;
    readonly omc_scripting_generateScriptingAPI: (a: number, b: number) => number;
    readonly omc_scripting_generateSeparateCode: (a: number, b: number) => number;
    readonly omc_scripting_generateSeparateCodeDependencies: (a: number) => number;
    readonly omc_scripting_generateSeparateCodeDependenciesMakefile: (a: number, b: number, c: number) => number;
    readonly omc_scripting_generateVerificationScenarios: (a: number) => number;
    readonly omc_scripting_getAlgorithmCount: (a: number) => bigint;
    readonly omc_scripting_getAlgorithmItemsCount: (a: number) => bigint;
    readonly omc_scripting_getAllSubtypeOf: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly omc_scripting_getAnnotationCount: (a: number) => bigint;
    readonly omc_scripting_getAnnotationModifierValue: (a: number, b: number, c: number) => number;
    readonly omc_scripting_getAnnotationNamedModifiers: (a: number, b: number) => number;
    readonly omc_scripting_getAnnotationVersion: () => number;
    readonly omc_scripting_getAvailableIndexReductionMethods: () => number;
    readonly omc_scripting_getAvailableLibraries: () => number;
    readonly omc_scripting_getAvailableLibraryVersions: (a: number) => number;
    readonly omc_scripting_getAvailableMatchingAlgorithms: () => number;
    readonly omc_scripting_getAvailablePackageConversionsFrom: (a: number, b: number) => number;
    readonly omc_scripting_getAvailablePackageConversionsTo: (a: number, b: number) => number;
    readonly omc_scripting_getAvailablePackageVersions: (a: number, b: number) => number;
    readonly omc_scripting_getAvailableTearingMethods: () => number;
    readonly omc_scripting_getBooleanClassAnnotation: (a: number, b: number) => number;
    readonly omc_scripting_getBuiltinType: (a: number) => number;
    readonly omc_scripting_getCFlags: () => number;
    readonly omc_scripting_getCXXCompiler: () => number;
    readonly omc_scripting_getClassComment: (a: number) => number;
    readonly omc_scripting_getClassDiagram: (a: number, b: number, c: number, d: bigint, e: number, f: number) => number;
    readonly omc_scripting_getClassInformation: (a: number) => number;
    readonly omc_scripting_getClassNames: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly omc_scripting_getClassRestriction: (a: number) => number;
    readonly omc_scripting_getCommandLineOptions: () => number;
    readonly omc_scripting_getCompiler: () => number;
    readonly omc_scripting_getComponentComment: (a: number, b: number) => number;
    readonly omc_scripting_getComponentCondition: (a: number, b: number) => number;
    readonly omc_scripting_getComponentCount: (a: number) => bigint;
    readonly omc_scripting_getComponentModifierNames: (a: number, b: number) => number;
    readonly omc_scripting_getComponentModifierValue: (a: number, b: number) => number;
    readonly omc_scripting_getComponentModifierValues: (a: number, b: number) => number;
    readonly omc_scripting_getComponents: (a: number, b: number) => void;
    readonly omc_scripting_getConfigFlagValidOptions: (a: number) => number;
    readonly omc_scripting_getConnectionCount: (a: number) => bigint;
    readonly omc_scripting_getConnectionList: (a: number) => number;
    readonly omc_scripting_getConnectorCount: (a: number) => bigint;
    readonly omc_scripting_getConversionsFromVersions: (a: number) => number;
    readonly omc_scripting_getDefUseChains: (a: number, b: number, c: number, d: number) => number;
    readonly omc_scripting_getDefaultComponentName: (a: number) => number;
    readonly omc_scripting_getDefaultComponentPrefixes: (a: number) => number;
    readonly omc_scripting_getDefaultOpenCLDevice: () => bigint;
    readonly omc_scripting_getDefinitionAt: (a: number, b: bigint, c: bigint, d: number) => number;
    readonly omc_scripting_getDefinitions: (a: number) => number;
    readonly omc_scripting_getDependencyGraph: (a: number, b: number, c: number) => number;
    readonly omc_scripting_getDerivedClassModifierNames: (a: number) => number;
    readonly omc_scripting_getDerivedClassModifierValue: (a: number, b: number) => number;
    readonly omc_scripting_getDerivedUnits: (a: number) => number;
    readonly omc_scripting_getDocumentationAnnotation: (a: number) => number;
    readonly omc_scripting_getElementAnnotation: (a: number) => number;
    readonly omc_scripting_getElementModifierNames: (a: number, b: number) => number;
    readonly omc_scripting_getElementModifierValue: (a: number, b: number) => number;
    readonly omc_scripting_getElementModifierValues: (a: number, b: number) => number;
    readonly omc_scripting_getElements: (a: number, b: number) => void;
    readonly omc_scripting_getEnumerationLiterals: (a: number) => number;
    readonly omc_scripting_getEnvironmentVar: (a: number) => number;
    readonly omc_scripting_getEquationCount: (a: number) => bigint;
    readonly omc_scripting_getEquationItemsCount: (a: number) => bigint;
    readonly omc_scripting_getErrorString: (a: number) => number;
    readonly omc_scripting_getExtendsModifierNames: (a: number, b: number, c: number) => number;
    readonly omc_scripting_getExternalFunctions: (a: number) => number;
    readonly omc_scripting_getHomeDirectoryPath: () => number;
    readonly omc_scripting_getImportCount: (a: number) => bigint;
    readonly omc_scripting_getImportedNames: (a: number) => number;
    readonly omc_scripting_getIndexReductionMethod: () => number;
    readonly omc_scripting_getInheritanceCount: (a: number) => bigint;
    readonly omc_scripting_getInheritedClasses: (a: number) => number;
    readonly omc_scripting_getInitialAlgorithmCount: (a: number) => bigint;
    readonly omc_scripting_getInitialAlgorithmItemsCount: (a: number) => bigint;
    readonly omc_scripting_getInitialEquationCount: (a: number) => bigint;
    readonly omc_scripting_getInitialEquationItemsCount: (a: number) => bigint;
    readonly omc_scripting_getInitialStates: (a: number) => number;
    readonly omc_scripting_getInstallationDirectoryPath: () => number;
    readonly omc_scripting_getInstantiatedParametersAndValues: (a: number) => number;
    readonly omc_scripting_getLanguageStandard: () => number;
    readonly omc_scripting_getLinker: () => number;
    readonly omc_scripting_getLinkerFlags: () => number;
    readonly omc_scripting_getLoadedLibraries: () => number;
    readonly omc_scripting_getMMfileTotalDependencies: (a: number, b: number) => number;
    readonly omc_scripting_getMatchingAlgorithm: () => number;
    readonly omc_scripting_getMemorySize: () => number;
    readonly omc_scripting_getModelInstance: (a: number, b: number, c: number, d: number) => number;
    readonly omc_scripting_getModelInstanceAnnotation: (a: number, b: number, c: number) => number;
    readonly omc_scripting_getModelInstanceAnnotationReference: (a: number, b: number) => bigint;
    readonly omc_scripting_getModelInstanceReference: (a: number, b: number, c: number) => bigint;
    readonly omc_scripting_getModelicaPath: () => number;
    readonly omc_scripting_getNoSimplify: () => number;
    readonly omc_scripting_getNthAlgorithm: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthAlgorithmItem: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthAnnotationString: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthComponentCondition: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthConnection: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthEquation: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthEquationItem: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthImport: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthInheritedClass: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthInitialAlgorithm: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthInitialAlgorithmItem: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthInitialEquation: (a: number, b: bigint) => number;
    readonly omc_scripting_getNthInitialEquationItem: (a: number, b: bigint) => number;
    readonly omc_scripting_getOrderConnections: () => number;
    readonly omc_scripting_getPackages: (a: number) => number;
    readonly omc_scripting_getParameterNames: (a: number) => number;
    readonly omc_scripting_getParameterValue: (a: number, b: number) => number;
    readonly omc_scripting_getReplaceableChoices: (a: number, b: number, c: number, d: number) => number;
    readonly omc_scripting_getShowAnnotations: () => number;
    readonly omc_scripting_getSimulationOptions: (a: number, b: number, c: number, d: number, e: bigint, f: number) => number;
    readonly omc_scripting_getSourceFile: (a: number) => number;
    readonly omc_scripting_getTearingMethod: () => number;
    readonly omc_scripting_getTempDirectoryPath: () => number;
    readonly omc_scripting_getTimeStamp: (a: number) => number;
    readonly omc_scripting_getTotalModel: (a: number, b: number, c: number, d: number) => number;
    readonly omc_scripting_getTransitions: (a: number) => number;
    readonly omc_scripting_getUsedClassNames: (a: number) => number;
    readonly omc_scripting_getUses: (a: number) => number;
    readonly omc_scripting_getVectorizationLimit: () => bigint;
    readonly omc_scripting_getVersion: (a: number) => number;
    readonly omc_scripting_help: (a: number) => number;
    readonly omc_scripting_iconv: (a: number, b: number, c: number) => number;
    readonly omc_scripting_importFMU: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number, h: number) => number;
    readonly omc_scripting_importFMUModelDescription: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number) => number;
    readonly omc_scripting_inferBindings: (a: number) => number;
    readonly omc_scripting_installPackage: (a: number, b: number, c: number) => number;
    readonly omc_scripting_installWasmToolchain: (a: number) => number;
    readonly omc_scripting_instantiateModel: (a: number) => number;
    readonly omc_scripting_isBlock: (a: number) => number;
    readonly omc_scripting_isClass: (a: number) => number;
    readonly omc_scripting_isConnector: (a: number) => number;
    readonly omc_scripting_isConstant: (a: number, b: number) => number;
    readonly omc_scripting_isEnumeration: (a: number) => number;
    readonly omc_scripting_isExperiment: (a: number) => number;
    readonly omc_scripting_isExtendsModifierFinal: (a: number, b: number, c: number) => number;
    readonly omc_scripting_isFunction: (a: number) => number;
    readonly omc_scripting_isModel: (a: number) => number;
    readonly omc_scripting_isOperator: (a: number) => number;
    readonly omc_scripting_isOperatorFunction: (a: number) => number;
    readonly omc_scripting_isOperatorRecord: (a: number) => number;
    readonly omc_scripting_isOptimization: (a: number) => number;
    readonly omc_scripting_isPackage: (a: number) => number;
    readonly omc_scripting_isParameter: (a: number, b: number) => number;
    readonly omc_scripting_isPartial: (a: number) => number;
    readonly omc_scripting_isPrimitive: (a: number) => number;
    readonly omc_scripting_isProtected: (a: number, b: number) => number;
    readonly omc_scripting_isProtectedClass: (a: number, b: number) => number;
    readonly omc_scripting_isRecord: (a: number) => number;
    readonly omc_scripting_isRedeclare: (a: number) => number;
    readonly omc_scripting_isReplaceable: (a: number) => number;
    readonly omc_scripting_isShortDefinition: (a: number) => number;
    readonly omc_scripting_isType: (a: number) => number;
    readonly omc_scripting_listFile: (a: number, b: number) => number;
    readonly omc_scripting_listVariables: () => number;
    readonly omc_scripting_loadClassContentString: (a: number, b: number, c: bigint, d: bigint) => number;
    readonly omc_scripting_loadEncryptedPackage: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_scripting_loadFile: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_scripting_loadFileInteractive: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly omc_scripting_loadFileInteractiveQualified: (a: number, b: number) => number;
    readonly omc_scripting_loadFiles: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number) => number;
    readonly omc_scripting_loadModel: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly omc_scripting_loadOMSimulator: () => bigint;
    readonly omc_scripting_loadString: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly omc_scripting_mkdir: (a: number) => number;
    readonly omc_scripting_modifierToJSON: (a: number, b: number) => number;
    readonly omc_scripting_moveClass: (a: number, b: bigint) => number;
    readonly omc_scripting_moveClassToBottom: (a: number) => number;
    readonly omc_scripting_moveClassToTop: (a: number) => number;
    readonly omc_scripting_newModel: (a: number, b: number) => number;
    readonly omc_scripting_numProcessors: () => bigint;
    readonly omc_scripting_oms_RunFile: (a: number) => bigint;
    readonly omc_scripting_oms_addBus: (a: number) => bigint;
    readonly omc_scripting_oms_addConnection: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_addConnectorToBus: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_addConnectorToTLMBus: (a: number, b: number, c: number) => bigint;
    readonly omc_scripting_oms_addDynamicValueIndicator: (a: number, b: number, c: number, d: number) => bigint;
    readonly omc_scripting_oms_addEventIndicator: (a: number) => bigint;
    readonly omc_scripting_oms_addExternalModel: (a: number, b: number, c: number) => bigint;
    readonly omc_scripting_oms_addSignalsToResults: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_addStaticValueIndicator: (a: number, b: number, c: number, d: number) => bigint;
    readonly omc_scripting_oms_addSubModel: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_addTLMConnection: (a: number, b: number, c: number, d: number, e: number, f: number) => bigint;
    readonly omc_scripting_oms_addTimeIndicator: (a: number) => bigint;
    readonly omc_scripting_oms_compareSimulationResults: (a: number, b: number, c: number, d: number, e: number) => bigint;
    readonly omc_scripting_oms_copySystem: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_delete: (a: number) => bigint;
    readonly omc_scripting_oms_deleteConnection: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_deleteConnectorFromBus: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_deleteConnectorFromTLMBus: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_export: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_exportDependencyGraphs: (a: number, b: number, c: number, d: number) => bigint;
    readonly omc_scripting_oms_exportSnapshot: (a: number) => number;
    readonly omc_scripting_oms_extractFMIKind: (a: number) => number;
    readonly omc_scripting_oms_getBoolean: (a: number) => number;
    readonly omc_scripting_oms_getFixedStepSize: (a: number) => number;
    readonly omc_scripting_oms_getInteger: (a: number, b: bigint) => bigint;
    readonly omc_scripting_oms_getModelState: (a: number) => number;
    readonly omc_scripting_oms_getReal: (a: number) => number;
    readonly omc_scripting_oms_getSolver: (a: number) => number;
    readonly omc_scripting_oms_getStartTime: (a: number) => number;
    readonly omc_scripting_oms_getStopTime: (a: number) => number;
    readonly omc_scripting_oms_getSubModelPath: (a: number) => number;
    readonly omc_scripting_oms_getSystemType: (a: number) => number;
    readonly omc_scripting_oms_getTolerance: (a: number) => number;
    readonly omc_scripting_oms_getVariableStepSize: (a: number) => number;
    readonly omc_scripting_oms_getVersion: () => number;
    readonly omc_scripting_oms_importFile: (a: number) => number;
    readonly omc_scripting_oms_importSnapshot: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_initialize: (a: number) => bigint;
    readonly omc_scripting_oms_instantiate: (a: number) => bigint;
    readonly omc_scripting_oms_list: (a: number) => number;
    readonly omc_scripting_oms_listUnconnectedConnectors: (a: number) => number;
    readonly omc_scripting_oms_loadSnapshot: (a: number, b: number) => number;
    readonly omc_scripting_oms_newModel: (a: number) => bigint;
    readonly omc_scripting_oms_removeSignalsFromResults: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_rename: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_reset: (a: number) => bigint;
    readonly omc_scripting_oms_setBoolean: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setCommandLineOption: (a: number) => bigint;
    readonly omc_scripting_oms_setFixedStepSize: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setInteger: (a: number, b: bigint) => bigint;
    readonly omc_scripting_oms_setLogFile: (a: number) => bigint;
    readonly omc_scripting_oms_setLoggingInterval: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setLoggingLevel: (a: bigint) => bigint;
    readonly omc_scripting_oms_setReal: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setRealInputDerivative: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setResultFile: (a: number, b: number, c: bigint) => bigint;
    readonly omc_scripting_oms_setSignalFilter: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setStartTime: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setStopTime: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_setTLMPositionAndOrientation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => bigint;
    readonly omc_scripting_oms_setTLMSocketData: (a: number, b: number, c: bigint, d: bigint) => bigint;
    readonly omc_scripting_oms_setTempDirectory: (a: number) => bigint;
    readonly omc_scripting_oms_setTolerance: (a: number, b: number, c: number) => bigint;
    readonly omc_scripting_oms_setVariableStepSize: (a: number, b: number, c: number, d: number) => bigint;
    readonly omc_scripting_oms_setWorkingDirectory: (a: number) => bigint;
    readonly omc_scripting_oms_simulate: (a: number) => bigint;
    readonly omc_scripting_oms_stepUntil: (a: number, b: number) => bigint;
    readonly omc_scripting_oms_terminate: (a: number) => bigint;
    readonly omc_scripting_parseEncryptedPackage: (a: number, b: number) => number;
    readonly omc_scripting_parseFile: (a: number, b: number) => number;
    readonly omc_scripting_parseString: (a: number, b: number) => number;
    readonly omc_scripting_plotAll: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number, o: number, p: number, q: number, r: number, s: number) => number;
    readonly omc_scripting_previous_saveTotalModel: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly omc_scripting_qualifyPath: (a: number, b: number) => number;
    readonly omc_scripting_readFile: (a: number) => number;
    readonly omc_scripting_readSimulationResultSize: (a: number) => bigint;
    readonly omc_scripting_readSimulationResultVars: (a: number, b: number, c: number) => number;
    readonly omc_scripting_realpath: (a: number) => number;
    readonly omc_scripting_reduceTerms: (a: number, b: number, c: number, d: bigint, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => number;
    readonly omc_scripting_refactorClass: (a: number) => number;
    readonly omc_scripting_regularFileExists: (a: number) => number;
    readonly omc_scripting_releaseModelInstanceReference: (a: bigint) => number;
    readonly omc_scripting_reloadClass: (a: number, b: number) => number;
    readonly omc_scripting_remove: (a: number) => number;
    readonly omc_scripting_removeComponentModifiers: (a: number, b: number, c: number) => number;
    readonly omc_scripting_removeElementModifiers: (a: number, b: number, c: number) => number;
    readonly omc_scripting_removeExtendsModifiers: (a: number, b: number, c: number) => number;
    readonly omc_scripting_renameClass: (a: number, b: number) => number;
    readonly omc_scripting_restoreAST: (a: bigint) => number;
    readonly omc_scripting_reverseLookup: (a: number, b: number, c: number, d: number) => number;
    readonly omc_scripting_rewriteBlockCall: (a: number, b: number) => number;
    readonly omc_scripting_runConversionScript: (a: number, b: number) => number;
    readonly omc_scripting_runScript: (a: number) => number;
    readonly omc_scripting_runScriptParallel: (a: number, b: bigint, c: number) => number;
    readonly omc_scripting_save: (a: number) => number;
    readonly omc_scripting_saveAll: (a: number) => number;
    readonly omc_scripting_saveModel: (a: number, b: number) => number;
    readonly omc_scripting_saveTotalModel: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly omc_scripting_saveTotalModelDebug: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly omc_scripting_searchClassNames: (a: number, b: number) => number;
    readonly omc_scripting_setCFlags: (a: number) => number;
    readonly omc_scripting_setCXXCompiler: (a: number) => number;
    readonly omc_scripting_setClassComment: (a: number, b: number) => number;
    readonly omc_scripting_setCommandLineOptions: (a: number) => number;
    readonly omc_scripting_setCompiler: (a: number) => number;
    readonly omc_scripting_setCompilerFlags: (a: number) => number;
    readonly omc_scripting_setComponentComment: (a: number, b: number, c: number) => number;
    readonly omc_scripting_setComponentCondition: (a: number, b: number, c: number) => number;
    readonly omc_scripting_setComponentProperties: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_scripting_setDocumentationAnnotation: (a: number, b: number, c: number) => number;
    readonly omc_scripting_setEnvironmentVar: (a: number, b: number) => number;
    readonly omc_scripting_setInstallationDirectoryPath: (a: number) => number;
    readonly omc_scripting_setLinker: (a: number) => number;
    readonly omc_scripting_setLinkerFlags: (a: number) => number;
    readonly omc_scripting_setModelicaPath: (a: number) => number;
    readonly omc_scripting_setNoSimplify: (a: number) => number;
    readonly omc_scripting_setShowAnnotations: (a: number) => number;
    readonly omc_scripting_setSourceFile: (a: number, b: number) => number;
    readonly omc_scripting_setTempDirectoryPath: (a: number) => number;
    readonly omc_scripting_solveLinearSystem: (a: number, b: number) => number;
    readonly omc_scripting_sortStrings: (a: number) => number;
    readonly omc_scripting_stat: (a: number) => number;
    readonly omc_scripting_storeAST: () => bigint;
    readonly omc_scripting_stringReplace: (a: number, b: number, c: number) => number;
    readonly omc_scripting_stringSplit: (a: number, b: number) => number;
    readonly omc_scripting_stringTypeName: (a: number) => number;
    readonly omc_scripting_strtok: (a: number, b: number) => number;
    readonly omc_scripting_system: (a: number, b: number) => bigint;
    readonly omc_scripting_system_parallel: (a: number, b: bigint) => number;
    readonly omc_scripting_threadWorkFailed: () => void;
    readonly omc_scripting_translateGraphics: (a: number) => number;
    readonly omc_scripting_translateModelFMU: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly omc_scripting_translateResidualsDAE: (a: number, b: number) => number;
    readonly omc_scripting_typeNameString: (a: number) => number;
    readonly omc_scripting_typeNameStrings: (a: number) => number;
    readonly omc_scripting_unloadOMSimulator: () => bigint;
    readonly omc_scripting_updateConnectionAnnotation: (a: number, b: number, c: number, d: number) => number;
    readonly omc_scripting_updateConnectionNames: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly omc_scripting_updateEquation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly omc_scripting_updatePackageIndex: () => number;
    readonly omc_scripting_upgradeInstalledPackages: (a: number) => number;
    readonly omc_scripting_uriToFilename: (a: number) => number;
    readonly omc_scripting_writeFile: (a: number, b: number, c: number) => number;
    readonly omc_seq_bool: (a: number, b: number) => number;
    readonly omc_seq_free: (a: number) => void;
    readonly omc_seq_int: (a: number, b: number) => bigint;
    readonly omc_seq_len: (a: number) => number;
    readonly omc_seq_new: () => number;
    readonly omc_seq_push_bool: (a: number, b: number) => void;
    readonly omc_seq_push_int: (a: number, b: bigint) => void;
    readonly omc_seq_push_real: (a: number, b: number) => void;
    readonly omc_seq_push_seq: (a: number, b: number) => void;
    readonly omc_seq_push_str: (a: number, b: number) => void;
    readonly omc_seq_real: (a: number, b: number) => number;
    readonly omc_seq_seq: (a: number, b: number) => number;
    readonly omc_seq_str: (a: number, b: number) => number;
    readonly ModelInstanceReference_get: (a: number) => number;
    readonly ModelInstanceReference_release: (a: number) => number;
    readonly omc_json_integer: (a: number) => bigint;
    readonly omc_json_iter_advance: (a: number) => void;
    readonly omc_json_iter_at_end: (a: number) => number;
    readonly omc_json_iter_free: (a: number) => void;
    readonly omc_json_iter_key: (a: number, b: number) => number;
    readonly omc_json_iter_new: (a: number) => number;
    readonly omc_json_iter_value: (a: number) => number;
    readonly omc_json_kind: (a: number) => number;
    readonly omc_json_number: (a: number) => number;
    readonly omc_json_string: (a: number, b: number) => number;
    readonly omc_set_loadmodel_callback: (a: number, b: number) => void;
    readonly omc_set_plot_callback: (a: number, b: number) => void;
    readonly wasi_write_file: (a: number, b: number, c: number, d: number) => void;
    readonly wasi_write_files: (a: any) => number;
    readonly wasm_bindgen_6102225ff9b5ba8___convert__closures________invoke___js_sys_52ae2eb98b551c2d___Array__core_6ebf190952f1f82c___result__Result_____wasm_bindgen_6102225ff9b5ba8___JsValue___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_6102225ff9b5ba8___convert__closures________invoke___js_sys_52ae2eb98b551c2d___Array__core_6ebf190952f1f82c___result__Result_js_sys_52ae2eb98b551c2d___Array__wasm_bindgen_6102225ff9b5ba8___JsValue___true_: (a: number, b: number, c: any) => [number, number, number];
    readonly wasm_bindgen_6102225ff9b5ba8___convert__closures________invoke___js_sys_52ae2eb98b551c2d___Array__core_6ebf190952f1f82c___result__Result_js_sys_52ae2eb98b551c2d___Array__wasm_bindgen_6102225ff9b5ba8___JsValue___true__40: (a: number, b: number, c: any) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
