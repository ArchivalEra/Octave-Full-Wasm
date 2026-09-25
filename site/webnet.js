// Async fetch bridge for octave-wasm. Own code, repo license.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Two halves, deliberately:
//
//   Synchronous (the one Octave actually calls): build/webnet.cc drives
//   XMLHttpRequest in sync mode from inside the wasm module, so urlread /
//   urlwrite / webread / websave behave exactly like their desktop versions —
//   same call stack, same return values, no Asyncify.
//
//   Async (this file): a plain fetch() wrapper for the page.  Use it to warm
//   the cache *before* Octave asks, to fetch things a sync XHR cannot
//   (streaming, large bodies, credentials), or to show progress in the UI.
//   It writes into the same MEMFS path the sync bridge reads from, so an
//   Octave-side urlread after a prefetch hits warm bytes.
//
//   await OctaveNet.prefetch(url)            — fetch and stage into MEMFS
//   await OctaveNet.get(url)                 — fetch, return text
//   await OctaveNet.getBytes(url)            — fetch, return Uint8Array
//   OctaveNet.stage(url, bytes)              — put bytes where urlread looks
//   OctaveNet.staged()                       — list staged urls
//
// CORS is the real constraint and it is a server-side decision: a page at
// 127.0.0.1:8761 can call any URL that sends Access-Control-Allow-Origin for
// that origin.  Same-origin URLs always work.

(function () {
  const STATUS = '/tmp/webnet_status';
  const ERROR = '/tmp/webnet_error';
  const CTYPE = '/tmp/webnet_ctype';
  const LAST = '/tmp/webnet_last';
  const staged = new Set();

  // 取 fs 用共享那份（bridge/queue.js）。注意本桥**不吃"行 + 制表符"协议**：
  // 它走的是四个单值文件（见下面 _paths 的声明），是同一族里的另一个形状。
  const fs = () => window.OctaveQueue.fs();

  function put(path, text) {
    try { fs().writeFile(path, text, { encoding: 'utf8' }); } catch (e) {}
  }

  // Make a URL's bytes visible to the synchronous bridge: write the body to
  // /tmp/webnet_last and record status/ctype, i.e. exactly the state a
  // successful __web_fetch_sync__ would have left behind.
  function stage(url, bytes, opts) {
    const o = opts || {};
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
      fs().writeFile(LAST, u8);
    } catch (e) {
      throw new Error('OctaveNet: 写入 MEMFS 失败: ' + e.message);
    }
    const status = o.status == null ? 200 : o.status;
    put(STATUS, String(status));
    put(CTYPE, o.contentType || '');
    put(ERROR, status >= 200 && status < 300 ? '' : (o.error || ('HTTP ' + status)));
    if (status >= 200 && status < 300) staged.add(url);
    return u8.length;
  }

  async function fetchRaw(url, opts) {
    const o = opts || {};
    const res = await fetch(url, {
      method: o.method || 'GET',
      headers: o.headers,
      body: o.body,
      credentials: o.credentials,
    });
    const buf = await res.arrayBuffer();
    return { res, bytes: new Uint8Array(buf) };
  }

  async function getBytes(url, opts) {
    const { res, bytes } = await fetchRaw(url, opts);
    if (!res.ok) {
      stage(url, bytes, {
        status: res.status,
        contentType: res.headers.get('Content-Type') || '',
        error: 'HTTP ' + res.status,
      });
      throw new Error(`OctaveNet: ${url} → HTTP ${res.status}`);
    }
    stage(url, bytes, { status: res.status, contentType: res.headers.get('Content-Type') || '' });
    return bytes;
  }

  async function get(url, opts) {
    const bytes = await getBytes(url, opts);
    return new TextDecoder().decode(bytes);
  }

  // Stage a URL's bytes without the caller ever seeing them — the point is to
  // have them ready when Octave asks.
  async function prefetch(url, opts) {
    try {
      const bytes = await getBytes(url, opts);
      return { url, ok: true, bytes: bytes.length };
    } catch (e) {
      return { url, ok: false, error: String(e.message || e) };
    }
  }

  function stagedList() { return Array.from(staged); }

  window.OctaveNet = { prefetch, get, getBytes, stage, staged: stagedList, _paths: { LAST, STATUS, ERROR, CTYPE } };
})();
