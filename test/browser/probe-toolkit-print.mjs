// toolkit 到底能不能自己扛 print：绕开桥的 print.m，直接调核心 print（→ toolkit 的 print_figure）
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-proxy-server','--no-sandbox','--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs=[]; page.on('console', m=>logs.push(m.text()));
await page.goto(URL,{waitUntil:'load',timeout:300000});
const t0=Date.now();
while(Date.now()-t0<300000){const ok=await page.evaluate(()=>{try{return !!window.Module?.feval?.('strcat',['a','b'],1);}catch{return false;}}).catch(()=>false); if(ok)break; await new Promise(r=>setTimeout(r,800));}
while(!(await page.evaluate(()=>!!window.__octaveReady).catch(()=>false))) await new Promise(r=>setTimeout(r,500));
async function ev(e){logs.length=0; let r; try{r=await page.evaluate(x=>{const rc=window.Module.eval_string(x); return {rc,err:window.Module.last_error_message()};},e);}catch(err){return {rc:-1,txt:'CRASH '+String(err).slice(0,100)};} await new Promise(rr=>setTimeout(rr,500)); return {rc:r.rc, txt:[...logs].join(' ').replace(/\s+/g,' ').slice(0,200), err:String(r.err||'').slice(0,140)};}

(async () => {
  await ev("graphics_toolkit('webgl'); figure(1); clf; plot(1:10); drawnow;");
  console.log('which print      :', (await ev('disp(which("print"))')).txt);

  // 逐个格式：**绕开桥**，直接用 __pb_mirror__（它就是"摘掉桥再调核心同名函数"）
  for (const [fmt, ext] of [['png','png'],['svg','svg'],['pdf','pdf'],['ps','ps'],['eps','eps']]) {
    const p = `/tmp/tk_${fmt}.${ext}`;
    const r = await ev(`__pb_mirror__("print", "-d${fmt}", "${p}"); d=dir("${p}"); if (isempty(d)) disp("(没有产出文件)"); else disp(d.bytes); endif`);
    let magic = '';
    if (fmt === 'png') {
      const m = await ev(`fid=fopen("${p}","r"); b=fread(fid,8,"uint8"); fclose(fid); disp(all(b(:)==[137;80;78;71;13;10;26;10]))`);
      magic = ' PNG魔数=' + m.txt.slice(-1);
    }
    if (fmt === 'svg') {
      const m = await ev(`fid=fopen("${p}","r"); b=fread(fid,40,"uint8"); fclose(fid); disp(char(b(:).'))`);
      magic = ' 头=' + m.txt.slice(-24);
    }
    console.log(`  ${('print -d'+fmt).padEnd(14)} rc=${r.rc} bytes=${r.txt.slice(-30).padEnd(30)}${magic}  ${r.err ? 'err=' + r.err.slice(0,90) : ''}`);
  }
  await browser.close();
})();
