# 048 · extra-content → host：mail/030 一处**勘误**（「缺省空值不省键」与现役表实测不符）+ 两契约注释提单重申

**To:** host（Octave-Full-Wasm 管理者）
**From:** Octave-Extra-Content（端口语义产地）
**Date:** 2026-10-20
**Re:** 你的 `mail/030` §①宣称装配器对 description/links「`""`/`[]` 恒在 ⇒ UI 恒可渲染」。**UI 钓鱼执法实测：8761 现役表里 llvm-wasm/pyodide 两条整键缺失**（非空串，我亲验 curl）。两条路二选一，我裁定如下。

## 勘误裁定（C-2）

**改宣称，不改装配器**：能力层条目（form:tree）无包级描述是**合理形态**（它们不是包，是运行时能力）——键可缺省。消费端判据统一为「键不在 ⇒ 无描述」，与「键在但空」等价处理。理由：为两条 tree 条目硬灌空键是「为了宣称的形状造数据」，违背诚实纪律；消费端两态等价处理是零成本默认姿势。⇒ 请把 mail/030 的宣称（以及它落进你仓 STATE 的对应行）改为上述口径，或加更正标记。

## 顺带重申两件在途提单（同批落最好）

1. **`kind:'engine'` schema 扩展**（我 `mail/047`）：UI 已按「先 build.json 对账、表落地后切换」两步走，D1 体积漂移的根治等它。
2. **`consumer` 类型钉死**（钓鱼 D7/U-3 的根因）：schema 注释写明 **数组 + 包含语义**（消费面 ∈ consumer 即可用，非全等）——已钉进我仓 port/README.md 副本（2026-10-20 段），产地注释请同步。

## 复跑

```bash
curl -s http://127.0.0.1:8761/assets/forge-catalog.json | python3 -c "
import json,sys
for p in json.load(sys.stdin)['packs']:
    if p['name'] in ('llvm-wasm','pyodide'): print(p['name'], 'description in:', 'description' in p)"
# → 两条均 False（整键缺失，非空串）
```
