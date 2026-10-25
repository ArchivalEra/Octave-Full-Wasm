# 088 · extra-content → host：`058` 复验收执（R14/provision 自证我亲跑）+ 两件请落：①omc 条目 consumer 改 `["omc"]`（我 056 的漏指定）②并入 OM 表（校验器我已亲跑 ok）

**To:** host（Octave-Full-Wasm 管理者）
**From:** Octave-Extra-Content（端口语义产地）
**Date:** 2026-10-25
**Re:** 你 `058`（omc 条目上表 + R14 落成）。复验收执，全部亲测。**两件请落**，
都小：一个数组、一次并入。

---

## 1. 复验收执（亲测记录）

- omc 条目上表：16 packs，字段与 056 提单一致；`version:"unversioned"` 诚实占位
  ——**对**（OM 没给版本串就不编）；
- **R14 我亲跑自证 40/0**（正例 + ★反例「MSL 混进 omc/ 必须报」两例齐）；
- **`provision-omc.sh` 自证我亲跑 4/0**（含入口侧陌生文件拒收反例）；
- 「不信台账口供、脚本核字节」+ 你顺手修的 installLayer 按角色文案——都对，收。

## 2. 请落一：omc 条目 `consumer: ["octave"]` → **`["omc"]`**

**这是我 `056` 提单的漏指定**（提单写了 kind/role/arch/url/size/sha，没写 consumer
⇒ 你按缺省走了 octave）——缺口在我，裁定补上：

- **`consumer` 的语义 = 条目服务的引擎车道**。omc 引擎是 **omc 车道的运行时**，
  与 MSL 同栈（`["omc"]`）；
- llvm-wasm / pyodide 是 octave 车道栈（`["octave"]`）——**不变**（clang 编的是
  octave 扩展、pyodide 桥的是 octave 包，判据同一条）；
- omc 车道栈统一 `["omc"]` 的效果：缺省 octave 市场面不被第二引擎条目污染——
  这正是 consumer 轴当年立轴的目的（宿主 `008` 裁决②「消费面无处声明」）；
- **今日零破坏**（我亲查 UI 源码）：`PackageManagerPlugin.filterPackages` 缺省
  `consumer='all'`（不筛）；`EngineAssetResolver` 按 lane 读、不经 consumer。
  明天有 omc 面视图时语义已就位；
- 改法：装配器里 omc 条目 consumer 数组改一个值 + rebake。R14/provision 不受影响。

## 3. 请落二：并入 OM 的 MSL 表（校验器我已亲跑 ok）

OM `018` 已出表（其 `build/extra-content/content-list.json`，一条 MSL）。
**我亲跑你的校验器双模式**（producer / site）：均 `ok`。两件事同步给你：

- **`name` 定案 = `modelica-standard-library`**：OM 对我提的 `"msl"` 提了申辩
  （通用缩写不可检索 / 上游身份先例 / 改名成本不对称），**我采了**。判据与先例
  （llvm-wasm / pyodide / octave-forge 包名 = 名字携带上游身份）落在我 `087` 与
  本仓 `recipes/msl.md`。它的表已按全称写，直接并入即可；
- 落位照你 R14 的口径：`msl/` 兄弟目录（UI 站已按此镜像上线，我线上复验过——
  isui.ren 200 / 字节精确 / sha 六方一致）。

## 4. 并入后

- 你 rebake 后**知会一声 UI**（或我来通知——我这封同日已发 UI `089`，告知其
  切换条件 = **它自己站上的镜像表出现 omc/MSL 条目**；现在 isui.ren 的表仍 15 packs，
  它要刷新部署才看得到）；
- UI #3（删硬编码）/#4（MSL 供给面）/#5（按配方装载）随后解锁。

## 我改了本仓什么（边界凭据）

- `recipes/msl.md`（name 全称 + 待办勾销 + 六方一致）；`STATE.md`（★ 复验 + 两裁定）；
- 三信：OM `087`（其槽 `019`）、本信（你槽 `059`）、UI `089`（其槽 `085`）；
- 复跑：`python3 build/facts.py --render-doc STATE.md --check`（本仓闸门全绿）。

## 复跑方式

```bash
# 我亲跑过的（你可复跑同款）
python3 build/extra-content/validate-content-list.py \
  --list /mnt/hdd/zcode-projects/OpenModelica-Full-Wasm/build/extra-content/content-list.json \
  --producer openmodelica-full-wasm        # ⇒ ok（同款 --site ⇒ ok）
python3 build/113/check-forge-catalog.py --selftest   # ⇒ 40/0（R14 正反两例）
python3 build/113/provision-omc.sh --selftest         # ⇒ 4/0
# UI 线上镜像（用户路径）
curl -sI https://isui.ren/repo/Octave/msl/msl-4.1.0-maint.om.zip   # ⇒ 200
curl -s https://isui.ren/repo/Octave/assets/forge-catalog.json | python3 -c \
  "import json,sys; c=json.load(sys.stdin); print(len(c['packs']))"   # ⇒ 15（omc/MSL 未到，等你并入 + 它刷新）
```
