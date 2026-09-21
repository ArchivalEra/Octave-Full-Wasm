// T3 验收：copyfile/movefile/ls 的进程内实现（无 shell）
// 用法：harness/run.sh test/browser/accept-fileops.mjs [URL]
//
// 判定原则：这些函数是**核心同名函数的覆写**，所以每条断言都同时检查
//   (a) 功能对（数值/字节/目录结构），且 (b) **没有走 shell**
// 后者是本批次的全部意义：原版实现最后一行是 `system("cp -r ...")`，
// 本构建里必然失败。只断言"没报错"不够——要断言真的复制了内容。
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

// 本批能力走懒加载车道（T3 资产）；不装载就测等于测"没按需加载"
const loadRes = await page.evaluate(async () => {
  try { await window.OctaveAssets.load('webfile'); return 'ok'; }
  catch (e) { return 'ERR ' + e.message; }
});
console.log('  装载 webfile: ' + loadRes);

let pass = 0, fail = 0;
async function ev(name, code, check, wait = 900) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, code);
  } catch (e) { console.log(`CRASH | ${name} :: ${String(e).slice(0,110)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, wait));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const ok = r.rc === 0 && check(out, r.err);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(32)} :: ${out.slice(0,130) || String(r.err).slice(0,110)}`);
}

const noShell = o => !/unable to start subprocess|cp -r|mv |ls -C/i.test(o);

console.log('--- 覆写生效（官方同名函数已被替换）---');
await ev('which copyfile 指向 webfile',
  "disp(which('copyfile'))", o => o.includes('/webfile/'));
await ev('which movefile 指向 webfile',
  "disp(which('movefile'))", o => o.includes('/webfile/'));
await ev('which ls 指向 webfile',
  "disp(which('ls'))", o => o.includes('/webfile/'));

console.log('--- copyfile ---');
await ev('单文件复制 + 内容一致',
  "fid=fopen('/tmp/t3a.txt','w');fprintf(fid,'hello');fclose(fid); [s,m]=copyfile('/tmp/t3a.txt','/tmp/t3b.txt'); fid=fopen('/tmp/t3b.txt','r');c=fgetl(fid);fclose(fid); printf('st=%d msg=[%s] c=[%s]\\n',s,m,c)",
  o => /st=1/.test(o) && /c=\[hello\]/.test(o) && noShell(o));
await ev('二进制字节级一致（0..255）',
  "fid=fopen('/tmp/t3bin.dat','wb');fwrite(fid,uint8(0:255),'uint8');fclose(fid); copyfile('/tmp/t3bin.dat','/tmp/t3bin2.dat'); fid=fopen('/tmp/t3bin.dat','rb');a=fread(fid,Inf,'*uint8');fclose(fid); fid=fopen('/tmp/t3bin2.dat','rb');b=fread(fid,Inf,'*uint8');fclose(fid); disp(isequal(a,b))",
  o => /(^|\s)1(\s|$)/.test(o) && noShell(o));
await ev('通配符 → 目录',
  "mkdir('/tmp/t3dst'); fid=fopen('/tmp/t3c1.txt','w');fprintf(fid,'1');fclose(fid); fid=fopen('/tmp/t3c2.txt','w');fprintf(fid,'2');fclose(fid); [s,m]=copyfile('/tmp/t3c*.txt','/tmp/t3dst'); printf('st=%d\\n',s); disp([exist('/tmp/t3dst/t3c1.txt') exist('/tmp/t3dst/t3c2.txt')])",
  o => /st=1/.test(o) && /2\s+2/.test(o) && noShell(o));
await ev('目录递归复制（含子目录）',
  "mkdir('/tmp/t3src'); mkdir('/tmp/t3src/sub'); fid=fopen('/tmp/t3src/x.txt','w');fprintf(fid,'X');fclose(fid); fid=fopen('/tmp/t3src/sub/y.txt','w');fprintf(fid,'Y');fclose(fid); [s,m]=copyfile('/tmp/t3src','/tmp/t3dst2'); printf('st=%d\\n',s); disp([exist('/tmp/t3dst2/x.txt') exist('/tmp/t3dst2/sub/y.txt')])",
  o => /st=1/.test(o) && /2\s+2/.test(o) && noShell(o));
await ev('多源 + 非目录目标 → 报错',
  "fid=fopen('/tmp/t3m1.txt','w');fclose(fid); fid=fopen('/tmp/t3m2.txt','w');fclose(fid); [s,m]=copyfile({'/tmp/t3m1.txt','/tmp/t3m2.txt'},'/tmp/t3notadir.txt'); printf('st=%d m=[%s]\\n',s,m)",
  o => /st=0/.test(o) && /must be a directory/i.test(o));
await ev('源不存在 → status 0 而非崩',
  "[s,m,id]=copyfile('/nope/absent.txt','/tmp/zz.txt'); printf('st=%d id=[%s]\\n',s,id)",
  o => /st=0/.test(o) && /id=\[copyfile\]/.test(o) && noShell(o));

console.log('--- movefile ---');
await ev('移动后源消失、目标存在',
  "fid=fopen('/tmp/t3mv1.txt','w');fprintf(fid,'pay');fclose(fid); [s,m]=movefile('/tmp/t3mv1.txt','/tmp/t3mv2.txt'); printf('st=%d\\n',s); disp([exist('/tmp/t3mv1.txt') exist('/tmp/t3mv2.txt')])",
  o => /st=1/.test(o) && /0\s+2/.test(o) && noShell(o));
await ev('移动后内容不变',
  "fid=fopen('/tmp/t3mv2.txt','r');c=fgetl(fid);fclose(fid); disp(c)",
  o => /pay/.test(o));
await ev('移动目录',
  "mkdir('/tmp/t3mvd'); fid=fopen('/tmp/t3mvd/f.txt','w');fprintf(fid,'F');fclose(fid); [s,m]=movefile('/tmp/t3mvd','/tmp/t3mvd2'); printf('st=%d\\n',s); disp([exist('/tmp/t3mvd') isfolder('/tmp/t3mvd2') exist('/tmp/t3mvd2/f.txt')])",
  o => /st=1/.test(o) && /0\s+1\s+2/.test(o) && noShell(o));
await ev('源不存在 → status 0',
  "[s,m,id]=movefile('/nope/absent.txt','/tmp/zz2.txt'); printf('st=%d id=[%s]\\n',s,id)",
  o => /st=0/.test(o) && /id=\[movefile\]/.test(o));

console.log('--- ls ---');
await ev('ls 目录（有输出）',
  "mkdir('/tmp/t3ls'); fid=fopen('/tmp/t3ls/one.txt','w');fclose(fid); ls('/tmp/t3ls')",
  o => /one\.txt/.test(o) && noShell(o));
await ev('ls 通配',
  "fid=fopen('/tmp/t3ls/g1.txt','w');fclose(fid); fid=fopen('/tmp/t3ls/g2.txt','w');fclose(fid); r=ls('/tmp/t3ls/g*.txt'); disp(r)",
  o => /g1\.txt/.test(o) && /g2\.txt/.test(o) && noShell(o));
await ev('ls 带输出参数返回 char',
  "r=ls('/tmp/t3ls'); disp([ischar(r) rows(r)>=1])",
  o => /1\s+1/.test(o) && noShell(o));
await ev('ls 无参数不报错',
  "ls()",
  o => noShell(o), 700);

console.log('--- 回归护栏：不能弄坏别的东西 ---');
await ev('dir 仍可用',
  "d=dir('/tmp'); disp(numel(d)>0)", o => /(^|\s)1(\s|$)/.test(o));
// imread/imwrite 需要 webimage 资产（imformats 注册）——不装载就测等于测"没按需加载"，
// 会把"缺资产"误报成"文件操作坏了"。
const imgRes = await page.evaluate(async () => {
  try { await window.OctaveAssets.load('webimage'); return 'ok'; }
  catch (e) { return 'ERR ' + e.message; }
});
console.log('  装载 webimage: ' + imgRes);
await ev('imread/imwrite 往返（依赖 fopen 路径）',
  "A=uint8(reshape(mod(0:255,256),16,16)); imwrite(A,'/tmp/t3.png'); disp(isequal(A,imread('/tmp/t3.png')))",
  o => /(^|\s)1(\s|$)/.test(o), 1600);
await ev('gzip（webio 路径）不回归',
  "fid=fopen('/tmp/t3z.txt','w');fprintf(fid,'x\\n');fclose(fid); gzip('/tmp/t3z.txt'); disp(exist('/tmp/t3z.txt.gz')>0)",
  o => /(^|\s)1(\s|$)/.test(o));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
