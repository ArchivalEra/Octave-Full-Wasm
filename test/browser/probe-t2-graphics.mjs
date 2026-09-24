// T2 前置：**零重链探针** —— 在不动主 wasm 的前提下，把当前图形句柄的真实状态量清楚，
// 并验证"能不能用纯 .m 提供 graphics toolkit"这条更便宜的路。
//
// 用法：harness/run.sh test/browser/probe-t2-graphics.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run (code, timeoutMs = 20000) {
  const s = '__G' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  let rc;
  try {
    rc = await page.evaluate(([x, sn]) => window.Module.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { rc: 'TRAP', out: '', err: String(e).slice(0, 140), trap: true }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  const out = logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim();
  return { rc, out, err: await page.evaluate(() => window.Module.last_error_message()).catch(() => '') };
}

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(600);
console.log(`URL=${URL}`);

const CASES = [
  ['版本',                 'disp(version())'],
  ['available_graphics_toolkits()', 'disp(available_graphics_toolkits())'],
  ['graphics_toolkit()（当前默认）', 'try; disp(graphics_toolkit()); catch e; printf("ERR: %s\\n", e.message); end'],
  ['loaded_graphics_toolkits()', 'disp(loaded_graphics_toolkits())'],
  ['__init_gnuplot__ 在吗',  'disp(exist("__init_gnuplot__"))'],
  ['__init_fltk__ 在吗',     'disp(exist("__init_fltk__"))'],
  ['__init_web__ 在吗',      'disp(exist("__init_web__"))'],
  ['figure(1)',            'try; h=figure(1); printf("OK handle=%g type=%s\\n", h, get(h,"type")); catch e; printf("ERR: %s\\n", e.message); end'],
  ['gcf / gca',            'try; printf("OK gcf=%g gca=%g\\n", gcf(), gca()); catch e; printf("ERR: %s\\n", e.message); end'],
  ['get(0,"defaultfigure__graphics_toolkit__")', 'try; d=get(0,"defaultfigure__graphics_toolkit__"); printf("OK [%s] empty=%d\\n", d, isempty(d)); catch e; printf("ERR: %s\\n", e.message); end'],
  ['plot 之后 gcf/gca',     'try; clf; plot(1:10); printf("OK gcf=%g gca=%g children=%d\\n", gcf(), gca(), numel(get(gca(),"children"))); catch e; printf("ERR: %s\\n", e.message); end'],
  ['get(gca,"xlim")',      'try; clf; plot(1:10); xl=get(gca(),"xlim"); printf("OK xlim=[%g %g]\\n", xl(1), xl(2)); catch e; printf("ERR: %s\\n", e.message); end'],
  ['set(gca,"xlim",[0 5])', 'try; clf; plot(1:10); set(gca(),"xlim",[0 5]); xl=get(gca(),"xlim"); printf("OK xlim=[%g %g]\\n", xl(1), xl(2)); catch e; printf("ERR: %s\\n", e.message); end'],
  ['title/xlabel 存得住吗',  'try; clf; plot(1:10); title("hello"); printf("OK title=[%s]\\n", get(get(gca(),"title"),"string")); catch e; printf("ERR: %s\\n", e.message); end'],
  ['close 能关吗',          'try; clf; plot(1:10); close(gcf()); printf("OK closed\\n"); catch e; printf("ERR: %s\\n", e.message); end'],
];

for (const [name, code] of CASES) {
  const r = await run(code);
  console.log(`${r.trap ? '★TRAP' : '     '} | ${name.padEnd(34)} :: ${r.trap ? '整页崩' : (r.out || r.err || '(空)').slice(0, 150)}`);
  if (r.trap) break;
}

// ── 更便宜的路：纯 .m 能不能提供一个 toolkit？ ───────────────────────────────
// 关键门禁在 graphics_toolkit.m:86 ——
//   `if (! any (strcmp (available_graphics_toolkits (), name))) error("%s toolkit is not available")`
// available_graphics_toolkits() 是 C++ 编译期写死的清单，.m 加不进去。
console.log('\n--- 试：纯 .m 提供 __init_web__ + 覆写 graphics_toolkit.m ---');
const mroute = await run([
  'd="/tmp/gt"; [st,msg]=mkdir(d);',
  'fid=fopen(fullfile(d,"__init_web__.m"),"w");',
  'fputs(fid, "function t = __init_web__ ()\\n  t = struct(\\"name\\",\\"web\\");\\nendfunction\\n");',
  'fclose(fid);',
  'addpath(d);',
  'printf("exist(__init_web__)=%d\\n", exist("__init_web__"));',
  'try; graphics_toolkit("web"); printf("OK toolkit=web\\n"); catch e; printf("WALL: %s\\n", e.message); end'
].join(' '));
console.log(`     | ${'纯 .m 注册 web toolkit'.padEnd(34)} :: ${mroute.trap ? '整页崩' : (mroute.out || mroute.err || '(空)').slice(0, 200)}`);

console.log('\n=== 探针结束（结论写进 HISTORY §5.5 / CLIBS）===');
await browser.close();
