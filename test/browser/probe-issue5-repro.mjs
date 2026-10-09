// 探针：issue #5 决定性复现（场景化；含 UI stub 三路径全写）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：sh test/browser/run.sh test/browser/probe-issue5-repro.mjs [URL]
//
// 场景（每个用独立 context，互不串味）：
//   R1 boot → 环境（pwd/path/which）→ UI 全 stub 写入 → 再次 which → 矩阵
//   R2 boot → 环境 → 只写 figure stub 到核心路径 → clear -f; rehash → title
//   R3 boot → 环境 → 只写 figure stub 到 /home/web_user → title
//   R4 boot → 环境 → 只写 figure stub 到 / → title
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8868/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STUBS = {
  plot: `% In-Engine Safe Shadow Plot Sink
function plot (varargin)
  x = [];
  y = [];
  if nargin == 1
    val = varargin{1};
    if isnumeric(val)
      y = double(val(:)');
      x = 1:length(y);
    endif
  elseif nargin >= 2
    v1 = varargin{1};
    v2 = varargin{2};
    if isnumeric(v1) && isnumeric(v2)
      x = double(v1(:)');
      y = double(v2(:)');
    endif
  endif
  s = struct('x', x, 'y', y, 'count', length(x));
  assignin('base', '__octave_web_plot__', s);
  printf("[OCTAVE_WEB_PLOT: %d points captured]\\n", length(x));
endfunction
`,
  figure: `% Safe Figure Stub
function figure (varargin)
  % No-op safe stub preventing GL4ES window init
endfunction
`,
  drawnow: `% Safe Drawnow Stub
function drawnow (varargin)
  % No-op safe stub preventing OpenGL flush
endfunction
`,
  helper: `% Safe Helper for extracting plot data without scoping errors
function s = __get_plot_data__ ()
  try
    s = evalin('base', '__octave_web_plot__');
  catch
    s = struct('count', 0);
  end
endfunction
`,
};
const PATHS = {
  plot:    ['/usr/src/octave/m/plot/draw/plot.m', '/plot.m', '/home/web_user/plot.m'],
  figure:  ['/usr/src/octave/m/plot/util/figure.m', '/figure.m', '/home/web_user/figure.m'],
  drawnow: ['/usr/src/octave/m/plot/draw/drawnow.m', '/drawnow.m', '/home/web_user/drawnow.m'],
  helper:  ['/usr/src/octave/m/plot/draw/__get_plot_data__.m', '/__get_plot_data__.m', '/home/web_user/__get_plot_data__.m'],
};

async function newSession (label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
  await sleep(1200);
  const isPage = await page.evaluate(() => !!(window.Module && window.Module.eval_string));
  let bootInfo = 'page';
  if (!isPage) {
    bootInfo = await page.evaluate(async () => {
      try {
        const meta = document.querySelector('meta[name="site-base"]');
        const globalBase = (meta && meta.getAttribute('content')) || '/';
        const base = (globalBase.endsWith('/') ? globalBase : globalBase + '/') + 'lanes/wasm32-final/';
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = base + 'octave.js';
          s.onload = () => resolve(); s.onerror = () => reject(new Error('load fail ' + s.src));
          document.head.appendChild(s);
        });
        await window.OctaveEmbed.create({
          base, mount: '#octave-raw-output', id: 'r-' + Math.random().toString(36).slice(2),
          lane: { lane: 'base', dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' },
        });
        return 'embed:' + base;
      } catch (e) { return 'BOOT-ERR ' + String(e).slice(0, 200); }
    });
    if (String(bootInfo).startsWith('BOOT-ERR')) { console.log(`[${label}] ${bootInfo}`); await ctx.close(); return null; }
    for (let i = 0; i < 240; i++) {
      const ok = await page.evaluate(() => {
        const ent = (window.__octaveHosts || []).slice(-1)[0];
        return !!(ent && ent.ready === true);
      }).catch(() => false);
      if (ok) break;
      await sleep(500);
    }
  }
  const modOk = await page.evaluate(() => {
    const ent = (window.__octaveHosts || []).slice(-1)[0];
    if (ent && ent.mod) { window.__M = ent.mod; return true; }
    if (window.Module && window.Module.eval_string) { window.__M = window.Module; return true; }
    return false;
  });
  if (!modOk) { console.log(`[${label}] no mod`); await ctx.close(); return null; }
  await sleep(2000);

  async function run (code, timeoutMs = 20000) {
    const s = '__R' + Math.random().toString(36).slice(2) + '__';
    logs.length = 0;
    try {
      await page.evaluate(([x, sn]) => window.__M.eval_string(`${x}; disp('${sn}');`), [code, s]);
    } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 160) }; }
    const t = Date.now();
    while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
    return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
  }
  return { page, logs, run, close: () => ctx.close(), bootInfo };
}

async function writeStubs (sess, which) {
  const res = await sess.page.evaluate(([stubs, paths, which]) => {
    const out = {};
    for (const k of which) {
      for (const p of paths[k]) {
        try {
          const dir = p.replace(/\/[^/]*$/, '') || '/';
          try { window.__M.FS.mkdirTree(dir); } catch (e) {}
          window.__M.FS.writeFile(p, stubs[k]);
          out[p] = 'ok';
        } catch (e) { out[p] = 'ERR ' + String(e).slice(0, 60); }
      }
    }
    return out;
  }, [STUBS, PATHS, which]);
  return res;
}

async function env (sess, tag) {
  const out = [];
  for (const [label, code] of [
    ['pwd', 'printf("PWD=[%s]\\n", pwd())'],
    ['path-head', 'p=path(); printf("PH=[%s]\\n", p(1:min(70,end)))'],
    ['which-figure', 'printf("WF=[%s]\\n", which("figure"))'],
    ['which-plot', 'printf("WP=[%s]\\n", which("plot"))'],
  ]) {
    const r = await sess.run(code);
    out.push(`${label}=${r.trap ? 'TRAP' : (r.out || '').slice(0, 240)}`);
  }
  console.log(`   [${tag}] ${out.join(' | ')}`);
  return out;
}

const MATRIX = [
  ['plot(0:1:10)', 'plot'],
  ['title("t")', 'title'],
  ['h = gcf()', 'gcf'],
  ['clf; plot(1:10); xlabel("x")', 'xlabel'],
  ['clf; plot(1:10); grid on', 'grid'],
  ['clf; plot(1:10); legend("a")', 'legend'],
  ['clf; plot(1:10); axis([0 11 0 11])', 'axis'],
  ['clf; plot(1:10); hold on; plot(2:11)', 'hold'],
  ['subplot(2,1,1); plot(1:10)', 'subplot'],
  ['bar([1 2 3])', 'bar'],
];

async function matrix (sess, tag) {
  console.log(`   [${tag}] 矩阵：`);
  for (const [code, name] of MATRIX) {
    const r = await sess.run(`try; ${code}; printf("OK %s\\n", '${name}'); catch e; printf("ERR %s: %s\\n", '${name}', e.message); end`);
    console.log(`      ${name.padEnd(8)} :: ${r.trap ? '★TRAP' : (r.out || '(空)').slice(0, 170)}`);
    await sess.run('close all');
  }
}

// ── R1：UI 全 stub（真实 install 形态）────────────────────────
{
  console.log('\n## R1 UI 全 stub（4 文件 × 3 路径）');
  const s = await newSession('R1');
  if (s) {
    console.log('   boot:', s.bootInfo.slice(0, 120));
    await env(s, 'before');
    const w = await writeStubs(s, ['plot', 'figure', 'drawnow', 'helper']);
    console.log('   writes:', JSON.stringify(w));
    // 读回验证
    const rb = await s.page.evaluate(() => {
      const out = {};
      for (const p of ['/usr/src/octave/m/plot/util/figure.m', '/figure.m', '/home/web_user/figure.m',
                       '/usr/src/octave/m/plot/draw/plot.m', '/plot.m', '/home/web_user/plot.m']) {
        try { out[p] = window.__M.FS.readFile(p, { encoding: 'utf8' }).slice(0, 42).replace(/\n/g, '\\n'); }
        catch (e) { out[p] = 'READ-ERR'; }
      }
      return out;
    });
    console.log('   readback:', JSON.stringify(rb));
    await env(s, 'after-write');
    await matrix(s, 'R1');
    await s.close();
  }
}

// ── R2：只 figure stub → 核心路径 ────────────────────────────
{
  console.log('\n## R2 只 figure stub → 核心路径');
  const s = await newSession('R2');
  if (s) {
    await writeStubs(s, ['figure']);
    const r0 = await s.run('clear -f; rehash; try; title("t"); printf("T-OK\\n"); catch e; printf("T-ERR: %s\\n", e.message); end');
    console.log('   clear -f; rehash; title =>', (r0.out || r0.err || '').slice(0, 240));
    const r1 = await s.run('try; h=gcf(); printf("G-OK %g\\n", h); catch e; printf("G-ERR: %s\\n", e.message); end');
    console.log('   gcf =>', (r1.out || '').slice(0, 240));
    await env(s, 'R2-after');
    await s.close();
  }
}

// ── R3：只 figure stub → /home/web_user ──────────────────────
{
  console.log('\n## R3 只 figure stub → /home/web_user');
  const s = await newSession('R3');
  if (s) {
    await writeStubs(s, ['figure']);   // 会写三处；R3 单独再确认 home 那份
    const r0 = await s.run('clear -f; rehash; try; title("t"); printf("T-OK\\n"); catch e; printf("T-ERR: %s\\n", e.message); end');
    console.log('   clear -f; rehash; title =>', (r0.out || r0.err || '').slice(0, 240));
    await s.close();
  }
}

console.log('\n=== 探针结束 ===');
await browser.close();
