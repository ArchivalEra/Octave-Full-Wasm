## Octave-Full-Wasm — **播放状态机**（唯一拥有者，own code, repo license）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么要有它（2026-09-23 胶水层审计候选 5）───────────────────────────────
## 播放器的状态是六个字段（`Running` / `PlayingFrom` / `PlayingTo` / `StartTime` /
## `PausedAt` / `CurrentSample`），而它们以前由**六个 module 各自维护**：
##   `__player_play__`（写 5 个）、`__player_pause__`（冻结时钟）、
##   `__player_resume__`（平移 StartTime）、`__player_stop__`（清 6 个）、
##   `__player_isplaying__`（**在谓词里**判"播完了"并写 2 个）、
##   `__player_playblocking__`（自己再写一遍"播完了"那 2 个）。
## ⇒ 同一件事（时长/已播时间/播完）算三遍，"播完"写两遍，谁都没法单独看懂这条状态机。
##
## 现在：**只有本文件写这六个字段**。六个 `__player_*` 保留原签名，只负责"取参数 → 调这里
## → 入队给页面"。于是"状态机对不对"第一次可以在**没有浏览器**的情况下测（见文末 `%!test`）。
##
## ── 状态机 ──────────────────────────────────────────────────────────────────
##                     play(s,e)                finish / tick(到点)
##      (无) ─────────────► running ────────────────► off
##                            │  ▲                      ▲
##                     pause  │  │  resume              │ stop
##                            ▼  │                      │
##                         paused ─────────────────────┘
##   · play 之后再 play、pause 之后再 pause、resume 只对 paused 有效（其余都是 no-op）
##   · **play 必须清 PausedAt**：否则 elapsed 会用上一轮的暂停点算，得到一个负数
##     （旧代码就有这个洞：`play; pause; play` 之后 `CurrentSample` 会算出负值）
##
## ── 为什么"查询也能推进状态"（tick 事件）─────────────────────────────────────
## 本构建**没有定时器**（Octave 侧拿不到页面的事件循环，`pause()` 期间页面完全停摆，
## 见 HISTORY §5.10）。所以"播完了"这件事只能**被查出来的**：`isplaying`/`playblocking`
## 顺带推一次时钟（tick），到点就转 off。这不是设计上的漂亮解，是环境约束下的唯一解 ——
## 写在这里免得下一个人把它当 bug"修"掉。
##
## ── 接口 ────────────────────────────────────────────────────────────────────
##   [tf, dur] = __pba_transition__ (id, event, ...)
##     event = "play"（后跟 1 基的 s, e）| "pause" | "resume" | "stop"
##           | "tick"（推进时钟，返回还在不在跑）| "finish" | "duration"（只为了拿 dur）
##     tf  = 事件之后这个播放器是否在跑
##     dur = 排定区间时长（秒）；没排定就是 []

function [tf, dur] = __pba_transition__ (id, event, varargin)

  tf = false;
  dur = [];

  if (! (isscalar (id) && id >= 1))
    return;
  endif

  fs = __pba_get__ (id, "SampleRate");
  s = __pba_get__ (id, "PlayingFrom");
  e = __pba_get__ (id, "PlayingTo");
  t0 = __pba_get__ (id, "StartTime");
  paused_at = __pba_get__ (id, "PausedAt");

  scheduled = (! isempty (fs) && fs > 0 && ! isempty (s) && ! isempty (e) && ! isempty (t0));
  if (scheduled)
    dur = (e - s + 1) / fs;
  endif

  switch (event)
    case "play"
      ## varargin = {s1, e1}：1 基的采样区间（调用方负责把用户给的 0 基换算过来）
      s1 = varargin{1};
      e1 = varargin{2};
      __pba_put__ (id, "Running", "on");
      __pba_put__ (id, "CurrentSample", s1 - 1);
      __pba_put__ (id, "PlayingFrom", s1);
      __pba_put__ (id, "PlayingTo", e1);
      __pba_put__ (id, "StartTime", __pba_now__ ());
      __pba_put__ (id, "PausedAt", []);     # ★ 清掉上一轮的暂停点（否则 elapsed 会算成负的）
      ## dur 要在**设置完区间之后**再算：开头那次是从事件之前的状态算的（那时还没排定）
      if (! isempty (fs) && fs > 0)
        dur = (e1 - s1 + 1) / fs;
      endif
      tf = true;

    case "pause"
      if (! strcmp (__pba_get__ (id, "Running"), "on"))
        return;                             # 没在跑：暂停是 no-op
      endif
      __pba_put__ (id, "PausedAt", __pba_now__ ());   # 冻结时钟
      __pba_put__ (id, "Running", "paused");

    case "resume"
      if (! strcmp (__pba_get__ (id, "Running"), "paused"))
        return;                             # 不是暂停态：恢复是 no-op
      endif
      if (! isempty (t0) && ! isempty (paused_at))
        __pba_put__ (id, "StartTime", t0 + (__pba_now__ () - paused_at));  # 把冻结的那段补回去
      endif
      __pba_put__ (id, "PausedAt", []);
      __pba_put__ (id, "Running", "on");
      tf = true;

    case "stop"
      __pba_put__ (id, "Running", "off");
      __pba_put__ (id, "CurrentSample", 0);
      __pba_put__ (id, "PausedAt", []);
      ## 连排定区间一起清：否则之后 resume 会去接一段已经不存在的区间，
      ## isplaying 也会拿过期的 StartTime 去比时钟。
      __pba_put__ (id, "PlayingFrom", []);
      __pba_put__ (id, "PlayingTo", []);
      __pba_put__ (id, "StartTime", []);

    case "finish"
      ## 播完：停在末采样。**保留**排定区间（与旧行为一致：finish 后 Running 是 off，
      ## resume 只认 paused，所以不会去接它）
      __pba_put__ (id, "Running", "off");
      __pba_put__ (id, "CurrentSample", e);
      tf = false;

    case "tick"
      if (! strcmp (__pba_get__ (id, "Running"), "on"))
        return;                             # 没在跑 ⇒ 不在跑
      endif
      if (scheduled)
        if (! isempty (paused_at))
          elapsed = paused_at - t0;         # 暂停期间冻结
        else
          elapsed = __pba_now__ () - t0;
        endif
        if (elapsed >= dur)
          __pba_put__ (id, "Running", "off");
          __pba_put__ (id, "CurrentSample", e);
          return;
        endif
        __pba_put__ (id, "CurrentSample", s - 1 + round (elapsed * fs));
      endif
      tf = true;

    case "duration"
      tf = false;                           # 只想拿 dur：状态不动

    otherwise
      error ("__pba_transition__: unknown event '%s'", event);
  endswitch

endfunction


%!test
## 状态机现在可以**脱离浏览器**测了 —— 这正是"把它收成一个 module"的回报之一。
%! global __pba__;
%! saved = __pba__;
%! unwind_protect
%!   __pba__ = struct ("items", {{}}, "next", 1);
%!   id = 1;
%!   __pba__.items{id} = struct ("SampleRate", 8000, "NumberOfChannels", 1, ...
%!                               "TotalSamples", 8000, "Running", "off", ...
%!                               "PlayingFrom", [], "PlayingTo", [], "StartTime", [], ...
%!                               "PausedAt", [], "CurrentSample", 0);
%!   ## play → running，且排定区间/起始时间/暂停点都被设成一致的样子
%!   [tf, dur] = __pba_transition__ (id, "play", 1, 8000);
%!   assert (tf, true);
%!   assert (dur, 1);                                     # 8000 采样 / 8000 Hz = 1 秒
%!   assert (__pba_get__ (id, "Running"), "on");
%!   assert (isempty (__pba_get__ (id, "PausedAt")));
%!   ## pause 冻结、resume 解冻，且 resume 把停住的那段补回 StartTime
%!   __pba_transition__ (id, "pause");
%!   assert (__pba_get__ (id, "Running"), "paused");
%!   tp = __pba_get__ (id, "PausedAt");
%!   assert (! isempty (tp));
%!   __pba_transition__ (id, "resume");
%!   assert (__pba_get__ (id, "Running"), "on");
%!   assert (isempty (__pba_get__ (id, "PausedAt")));
%!   ## tick：还在区间内 ⇒ 在跑；把时钟推到区间之外 ⇒ 自己转 off 并停在末采样
%!   assert (__pba_transition__ (id, "tick"), true);
%!   __pba_put__ (id, "StartTime", __pba_now__ () - 5);   # 假装已经播了 5 秒（区间只有 1 秒）
%!   assert (__pba_transition__ (id, "tick"), false);
%!   assert (__pba_get__ (id, "Running"), "off");
%!   assert (__pba_get__ (id, "CurrentSample"), 8000);
%!   ## stop：清干净（含排定区间 —— 否则 resume 会去接不存在的区间）
%!   __pba_transition__ (id, "play", 101, 200);
%!   __pba_transition__ (id, "stop");
%!   ## 逐字段写死（用循环反而看不出是哪个字段不对 —— 第一版就是这么写的，
%!   ## 结果 `CurrentSample` 期望成空、实际是 0，报错只给了 `assert (isempty (v)) failed`）
%!   assert (__pba_get__ (id, "Running"), "off");
%!   assert (__pba_get__ (id, "CurrentSample"), 0);
%!   assert (isempty (__pba_get__ (id, "PausedAt")));
%!   assert (isempty (__pba_get__ (id, "PlayingFrom")));
%!   assert (isempty (__pba_get__ (id, "PlayingTo")));
%!   assert (isempty (__pba_get__ (id, "StartTime")));
%!   ## no-op 边界：不是 paused 时 resume 不做事；没在跑时 pause 不做事
%!   __pba_transition__ (id, "resume");
%!   assert (__pba_get__ (id, "Running"), "off");
%!   __pba_transition__ (id, "pause");
%!   assert (__pba_get__ (id, "Running"), "off");
%!   ## ★ 回归：play 必须清 PausedAt（旧代码的洞 —— play/pause/play 之后会算出负的 CurrentSample）
%!   __pba_transition__ (id, "play", 1, 8000);
%!   __pba_transition__ (id, "pause");
%!   __pba_transition__ (id, "play", 1, 8000);
%!   assert (isempty (__pba_get__ (id, "PausedAt")));
%!   assert (__pba_transition__ (id, "tick"), true);
%!   assert (__pba_get__ (id, "CurrentSample") >= 0);
%! unwind_protect_cleanup
%!   clear -g __pba__;
%!   if (isstruct (saved)), __pba__ = saved; endif
%! end_unwind_protect
