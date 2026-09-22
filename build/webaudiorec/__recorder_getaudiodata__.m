## Return the recorded audio (T7).  **朝向是 声道 × 帧**，不是帧 × 声道。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ⚠️ 朝向这条是**读 @audiorecorder/getaudiodata.m 的收尾**定出来的，不是猜的：
## 那个 .m 最后做的是
##     if (get (recorder, "NumberOfChannels") == 2)
##       data = data.';        # 立体声：原样转置
##     else
##       data = data(1,:).';   # 单声道：**取第 1 行**
##     endif
## 所以本函数必须交回 声道×帧；单声道还必须**至少有 1 行**，否则那句 `data(1,:)`
## 直接 "out of bound 0"（第一版就是栽在这里：返回了 0×1，单声道路径一读就报错）。
## 于是空数据也要返回 **nch×0**（单声道 = 1×0，转置后 0×1，与桌面版"还没录到东西"
## 的形状一致）。
##
## 数据来自页面写下的 /tmp/pra_<id>.f64（交织的 little-endian double，与播放侧同布局）。
## Octave 的裸读是列优先，所以 reshape 成 (声道 × 帧) 正好 —— 不用再转置。
##
## ── 权限三态必须**分开报**（外部审核 B1 明确要求）──────────────────────────
## "允许 → 正常录音 / 拒绝 → Octave 可读的明确错误 / 没有安全上下文 → 明确错误"。
## 尤其**不能假装麦克风永远存在**：拿不到数据时给一句能照着做的错误，
## 而不是返回空矩阵让调用者去猜。

function data = __recorder_getaudiodata__ (h)

  id = __pra_id__ (h);
  if (id < 1)
    error ("audiorecorder: invalid recorder handle");
  endif

  nch = __pra_get__ (id, "Channels");
  if (isempty (nch) || ! (isscalar (nch) && nch >= 1))
    nch = 1;
  endif

  s = __pra_progress__ (id);

  ## 三态分开报；页面的原文（若有）作为括号里的补充，不自造细节。
  if (strcmp (s.state, "denied"))
    msg = ["audiorecorder: microphone access was denied by the user or by the " ...
           "browser. Grant microphone permission for this origin, then record again."];
    if (! isempty (s.err))
      msg = [msg " (" s.err ")"];
    endif
    error ("%s", msg);
  elseif (strcmp (s.state, "insecure"))
    msg = ["audiorecorder: microphone capture requires a secure context " ...
           "(https://, or http://localhost / http://127.0.0.1)."];
    if (! isempty (s.err))
      msg = [msg " (" s.err ")"];
    endif
    error ("%s", msg);
  elseif (strcmp (s.state, "error"))
    error ("audiorecorder: recording failed: %s", s.err);
  endif

  ## 空数据也要是 nch×0（见文件头：单声道路径会 data(1,:)）
  data = zeros (nch, 0);

  fn = sprintf ("/tmp/pra_%d.f64", id);
  if (! exist (fn, "file"))
    return;
  endif

  fid = fopen (fn, "rb");
  if (fid < 0)
    return;
  endif
  raw = fread (fid, Inf, "double");
  fclose (fid);

  n = floor (numel (raw) / nch);
  if (n < 1)
    return;
  endif

  raw = raw(1:n*nch);
  data = reshape (raw, nch, n);

endfunction
