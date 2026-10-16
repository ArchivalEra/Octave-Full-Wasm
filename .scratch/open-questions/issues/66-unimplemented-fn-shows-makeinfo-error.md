# 66 · 未实现函数给出 `makeinfo` 子进程错误（应给"未实现"的可读信息）

**Status:** resolved
**结案凭据**（2026-10-16）：复跑结算件 **6/0**；修法 ① 已落 `build/webshims/__makeinfo__.m`（见文末 §结案）。
**Settling:** `node test/browser/probe-unimplemented-msg.mjs <URL>` —— rc=0 ⇒ 两类名字都给出可读信息
（未实现的核心 MATLAB 名字 ⇒ 含 "not yet implemented" 且**不含** `makeinfo`/`system:`；真正不存在的名字 ⇒
含 "undefined"）；rc=1 ⇒ 仍在报 `makeinfo` 子进程错误；rc=3 ⇒ 环境问题（页面没起来），不是结论。
结算件尚未存在 —— **本工单的第一交付物就是造它**。

## 背景（2026-10-13 实测）

浏览器里调一个 **Octave 认识、但本构建装不上**的 MATLAB 函数名，得到的**不是**可读的
"未实现"，而是一句**子进程错误**：

```
>> table()
error: system: unable to start subprocess for 'makeinfo --no-headers --no-warn
       --no-validate --plaintext --fill-column=80 -c exampleindent=2 --output=- "/tmp/octave-help-..."
```

对照：**真正不存在**的名字报得很干净 ——
`zzz_abc()` ⇒ `'zzz_abc' undefined near line 1, column 37`。

### 两类名字，实测（8761，逐条 `try/catch` 取 `e.message`）

| 名字 | 实测结果 |
|---|---|
| `table` `datetime` `duration` `timetable` `string` `contains` `strlength` `pad` `split` `join` | **`system: unable to start subprocess for 'makeinfo …'`** |
| `readmatrix` `zzz_abc` `zzz_def` | `'<名>' undefined near line 1, column 37`（干净） |

（`exist('table')` = 0、`exist('readmatrix')` = 0 **两者一样**，但报错完全不同 —— 差别不在"在不在"。）

## 根因（已定位到行）

`upstream/octave/scripts/help/__unimplemented__.m:549`：

```matlab
if (txt)
  ...
  txt = __makeinfo__ (txt, "plain text");   # ← 这里 shell out 到 makeinfo
endif
```

Octave 内置一张"MATLAB 有、我们没实现"的名单（`missing_functions()`），命中就走
`__unimplemented__` 生成一条**带 texinfo 标记**的提示，再调 `__makeinfo__` 把它渲成纯文本
—— 而 `__makeinfo__` 的实现是 `system(["makeinfo …"])`。**本构建无 shell**（AGENTS 硬约束、
`system()` 恒失败）⇒ 渲染那一步抛错，**盖掉了本来要给用户看的那句话**。

⇒ 用户看到的是"内部工具炸了"，而真相是"这个函数我们还没实现"——**正好把最有用的信息换成最没用的**。

## 影响

- **MATLAB 贴近度**：`table`/`datetime`/`duration`/`string` 是现代 MATLAB 脚本的日常类型
  （用户点令"完全靠近 MATLAB"）⇒ 用户一上手就会撞，且撞到的是**误导性**错误。
- 属"既存缺口"（非本轮引入），但**本仓第一次实测到并定位**。

## 修法（两选一，都可测）

1. **改 `.m` 覆写**（推荐，零重链）：在 `build/webshims/` 加 `__makeinfo__.m` 覆写 ——
   无 shell 时**不做 texinfo 渲染**，直接把 `txt` 剥掉标记返回（或原样返回）。
   理由：`__makeinfo__` 的**唯一职责**是"把 texinfo 变纯文本"，本构建没有 `makeinfo`，
   而调用方（`help`/`__unimplemented__`）要的是"能读的一段字"，不是"渲染过的 texinfo"。
   ⚠️ 必须**同时**覆盖 `help` 的路径（`help.m:110/192` 也调它）—— 但 `help sin` 实测
   返回 len=105（能读），说明那条路已有别的兜底 ⇒ 改前先量，别把 `help` 弄坏。
2. **改 C++**：在 `system()`/`popen()` 的 shim（`build/webshims/system.m`）里识别
   `makeinfo` 调用并返回一个"空渲染结果 + status≠0"，让 `__makeinfo__` 走它的降级分支。
   （重链成本高，非首选。）

**验收判据（两条，正反各一）**：
- 正向：`table` / `datetime` / `string` ⇒ 报错含 `not yet implemented`（或至少**不含** `makeinfo`/`system:`）；
- 反向：`zzz_abc` ⇒ 仍报 `undefined`（**不许**把"真不存在"也说成"未实现"）。

## 相关

- 未实现名单本身在 `__unimplemented__.m`（含 `table`/`datetime` 等），**这是 Octave 上游的
  既有设计**，本仓只是第一个在"无 shell"环境下撞到它的。
- 与 `build/GAPS.md` §2「能力级缺口」同族：那张表记的是"能不能用"，本工单记的是
  "**不能用时给的信息对不对**"。


---

## ★ 结案（2026-10-16）

**结算件已存在**（`test/browser/probe-unimplemented-msg.mjs`，2026-10-13 造），**复跑 6/0**：

```
sh test/browser/run.sh test/browser/probe-unimplemented-msg.mjs http://127.0.0.1:8761/
  ⇒ ① table/datetime/duration/string ⇒ 报错**不含** makeinfo/system（可读）
     ② zzz_abc_9f / zzz_def_7q ⇒ 仍报 `undefined`（"真不存在"没说成"未实现"）
=== 6 PASS / 0 FAIL ===  结论：工单 66 已修
```

**修法 = 本工单建议的 ①**（零重链）：`build/webshims/__makeinfo__.m` 覆写已落（2026-10-13）。

**一处如实记的变化**（不影响判据，但读者会注意到）：现在这些名字报的是
**`The 'table' function belongs to the 'datatypes' package indexed in…`** —— 因为
`datatypes` 已进**货架**（`OctaveAssets.install('datatypes')` 可装，见 `accept-forge`）⇒
报错比"not yet implemented"**更准**（它告诉用户**怎么拿到**）。判据两条仍成立
（不含 makeinfo/system；"真不存在"仍报 undefined）。
