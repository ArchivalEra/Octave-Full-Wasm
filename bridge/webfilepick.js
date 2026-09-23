// 浏览器文件选择器桥（T8 / 缺口清单 H2）。Own code, repo license.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 另一半是 build/webfilepick.cc 编出来的 `__fltk_uigetfile__.oct`：它把请求写进
// /tmp/ufp_queue.txt，然后**报错**让用户"选好后再跑一次"（因为选择框是异步的、
// 而 Octave 一阻塞页面就停摆 —— 见 build/113/NOTES-t6-t7-hostlayer.md 坑 1）。
// 本模块负责中间那一步：弹出选择框、把选中的文件字节写进 MEMFS、写下结果状态。
//
//   await OctaveFilePick.init()   — 开始轮询（页面启动时调用）
//   await OctaveFilePick.drain()  — 处理一次队列
//   OctaveFilePick.status()       — { opened, lastError, lastPick }
//
// 协议（与 C++ 侧一一对应，别单边改）：
//   队列：/tmp/ufp_queue.txt  追加  `<accept>\t<multiple>\t<title>`
//   状态：/tmp/ufp_status.txt `key<TAB>value` 若干行
//           state  none|pending|done|cancelled
//           count  <n>
//           nameK  第 K 个文件名（K 从 0 起）
//   字节：/tmp/ufp_picked/<原文件名>
//
// ⚠️ 实测：**程序化 `input.click()` 不需要用户手势**也能弹出选择框
//    （Chromium 里 filechooser 事件确实触发），所以这一步不需要页面放按钮。

(function () {
  const QUEUE = '/tmp/ufp_queue.txt';
  const STATUS = '/tmp/ufp_status.txt';
  const PICKED = '/tmp/ufp_picked';

  const S = { opened: 0, lastError: null, lastPick: null, busy: false, pollTimer: null };

  // 共享 primitive（bridge/queue.js）
  const Q = window.OctaveQueue;

  // ── 本协议的行格式（**唯一声明**，页面侧）────────────────────────────────
  //   <accept>\t<multiple:0|1>\t<title>     例：`*.m\t1\t选择文件`
  //   生产侧：build/webfilepick.cc（C++ 那边有同一份说明，两边靠漂移测试对齐）
  function parseLine(line) {
    const p = Q.split(line);
    return { accept: p[0] || '', multiple: p[1] === '1', title: p[2] || 'Select a file' };
  }

  function readQueue() {
    return Q.drain(QUEUE).map(parseLine);
  }

  function writeStatus(state, names) {
    const list = names || [];
    const lines = ['state\t' + state, 'count\t' + list.length];
    list.forEach((n, k) => lines.push('name' + k + '\t' + n));
    try {
      Q.fs().writeFile(STATUS, new TextEncoder().encode(lines.join('\n') + '\n'));
    } catch (e) {
      S.lastError = '写状态文件失败: ' + e.message;
    }
  }

  // FLTK 的过滤器串长这样（`__fltk_file_filter__.m` 生成的）：
  //     Text-Files (*.txt)\tM-Files (*.m)\tAll (*.{m,txt})
  // 这里把每个 (...) 里的模式抠出来，转成 <input accept> 认的扩展名列表。
  function acceptFromFilter(s) {
    const out = [];
    const re = /\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(s))) {
      for (const raw of m[1].split(/[;,]/)) {
        const part = raw.trim();
        if (!part) continue;
        const brace = part.match(/^\*\.\{(.+)\}$/);
        if (brace) {
          for (const e of brace[1].split(',')) {
            const ext = e.trim();
            if (ext) out.push('.' + ext);
          }
          continue;
        }
        const star = part.match(/^\*\.(.+)$/);
        if (star) out.push('.' + star[1].trim());
        // 裸 `*` 之类：不认，于是不设 accept（= 允许全部），而不是猜一个
      }
    }
    return Array.from(new Set(out)).join(',');
  }

  function openPicker(req) {
    const el = document.createElement('input');
    el.type = 'file';
    el.style.display = 'none';
    const accept = acceptFromFilter(req.accept);
    if (accept) el.accept = accept;
    if (req.multiple) el.multiple = true;
    document.body.appendChild(el);

    let settled = false;
    function finish(names) {
      if (settled) return;
      settled = true;
      S.busy = false;
      try { el.remove(); } catch (e) {}
      const st = names && names.length ? 'done' : 'cancelled';
      S.lastPick = { state: st, names: names || [] };
      writeStatus(st, names || []);
    }

    el.onchange = async () => {
      const files = Array.from(el.files || []);
      if (!files.length) return finish(null);
      try { Q.fs().mkdirTree(PICKED); } catch (e) {}
      const names = [];
      for (const f of files) {
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          Q.fs().writeFile(PICKED + '/' + f.name, buf);
          names.push(f.name);
        } catch (e) {
          S.lastError = '读文件失败（' + f.name + '）: ' + e.message;
        }
      }
      finish(names);
    };
    // Chrome 113+ 有 oncancel；老一点的靠"回焦但没 change"兜底
    el.oncancel = () => finish(null);

    try {
      el.click();
      S.opened++;
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(() => {
          if (!settled && !(el.files && el.files.length)) finish(null);
        }, 1200);
      });
    } catch (e) {
      S.lastError = '打开选择框失败: ' + e.message;
      finish(null);
    }
  }

  async function drain() {
    let reqs;
    try { reqs = readQueue(); } catch (e) { S.lastError = String(e.message || e); return { done: 0 }; }
    if (!reqs.length) return { done: 0 };
    // 一次只开一个选择框（同时弹两个没有意义，而且用户只能应付一个）
    if (S.busy) return { done: 0 };
    S.busy = true;
    openPicker(reqs[reqs.length - 1]);
    return { done: 1 };
  }

  async function init(opts) {
    const o = opts || {};
    if (S.pollTimer) clearInterval(S.pollTimer);
    // 比音频桥快一点：用户点完"选好后再跑一次"不该等
    S.pollTimer = setInterval(() => { drain().catch(() => {}); }, o.intervalMs || 300);
    await drain().catch(() => {});
    return true;
  }

  function status() {
    return { opened: S.opened, busy: S.busy, lastPick: S.lastPick, lastError: S.lastError };
  }

  window.OctaveFilePick = { init, drain, status, _parseLine: parseLine, _state: S };
})();
