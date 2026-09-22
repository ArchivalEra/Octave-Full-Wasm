## audiodevinfo 最小 shim —— "浏览器默认设备"模型（T6 / 缺口清单 B2）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么需要它 ─────────────────────────────────────────────────────────────
## 本构建**没有 PortAudio**，`audiodevinfo` 那个内建整个被条件编译掉了
## （实测 `exist("audiodevinfo")` = 0）。后果是两处：
##   · 官方 `@audioplayer` 的文档里"设备 ID 用 audiodevinfo 查"没有对应实现；
##   · `@audiorecorder` 的类测试以 `audiodevinfo` 为前提（`%!testif HAVE_PORTAUDIO`）。
##
## ── 做法：静态设备模型，**不做真枚举** ───────────────────────────────────────
## 外部审核（GPT-REVIEW-2 的 B2）给的建议就是这条：只保证最常见的查询不炸，
## 对做不到的（真实设备枚举/驱动查询）给**明确错误**。
## 为什么做不了真枚举：`navigator.mediaDevices.enumerateDevices()` 是**异步**的、
## 而且要用户授权，而 Octave 侧是**同步**的。想像 PortAudio 那样"列出真设备"
## 在这条架构里不可能如实做到，所以这里给的是**兼容性 shim，不是设备枚举器**。
## 设备名也如实写成 "Browser ..."，**不假装**是真实硬件型号。
##
## ── 语义对齐（照抄 `libinterp/dldfcn/audiodevinfo.cc` 的分支）───────────────
##   audiodevinfo()                          → 结构体，含 input/output 两个结构体
##   audiodevinfo(io)                        → **设备个数**（不是结构体！）
##   audiodevinfo(io, name)                  → 该名字的 ID
##   audiodevinfo(io, id)                    → 该 ID 的**名字**
##   audiodevinfo(io, id, "DriverVersion")   → 驱动版本串
##   audiodevinfo(io, rate, bits, chans)     → 支持该参数的设备 ID（否则 -1）
##   audiodevinfo(io, id, rate, bits, chans) → 是否支持（逻辑值）
## io 取值 0=输出、1=输入；其它值报官方那句 "specify 0 for output and 1 for input
## devices"；io 合法但设备不存在时报 "no device found for the specified criteria"。
## 第三参数官方**只认** "DriverVersion"（不是 "Name"），所以这里也只认它。

function r = audiodevinfo (varargin)

  n = numel (varargin);
  if (n > 5)
    print_usage ();
  endif

  ## 静态设备表：每个方向**恰好一台**，ID 恒为 0（见文件头：真枚举做不到）。
  dev.name = {"Browser microphone", "Browser default output"};
  dev.drv  = {"Web MediaDevices",    "Web Audio"};
  dev.io   = [1, 0];                        # 1 = 输入，0 = 输出

  if (n == 0)
    r = struct ("input",  struct ("Name", dev.name{1}, ...
                                  "DriverVersion", dev.drv{1}, "ID", 0), ...
                "output", struct ("Name", dev.name{2}, ...
                                  "DriverVersion", dev.drv{2}, "ID", 0));
    return;
  endif

  io = varargin{1};
  if (! (isnumeric (io) && isscalar (io) && (io == 0 || io == 1)))
    error ("audiodevinfo: specify 0 for output and 1 for input devices");
  endif
  k = find (dev.io == io);                  # 该方向在表里的下标（本表恒为非空）

  if (n == 1)
    r = numel (k);                          # 官方语义是**设备个数**
    return;
  endif

  a2 = varargin{2};

  if (n == 2)
    if (ischar (a2))
      if (strcmp (a2, dev.name{k}))         # 名字 → ID
        r = 0;
      else
        error ("audiodevinfo: no device found for the specified criteria");
      endif
    elseif (isnumeric (a2) && isscalar (a2))
      if (a2 == 0)                          # ID → 名字
        r = dev.name{k};
      else
        error ("audiodevinfo: no device found for the specified criteria");
      endif
    else
      error ("audiodevinfo: no device found for the specified criteria");
    endif
    return;
  endif

  if (n == 3)
    ## 官方只支持这一个属性名 —— 别顺手加 "Name"/"Channels"，那会造出桌面版没有的行为
    if (! (ischar (varargin{3}) && strcmp (varargin{3}, "DriverVersion")))
      error ('audiodevinfo: third argument must be "DriverVersion"');
    endif
    if (isnumeric (a2) && isscalar (a2) && a2 == 0)
      r = dev.drv{k};
    else
      error ("audiodevinfo: no device found for the specified criteria");
    endif
    return;
  endif

  ## n == 4/5：参数支持查询
  if (n == 4)
    id = []; rate = a2; bits = varargin{3}; chans = varargin{4};
  else
    id = a2; rate = varargin{3}; bits = varargin{4}; chans = varargin{5};
  endif

  if (! (isnumeric (rate) && isscalar (rate) && ...
        isnumeric (chans) && isscalar (chans)))
    error ("audiodevinfo: invalid rate or channel count");
  endif
  if (! isnumeric (bits))
    error ("audiodevinfo: invalid bits per sample format");
  endif

  ## ⚠️ 这是**声明式**支持矩阵，不是探测结果（文件头已说明本 shim 不探测硬件）：
  ## 列的是"WebAudio 桥这条路上我们认为可用的常见取值"，之外的如实判为不支持，
  ## 而不是一律回 true —— 报"支持"却放不出声比报"不支持"更糟。
  ok = (any (rate == [8000 11025 16000 22050 32000 44100 48000 88200 96000]) && ...
        any (bits == [8 16 24 32]) && chans >= 1 && chans <= 2);

  if (n == 4)
    if (ok)
      r = 0;                                # 本表只有 ID 0 一台
    else
      r = -1;
    endif
  else
    if (! (isnumeric (id) && isscalar (id) && id == 0))
      error ("audiodevinfo: invalid audio device ID = %d", id);
    endif
    r = ok;
  endif

endfunction
