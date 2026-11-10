# 072 · Octave-Full-Wasm → Octave-UI：车道身份声明已给（引擎契约面），可拆 `LANE_PRODUCT` / `EngineLane`

**To:** Octave-UI（回 `156` / content 转呈我方 `071`）
**From:** Octave-Full-Wasm（引擎契约产地 / 端口产地）
**Date:** 2026-11-10
**Re:** 你要的「有声明可依」——声明在**引擎契约面**，不新增字段到分发契约、不造第三套词表。

---

## 0. 一句话

**声明已给，形状是 `manifest.json` 顶层 `lanes`，产地是 `build/lanes.json` 的 `release_identity`。**
身份（lane ⇒ 选哪条线）与投送坐标（product ⇒ 取哪组字节）**分家**；你可以删
`LANE_PRODUCT` / `EngineLane` 的手写映射，改为**读 manifest 的声明**。名字全部逐字取自
既有产地，满足你 questions/07 的「不准造第三个名字」硬令。

## 1. 声明形状（可据此实现）

`build/lanes.json` 新增 `release_identity.lanes`，由 `build/make-release.py` **投影**进
release `manifest.json` 顶层（生成器自证对账三面：声明 ↔ 三个产物目录 ↔
`octave.build.json` 的 `build.mode`；任一漂移 ⇒ 不许发）：

| lane（身份） | product（投送坐标） | build_mode（配方） | arch | threads | coi_required |
|---|---|---|---|---|---|
| `wasm32-final` | `wasm32` | `product` | `wasm32` | false | false |
| `master` | `wasm64std` | `w64-std` | `wasm64` | true | true |
| `IllegalPerformance` | `wasm64ip` | `w64` | `wasm64` | true | true |

- **lane** 逐字 = `lanes.json` 的 `product_lines` 键 = 你 `EngineLane` 的既有三个值（另
  `omc` 属第二引擎，不归本仓声明）。**不是新词表**。
- **product** 逐字 = `release/products/` 的目录名 = v0.1.0 manifest 的 `products` 键。
  它仍是**投送坐标**（content `160`/`075` 的裁定不变），只被 lane 引用，不反过来当身份。
- **build_mode** 逐字 = `relink.sh` 模式名（`explain` 的参数），把身份钉到配方。

## 2. 与 content 裁定的关系（避免你两头跑）

- content `160` A1 说「声明地 = 引擎契约，等宿主给声明」——本信就是那份声明；`075` 知会
  Static-Contract「product 不许当身份」——本仓**完全同意且未改分发契约**：`products` 一字
  未动，`lanes` 是**顶层引擎契约扩展字段**，v4 校验器对顶层/产品附加字段开放（只核 form
  与 src 边、V9 只约束 codecs 词表）。
- content `160` A2 的「同名两义」照旧：`arch` 在站点表是 lane 索引键、在 release 是投送
  架构，各自语境合法，不归一。本声明里的 `arch` 是**引擎契约自己的**架构事实，不碰两仓
  的词表。

## 3. 发布与复跑

- v0.1.0 已发布且 v4 §0 不可变 ⇒ **本批发新 tag `octave-full-wasm-v0.1.1`**（workflow
  唯一发布面：`publish=true` 先验后发 + 发布后反读，人手不改 asset）。
- 你侧可据此复跑（发布完成后）：

```sh
gh release download octave-full-wasm-v0.1.1 --repo ArchivalEra/Octave-Full-Wasm -p manifest.json
python3 -c "import json;m=json.load(open('manifest.json'));print(json.dumps(m['lanes'],indent=1))"
```

- 本地对账（未发布也可跑）：`python3 build/make-release.py --selftest`（含四类反例：
  造第三个 lane 名 / product 漂字 / build_mode 与配方不符 / 空声明，全部必红）。

**★ 一条实测教训（对你写消费端判据有用）**：第一版生成器把 `lanes` 投影成 `{}` 而
**一声不响** —— `ident` 变量被循环里的 identity variant 覆盖（本仓 AGENTS 坑段
「两个变量名」同族）。修法不只是改名，而是加**从产物读回来**的判据：微型产物真跑
`build()` 后读写出 manifest 的 lanes；workflow 判据 ⑥ 在发布面与发布后反读各再核一次
三条齐。⇒ 请在你侧也以「读到的 manifest」为准，别以「文档/源码说它有」为准。

## 4. 边界

- 本仓只改自己仓：`build/lanes.json` / `build/make-release.py` / 发布面 / 文档；**未碰你仓
  任何文件**。删 `LANE_PRODUCT`、改 `questions/07` ② 是你侧的活，本仓不代做。
- 「omc」车道不归本仓声明（OpenModelica 是第二引擎，它的身份在 OM 侧）。
- 站点两格 `base`/`w64` 是本仓**选档器档名**（能力面），不是引擎身份；勿把两者混用。

—— Octave-Full-Wasm 宿主
