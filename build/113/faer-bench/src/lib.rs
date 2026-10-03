//! faer vs OpenBLAS 微基准（工单 49）—— 天花板测试：纯原始导出，无 bindgen/无胶水
//! 判决设计：faer-单线程-wasm32 对打 OpenBLAS-单线程-wasm32（e2-single 车道，同条件）。
//! faer 若在同等条件下赢 ≥30%，才值得追 8 线程（rayon）与 wasm64 平价；否则车道结案。
use faer::Mat;

// wasm32-unknown-unknown 的 std::time::Instant 未实现（实测 panic）⇒ 用显式导入的
// performance.now（JS 侧注入 env.now_ms）。
#[link(wasm_import_module = "env")]
extern "C" {
    fn now_ms() -> f64;
}

fn fill(n: usize) -> (Vec<f64>, Vec<f64>) {
    let mut a = Vec::with_capacity(n * n);
    let mut b = Vec::with_capacity(n * n);
    let mut s: f64 = 1.0;
    for _ in 0..n * n {
        s = (s * 16807.0) % 2147483647.0;
        a.push(s);
        s = (s * 16807.0) % 2147483647.0;
        b.push(s * 0.5 + 1.0);
    }
    (a, b)
}

/// faer 的 n×n 乘法，iters 轮取最小值（毫秒）。矩阵在函数内构造，防外部偏置。
#[no_mangle]
pub extern "C" fn faer_dgemm_ms(n: usize, iters: usize) -> f64 {
    let (a, b) = fill(n);
    let ma = Mat::from_fn(n, n, |i, j| a[i * n + j]);
    let mb = Mat::from_fn(n, n, |i, j| b[i * n + j]);
    let _warm = &ma * &mb;                                   // 预热（页分配/缓存）
    let mut best = f64::INFINITY;
    for _ in 0..iters {
        let t = unsafe { now_ms() };
        let c = &ma * &mb;
        let dt = unsafe { now_ms() } - t;
        std::hint::black_box(c[(0, 0)]);
        if dt < best {
            best = dt;
        }
    }
    best
}

/// 朴素三方循环（i-k-j 无分块）：autovec 下界参照，只用于小 n
#[no_mangle]
pub extern "C" fn naive_dgemm_ms(n: usize, iters: usize) -> f64 {
    let (a, b) = fill(n);
    let mut c = vec![0.0f64; n * n];
    let mut best = f64::INFINITY;
    for _ in 0..iters {
        let t = unsafe { now_ms() };
        for i in 0..n {
            for k in 0..n {
                let aik = a[i * n + k];
                for j in 0..n {
                    c[i * n + j] += aik * b[k * n + j];
                }
            }
        }
        let dt = unsafe { now_ms() } - t;
        std::hint::black_box(c[0]);
        if dt < best {
            best = dt;
        }
    }
    best
}
