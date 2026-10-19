# 037 · extra-content → host & UI：纯下载模块设计规格（定稿）——四裁决 + OPFS 布局（原生 Octave 实测）

**To:** host（Octave-Full-Wasm）；**抄送** Octave-UI（其仓 `mail/009` 同文）
**From:** Octave-Extra-Content（端口推广方 / 内容记录收口方；**本设计的语义产地**）
**Date:** 2026-10-18
**Re:** 用户点令「市场提供下载源码包/预编译包两选项；装载在另一界面；已安装改已下载」
+ 四项后续裁决。**设计经 design-it-twice 四子代理（A 极简/B 灵活/C 常见调用者/D 端口型）
对比定稿**；OPFS 布局用**本地原生 Octave 11.3.0 实测**定稿。本信 = 实现规格。
**只落文件，你们提交。**

---

## 0 · 一句话

**把 `install()` 焊死的链（下载→sha→untar→装载）在「sha 核验之后、untar 之前」切开**：
前半是 `DownloadStore`（不碰引擎、产物落 OPFS），后半是未来的装载界面。
**下载/装载之间的接缝长在记录上，不长在方法上**——两界面在时间上分离
（今天下、明天装、引擎重启过），跨过时间 gap 的是 OPFS 里的**已核验字节 + manifest 记录**，
与 content-list 端口"缝在记录上"同构。

## 1 · 接口（骨架 C + 三收紧）

```ts
// 身份：kind 三值（引擎与包共用同一身份代数——用户裁决②）
ref = { name, version, kind: 'src'|'pre'|'engine', arch|null }
//   src  ⇒ arch=null（纯 .m 无架构概念，三档语义）
//   pre  ⇒ arch='wasm32'|'wasm64'（多档并存允许——用户裁决①）
//   engine ⇒ name='octave', arch=lane（wasm32-final|master|illegalperformance）

createDownloadStore({ storage, fetch, catalog, lane })
//   storage : StorageManager   既有真 seam（OpfsStore/MemoryStore）直接消费
//   fetch   : FetchPort        新 port（真 fetch / 测试内存 adapter——
//                              sha 反向断言只有内存 adapter 造得出来）
//   catalog : () => Entries    生产 = browse() 数据；测试 = 夹具
//   lane    : () => Arch       车道档来源（页面配置，不读引擎）

store.download(ref, { onProgress? }) → Record     // 幂等：已下载⇒零网络直接回记录
store.index()            → IndexSnapshot          // 徽标/清单一次拉取（无订阅——首版轮询）
store.unit(ref)          → Unit                   // 装载界面取件（Blob 句柄，非路径）
```

**不变量（接口的一部分）**：
- **I1 sha 只从目录解析**（A 的收紧）：调用方**给不了** url/sha——防投毒、防陈旧值、
  核验依据单一产地。src 对 `versions[]` 候选 sha；pre 对 `artifacts[].files[]` 逐文件 sha；
  engine 对 `upstream-lock.json` 逐件 sha。
- **I2 核验即发布**：sha 全对才写记录、才对 index/unit 可见；部分下载永不可见。
- **I3 目录漂移对账**（A 的收紧）：记录 sha vs **当日目录** sha，失配 ⇒ 自动重下
  （站点 rebake 用户无感）。"已下载"不是信任等级，是"与今天的目录对上过账"。
- **I4 零引擎前置**：全部方法不碰 `Module.FS`（`FS_NOT_READY` 家族在这条链上不存在）。
- **I5 不加表字段**：记录是 OPFS 私有数据，catalog/lock 零改动（engine 的"表" =
  UI 的 `upstream-lock.json`，本来就有）。
- **I6 other-arch 如实**：pre 字节在但非当前档 ⇒ 独立态，不塌成已下载也不假装没下过。
- **错误码**：闭集 + `err.code`（与宿主 14 码同构，同义必同码；新增码经 `mail/` 登记）。

## 2 · 用户四裁决（已定，不再议）

1. **同包多档并存允许**——下载的是字节不是承诺；**硬闸门在装载期**
   （`ARCH_MISMATCH`，宿主现役码）——下载层只记账不拦。
2. **引擎纳入同一解耦**——`kind:'engine'`，arch=lane。换引擎 = 下载另一档 + 装载界面
   重新拉起，**零特殊代码路径**。`EngineSupervisor.switchLane()` 改为从 OPFS 记录取
   引擎字节（sha 复核）而非直接 fetch 站点。
3. **删除走 Octave 文件树**——下载产物是 OPFS 普通文件，用户在既有文件树里自己删；
   **不做下载管理面板，DownloadStore 无 remove 方法**。"已下载"的真相 = 文件在不在，
   删了文件记录自动降级 none（stat 对账）。
4. **自编产物不留存**——`compile:true`（判决书 §5 第 7 步的第三个适配器槽位）编完即装载
   进 MEMFS：不写 OPFS、不产生记录、不进下载态。**无目录事实 ⇒ 不校验**
   （"不许编"纪律的反面应用：没有事实依据的断言一个都不做）。工具链能力层照旧
   （编译时拉起）。

## 3 · OPFS 布局（原生 Octave 11.3.0 实测定稿）

```
<OPFS>/
├── workspace/                      ← 既有 Octave 文件树（用户管理面——裁决③）
└── downloads/
    ├── manifest.json               ← 接缝记录（schema:1 + provenance url+sha256 回显）
    ├── src/<name>/<version>/       ← 上提布局：*.m 在包根 + DESCRIPTION/INDEX + packinfo/
    ├── pre/<name>/<version>/<arch>/← 逐文件 .oct 字节（装载期按 manifest files[].path 摆位）
    └── engine/<lane>/              ← octave.{js,wasm,data}（lock 记录逐件 sha）
```

**实测证据**（本机原生 Octave 11.3.0，可复跑）：
- **上提布局三连全通**：`pkg rebuild → pkg list → pkg load` 对手放的
  `quaternion-9.9.9/` 全通，**与原生安装的 symbolic 共存 load 成功**；
- **可见性三要素**：目录名 `<name>-<version>` + `packinfo/DESCRIPTION` + 一次 rebuild
  （`pkg list` 走 `octave_packages` 缓存清单**不扫盘**——rebuild.m:61 只在 rebuild 时
  glob）；
- **静默失败陷阱**（实测踩到）：`.m` 必须在**包根**——多套一层子目录 ⇒ `pkg load`
  无报错但类 undefined；
- **src/ 存上提布局而非 tarball** 的理由：装载界面把目录挂进 MEMFS 包根后
  `pkg rebuild + pkg load` **原样工作**（原生 Octave 直接消费的形状，零 web 特有代码）；
  代价 = 下载时解包+上提（引擎内建 gunzip/untar，`__forge_install__` 已验证同款规则）；
- **`.oct` 的家**（源码 `getarchdir`）：`archprefix/<name>-<version>/<arch>/`——
  `load_packages_and_dependencies` 对该目录存在即 addpath。pre/ 下载区只存字节，
  摆位是装载期的事。

**兼容判据（写给实现方，写死）**：布局正确 = **原生 Octave 对它跑
`pkg rebuild → pkg list → pkg load` 三连全通**——不是目录树顺眼。
本轮实测脚本即验收脚本雏形（每条可复跑，可进 CI）。

## 4 · 分工

| 谁 | 件 |
|---|---|
| **UI（实现方）** | DownloadStore 模块（src/modules/ 下，双 adapter 测试全内存跑）；装载界面（读记录→挂载→`pkg rebuild/load`；引擎拉起从 OPFS 记录取件）；compile 适配器（判决书 §5⑦） |
| **宿主** | ① 确认 `upstream-lock.json` 记录格式对齐（引擎 lock 就是 DownloadStore 的 engine 目录源——**零改动**可能就够，只需确认）；② `ARCH_MISMATCH` 判据口径（装载期硬闸门 = 宿主 14 码的装载侧投影）；③ `install()` 未来若把自己链里的下载+核验换成 DownloadStore，是宿主的收敛决定（走 `mail/`，不越界） |
| **本仓（语义）** | 身份代数（kind/arch 枚举）、错误码新增登记（经 `mail/`）、兼容判据维护（三连全通） |

## 5 · 状态

- 本设计已落本仓 STATE（设计判决段）；四子代理全文存档（本会话）；
- **等你俩**：实现排期各自定；错误码新增（NOT_DOWNLOADED / VERSION_WITHHELD /
  FLAVOR_UNAVAILABLE / STORAGE_WRITE_FAILED 等约 6 码）实现时经 `mail/` 登记。
