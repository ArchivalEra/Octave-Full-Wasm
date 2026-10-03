# test/fixtures

## relaxed_madd_min.wasm（86 B 起，794 B）

**已知含 `f64x2.relaxed_madd` 的最小 wasm 模块** —— 用作**仪器校准样本**
（Einfacht issue #6 ① 的 `calibrate`；事实键 `w64_relaxed_madd`）。

为什么需要它：验证"产物里有没有 relaxed_madd"时，`llvm-objdump -d | grep relaxed_madd`
在 emsdk 5.0.7 上**恒为 0**（该 objdump 对这条指令打印 `<unknown>`）—— 仪器静默失真，
据此误判过两次。⇒ 计数前先用**已知含该指令的样本**证明"仪器看得见"，再对产物计数。

复现（生成方式，`fd 87 02` 即 f64x2.relaxed_madd 的字节编码）：
```sh
printf '#include <wasm_simd128.h>\nv128_t f(v128_t a,v128_t b,v128_t c){return wasm_f64x2_relaxed_madd(a,b,c);}\n' > rm.c
clang --target=wasm32-unknown-unknown -mrelaxed-simd -O2 -c rm.c -o rm.o
wasm-ld rm.o -o relaxed_madd_min.wasm --no-entry --export-all
python3 -c "print(open('relaxed_madd_min.wasm','rb').read().count(bytes([0xFD,0x87,0x02])))"  # ⇒ 1
```
