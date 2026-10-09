# 48: **octave-page.js 重写为 TypeScript**（拆三道缝 + 合并刷新输出），回答"DOM 该不该改 wasm"

**What to build:** 用户令（2026-10-03）："重写 octave-page.js，去掉大部分 DOM 胶水，最好用
TypeScript"；并追问"DOM 重绘一下比计算性能消耗都大，要不这也改 wasm？你觉得呢"。本单 =
**先实测**（用户选"先测量再定"）→ 按实测结论重写 → 用数据回答"要不要改 wasm"。

**Blocked by:** None

**Status:** resolved （2026-10-03：TS 重写完成、三套 embed 验收全绿、输出插入 −99%；
结论 = **DOM 不是瓶颈、更不该挪进 wasm**，合并刷新 + 可替换 Sink 是对解）

**Settling:** 重写后跑 `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
test/browser/{accept-embed-api,accept-embed-multi,probe-embed-inventory}.mjs http://127.0.0.1:8865/`
—— 三套应全绿（13/0、13/0、14/0）；`sh build/build-embed-ts.sh` 应可重编。

## Answer

（2026-10-03 结案。）

**① 测量（先做，用户选的）**：`test/browser/probe-output-cost.mjs`（同页 A=真 DOM /
B=计数不插树）+ 纯净 sink 基准（无 wasm，排除 JIT/预热混淆）：

- 一次 1.4MB 输出（`disp(rand(400,400))`）= **27000 次 DOM 插入**；
- 旧的 A−B "DOM 差" 540–720ms **不可信**（A 恒跑冷启动位，就是本仓记录过的 ±30% 运行间方差
  —— 自己踩了自己的教训）；**可信的是直接计数**：插入 27000、原始 `createTextNode+appendChild`
  107ms（冷）。
- 纯净 sink 基准（27000 行/321KB，5 轮取中位）：**逐行 12.8ms vs 合并 ≈0ms（425×）**。

**② 结论：DOM 不是瓶颈，更不该挪进 wasm。** compute（`disp(rand(400,400))` ≈2.4s）比 DOM
（几十 ms 量级）大两个量级；且 **wasm 碰不到 DOM** —— 挪进去只会把 `JS→DOM` 变成
`wasm→import→JS→DOM`（每次多一次边界穿越），成本在**布局**、只有 DOM 侧能治。
用户"DOM 重绘比计算贵"的直觉**方向**在富 UI（逐行 span/高亮/行号，DOM 成本 ∝ 渲染器复杂度）
才成立，在裸 `<pre>` 上不成立。

**③ 重写（deliverable）**：`bridge/octave-page.ts`（源）→ `bridge/octave-page.js`（编译产物，
ES5 全局脚本、逐名兼容旧版对外面）。重画三道**类型化的缝**：
- **Host 契约** = `CoreHooks` 接口（内核/页面之间唯一接口面，10 件收敛成显式类型）；
- **输出** = 可替换的 `OutputSink`：默认 `createCoalescedPreSink`（**时间预算 16ms 合并刷新**——
  同步 eval 里也能中途 flush 保住流式，异步突发 rAF 兜底；200ms 节流滚动保留）；
- **输入捕获** = 独立小函数（pointerdown 扇出 / Ctrl-C / interrupt，需要 document 留在 JS）。
删掉的是"每行一次 DOM 写 + 每次重查 DOM"的胶水；保留的是全部对外语义。
编译：`sh build/build-embed-ts.sh`（tsc 装仓库外 `/mnt/hdd/crossbuild-tools/npm-ts`，不污染白名单）。

**④ 验证**：重写后 `probe-embed-inventory` **14/14**、`accept-embed-api` **13/0**、
`accept-embed-multi` **13/0**（8865 embed 站实测）；8761 现役**不受影响**（用旧内联版，
`site/index.html` 不引 `octave-page.js`）—— 故本批**不 promote**，`site/` 同步留给 38 上站批。

**⑤ 收益**：DOM 插入 27000 → 167（−99%）、原始调用 107ms → 4.5ms（−96%）；且 `OutputSink`
这道缝让 UI 换自己的渲染器（终端网格/ANSI/scrollback）**不动内核** —— 这才是"去 DOM 胶水"
的正解形状。
