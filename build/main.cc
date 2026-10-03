// Copyright 2022 Richard Lincoln. All rights reserved.

#include <string>
#include <iostream>
#include <cstdlib>      // setenv（fontconfig 的运行期配置，见 execute_interp）
#include <sys/stat.h>   // mkdir（fontconfig 的缓存目录）

#include <oct.h>
#include <octave.h>
#include <parse.h>
#include <interpreter.h>
#include <builtin-defun-decls.h>
#include <octave/quit.h>   // octave_interrupt_state / interrupt_exception（批次 3 G4）

#include <emscripten.h>
#include <emscripten/bind.h>

// dldfcn modules (__delaunayn__/convhulln/__glpk__/fftw/gzip/audioread/…) are
// NOT registered here any more: they are ordinary .oct side modules loaded at
// runtime by dlopen — the same mechanism desktop Octave uses, and the same one
// this build already used for the Forge packages and the web* modules.
//
// History, because this is the first place to look when a function goes
// missing: an earlier version kept a STATIC_DLD_FCNS table here that drove each
// module's G_installer by hand and installed it as a *built-in*
// (symtab.install_built_in_function).  That was invented when dlopen looked
// impossible in wasm — the upstream fork had gutted oct-shlib.cc and never
// built dldfcn at all.  Once the real dlopen path was restored (see
// build/CLIBS.md「真 .oct 动态装载」) the hand-registration became both
// unnecessary and wrong: it made exist() report 5 and which() say
// "built-in function", where desktop Octave reports 3 and a file path.
//
// The modules now ship as lazy assets; bridge/index.html loads the core group
// at startup, so the out-of-the-box experience is unchanged.

const std::string OBJ_TYPE_KEY = "$type";

const std::string MATRIX_ROWS_KEY = "rows";
const std::string MATRIX_COLS_KEY = "cols";
const std::string MATRIX_DATA_KEY = "data";

const std::string MATRIX_TYPE_VALUE = "matrix";
const std::string COMPLEX_MATRIX_TYPE_VALUE = "complex_matrix";
const std::string SPARSE_MATRIX_TYPE_VALUE = "sparse_matrix";
const std::string SPARSE_COMPLEX_MATRIX_TYPE_VALUE = "sparse_complex_matrix";

std::unique_ptr<octave::interpreter> interpreter;

// ── 就绪守卫（工单 46，2026-10-03）─────────────────────────────────────────────
// 票 40 的残留尖角：boot 中途（OpenBLAS 建池窗口）调 eval/feval，NT=4 上干净抛错、
// **NT=8 上主线程卡死在 wasm 里**（页内 setTimeout 都停摆 ⇒ 任何 JS 层 catch 都救不了，
// embed 门面的 try/catch 也被穿透）。守卫 = wasm 边界上的**快速 JS Error**：
// execute_interp() 完成前置位旗标，两个 eval 入口（feval / eval_string）先查旗标，
// 未就绪就 throw 一个真 JS Error（emscripten::val::throw_ —— 消息逐字到 JS，
// 不依赖 embind 的异常映射）。quit_interp 后复位 ⇒ 退出后的调用同样干净拒绝。
#include <atomic>
static std::atomic<bool> g_interp_ready{false};

static void require_interp_ready () {
  if (!g_interp_ready.load (std::memory_order_acquire)) {
    emscripten::val::global ("Error")
        .new_(std::string ("octave interpreter not ready: await __octaveReady "
                           "before eval/feval (see ticket 40/46)"))
        .throw_ ();
  }
}

octave_value em_val_to_octave_value(emscripten::val em_val) {
  if (em_val.instanceof(emscripten::val::global("Boolean"))) {
    return octave_value(em_val.as<bool>());
  } else if (em_val.isString()) {
    return octave_value(em_val.as<std::string>());
  } else if (em_val.isNumber()) {
    return octave_value(em_val.as<double>());
  } else if (em_val.isArray()) {
    octave_value_list val_list;
    const int l = em_val["length"].as<int>();

    for (int i = 0; i < l; i++) {
      emscripten::val val_i = em_val[i];
      val_list(i) = em_val_to_octave_value(val_i);
    }

    return octave_value(val_list);
  } else if (em_val.typeOf().as<std::string>() == "object" && !em_val.isNull() && !em_val.isArray()) {
    if (em_val.hasOwnProperty(OBJ_TYPE_KEY.c_str())) {
      std::string obj_type_str = em_val[OBJ_TYPE_KEY].as<std::string>();

      if (obj_type_str == MATRIX_TYPE_VALUE) {
        const int rows = em_val[MATRIX_ROWS_KEY].as<int>();
        const int cols = em_val[MATRIX_COLS_KEY].as<int>();

        Matrix matrix(rows, cols);

        emscripten::val arr = em_val[MATRIX_DATA_KEY];
        for (int c = 0; c < cols; c++) {
          for (int r = 0; r < rows; r++) {
            emscripten::val elem = arr[c * rows + r];
            matrix(r, c) = elem.as<double>();
          }
        }

        return octave_value(matrix);
      } else if (obj_type_str == SPARSE_MATRIX_TYPE_VALUE) {
        const int rows = em_val[MATRIX_ROWS_KEY].as<int>();
        const int cols = em_val[MATRIX_COLS_KEY].as<int>();

        SparseMatrix matrix(rows, cols);
        // TODO: sparse matrix

        return octave_value(matrix);
      } else if (obj_type_str == SPARSE_COMPLEX_MATRIX_TYPE_VALUE) {
        const int rows = em_val[MATRIX_ROWS_KEY].as<int>();
        const int cols = em_val[MATRIX_COLS_KEY].as<int>();

        SparseComplexMatrix matrix(rows, cols);
        // TODO: sparse complex matrix

        return octave_value(matrix);
      } else {
        std::cerr << "error: invalid object type: " << obj_type_str << std::endl;
        return octave_value();  // TODO: return Octave null
      }
    }


    octave_scalar_map scalar_map;
    emscripten::val keys = emscripten::val::global("Object").call<emscripten::val>("keys", em_val);

    const int l = keys["length"].as<int>();

    for (int i = 0; i < l; i++) {
      emscripten::val key_i = keys[i];
      emscripten::val key_value = em_val[key_i];

      octave_value oct_value = em_val_to_octave_value(key_value);
      scalar_map.setfield(key_i.as<std::string>(), oct_value);
    }

    return octave_value(scalar_map);
  } else {
    std::cerr << "error: invalid type " << em_val.typeOf().as<std::string>() << std::endl;
    return octave_value();  // TODO: return Octave null
  }
}

emscripten::val octave_value_to_em_val(octave_value value) {
  if (value.islogical()) {
    return emscripten::val(value.bool_value());
  } else if (value.is_string()) {
    return emscripten::val(value.string_value());
  } else if (value.is_scalar_type()) {
    return emscripten::val(value.scalar_value());
  } else if (value.isstruct()) {
    emscripten::val obj = emscripten::val::object();

    octave_scalar_map scalar_map = value.scalar_map_value();
    string_vector field_names = scalar_map.fieldnames();
    for (int i = 0; i < field_names.numel(); i++) {
      const std::string field_name = field_names.elem(i);
      octave_value field = scalar_map.getfield(field_name);
      obj.set(field_name, octave_value_to_em_val(field));
    }

    return obj;
  } else if (value.is_real_matrix()) {
    emscripten::val obj = emscripten::val::object();
    obj.set(OBJ_TYPE_KEY, emscripten::val(MATRIX_TYPE_VALUE));
    Matrix matrix = value.matrix_value();

    octave_idx_type rows = matrix.rows();
    octave_idx_type cols = matrix.cols();
    obj.set(MATRIX_ROWS_KEY, rows);
    obj.set(MATRIX_COLS_KEY, cols);

    emscripten::val arr = emscripten::val::array();
    double *fortran_vec = matrix.fortran_vec();
    for (int i = 0; i < rows * cols; i++) {
      arr.call<void>("push", fortran_vec[i]);
    }
    obj.set(MATRIX_DATA_KEY, arr);

    return obj;
  } else if (value.is_complex_matrix()) {
    emscripten::val obj = emscripten::val::object();
    obj.set(OBJ_TYPE_KEY, emscripten::val(COMPLEX_MATRIX_TYPE_VALUE));
    Matrix matrix = value.matrix_value();

    octave_idx_type rows = matrix.rows();
    octave_idx_type cols = matrix.cols();
    obj.set(MATRIX_ROWS_KEY, rows);
    obj.set(MATRIX_COLS_KEY, cols);

    emscripten::val arr = emscripten::val::array();
    double *fortran_vec = matrix.fortran_vec();
    for (int i = 0; i < rows * cols; i++) {
      arr.call<void>("push", std::real(fortran_vec[i]));
      arr.call<void>("push", std::imag(fortran_vec[i])); // interleave
    }
    obj.set(MATRIX_DATA_KEY, arr);

    return obj;
  } else if (value.issparse()) {
    if (value.isreal()) {
      emscripten::val obj = emscripten::val::object();
      obj.set(OBJ_TYPE_KEY, emscripten::val(SPARSE_MATRIX_TYPE_VALUE));
      SparseMatrix matrix = value.sparse_matrix_value();

      octave_idx_type rows = matrix.rows();
      octave_idx_type cols = matrix.cols();
      obj.set(MATRIX_ROWS_KEY, rows);
      obj.set(MATRIX_COLS_KEY, cols);

      octave_idx_type nnz = matrix.cols();
      obj.set("nnz", nnz);

      emscripten::val row_idx = emscripten::val::array();
      octave_idx_type *ridx = matrix.ridx();
      for (octave_idx_type i = 0; i < nnz; i++) {
        row_idx.call<void>("push", ridx[i]);
      }
      obj.set("row_idx", row_idx);

      emscripten::val col_ptr = emscripten::val::array();
      octave_idx_type *cidx = matrix.cidx();
      for (octave_idx_type i = 0; i < cols; i++) {
        col_ptr.call<void>("push", cidx[i]);
      }
      obj.set("col_ptr", col_ptr);

      emscripten::val arr = emscripten::val::array();
      double *data = matrix.data();
      for (octave_idx_type i = 0; i < nnz; i++) {
        arr.call<void>("push", data[i]);
      }
      obj.set(MATRIX_DATA_KEY, arr);

      return obj;
    } else if (value.iscomplex()) {
      emscripten::val obj = emscripten::val::object();
      obj.set(OBJ_TYPE_KEY, emscripten::val(SPARSE_COMPLEX_MATRIX_TYPE_VALUE));
      SparseComplexMatrix matrix = value.sparse_complex_matrix_value();

      octave_idx_type rows = matrix.rows();
      octave_idx_type cols = matrix.cols();
      obj.set(MATRIX_ROWS_KEY, rows);
      obj.set(MATRIX_COLS_KEY, cols);

      octave_idx_type nnz = matrix.cols();
      obj.set("nnz", nnz);

      emscripten::val row_idx = emscripten::val::array();
      octave_idx_type *ridx = matrix.ridx();
      for (octave_idx_type i = 0; i < nnz; i++) {
        row_idx.call<void>("push", ridx[i]);
      }
      obj.set("row_idx", row_idx);

      emscripten::val col_ptr = emscripten::val::array();
      octave_idx_type *cidx = matrix.cidx();
      for (octave_idx_type i = 0; i < cols; i++) {
        col_ptr.call<void>("push", cidx[i]);
      }
      obj.set("col_ptr", col_ptr);

      emscripten::val arr = emscripten::val::array();
      Complex *data = matrix.data();
      for (octave_idx_type i = 0; i < nnz; i++) {
        arr.call<void>("push", std::real(data[i]));
        arr.call<void>("push", std::imag(data[i]));
      }
      obj.set(MATRIX_DATA_KEY, arr);

      return obj;
    }
  }

  std::cerr << "error: octave_value invalid type: " << value.type_name() << std::endl;
  return emscripten::val::undefined();
}

int value_list_to_em_val(octave_value_list val_list, emscripten::val &em_val) {
  if (!em_val.isArray()) {
    std::cerr << "error: val reference must be an array" << std::endl;
    return 1;
  }

  for (int i = 0; i < val_list.length(); i++) {
    octave_value val_i = val_list(i);

    emscripten::val em_val_i = octave_value_to_em_val(val_i);
    if (!em_val.isUndefined()) {
      em_val.call<void>("push", em_val_i);
    }
  }

  return 0;
}

std::string EMSCRIPTEN_KEEPALIVE last_err_msg() {
    return interpreter->get_error_system().last_error_message();
}

emscripten::val EMSCRIPTEN_KEEPALIVE feval(std::string fn_name, emscripten::val args_val, int nargout) {
  require_interp_ready ();
  if (!args_val.isArray()) {
    std::cerr << "error: feval args value must be an array" << std::endl;
    return emscripten::val::undefined();
  }
  octave_value in = em_val_to_octave_value(args_val);

//  std::cout << "feval: " << fn_name << " " << in.length() << " " << nargout << std::endl;

  octave_value_list out;
  try {
    out = octave::feval(fn_name, in.list_value(), nargout);
  } catch (const octave::execution_exception& ex) {
    interpreter->handle_exception(ex);
    std::cerr << "execution exception: " << interpreter->get_error_system().last_error_message() << std::endl;
    return emscripten::val::undefined();
  }

  // The length of the list is not necessarily the same as nargout.
  emscripten::val rv = emscripten::val::array();
  if (value_list_to_em_val(out, rv)) {
    return emscripten::val::undefined();
  }

//  std::cout << "rv: " << fn_name << " " << rv["length"].as<int>() << std::endl;

  return rv;
}

int EMSCRIPTEN_KEEPALIVE eval_string(std::string eval_str) {
  require_interp_ready ();
  bool silent = false;
  int parse_status = 0;
  int nargout = 0;
//  std::cout << "eval_string: " << eval_str << " " << " " << nargout << std::endl;

  try {
    interpreter->eval_string(eval_str, silent, parse_status, nargout);
  } catch (const octave::execution_exception& ex) {
    interpreter->handle_exception(ex);
    return 2;
  } catch (const octave::interrupt_exception&) {
    // G4 Ctrl-C：web_request_interrupt 置位后，安全点抛 interrupt_exception。
    // ★ 必须**复位旗标**——否则后面每条命令在第一个安全点继续炸（解释器变砖）。
    //   rc=3 与执行错误(2)区分；interrupt_exception 不是 execution_exception 的子类，
    //   不能走 handle_exception（它只收后者）。
    octave_interrupt_state.store (0);
    return 3;
  }

  return 0;
}

// ── G1（2026-09-25，B 姿势）：可挂起的解释器入口 ──────────────────────────────
// **为什么是 extern "C" 而不是 embind async**：`WebAssembly.promising()` 只能包
// **真 wasm 导出**，而 embind 的 JS 名（eval_async）不是；且实测 5.0.7 里 `-sJSPI`
// 会让 `dlopen` 无条件变成挂起点（`__dlopen_js.isAsync=true`，NOTES-jspi「A2 最小
// 实验」），手搓 JSPI（页面钩子包 import + 页面 `promising` 包入口）完全绕开它。
// ★ 同步的 `eval_string` 一字不改 —— 它被 39 个验收套件 + 页面命令队列同步调用。
extern "C" int eval_wait (const char *eval_str) {
  return eval_string (std::string (eval_str));
}

// G2 的挂起点（本批预埋好，省一次重链）：m 侧 `__web_pause_ms__`（webpause.oct）
// 经它转发到 JS 库函数 `web_sleep_ms`（build/webjslib.js，返回 Promise）。
// 页面钩子把 env 里的 `web_sleep_ms` 包成 `WebAssembly.Suspending` ⇒ 在
// promising 栈上调用它时整个 wasm 栈真挂起、页面事件循环照常跑。
extern "C" void web_sleep_ms (int ms);
// ★ G4：web_pause_ms 是**可靠的中断投递点**——挂起 resume 之后查中断旗标，
//   置位就抛 interrupt_exception（-fwasm-exceptions 沿调用栈正常退绕，eval_string
//   的 interrupt 捕获转 rc=3）。CPU 密集且不含 pause 的循环仍然打不断（没有安全点），
//   如实记：不是抢占。
extern "C" void web_pause_ms (int ms) {
  web_sleep_ms (ms);
  if (octave_interrupt_state.load () == 1)
    {
      octave_interrupt_state.store (0);
      throw octave::interrupt_exception ();
    }
}

// ── 批次 3（2026-09-25）：交互原语（G3 取点 / D9 门槛 / G4 Ctrl-C）────────────
// 全部是"主模块导出 → JS import（webjslib.js）→ 页面队列/能力"的转发器。
// ⚠️ ginput 的等待**不**在这里挂起：轮询循环靠 `__web_pause_ms__`（已挂起）让出，
//    pop/arm/pending 是**即返**原语（B 姿势下不需要每个 import 都可挂起）。

// D9 门槛：页面钩子是否真的包上了 Suspending（无 JSPI API 的浏览器 = 0）。
// m 侧 shim 用它做**Octave 层的能力门**（pause/ginput/keyboard 先问它）。
extern "C" int web_suspend_ok_impl (void);
extern "C" EMSCRIPTEN_KEEPALIVE int web_suspend_ok (void) { return web_suspend_ok_impl (); }

// G3：点击队列。arm = 清空并开始收点；pending = 队列长度；
// pop = 弹一个点：v[0]=x v[1]=y（画布 CSS px，y 向下）、v[2]=rect宽、v[3]=rect高、
// 返回按键（1 左 / 2 中 / 3 右），队列空 = -1。坐标→数据的映射在 `__webgl_ginput__.m`。
extern "C" int web_ginput_arm_impl (void);
extern "C" EMSCRIPTEN_KEEPALIVE int web_ginput_arm (void) { return web_ginput_arm_impl (); }
extern "C" int web_ginput_pending_impl (void);
extern "C" EMSCRIPTEN_KEEPALIVE int web_ginput_pending (void) { return web_ginput_pending_impl (); }
extern "C" int web_ginput_pop_impl (double *v);
extern "C" EMSCRIPTEN_KEEPALIVE int web_ginput_pop (double *v) { return web_ginput_pop_impl (v); }

// G4 Ctrl-C：置位中断旗标，解释器在下一个安全点抛 interrupt_exception。
// ⚠️ CPU 密集循环不经过安全点 ⇒ 只有循环里含 pause/yield 时页面才递得进中断
//    （如实记：不是抢占）。
extern "C" EMSCRIPTEN_KEEPALIVE void web_request_interrupt (void) {
  octave_interrupt_state.store (1);
}

////int EMSCRIPTEN_KEEPALIVE execute_cli(std::vector<std::string> args) {
//int EMSCRIPTEN_KEEPALIVE execute_cli() {
////  int argc = args.size()
////  std::vector<char *> argv;
////  for (std::string &arg : args) {
////    argv.push_back(const_cast<char *>(arg.c_str()));
////  }
//
//  octave::cmdline_options options;
//  options.forced_interactive(true);
//
////  check_hg_versions ();
//
////  octave_block_async_signals ();
//
////  octave::sys::env::set_program_name (argv[0]);
//
////  octave::cli_application app(argc, argv.data());
//  octave::cli_application app(options);
//
//  return app.execute();
//
////  interpreter& interp = app.create_interpreter();
////  int status = interp.execute();
////  return status;
//}

#if defined (P5_WEBGL_TOOLKIT)
// 图形线 WebGL：由 build/113/webgl_toolkit.cc 提供（编进主模块，见该文件头）。
// 2026-09-23 起这是**唯一的**真渲染器 —— OSMesa 后端已退役（脚本与配方留在 git 历史的
// graphics-osmesa / graphics-osmesa-p5 分支，记录见 build/113/NOTES-p5-osmesa.md）。
extern "C" void p5_install_webgl_graphics_toolkit (octave::interpreter& interp);
#endif

int EMSCRIPTEN_KEEPALIVE execute_interp() {
  // ── fontconfig 的**运行期配置**（R3，2026-09-24）────────────────────────────
  // 为什么必须在**这里**（进程内）设，而不是页面或外层 shell：
  //   ① `--sysconfdir=/` 编出来的默认配置文件名是 **`//fonts/fonts.conf`（双斜杠）**，
  //      Emscripten 的 FS 解析不到它 ⇒ 不显式给变量时 `FcFontList()` 恒为 **0 个 face**
  //      **且一声不响**（现象像"字体没装"，其实是"配置没读到"）。
  //   ② 页面侧没有任何口子改 wasm 的 ENV：生成的 glue 里没有 `Module.ENV`，而宿主
  //      （node/浏览器）的环境变量**不会**进 wasm 的 ENV —— 两条都在机制闸门
  //      `build/113/probe-fontconfig.sh` 里实测过（`FONTCONFIG_FILE=(unset)` 恒成立）。
  // 配置内容（`<dir>` 指向预载字体的 octfontsdir、`<cachedir>` 指向 /tmp 下的目录）
  // 由 `build/113/link-web.sh` 生成并预载到 `/fonts/fonts.conf`。
  setenv ("FONTCONFIG_FILE", "/fonts/fonts.conf", 1);
  // 缓存目录：建不出来只是"不写缓存"（fontconfig 对不可写的 cachedir 是静默跳过），
  // 不影响 `FcFontList`/`FcFontMatch` 的结果 ⇒ 这里是**尽力而为**，不看返回值。
  mkdir ("/tmp/fontconfig-cache", 0700);

  std::cout << "Starting GNU Octave interpreter..." << std::endl;

  interpreter.reset(new octave::interpreter());

  interpreter->initialize_load_path(true);
  interpreter->read_init_files(true);
  int status = interpreter->execute();
  if (status != 0) {
      std::cerr << "creating interpreter failed: " << status << std::endl;
      return status;
  }

  // Phase 1: the original 16 dirs (proven good) — one shot, abort on failure.
  //
  // 开头额外加上 `m` 目录**本身**（不只是它的子目录）。这不是可有可无的：
  // Octave 11.x 的 m/ 下有 `+matlab`、`+containers`、`@ftp` 三个特殊目录
  // （`+` 是包命名空间、`@` 是类目录），它们**不是靠自己被 addpath 解析**，
  // 而是靠**父目录 m/ 在 path 上**才解析得到。
  // 依据（实读本机同版 octave 11.3.0 的 path()）：里面确实有
  // `/usr/share/octave/11.3.0/m` 这一条，却没有单独列 `+matlab` 等。
  // 7.2 时代没有这类目录，所以当时不需要这一条——这是 11.x 的差异，别照抄 7.2。
  try {
    octave_value_list octave_paths;
    octave_paths(0) = octave_value("/usr/src/octave/m:"
        "/usr/src/octave/m/help:"
        "/usr/src/octave/m/general:"
        "/usr/src/octave/m/set:"
        "/usr/src/octave/m/miscellaneous:"
        "/usr/src/octave/m/strings:"
        "/usr/src/octave/m/sparse:"
        "/usr/src/octave/m/statistics:"
        "/usr/src/octave/m/elfun:"
        "/usr/src/octave/m/path:"
        "/usr/src/octave/m/io:"
        "/usr/src/octave/m/polynomial:"
        "/usr/src/octave/m/pkg:"
        "/usr/src/octave/m/time:"
        "/usr/src/octave/m/specfun:"
        "/usr/src/octave/m/legacy:"
        "/usr/src/octave/m/linear-algebra", '\'');
    Faddpath(*interpreter, octave_paths);
  } catch (const octave::exit_exception& ex) {
    return ex.exit_status();
  } catch (const octave::execution_exception& ex) {
    interpreter->handle_exception(ex);
    std::cerr << "error adding paths: " << interpreter->get_error_system().last_error_message() << std::endl;
    return 1;
  }

  // Phase 2: extra dirs one at a time — a single bad PKG_ADD (e.g.
  // optimization's, which needs unique from set/) can't abort the rest.
  // NOTE: no @ftp (browser FTP class is pointless), no +package dirs
  // (Octave resolves those via the parent dir, added last).
  const char *extra_dirs[] = {
    "audio", "deprecated", "geometry", "gui", "image", "java",
    "ode", "optimization", "plot", "plot/appearance", "plot/draw",
    "plot/util", "prefs", "profiler", "signal", "special-matrix",
    "startup", "testfun", "web", "forge", "plotbridge", ".", nullptr
  };
  for (int i = 0; extra_dirs[i] != nullptr; i++) {
    try {
      octave_value_list p;
      p(0) = octave_value(std::string("/usr/src/octave/m/") + extra_dirs[i], '\'');
      Faddpath(*interpreter, p);
    } catch (const octave::exit_exception& ex) {
      return ex.exit_status();
    } catch (const octave::execution_exception& ex) {
      interpreter->handle_exception(ex);
      std::cerr << "warning: skipping path dir " << extra_dirs[i]
                << ": " << interpreter->get_error_system().last_error_message() << std::endl;
    }
  }

  // No Phase 3 any more.  dldfcn modules arrive as .oct assets and are dlopen'd
  // on demand — see the note at the top of this file for why the old
  // hand-registration was removed.

#if defined (P5_WEBGL_TOOLKIT)
  // 图形线 WebGL：登记 + 装载 `webgl` 图形 toolkit（同一条 opengl_renderer，
  // 但渲染目标是**真 WebGL2 上下文**，GL 1.x 调用由 gl4es 翻译 ⇒ 走 GPU）。
  // 同样必须编进主模块；而且**本 TU 是唯一实例化 `opengl_functions` 的地方**，
  // 所以它必须用 gl4es 的 include 编译（见 webgl_toolkit.cc 的文件头）。
  try {
    p5_install_webgl_graphics_toolkit (*interpreter);
  } catch (const octave::exit_exception& ex) {
    return ex.exit_status();
  } catch (const octave::execution_exception& ex) {
    interpreter->handle_exception(ex);
    std::cerr << "warning: webgl graphics toolkit not installed: "
              << interpreter->get_error_system().last_error_message() << std::endl;
  }
#endif

  // ★ 就绪旗标置位（工单 46）：到这里 interpreter 全部装配完（含 GL toolkit），
  //   与页面侧 `__octaveReady` 的语义严格对齐 —— 旗标只保证"碰解释器不再挂"。
  g_interp_ready.store (true, std::memory_order_release);
  return 0;
}

void EMSCRIPTEN_KEEPALIVE quit_interp() {
  try {
    interpreter->quit(0, false, false);
  } catch (const octave::exit_exception& ex) {
  }
  interpreter.reset();
  g_interp_ready.store (false, std::memory_order_release);
}

int main(int argc, char **argv) {
  if (argc > 1) {
    std::cerr << "invalid command: " << argv[1] << std::endl;
    return 2;
  }

  return 0;
}

EMSCRIPTEN_BINDINGS(my_module) {
//  emscripten::function("execute_cli", &execute_cli);
  emscripten::function("execute_interp", &execute_interp);
  emscripten::function("quit_interp", &quit_interp);
  emscripten::function("last_error_message", &last_err_msg);
  emscripten::function("feval", &feval);
  emscripten::function("eval_string", &eval_string);
  // ── G1（2026-09-24 → 2026-09-25 退役）：embind `eval_async` ────────────────
  // 退役原因：`WebAssembly.promising()` 只能包**真 wasm 导出**，embind 的 JS 名不行
  //（第一次 G1"失败"的真因之一）；且 `-sJSPI` 在 5.0.7 有 dlopen 连带（见上）。
  // 替代品 = 上面的 `eval_wait`（extern "C" 薄导出）+ 页面把它 promising 化后仍以
  // `Module.eval_async` 这个名字暴露 ⇒ 页面级 API 与 G0 门机制**全部不变**。
}
