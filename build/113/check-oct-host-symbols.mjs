import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const URL = process.argv[2];
// 先把 needlib 需要的所有导入名拿到
const octPath = '/mnt/hdd/octave-wasm-build/octc-spike/needlib-noa.oct';
const mod = new WebAssembly.Module(readFileSync(octPath));
const need = WebAssembly.Module.imports(mod).filter(i => i.module === 'env').map(i => i.name)
  .filter(n => !['memory','__indirect_function_table','__stack_pointer','__memory_base','__table_base','__stack_high','__heap_base'].includes(n));
// 宿主导出
const host = new WebAssembly.Module(readFileSync('/mnt/hdd/octave-wasm-build/siteWebGL/w64/octave.wasm'));
const hostExp = new Set(WebAssembly.Module.exports(host).map(e => e.name));
console.log('needlib 需要的 env 符号:', need.length);
const missing = need.filter(n => !hostExp.has(n));
console.log('★ 宿主**没有**导出的:', missing.length);
for (const m of missing) console.log('   ❌', m);
