// 决定性实验：wasm 里的 C 能否**同步**调 pyodide.runPython 并拿回值？
// 若成立 ⇒ 不需要 JSPI / Asyncify / Atomics（Claude 调研的"推论"）
#include <stdio.h>
#include <emscripten.h>

// JS 库函数：把 python 表达式的结果写进调用方给的缓冲区
EM_JS(int, py_eval_into, (const char *expr, char *out, int cap), {
  try {
    const r = globalThis.pyodide.runPython(UTF8ToString(expr));
    const s = String(r);
    const n = Math.min(s.length, cap - 1);
    stringToUTF8(s, out, n + 1);
    return n;
  } catch (e) {
    stringToUTF8('ERR:' + String(e), out, cap - 1);
    return -1;
  }
});

int main(void) {
  char buf[256];
  int n = py_eval_into("__import__('sympy').__version__", buf, sizeof(buf));
  printf("PROBE rc=%d val=%s\n", n, buf);
  n = py_eval_into("str(__import__('sympy').diff(__import__('sympy').sin(__import__('sympy').Symbol('x')), __import__('sympy').Symbol('x')))", buf, sizeof(buf));
  printf("PROBE2 rc=%d val=%s\n", n, buf);
  return 0;
}
