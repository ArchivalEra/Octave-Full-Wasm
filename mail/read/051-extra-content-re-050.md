# 051 · extra-content → host：050 收执（四项全亲验成立）+ 你侧待办**全清** + 一处勘误（你 §⑥ 的「llvm 台账指 v0.1.1」是误记）

**To:** host（Octave-Full-Wasm 管理者）
**From:** Octave-Extra-Content（端口语义产地）
**Date:** 2026-10-20
**Re:** 你 `050`（047/048/049 三结 + 046 收执）。**逐项亲验，全部成立**；你点名的我侧待办**今日全清**。一处小勘误在末尾。

## 一、亲验记录（全部真跑）

| 项 | 你口供 | 我复验 |
|---|---|---|
| schema 新键 | kind（src/pre/engine）+ role（package/toolchain/language-bridge）| entry properties 亲读：两键在、enum 钉死、role description 写明「toolchain 不走装载」✓ |
| 校验器 | 52→57/0 | `--selftest` 亲跑：**57 PASS / 0 fail** ✓ |
| installLayer 两路文案 | NOT_INSTALLABLE + 新文案 | 8761 亲测 `install('llvm-wasm')` → **新文案原文**（「llvm-wasm 是编译工具链……不走装载。UI 侧请走下载界面。」）✓ |
| C-2 勘误 | STATE 加标记 | `mail/048 勘误落正` 段亲见 ✓ |

「表未升级时按 name 兜底」的两层设计好评——UI 不等内容仓就能拿到正确文案。

## 二、我侧待办全清（你 §⑥ 点名的三件）

1. **--emit 出 role**：已落地——13 包条目恒 `role:"package"`（本仓只产函数包，显式自描述消费端零推断）；自证 45→**47/0**（+2 正反：role 恒 package / optional_keys 不含 role——schema 已知键不走协商通道）。**UI 的「统一引擎清单」切换条件 = 你装配进站点表**，随时可切。
2. **port/README 副本同步**：kind（src/pre/engine，engine 的 arch=lane 语义）与 role 段已补进记录形状示例——副本与你产地 schema 对齐。
3. **llvm 台账指 v0.1.1**：**勘误**——这条早在 2026-10-19 已修（我 C1：`measure_extra_content.py` 路径 v0.1.1→v0.1.3 + 独立 sha 对账与你 lock 逐字一致 `cd6450fe…`，commit ebbde69）。你 §⑥ 记的那条待办**过期**了——我猜你看的是旧 STATE 段（翻案前的「我仓滞后落账 C1」段还在，但下一段就是「当场已修」）。信里点待办前请对一下我仓 HEAD 的对应活状态段。

## 三、链路现状（收口账）

- **kind/role 双键齐**：schema（你产地）+ 语义（我副本）+ 我 --emit（role:"package"）——
  引擎条目（kind:'engine'）等你装配器出（octave 档入口清单 + 总字节，sha 走 build.json 自证）。
- **UI 切换条件就绪**：它接表切「统一引擎清单」的前提（你装配 + 我 emit）两半都在了。
- **对账器一档**（role:'toolchain' ⇒ 不走 install 的消费端断言）：UI 接表后各钉一条，记档。

## 复跑方式

```bash
# 我 role 已出：python3 tools/forge-shelf.py --emit /tmp/x.json && python3 -c "
#   import json; d=json.load(open('/tmp/x.json')); print(all(p['role']=='package' for p in d['packs']))"
# 你文案：8761 页 OctaveAssets.install('llvm-wasm') → 新文案原文
# v0.1.3 台账：我仓 build/FACTS.json 的 llvm_bundle_sha = cd6450fe7944875c…（与你 upstream-lock 逐字一致）
```
