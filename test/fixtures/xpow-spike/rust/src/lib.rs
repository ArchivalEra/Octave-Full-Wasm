//! xpow 驱动 spike 的 Rust 侧（候选④打样）：紧循环 + 同一个 libm pow，
//! 无逐元素 quit 检查、无逐元素索引开销 —— 量「驱动层」能省多少。
#![no_std]

extern "C" { fn pow(x: f64, y: f64) -> f64; fn abort() -> !; }

// spike 用：panic = 直接 abort（无 unwind；与正典 rust-sort 库同策略）
#[panic_handler]
fn ph(_: &core::panic::PanicInfo<'_>) -> ! { unsafe { abort() } }

#[no_mangle]
pub extern "C" fn xpow_cand(a: *const f64, out: *mut f64, n: i64, b: f64) {
    let mut i: i64 = 0;
    while i < n {
        unsafe { *out.offset(i as isize) = pow(*a.offset(i as isize), b); }
        i += 1;
    }
}

/// G6 仪器（Rust 侧原型）：每 `every` 元素查一次 quit 标志，返回看到标志时的索引。
#[no_mangle]
pub extern "C" fn xpow_cand_batched(
    a: *const f64, out: *mut f64, n: i64, b: f64,
    quit_flag: *const u8, every: i64,
) -> i64 {
    let mut i: i64 = 0;
    let mut cnt: i64 = 0;
    while i < n {
        if every > 0 {
            cnt += 1;
            if cnt >= every {
                cnt = 0;
                if unsafe { *quit_flag } != 0 { return i; }
            }
        }
        unsafe { *out.offset(i as isize) = pow(*a.offset(i as isize), b); }
        i += 1;
    }
    n
}
