// 探针：fontconfig 上线后 **`fontname` 真的生效**（R3，2026-09-24）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-fontname.mjs [URL]
//
// ── 为什么要有它（外部审核点名要防的那个假绿）──────────────────────────────────
// 批次 D 之后（FreeType 编进来、**没有** fontconfig）文字能画，但：
//   · `set(h,'fontname','Courier')` **存得住、渲染时被忽略**（任何字体名都落到 FreeSans）；
//   · `listfonts()` **报错** `structure has no member 'family'`。
// 所以"字体名生效"这件事**不能靠属性/返回值判断**：属性一直是对的，图一直没变。
// 唯一判据是 **framebuffer 变了** —— 本探针就是这条：
//   同一段文字、只换 `fontname`（FreeSans vs FreeSans Bold）⇒ `getframe` 的像素和**必须不同**；
//   同一个 fontname 画两次 ⇒ 必须**相同**（证明差异来自字体而不是别的噪声）。
// 红线：把 R3 回退成"没有 fontconfig"时，本探针第 ③ 条会立刻变红（diff=0）。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 400)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
console.log(`URL=${URL} ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

async function run (code, ms = 900) {
  logs.length = 0;
  const r = await page.evaluate(x => {
    const rc = window.Module.eval_string(x);
    return { rc, err: window.Module.last_error_message() };
  }, code);
  await new Promise(rr => setTimeout(rr, ms));
  const out = logs.join(' ').replace(/LIBGL:[^|]*?(?=[A-Z]|$)/g, '').replace(/\s+/g, ' ').trim();
  return { rc: r.rc, out };
}
let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 160)}`); };

// ── ① listfonts / get_system_fonts：无 fontconfig 时它们报错（R2）──────────────
let r = await run('try; L=listfonts(); disp(sprintf("nf=%d|%s", numel(L), strjoin(L,","))); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /nf=\d+\|.*FreeSans/.test(r.out),
  '★ listfonts() 返回字体名列表（以前报 structure has no member family）', r.out);
// ⚠️ 名字面实测（2026-09-24）：Octave 11.3.0 里**没有** `get_system_fonts`（`exist`=0）；
//    真正暴露字体表的内建是 **`__get_system_fonts__`**（`exist`=5），`listfonts.m` 就是包它的。
//    ⇒ 断言必须钉真名，不然会得到一个"函数不存在"的假红（第一版就是这样）。
r = await run('disp(sprintf("exist=%d", exist("__get_system_fonts__")))');
check(r.rc === 0 && /exist=5/.test(r.out), '内建 __get_system_fonts__ 存在（exist=5）', r.out);
r = await run('try; f=__get_system_fonts__(); disp(sprintf("fields=%s|n=%d", strjoin(fieldnames(f),","), numel(f))); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /family/.test(r.out) && /angle/.test(r.out) && /weight/.test(r.out) && /suitable/.test(r.out),
  '★ 字体表有 family/angle/weight/suitable 四个字段（R2 消失）', r.out);

// ── ② 配置真的被读到了（这条专门抓"配置没加载但静默 0 个 face"）─────────────
r = await run('disp(which("listfonts"))');
check(r.rc === 0, 'listfonts 可解析', r.out);
const cfg = await run('clf; plot(1:3); set(gca,"fontname","FreeSans"); disp(sprintf("fn=%s|wt=%s|ang=%s", get(gca,"fontname"), get(gca,"fontweight"), get(gca,"fontangle")))');
check(cfg.rc === 0 && /fn=FreeSans/.test(cfg.out), 'fontname/fontweight/fontangle 属性可存可读', cfg.out);

// ── ③ 判别性判据：换**字体属性** ⇒ 像素必须变（这是 R3 的全部意义）───────────────
// ⚠️ 第一版写错了判据：拿 `fontname="FreeSans Bold"` 去比 —— 那是**风格名不是家族名**，
//    fontconfig 查不到这个 family，FcFontMatch 会**落回 FreeSans Regular**（机制闸门
//    probe-fontconfig.sh 实测过：不存在的 family → 落回 FreeSans.otf）⇒ 像素当然一样。
//    真正的映射关系在 `ft-text-renderer.cc:330-360`（逐行核过）：
//        fontname  → FC_FAMILY      （家族名，本构建只有 "FreeSans" 一个）
//        fontweight→ FC_WEIGHT      （normal/bold）
//        fontangle → FC_SLANT       （normal/italic/oblique）
//    ⇒ 判别性测试必须**变 weight/angle**（本构建有 Regular/Bold/Oblique/BoldOblique 四个面）。
const draw = (fam, weight, angle) => `clf; plot(1:3); ` +
  `set(gca, "fontname", "${fam}", "fontweight", "${weight}", "fontangle", "${angle}"); ` +
  `title("WWWW iii 8888"); xlabel("abcdefgh"); drawnow; ` +
  `F=getframe(gcf); printf("SUM=%d NONWHITE=%d\\n", sum(double(F.cdata(:))), sum(F.cdata(:)!=255));`;
const sum = (o) => { const m = /SUM=(\d+)/.exec(o); return m ? parseInt(m[1], 10) : null; };
const ink = (o) => { const m = /NONWHITE=(\d+)/.exec(o); return m ? parseInt(m[1], 10) : null; };

const a1 = await run(draw('FreeSans', 'normal', 'normal'), 1600);
const a2 = await run(draw('FreeSans', 'normal', 'normal'), 1600);
const b1 = await run(draw('FreeSans', 'bold', 'normal'), 1600);
const c1 = await run(draw('FreeSans', 'normal', 'italic'), 1600);
const [s1, s2, s3, s4] = [sum(a1.out), sum(a2.out), sum(b1.out), sum(c1.out)];
console.log(`   普通 #1=${s1} (ink ${ink(a1.out)})  #2=${s2} (ink ${ink(a2.out)})  粗体=${s3} (ink ${ink(b1.out)})  斜体=${s4} (ink ${ink(c1.out)})`);
check(s1 !== null && s2 !== null && s3 !== null && s4 !== null, '四次都拿到了 framebuffer 统计', `${s1} ${s2} ${s3} ${s4}`);
check(ink(a1.out) > 0, '文字真的画出来了（非白像素 > 0）', `ink=${ink(a1.out)}`);
check(s1 === s2, '对照：同一组属性画两次 ⇒ 像素和相同（差异不是噪声）', `${s1} vs ${s2}`);
check(s1 !== s3, '★ 判别性：只把 fontweight 改成 bold ⇒ 像素和**不同**（字体真的换面了）', `normal=${s1} vs bold=${s3}`);
check(s1 !== s4, '★ 判别性：只把 fontangle 改成 italic ⇒ 像素和**不同**', `normal=${s1} vs italic=${s4}`);
check(s3 !== s4, '★ 判别性：bold 与 italic 互不相同（不是"只要一变就随便变"）', `bold=${s3} vs italic=${s4}`);

// 落回行为的交底：家族名不存在 ⇒ 落到 FreeSans（**这不是失败**，是只有 4 个字体的必然）
const d1 = await run(draw('Courier', 'normal', 'normal'), 1600);
console.log(`   fontname="Courier"（本构建没有这个家族）⇒ 像素和 ${sum(d1.out)}（与 FreeSans 普通体相同？${sum(d1.out) === s1}）—— 预期的落回`);
check(sum(d1.out) === s1, '交底：家族名不存在时落回 FreeSans（与普通体一致）', `${sum(d1.out)} vs ${s1}`);

// ── ④ 控制台里不该有 fontconfig 的加载错误/警告（配置路径错时它会明说）────────
const bad = logs.filter(l => /Cannot load default config file|Fontconfig error|Fontconfig warning/i.test(l));
// 上面 logs 已被 run() 清空 ⇒ 重跑一次"从零到出图"，专门抓这几条
logs.length = 0;
await run(draw('FreeSans', 'normal', 'normal'), 1400);
const bad2 = logs.filter(l => /Cannot load default config file|Fontconfig error/i.test(l));
check(bad.length === 0 && bad2.length === 0, '没有 fontconfig 的配置加载错误（配置读到了）', bad2.join(' ') || '(无)');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（★ 是本批的判别性断言；③ 那条变红就说明"fontname 又只是存着好看了"）');
await browser.close();
process.exit(fail ? 1 : 0);
