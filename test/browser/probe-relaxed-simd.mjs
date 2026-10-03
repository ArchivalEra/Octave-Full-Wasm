// 探针：relaxed-simd 引擎支持矩阵（工单 52）——决定 FMA 产物是否需要 lane 回退轴
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// 判据：用一个**已知含 f64x2.relaxed_madd** 的最小模块（编译期生成的校准样本，
//   794B）对各引擎做 WebAssembly.validate ⇒ 支持=true。
// ⚠ 校准是仪器自证的一部分（Einfacht #6）：模块本身由 clang -mrelaxed-simd 编译，
//   先决条件"它真的含该指令"由字节码 fd 87 02 保证。
import { chromium, firefox, webkit } from 'playwright-core';
const RM = "AGFzbQEAAAABCwJgAABgA3t7ewF7AwMCAAEFAwEAAQZZDn8BQYCABAt/AEEAC38AQQELfwBBgIAEC38AQYCABAt/AEGAgAQLfwBBAAt/AEEAC38AQQALfwBBgIAEC38AQYCABAt/AEGAgAQLfwBBgIAEC38AQYCABAsH/AERBm1lbW9yeQIAEV9fd2FzbV9jYWxsX2N0b3JzAAAPX19zdGFja19wb2ludGVyAwABZgABDF9fZHNvX2hhbmRsZQMECl9fZGF0YV9lbmQDBQ5fX3JvZGF0YV9zdGFydAMGDF9fcm9kYXRhX2VuZAMHC19fc3RhY2tfbG93AwgMX19zdGFja19oaWdoAwkNX19nbG9iYWxfYmFzZQMKC19faGVhcF9iYXNlAwsKX19oZWFwX2VuZAMMDV9fbWVtb3J5X2Jhc2UDAQxfX3RhYmxlX2Jhc2UDAhVfX3dhc21fZmlyc3RfcGFnZV9lbmQDDQpfX3Rsc19iYXNlAwMKEAICAAsLACAAIAEgAv2HAgsAZQRuYW1lAAgHcm0ud2FzbQEXAgARX193YXNtX2NhbGxfY3RvcnMBAWYHOwQAD19fc3RhY2tfcG9pbnRlcgENX19tZW1vcnlfYmFzZQIMX190YWJsZV9iYXNlAwpfX3Rsc19iYXNlAHgJcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBBWNsYW5nWDIzLjAuMGdpdCAoaHR0cHM6L2dpdGh1Yi5jb20vbGx2bS9sbHZtLXByb2plY3QgN2I1ODcxNmQ5NmMzYWU0YzBjNGU2ZjcyZTI5YjE2MTM3YmI2MjI0YikAqwEPdGFyZ2V0X2ZlYXR1cmVzCisLYnVsay1tZW1vcnkrD2J1bGstbWVtb3J5LW9wdCsWY2FsbC1pbmRpcmVjdC1vdmVybG9uZysKbXVsdGl2YWx1ZSsPbXV0YWJsZS1nbG9iYWxzKxNub250cmFwcGluZy1mcHRvaW50Kw9yZWZlcmVuY2UtdHlwZXMrDHJlbGF4ZWQtc2ltZCsIc2lnbi1leHQrB3NpbWQxMjg=";
const PW = process.env.PLAYWRIGHT_BROWSERS_PATH;
let pass = 0, fail = 0;
const check = (ok, name, detail) => { ok ? pass++ : fail++; console.log(`${ok?'PASS':'fail'} | ${name}${detail?' :: '+detail:''}`); };

async function probe(name, launcher) {
  let br;
  try { br = await launcher(); }
  catch (e) { console.log(`   [skip] ${name} 起不来：${String(e).slice(0,90)}`); return; }
  try {
    const page = await (await br.newContext()).newPage();
    await page.goto('about:blank');
    const r = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      let relaxed = false, err = '';
      try { relaxed = WebAssembly.validate(bytes); } catch (e) { err = String(e).slice(0, 80); }
      // 顺带记录该引擎是否支持 memory64（w64 档的前提）
      let m64 = false;
      try { m64 = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,4,1])); } catch (e) {}
      return { relaxed, m64, err, ua: navigator.userAgent.slice(0, 60) };
    }, RM);
    check(r.relaxed === true, `${name}：relaxed-simd 支持`, JSON.stringify(r));
  } finally { await br.close(); }
}

await probe('chromium', () => chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] }));
await probe('firefox', () => firefox.launch());
await probe('webkit', () => webkit.launch());

console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
