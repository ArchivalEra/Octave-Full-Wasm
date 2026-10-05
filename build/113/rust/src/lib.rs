//! rust-sort 插件内核 —— 正典单一来源（本文件）。
//! 消费方：① build/113/build-rustsort.sh（wasm32 车道，rustc 直编——wasm32-emscripten
//! 有预编译 rust-std，不需要 build-std）；② 本 cargo 工程（wasm64 车道，build-std 出
//! core/alloc）；③ test/fixtures/rustsort-spike/run-spike.sh（G2 差分门 + G2b 变异自证，
//! wasm32）。缝 = Array-base.cc（fork f4bf15b）。
//!
//! 语义红线：IEEE 754 比较 + 稳定序。**缝在 Octave 的 NaN 分区之后调用**——本函数输入
//! 按构造无 NaN ⇒ partial_cmp 构成全序 ⇒ 稳定排序的"比较器非全序 panic"不可达
//! （评审 ①NaN 项的结构性回应；G2 差分门保留 NaN 域守分区正确性）。

#![no_std]
extern crate alloc;

use core::alloc::{GlobalAlloc, Layout};
use core::ffi::{c_int, c_void};

// ── 宿主胶水：emscripten libc 供给（评审 ②）。
// wasm64 下指针=i64、usize=i64，与 C++ 侧 `double*`/`long long` 对齐。
extern "C" {
    fn malloc(size: usize) -> *mut u8;
    fn realloc(p: *mut u8, size: usize) -> *mut u8;
    fn free(p: *mut u8);
    fn posix_memalign(memptr: *mut *mut c_void, align: usize, size: usize) -> c_int;
    fn abort() -> !;
}

/// 全局分配器：转发宿主 malloc/free/realloc/posix_memalign。
/// 不开 compiler-builtins-mem（评审 ②：避免弱定义覆盖 emscripten 的优化 mem 系列）。
struct HostAlloc;

unsafe impl GlobalAlloc for HostAlloc {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        if l.align() <= 8 {
            malloc(l.size())
        } else {
            let mut p: *mut c_void = core::ptr::null_mut();
            if posix_memalign(&mut p, l.align(), l.size()) == 0 {
                p as *mut u8
            } else {
                core::ptr::null_mut()
            }
        }
    }
    unsafe fn dealloc(&self, p: *mut u8, _l: Layout) {
        free(p)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, new_size: usize) -> *mut u8 {
        if l.align() <= 8 {
            realloc(p, new_size)
        } else {
            // 对齐块不走宿主 realloc（宿主不知道对齐约定）——保守：新块+拷贝+释放
            let q = self.alloc(Layout::from_size_align_unchecked(new_size, l.align()));
            if !q.is_null() {
                core::ptr::copy_nonoverlapping(p, q, l.size().min(new_size));
                self.dealloc(p, l);
            }
            q
        }
    }
}

#[global_allocator]
static HOST_ALLOC: HostAlloc = HostAlloc;

/// panic = 宿主 abort（panic=abort 策略下不需要 unwind/personality）。
#[panic_handler]
fn ph(_: &core::panic::PanicInfo<'_>) -> ! {
    unsafe { abort() }
}

/// 稳定排序内核（driftsort 谱系，Rust 1.81+ std 同源）。稳定序 + IEEE 比较，
/// 与 octave_sort<double>（timsort）逐位一致（G2：22 域差分 + 20k 重复值 + desc 顺序断言）。
#[no_mangle]
pub extern "C" fn octave_rust_sort_f64(v: *mut f64, n: i64, descending: i32) {
    let s = unsafe { core::slice::from_raw_parts_mut(v, n as usize) };
    if descending != 0 {
        s.sort_by(|a, b| b.partial_cmp(a).unwrap_or(core::cmp::Ordering::Equal));
    } else {
        s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
    }
}
