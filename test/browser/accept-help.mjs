// T1 验收：help 走官方 makeinfo 预渲染产物（零 .m 覆写）
// 用法：harness/run.sh test/browser/accept-help.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 600)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a','b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 800));
}
console.log(`URL=${URL} ready=${((Date.now()-t)/1000).toFixed(1)}s`);

// 等 index.html 的启动装载（dldfcn 核心组 + help 数据）完成
await page.evaluate(async () => {
  for (let i = 0; i < 150; i++) {
    if (window.__octaveReady) break;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});

let pass = 0, fail = 0;
async function ev(name, code, check, wait = 1200) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, code);
  } catch (e) { console.log(`CRASH | ${name} :: ${String(e).slice(0,110)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, wait));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const ok = r.rc === 0 && check(out, r.err);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(30)} :: ${out.slice(0,140) || String(r.err).slice(0,120)}`);
}

console.log('--- 官方性：必须没有 __makeinfo__ 覆写 ---');
await ev('which __makeinfo__ 是核心文件',
  "disp(which('__makeinfo__'))",
  o => o.includes('/usr/src/octave/m/help/__makeinfo__.m'));
await ev('无 docbridge 残留',
  "disp(exist('__tf_texinfo_to_plain__'))",
  o => /\b0\b/.test(o));

console.log('--- help：内建函数（走预渲染的 built-in-docstrings）---');
await ev('help sin 有正文',
  "help sin",
  o => /Compute the sine for each element/i.test(o) && !/makeinfo|unable to start subprocess/i.test(o));
await ev('help sin 无原始标记',
  "help sin",
  o => !/@deftypefn|@var\{|@seealso/.test(o));
await ev('help sqrt 保留 See also',
  "help sqrt",
  o => /square root/i.test(o) && /See also/i.test(o));
await ev('help disp 的 @example 变成正文',
  "help disp",
  o => /value of pi is/i.test(o) && !/@print\{\}|@group/.test(o));
await ev('help("sin") 返回字符串',
  "s=help('sin'); disp(numel(s)>50 && ischar(s))",
  o => /\b1\b/.test(o));
await ev('help 未知函数清晰报错',
  "try; help zzznope; catch e; disp(['CAUGHT ' e.message]); end",
  o => /CAUGHT/.test(o) && /not found/i.test(o));

console.log('--- 回归护栏 ---');
await ev('help plot（.m 路径）不回归',
  "help plot",
  o => /Headless plot/i.test(o));
await ev('lookfor 可用',
  "lookfor sine",
  o => /Compute the sine/i.test(o));
await ev('get_first_help_sentence',
  "disp(get_first_help_sentence('sin'))",
  o => /Compute the sine/i.test(o));
await ev('disp(函数句柄) 不炸',
  "disp(@sin)",
  o => /sin/.test(o));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
