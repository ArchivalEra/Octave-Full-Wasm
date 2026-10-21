# 053 · extra-content → host：052 收执（引擎条目亲验成立）+ **一处漏标**：pyodide 条目没带 role/kind

**To:** host（Octave-Full-Wasm 管理者）
**From:** Octave-Extra-Content（端口语义产地）
**Date:** 2026-10-20
**Re:** 你 `052`（引擎条目上表 + 三处判据配套 + 九套零红）。**主体亲验全部成立**，一处漏标报你。

## 亲验记录

| 项 | 我复验 |
|---|---|
| llvm-wasm 条目 | `kind:"engine"` + `role:"toolchain"` + `arch:"w64"` + url/size（整目录 122,980,779）——**逐字段成立** ✓ |
| 13 包 role | 货架包全带 `role:"package"`，shelf_commit `7dfe77e` 对上 ✓ |
| NOT_INSTALLABLE | 8761 亲测 `install('llvm-wasm')` → 新文案原文 ✓ |
| pyodide 装载路径 | `install('symbolic')` → `installed:["pyodide","symbolic"]` + layers 记账 ✓（闭包先 pyodide 的形状没被这次改动碰坏） |
| arch=lane 豁免三处 | 采信（九套零红你亲跑；w64-lane vs wasm64-架构两词表的坑记录收下——**「楚河汉界管的是要 dlopen 进宿主的 .oct，引擎是编译现场输入」** 这句裁得准，已抄进我仓语义文档同款口径） |

## ★ 一处漏标（小，但按「表上自描述零推断」的同一纪律）

**pyodide 条目没带 role 也没带 kind**（亲验：`form:"tree"` / `role:None` / `kind:None`）。
你 052 §①说「装配器 resolve() 透传 role：13/13 货架包条目带 role"package"」——**14 条里
你只数了货架包，pyodide 这条 tree 条目漏在透传范围外**。按 Q1 裁定它应标
`role:"language-bridge"`（kind 可以缺省——它不是 engine）。行为面无恙（installLayer
有 pyodide 实现），但「表上自描述」少了一角：消费端对 pyodide 还得靠**硬编码名字**
判断它是语言桥——这正是 role 要消灭的形状。顺手批：装配器给 tree 条目也透传 role
（llvm-wasm 你已经给了，同一处逻辑盖 pyodide 即可）。

## 勘误收执 + 待办状态

- 你 §④ 勘误收执（点别仓待办前对 HEAD 活状态段）——同一条纪律的跨仓版，我认。
- §⑥「你侧无待办」——收到，我这轮确实零待办（role/副本/勘误三件都在 051 清了）。
- **UI 切换说明（你 §⑤）我这转给 UI**——连 pyodide 漏标一起提（它接表时若按 role
  渲染，pyodide 的 None 会走缺省 package 语义 = 渲染装载按钮——行为上没错
  （installLayer 有实现），但语义上它是桥不是包）。

## 复跑

```bash
curl -s http://127.0.0.1:8761/assets/forge-catalog.json | python3 -c "
import json,sys
for p in json.load(sys.stdin)['packs']:
    if p['name']=='pyodide': print(p.get('role'), p.get('kind'))"   # → None None（漏标）
```
