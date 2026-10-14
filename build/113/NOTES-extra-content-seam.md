# 统一「额外内容」后端接口 —— 三仓接缝设计（2026-10-14）

> **用户点令**："是时候进行一个大一统，就由你来定目前三个仓库（Octave-Full-Wasm / LLVM-Wasm /
> 货架仓）怎么出一个大伙都能接受的「额外内容」后端接口"。
>
> **性质**：设计（decision），不是实现。结论旁注明**复跑方式**；推断逐条标"推断"。
> **方法**：按 codebase-design 的 design-it-twice 走 —— 派**四个**子代理各按一条互斥约束
> 独立出方案（极简 / 最大灵活 / 常见调用者优先 / 端口-适配器），本文件是**比较与判决**。
> **词汇**：`额外内容`＝统摄概念（`CONTEXT.md`）；**module / interface / depth / seam / adapter /
> leverage / locality** 按 codebase-design 的用法；"商店/市场"只是 UI 形态。

---

## §0 判决（一句话）

**缝在「记录」上，不在「方法」上** —— 三个仓库真正共享的是那行 JSON；宿主的方法名是它内部的事。
具体 = **极简方案的骨架**（一种记录 + 能力层折进同一张依赖图）+ **常见调用者方案的返回值**
（Verdict 四态值）+ **端口方案**（schema/校验器产地与生产者自证）+ **只从最大灵活方案拿一条**
协商规则（未知轴默认 fail-closed）。

---

## §1 这个设计挣到的位置：三条实测现状缺陷

设计不是凭空的 —— 它修的是**量出来的**三处（复跑命令见 §5）：

| # | 缺陷（实测） | 本设计怎么修 |
|---|---|---|
| 1 | **`kind` 与 `kinds` 同名两义** —— manifest 的 `kind` 是**投送形态**（`oct` 16 / `octdir` 6 / `file` 3 / `js` 25），catalog 的 `kinds` 是**内容构成**（`m`+`src` 7 / `m` 3）⇒ 一个名字两个轴 | 改名收编：投送形态 = **`form`**（供给期**从字节派生**，不是作者手写）；内容构成 = **`content`** |
| 2 | **宿主 import 生产者内部** —— `build/forge-catalog.py:37` 直接 `sys.path.insert(0, SHELF)` | 端口取代：宿主只吃**校验过的表**，不 import 生产者代码 |
| 3 | **版本解析三份副本** —— `vtuple`/`octave_ok`/`pick_version` 在 `forge-catalog.py`、`forge-fetch.py`、货架 `forge-shelf.py` 各一份 | 校验器成为**唯一产地**；三处改为调它（或删除） |

> 这三条是"没有对账器的必须一致 = 迟早不一致"（AGENTS.md C4）的现成实例。

---

## §2 统一记录（生产者发布的表）

**一种记录类型**（不叫 pack、不叫 asset —— 它就是"一条额外内容"）：

```json
{ "schema": 2, "producer": { "id": "octave-forge-shelf", "pin": "submodule:a6ab1a8c…" },
  "octave": "11.3.0",
  "entries": [ {
    "name": "optim",                    // 必填，producer 内唯一
    "version": "1.6.3",                 // 必填（诊断用；也进临时文件名）
    "url": "assets/forge/optim-1.6.3.tar.gz",   // 必填，**站内相对**（同源是硬约束）
    "sha256": "59fb…",                  // 必填，fail-closed
    "size": 422679,                     // 可选（进度条；不作为第二断言）
    "form": "pkg",                      // 派生：pkg | tree | oct | octdir | file | js
    "content": ["m", "src"],            // 派生：m | src | oct（= 今天的 kinds）
    "deps": ["statistics", "struct"],   // 可选，默认 []
    "exclude_from_pkg_list": false      // 见 §3 末（替代今天按 url 前缀猜）
  } ] }
```

**三条派生规则**（收的是"生产者手写字段会漂"的教训）：

1. `form` **由供给方从字节派生**（`shelf/tools/forge-shelf.py` 的 `detect_kinds` 本来就这么干）；
   手写只允许出现在探不出来的形态上，且闸门 R4 那类对账必须跟着长。
2. `url` **必为站内相对路径** —— 适配器**拒绝绝对 URL**（新断言；今天 `withBase()` 会照拼）。
   上游 URL 只作为记账字段（`upstream_url`），不参与运行期。
3. **依赖闭包、安装顺序、能力层引用全部由图推出** —— 生产者不声明顺序，只声明边。

**能力层（Pyodide / clang 工具链）= `form:"tree"` 的普通条目**，进**同一张 `deps` 图**。
⇒ 客户端只有**一种**遍历；UI 想显示"这条还要拉 27 MB"= 闭包 ∩ `form:"tree"` 求字节和，
**从数据推出**，不需要新字段（反向断言天然成立：没有 tree 条目 ⇒ 不会有这类提示）。

**协商规则（唯一从"最大灵活"方案拿的一条）**：
> 新轴**只能追加**，且必须声明 `"optional": true` 才允许旧消费者**忽略**；
> 不声明 ⇒ 旧消费者必须**撤下该条目**（fail-closed）并落账。
> **"忽略"是给可选轴的礼遇，不是默认** —— 防的是"未知字段被静默当默认值"这个本仓吃过的形状。

---

## §3 宿主返回 = Verdict 四态值

```js
await OctaveAssets.install('optim')             // 默认路径：一行，无必填参数
await OctaveAssets.install('symbolic', { planOnly: true })   // UI 预演：零下载，出闭包+字节
// → { state: 'ok' | 'failed' | 'not-found' | 'cannot-know',   ← ★ 四态是值，不是布尔
//     name, installed: [闭包], layers: [{name, state, bytes}],
//     cause,   // 闭集，见下
//     why,     // 人话（.m 侧报错就用它）
//     acceleration: 'built' | 'not-built',   // kinds 含 src 而没编 ⇒ 必须说出来，不许当"装好了"
//     bytes: { fetched }, elapsed_ms }
```

**为什么四态必须是值**（本仓最贵的一条实测教训）：T4 期间把"货架没读过"当成"没有这个包"
⇒ 用户打错个包名就把调用方炸掉（`SuspendError` 穿透）。`build/pkgfix/__webpackage_source__.m`
的头注与 12 条 `%!test` 已经把四态在 `.m` 侧钉死；**它必须同样钉在 JS 返回值上**，
否则同一条教训会从另一个入口回来。

`cause` 闭集：`sha-mismatch | artifact-missing | http-error | unpack-failed | engine-not-ready |
arch-mismatch | layer-missing | catalog-unreadable | not-in-any-list`。

**逃生口全在 options，不另开方法**（"maximum flexibility"最诱人的地方就是另开 API；
本设计拒绝）：`onProgress` / `planOnly` / `version`（显式钉） / `compile:true`（编加速件）。
低层原语 `load(names)` **一字不动**（26 套房 + boot 链在用）；旧名 `catalog()`/`install()`
保留为适配器，`accept-catalog-load`(27/0)、`accept-forge-ondemand`(15/0) 的断言语义不变。

---

## §4 端口产地与生产者自证

**产地 = 宿主仓 `build/extra-content/`**（★新目录，须同步 `!路径` 进白名单 `.gitignore`）：

```
content-list.schema.json     唯一权威形状
validate-content-list.py     纯 stdlib 校验器：--list F --producer ID / --selftest（rc 0/1/2）
golden/{shelf,toolchain,runtime}.json      三个真样件
bad/*.json                   反向夹具（sha 缺失 / 未知 form / 未知 optional 轴 / 空表）
```

**为什么产地在消费者**：端口 = 应用核心的**接受面**；依赖方向已是如此
（货架仓自述"给 Octave-Full-Wasm 的按需拉取用"；LLVM-wasm 的 `DELIVERY.md` §4 标题即
"宿主侧必须承诺的"）。**不新开第四仓**：为一个 <200 行的校验器再建一仓，成本大于收益。

**生产者必做**（三条，都不要求宿主在场）：
1. `emit(octave_version)` —— 离线纯函数出表（货架 `--emit` 已如此）；
2. 过校验器自证（`validate --list <自己出的表>`）；
3. `pin` 自述（货架 = submodule commit；工具链 = release tag + bundle sha256）。

**消费侧操作**：`catalog()` 只读（零包字节，实测断言）→ 闭包 → 逐件 fetch+sha256 →
引擎内建 gunzip/untar → `pkg install` 布局 → addpath → `__pkgfix_sync_db__` → 落账。
顺序不许变（现役实现逐条已如此）。

---

## §5 增量路径（每步独立验收，失败即回退）

```
① 端口落地产地 + 校验器（**零客户端改动**）
   build/extra-content/{schema,validator,golden,bad} + selftest 三档齐备
   ⇒ 判据：货架的 --emit 输出过校验（rc=0）；bad/ 五个夹具逐一 rc=1；空表 rc=1
   ⇒ 顺手吃掉缺陷 3（三份 pick_version 副本收成一份）
② 表加新字段（**向后兼容**）：form/content 派生 + optional 规则；旧字段 kinds 保留为兼容视图
   ⇒ 判据：现役 forge-catalog.json 加字段后，老 loader 照装 12 包（accept-forge-ondemand 15/0 不变）
   ⇒ 闸门 check-forge-catalog 涨一条 R5（form 与实际字节一致 —— R4 的推广）
③ Verdict 四态 + planOnly（宿主返回值）
   ⇒ 判据：新套件 accept-install-verdict：四态各一例 + 反向（"读不到"不许报 not-found）
     + planOnly 零下载（网络审计断言）
④ 能力层接进同一张图：Pyodide 供给（provision-pyodide.sh + upstream-lock 一条）
   + 一条 form:"tree" 条目 ⇒ `install('symbolic')` 走通（依赖 §1 的 Pyodide 实测，5/0 已备）
   ⇒ 判据：端到端 syms x; diff(sin(x),x) ⇒ cos(x)（与宿主 Octave 逐字比对）+ 无 COI 站同过
⑤ 工具链条目（clang 进同一张表）—— 与 client-compile 设计（NOTES-client-compile-design §9）合流
```

---

## §6 明确不做 / 诚实的薄处

- **不做**：卸载（今天接口不存在，"撤销/多版本"字段只会是装饰——最大灵活方案自己承认这点）、
  包签名、多版本共存、跨域生产者（COEP 实测拦）、**不把部件插件折进来**（构建期另轴）。
- **薄处 1**：`form` 派生需要供给方判定 ⇒ 新容器形态要动 `forge-catalog.py`，端口不消灭这类知识。
- **薄处 2**：**工具链那条一致性没闭合** —— 货架是 submodule（宿主闸门可达），LLVM-wasm **不是**
  ⇒ 它的表只能在自己 CI 里过校验器（测试期依赖一份 pin 住的宿主 checkout）。
  **如实记**：这是本设计唯一没有对账器的一条。
- **薄处 3**：默认**不编**加速件（`content` 含 `src` 的占 7/10）⇒ Verdict 必须带
  `acceleration:'not-built'`，否则"装好了"是半真话。

---

## §7 复跑命令（本文件每个数字的出处）

```bash
# 缺陷 1：kind 与 kinds 是两个轴（计数）
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm
python3 -c "
import json,collections
m=json.load(open('site/assets/manifest.json')); c=json.load(open('site/assets/forge-catalog.json'))
print('manifest kind :', dict(collections.Counter(a.get('kind') for a in m['assets'])))
print('catalog kinds :', dict(collections.Counter(tuple(p.get('kinds',[])) for p in c['packs'])))"

# 缺陷 2：宿主 import 生产者内部
grep -n "sys.path.insert" build/forge-catalog.py        # ⇒ :37/:38 指向 SHELF

# 缺陷 3：版本解析三份副本
grep -n "def vtuple\|def octave_ok\|def pick_version" \
  build/forge-catalog.py build/forge-fetch.py \
  /mnt/hdd/zcode-projects/Octave-Forge-Shelf/tools/forge-shelf.py   # ⇒ 三处各一份

# 四方案原文：本轮 design-it-twice 的四个子代理输出（记录在会话里；本文件是判决）
```
