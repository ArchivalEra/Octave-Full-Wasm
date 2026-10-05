// probe-sort-bitexact.mjs — 端到端逐位抽查（工单 63 候选③ / E7 的产物级判据）。
// 用法：HOTPATH_DIR 同款自托管形状：node probe-sort-bitexact.mjs <URL> <OUT.json>
// 两个站点（候选/对照）各跑一次：同一 rand 种子（解释器冷启动 ⇒ 同序列）→
// sort → %.17g 写虚拟 FS → 宿主读回 → 两站输出必须**逐字节相等**（IEEE 红线）。
// 升/降序各来一份；NaN 域由 G2 门把守（分区正确性），这里守端到端。
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';

const URL = process.argv[2] || 'http://127.0.0.1:8868/';
const OUT = process.argv[3] || '/tmp/sort-bitexact.json';

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await (await browser.newContext()).newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

let ready = false;
for (let i = 0; i < 300 && !ready; i++) {
  ready = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) { console.log('=== FAIL: 30s 内未就绪 ==='); process.exit(1); }

const lane = await page.evaluate(() => (window.__octaveCaps?.lane || {}).chosen || null);

const SNIPPETS = {
  asc: "rand('twister',20261005); x=rand(20000,1); s=sort(x); fid=fopen('/tmp/sortout-asc.txt','w'); fprintf(fid,'%.17g,',s); fclose(fid); disp('ASC-OK')",
  desc: "rand('twister',20261005); x=rand(20000,1); s=sort(x,'descend'); fid=fopen('/tmp/sortout-desc.txt','w'); fprintf(fid,'%.17g,',s); fclose(fid); disp('DESC-OK')",
};

const out = { url: URL, lane, results: {} };
for (const [tag, snip] of Object.entries(SNIPPETS)) {
  // 同一 evaluate 闭包内：eval → readdir 取证 → 读回（跨 evaluate 曾读到空——
  // eval_string 的执行时序与 FS 可见性必须在同一闭包里确认，2026-10-05 实测）
  const res = await page.evaluate(({ s, tag }) => {
    try {
      const rc = window.Module.eval_string(s);
      let listing = null, data = null, err = null;
      try { listing = window.Module.FS.readdir('/tmp').filter((n) => n.includes('sortout')); } catch (e) { listing = ['readdir-throw:' + e]; }
      try {
        const b = window.Module.FS.readFile(`/tmp/sortout-${tag}.txt`);
        data = Array.from(b);
      } catch (e) { err = String(e); }
      return { rc, listing, data, err };
    } catch (e) { return { rc: 'throw:' + e, listing: null, data: null, err: null }; }
  }, { s: snip, tag });
  const data = res.data;
  out.results[tag] = { rc: res.rc, listing: res.listing, err: res.err,
                       bytes: data ? data.length : 0, data };
}

writeFileSync(OUT, JSON.stringify(out));
console.log(`=== bitexact ${URL} lane=${lane} asc=${out.results.asc?.bytes}B desc=${out.results.desc?.bytes}B ===`);
await browser.close();
