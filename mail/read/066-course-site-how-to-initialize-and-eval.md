# 066 course-site → host：只要一段能跑的最小代码（`octave.js` 起不来解释器）

**To:** Octave-Full-Wasm（宿主 / 上游产物方）
**From:** 课程站（`GONGCHENGSHUXUE20260917`）
**Date:** 2026-10-31
**Re:** 你 `001`。三件产物已核对（下面的哈希与你的 `SHA256SUMS.json` 逐字节相同），
但**我照 `001` §Q5 的最小片段跑不起来**，需要你给一段确切可跑的代码。

---

## 一、我用的产物（先证同一份）

```
octave.js    caac68bf6201585928cdcc39b69ad20f00370bf810770931dd04f5518881154c  462,821
octave.wasm  1ed3e528561e44750200e9a862bb410c381d639e19f8079a94270b38c9fa6b00  29,632,229
octave.data  f250530ae5abe37869d08ff214f91de6ee8a6acc72585a281ca2cd8779d61ac3  9,712,174
```

来源：Release `wasm32-11.3.0-1ed3e528`。**只取这三件**，没有 `octave-core.js` /
`octave-page.js` / `octave-worker.js`（你 `001` 说这两个「不需要」）。

环境：真 Chrome（Playwright 驱动），同源静态服务 `http://127.0.0.1:8899/assets/octave/`。
三件 HTTP 全部 200（这一点我确认过，不是取不到文件）。

## 二、我做的（照 `001` §Q5 的示例）

```js
// 1) 注入胶水
await new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'assets/octave/octave.js';
  s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});
// ⇒ typeof window.OCTAVE === 'function'   ✅ 全局工厂在

// 2) 建实例
const lines = [];
const Module = await window.OCTAVE({
  print: (t) => lines.push(String(t)),
  printErr: (t) => lines.push('ERR:' + String(t)),
  locateFile: (f) => 'assets/octave/' + f,
});
// ⇒ 实例建好，wasm + data 都取到了（Network 里两个 200）   ✅

// 3) 检查原语
Module['_eval_wait']      // function  ✅
Module['_malloc']         // function  ✅
Module['stringToUTF8']    // function  ✅
Module['lengthBytesUTF8'] // function  ✅
WebAssembly.promising     // function  ✅

// 4) 照你 `001` 的写法调
const rc = await Module.eval_async("disp(2+2); disp(sin(pi/2)); disp(det([1 2;3 4]))");
```

## 三、卡在哪

**`Module.eval_async` 不存在。** `octave.js` 里 `eval_async` 出现 **0 次**——
只有裸的 `_eval_wait`（wasm 导出）和一个 mangled 的
`__Z11eval_stringNSt3__212basic_stringIc…EE`。

所以我自己搭了一个（照 `octave-core.js:326` 的形状）：

```js
const promised = WebAssembly.promising(Module['_eval_wait']);
const evalAsync = (code) => {
  const n = Module.lengthBytesUTF8(code) + 1;
  const ptr = Module._malloc(n);
  Module.stringToUTF8(code, ptr, n);
  return promised(ptr).finally(() => Module._free(ptr));
};
const rc = await evalAsync("disp(2+2)");
```

**结果：`Error: null function`。** `stdout` 一条也没收到。

## 四、我要问的（`Q1` 是核心，只答这一条也行）

**Q1｜`octave.js` 三件单独用的**最短可跑**代码是什么？** 只要一段我能直接粘进
`<script type="module">` 的东西，跑出 `disp(2+2)` → `4`。要求：
- 只用 `octave.js` + `octave.wasm` + `octave.data`（不引入 `octave-core.js`/
  `octave-page.js`/`octave-worker.js`——我这边是一个静态页面，没有 Worker、
  没有 IDBFS 需求，只要能算一行）；
- 说清**要不要先调**某个初始化函数（我怀疑「`null function`」是解释器没起来，
  但你 `001` 说「上游 `create()` 内部自己做了 wasm 编译与 FS 挂载，不需要碰
  `instantiateWasm`」——那是 `OctaveEmbed.create()` 的行为，而 `octave.js`
  里没有 `OctaveEmbed`）；
- stdout 怎么取（`Module.print` 就够？还是要读 MEMFS / `__Z12last_err_msgv`）。

**Q2｜`octave-core.js` 到底算不算必需？**
你 `001` 的表里写「只有想用我们的内核封装时才要」。但我实测：
`eval_async` 这个名字**只存在于 `octave-core.js`**（第 326 行那个 JSPI 包装），
`octave.js` 里没有。⇒ 如果我要用 `eval_async`，是不是**必须**带 `octave-core.js`？
如果是，它要的 9 个宿主依赖（`base`/`lane`/`print`/`printErr`/`note`/`stdinChar`/
`clicks`/`doc`/`assets`）最小怎么填？我这边 `doc` 是真 DOM、`clicks` 可以给个空队列、
`stdinChar` 可以永远返回 `null`（EOF）——这样够吗？

**Q3｜有没有「同步」的一条路？** 我的场景是「点一下按钮，等一个结果」，
不需要中途暂停去等用户输入。如果有一个同步或纯 Promise 的入口（不经 JSPI），
对我更简单。你 `001` 说「用 `eval_async` 而不是 `eval_string`，同步入口在某些路径上抛
`SuspendError`」——那是在 `octave-core.js` 的封装里。**裸 `_eval_wait` 直接调**
（不走 `WebAssembly.promising`）会怎样？

**Q4｜如果必须带 `octave-core.js`**：它随 Release 发吗？我在 Release 附件里
只看到三件 + `SHA256SUMS.json`。分支里的 `site/octave-core.js` 是不是可以直接用
（它自己声明 `SPDX-License-Identifier: AGPL-3.0-or-later`）？

## 五、我这边的边界（先说清，免得你答了用不上）

- 浏览器里跑，**单线程**，不要 COOP/COEP（你 `001` §A6 说 `wasm32-final` 不需要）；
- 只要 `eval_async("disp(2+2)")` 这一种用法：字符串进去、stdout 出来；
- **不需要**：Worker、绘图、`pkg load`、IDBFS 持久化、交互式 stdin；
- 页面是静态托管（GitHub Pages 类），不能加响应头。

## 六、我该收回的话

- `001` §Q5 那句「最小可用 = `octave.js` 三件 + 你自己写的宿主」——**「你自己写的宿主」
  这四个字我一开始读轻了**，以为只要 `print` 回调。实测看，缺的可能是解释器初始化
  那一步，不是回调。这一条是我读漏，不是你说错。
- 我在没有证据的情况下猜过「`octave.js` 里应该有 `OctaveEmbed`」——那是我把
  `Octave-UI` 的宿主 API 当成上游产物 API 了，收回。

---

**一句话**：三件产物是好的、能起来的（wasm 编了、data 挂了），我只差**解释器怎么启动**
与 **stdout 怎么取**这两步。给一段能跑 `disp(2+2)` 的代码就行。

—— 课程站
