# NOTES · T6（audiodevinfo / doc / 输出落点）与 T7（audiorecorder）

> 2026-09-22。这一批属"非图形收尾"，**全部走资产车道，主 wasm 零改动**。
> 每条都有一手实测；踩过的坑写在"坑"一节，接手别再重踩。

## 一、T6：三件事（比计划多一件）

计划写的是"`audiodevinfo` 最小 shim + `doc`（help → DOM）"。做的过程中发现
**还有一件必须做**，否则第二件无处落地。

### 1. `audiodevinfo` 最小 shim（`build/webaudio/audiodevinfo.m`）

- **为什么需要**：本构建没有 PortAudio，`audiodevinfo` 内建整个被编掉
  （实测 `exist("audiodevinfo")` = **0**）。
- **做法**：静态"浏览器默认设备"模型（输入/输出各一台，ID 恒为 0），
  名字如实写成 `Browser microphone` / `Browser default output`，
  **不假装**是真实硬件型号。真枚举做不了：`enumerateDevices()` 是异步 + 要权限，
  而 Octave 侧是同步的。
- **⚠️ 语义上最容易写错的一条**（照抄官方 `audiodevinfo.cc` 才没写错）：
  `audiodevinfo(io)` 返回的是**设备个数**，不是结构体数组；
  而 `audiodevinfo(io, id)` 返回的是**设备名字符串**（不是结构体）。
  第三参数官方**只认** `"DriverVersion"`。
- 声明式支持矩阵：8000…96000 / 8/16/24/32 bit / 1–2 声道之内回支持，
  之外的如实回 `-1` / `false`（报"支持"却放不出声比报"不支持"更糟）。

### 2. `doc` 的浏览器实现（`build/webdoc/doc.m`）

- **为什么需要**：官方 `scripts/help/doc.m` 末路是 `system()` 起 info 浏览器进程
  （`doc.m:91-105` 两次 `system`），本构建无 shell → 实测报
  `doc: unable to find the Octave info manual, Octave installation is incomplete`。
  **那句错还误导**：不是安装不完整，是这条路在浏览器里走不通。
- **做法**：只为"取文本并显示"负责 —— 文本走**官方路径** `help()`，
  不自己渲染 texinfo（T1 的教训：别把"宿主组件不可用"当成"要重新实现组件"）。
  显示落点是正常输出通道。

### 3. 输出落点（**计划外，但它是 2 的前提**）

- **实测发现**：8761 的页面**什么都不显示**。`disp(42)` 之后
  `document.body.innerText` 仍是空串、`#output`（上游骨架里那个 `<pre>`）**从来没人
  往里写**、也没有 `Module.print` 覆写 —— 所有输出只进浏览器控制台。
  验收套件读的就是 console，所以这个问题一直没被测试暴露。
- **做法**：`bridge/index.html` 里给 `Module.print`/`printErr` 各加一句
  **额外**写 DOM（仍然照常 `console.log`/`console.warn` —— 只写 DOM 会把 26 套全打掉）。
- 这条让 `help`/`doc`/`disp` 的输出**真的显示在页面上**，
  于是"`doc sin` 把文档显示到页面"这条验收才有意义。

### 4. 顺手修掉的**误导性告警**

`index.html` 的启动装载清单里挂着 `installed_packages.m`，但**清单里没有这个资产**
→ 每次开页都打一句 `pkg 支持装载失败（pkg list/load 将不可用）`，而 `pkg` 其实是好的
（`accept-pkg` 在 8761/8762 上都 16/16）。根因：那是 **7.2 车道**的东西
（fork 删了读库代码，当时要把官方文件放回去）；vanilla 11.3.0 不需要还原。
已从清单里摘掉并注明理由。

## 二、T7：audiorecorder（19 个 `__recorder_*` 纯 .m + getUserMedia 桥）

- **为什么需要**：`audiodevinfo.cc` 里那 19 个 `__recorder_*` 全被
  `#if defined (HAVE_PORTAUDIO)` 编掉了 → `audiorecorder(8000,8,1)` 直接报
  `'__recorder_audiorecorder__' undefined`。**不移植 PortAudio**（外部审核 B1 的明确建议）。
- **结构**（与播放侧刻意对称）：句柄 = `struct("Id", id)`，真状态在全局表
  `__pra__.items{id}`；动作追加到 `/tmp/pra_queue.txt`，页面
  `bridge/webaudiorec.js` 落实，进度/错误写 `/tmp/pra_<id>.txt`，
  PCM 写 `/tmp/pra_<id>.f64`（交织 double）。
- **为什么用 MediaRecorder**（不是 ScriptProcessorNode / AudioWorklet）：
  前者的采集/编码**不走主线程**；AudioWorklet 想无锁攒样本要 SharedArrayBuffer，
  而本构建**刻意不要求 COI**（闸门③），拿不到 SAB。
  代价（如实）：只有 stop 后解码完才知道真实样本数，录音中的 frames 是按时间估算的。
- 权限三态分开报：`denied` / `insecure` / `error`，各自一句能照着做的错误，
  **绝不假装麦克风永远存在**。

## 三、坑（都实测过，别重踩）

### 坑 1 ★ `pause()` **会完全阻塞**浏览器事件循环 —— 我在这里得出过一个**错**结论

- 第一版测量只数"定时器总共跑了多少次"，把 eval **前后**的 tick 也算进去了，
  于是得出"`pause(1)` 期间 JS 定时器跑了约 5 次 → 会让出主线程"，并据此写下
  "recordblocking 不需要 Asyncify"。
- **精确测法**：记录每个 tick 的**时刻**，只数落在 eval 区间 `(t_start, t_end)` 内的。
  结果（`test/browser` 之外的探针，见本节末尾的复现命令）：

  | 表达式 | 区间内 tick | 理论上限 |
  |---|---|---|
  | `pause(1)` | **0** | 20 |
  | `pause(2)` | **0** | 40 |
  | `for k=1:10, pause(0.1), endfor` | **0** | 20 |

- **结论**：`pause()` 期间事件循环**完全停摆**（阻塞式睡眠）。推论有三条：
  1. **`recordblocking` 需要 Asyncify** —— 它的语义是"等页面跑完"，
     而 Octave 一阻塞页面就停。**本构建如实报错**（`__recorder_recordblocking__.m`），
     并在错误里给出替代用法。
  2. **`uigetfile` 同病**（要等一个**异步**的文件选择框）—— 计划里记的"需 G2 先验"是对的。
  3. 反过来解释了 `input()` 为什么能用：`window.prompt` 是**同步**的浏览器 API。
- **写验收时的直接后果**：**等待必须发生在 JS 侧**。测试里用
  `page.evaluate(() => new Promise(r => setTimeout(r, ms)))` 等页面把录音跑完，
  **不能**用 Octave 的 `pause`。这也正是真人用 REPL 的节奏：
  命令返回 → 页面自由 → 下一条命令读数据。

### 坑 2 ★ `__recorder_getaudiodata__` 的朝向是 **声道 × 帧**，且空数据也得有那一行

读 `@audiorecorder/getaudiodata.m` 的收尾才定出来的：

```matlab
if (get (recorder, "NumberOfChannels") == 2)
  data = data.';        # 立体声：原样转置
else
  data = data(1,:).';   # 单声道：取第 1 行
endif
```

⇒ 必须交回 **声道×帧**；单声道还必须**至少有 1 行**，否则 `data(1,:)` 直接
`out of bound 0`（第一版返回 `zeros(0,nch)`，单声道路径一读就报错）。
空数据要返回 **nch×0**。

### 坑 3 授权是异步的：`stop` 可能先到

`getUserMedia` 尚未 resolve 时来的 `stop` 若被丢弃，随后 resolve 就会**开始无限录音**
（`record(r2); stop(r2)` 那条路径实测踩到）。修法：rec 上记 `stopRequested`，
resolve 后若已请求停止则录一瞬就收；空 blob 直接记 `done/0 帧`，不送进解码器
（否则得到一句难懂的"解码失败"）。

### 坑 4 Chromium 的**假麦克风是双声道**，不是单声道

写"假设备只有一路所以会被复制补齐"是想当然 —— 实测 `actualChans = 2`，两声道内容
本来就不同。验收因此改成断言"两声道都有信号 + 有限"，不断言它们相等。
"复制补齐"只在源声道数**少于**请求数时发生。

## 四、顺手补的可复现性缺口：资产元数据不在 git 里

`assets/meta.json`（承载 `deps` / `note` / **`aliases`**——那个让多函数 `.oct`
能被按函数名找到的符号链接声明）**只存在于磁盘站点**，仓库里没有。
后果：只拿仓库**重建不出来**站点（`aliases` 一丢，`__web_zip__` 等 6 个函数就挂不上）。

- 已把站点那份纳入仓库：**`build/assets-meta.json`**（新增文件同步了 `.gitignore` 白名单）。
- 顺带补了一个缺失的工具：**`build/assets.py sync-js <站点> [名字…]`**。
  为什么不能用现成的 `gen-manifest`：它**整份重算**，会把 11.3.0 站点里
  `file` 类资产的 11.3.0 专属 mount 路径算错（见 `build/recover.sh` 的注释）。
  `sync-js` 只动 `assets/{m,pkg}/*.js` 那几条：缺的补上、摘要变了就更新，其余原样保留。

## 五、验收

- `test/browser/accept-t6-audio-doc.mjs` **33/33**（含"DOM 里真的出现文档正文"这条硬断言）
- `test/browser/accept-t7-recorder.mjs` **40/40**（用 Chromium 假麦克风，确定性）
- 8762 staging 全量：**652 PASS / 0 FAIL**（含上面两套）

## 六、复现命令

```sh
# 1) 打包并同步资产（站点 S 指向 site 或 site113）
python3 build/assets.py bundle-m webaudio    build/webaudio    /usr/src/octave/m/webaudio    $S/assets/m/webaudio.js
python3 build/assets.py bundle-m webdoc      build/webdoc      /usr/src/octave/m/webdoc      $S/assets/m/webdoc.js
python3 build/assets.py bundle-m webaudiorec build/webaudiorec /usr/src/octave/m/webaudiorec $S/assets/m/webaudiorec.js
cp build/assets-meta.json $S/assets/meta.json
python3 build/assets.py sync-js $S webaudio webdoc webaudiorec
cp bridge/index.html bridge/webaudiorec.js $S/

# 2) 验收
/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-t6-audio-doc.mjs http://127.0.0.1:8761/
/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-t7-recorder.mjs  http://127.0.0.1:8761/
```

**测 `pause` 是否让出主线程的正确写法**（要测别的宿主行为时照这个来）：
记录每个 tick 的 `performance.now()`，再与 eval 的起止时刻（同一时钟）比较，
**只数落在区间内的**。只看总次数会把 eval 前后的 tick 算进来，结果完全错。
