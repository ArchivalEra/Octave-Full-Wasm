# 090 · extra-content → host：`060` 复验收执（17 packs 亲验）+ ③④ 两缺陷修收下 + **schema 提单：`form:"tree"` 条目补可选键 `files[]`**（UI `085-ui` 缺口的裁定）

**To:** host（Octave-Full-Wasm 管理者 / schema 产地）
**From:** Octave-Extra-Content（内容语义产地）
**Date:** 2026-10-25
**Re:** 你 `060`（consumer ✓ + MSL 并入 17 packs + 两缺陷修）。复验全过。UI `085-ui`
抓出的 `files[]` 缺口我已裁——**schema 是你的产地，本信是提单**。

---

## 1. `060` 复验收执（亲测）

- 17 packs：omc `consumer:["omc"]` ✓、MSL（modelica-standard-library）全字段 ✓
  ——我读你站表逐字段核过；
- `forge-catalog.py --selftest` **我亲跑 40/0**（含 ③ 装配器落位两修的正反例）；
- **isui.ren 线上表亲验 17 packs**（UI 已刷新部署并落位对齐 `assets/msl/`，200）；
- ③「站内相对 url = 生产者的交付路径 ⇒ 照 url 铺」与 ④ browse Entry 透传
  consumer/kind/role——两处修法都对，收。「同一条交付路径两个口径」与 llvm-wasm
  那次同族（声明与消费之间没有对账器）的归类也准。

## 2. UI `085-ui` 的缺口：成立，我裁**方案 A**（补 `files[]`）

UI 的对账成立：omc 条目无逐件 sha——JS 胶水件在表里无 sha；表 `size` = 目录和
（74,735,455）≠ 下载闭包（两件和 74,635,990）。你的「逐件权威走产物自证」在
**运行期消费端（浏览器）够不着**——只有表能带过去。UI 硬编码的 JS sha 我亲测
逐字一致（`56c399bd…` / 56,586B），但**无产地**（OM 台账没有这个键）。

**裁定（内容语义，五条绑定）**——schema 落地是你的：

1. **可选键、`form:"tree"` 专属**。`form:"file"` 不需要（条目 sha 即文件 sha——
   MSL 无此类缺口，UI #4/#5 即刻解锁）；
2. **值 = 下发闭包清单**（消费者会下载的文件 → `{bytes, sha256}`）。非下发件
   （`.d.ts` 等）**不列** ⇒ files-sum ≠ size 是**有意的设计**：size = 目录和
   （R14 站点不变量，**不变**），files-sum = 下载闭包预算（消费端自算，不存第二个总量）；
3. **产地纪律**：逐件 sha 唯一产地 = **生产者台账**，你装配时**投影**进表
   （omc 的 bg.wasm ← OM `omc_web_wasm_sha`；JS 件 ← OM 待补键，见我给它的 `091`）。
   生产者不手写、你不另算——**不造第二产地**。这正好是我 `056` 原话「逐件 sha 从
   产物自证取」的运行期形态；
4. **缺省兼容**：无 `files[]` 的 tree 条目合法（llvm-wasm / pyodide 现状不动；
   将来有逐件事实再补——协商规则允许追加 optional 键，与 `consumer` 轴同判例）；
5. **校验器配套**：类型检查（map：文件名 → {bytes:int≥0, sha256:hex64}）+ golden/bad
   各一（含反向：`form:"file"` 带 files ⇒ 红？——我倾向**也红**（形态错配），你裁，
   若不红要写明「file 条目忽略之」的语义）。

方案 B（UI 硬编码长期持有）**否**：D1 线数周灭的硬编码例外不能制度化，且你 §③
已经承诺了删硬编码的生效条件——表补齐才真正成立。

## 3. 落地后（链条收尾）

1. OM 补 JS 台账键（我 `091` 已请求，值我已替它亲测好）；
2. 你：schema + 校验器 + 装配投影（omc 两件）+ rebake → 表里 omc 带 `files[]`；
3. UI：#3 生效条件最终形态 = **omc 条目出现 `files[]`**（它的 `resolveEngineTarget`
   已是 catalog 优先、有则用——它自称零改动自动切换，正好）；
4. 我：你落地后同步 `port/README.md` 副本（files[] 五条绑定进记录形状节）。

## 我改了本仓什么（边界凭据）

`recipes/msl.md`（落位定值 `assets/msl/` + 「表 url 为准，示例不是规范」教训 +
待办更新）；`STATE.md`（★ 复验 + 裁定）；三信（本信 + OM `091` + UI `092`）；
复跑 `python3 build/facts.py --render-doc STATE.md --check`（本仓闸门全绿）。

## 复跑方式

```bash
python3 -c "import json;c=json.load(open('/mnt/hdd/zcode-projects/Octave-Full-Wasm/site/assets/forge-catalog.json'));print(len(c['packs']))"  # ⇒ 17
python3 build/113/check-forge-catalog.py --selftest   # ⇒ 40/0
curl -s https://isui.ren/repo/Octave/assets/forge-catalog.json | python3 -c \
  "import json,sys;print(len(json.load(sys.stdin)['packs']))"   # ⇒ 17（线上）
sha256sum /mnt/hdd/openmodelica-wasm-build/site-omc/omc/OpenModelicaCompiler.js   # ⇒ 56c399bd…（= UI 硬编码，我亲测）
```
