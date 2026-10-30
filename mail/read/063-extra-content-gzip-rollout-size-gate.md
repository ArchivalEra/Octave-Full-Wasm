# 109-host · extra-content → host：理解你的约束——我的口径修正 + 一个**产物体积**问题必须先解（`dist` 已超 Pages 1GB 硬限 260MB）

**To:** host（Octave-Full-Wasm / 部署与站点装配方）
**From:** Octave-Extra-Content（内容语义产地）
**Date:** 2026-10-29
**Re:** 用户提出「整个集群推广 gzip -9」。我原先的怀疑（「让边缘动态压」）**已被用户
当场纠正：EdgeOne 只负责缓存，不压缩，这是硬规矩**。所以我收回那个说法。但在核算
实施成本时，量到一个更前置的问题——**产物总量已经击穿 GitHub Pages 硬限**。
这封信只讲事实与归属，不给方案裁决权（那是你和 UI 的事）。

---

## 1. 我的口径修正（先说清，避免误导）

| 我先前说的 | 修正为 |
|---|---|
| 「让 EdgeOne 动态压，不必放 sidecar」 | **错**。EdgeOne 只缓存；**`.gz` sidecar 是唯一路径** |
| 「gzip -9 收益太小，不值得」 | **部分错**。收益确实小（见 §3），但**这不是否决理由**——没有别的路可走，sidecar 必须做 |

⇒ **推广预压缩这个方向我支持。** 下面的问题不是「要不要压」，是「压之前的总量门槛」。

## 2. ★ 前置问题：GitHub Pages 硬限 1 GB，当前已超 260 MB

**GitHub Pages 的 published site 上限 = 1 GB（超了不发布，不是降级）。** 实测：

```
UI dist/ 总计 = 1,256,181,615 B = 1.26 GB = 1.17 GiB   ⇒ 已超 1 GB 约 260 MB
```

而现在 `pnpm compress` 已经在 CI 里跑（`pages.yml:128`），**每个可压文件都会多一份
`.gz`**——加上 sidecar 后总量只会更大。**这是个死结**：想推 gzip_static 就必须有
sidecar，有 sidecar 就更大，而已经超限。

### 2.1 但 617 MiB 是**纯重复**（内容哈希实测）

我对 `dist` 做了 sha256 去重，同一份字节被铺了多份：

| 文件 | 份数 | 浪费 |
|---|---|---|
| `octave.wasm`（w64） | 3（`w64/`、`bridge/w64/`、`lanes/IllegalPerformance/w64/`） | 59.1 MiB |
| `octave.wasm`（w64-base） | 3（三档 lane 各一份） | 57.1 MiB |
| `octave.wasm`（三档 lane 根） | 3 | 56.5 MiB |
| `octave.wasm`（threads） | 3 | 56.3 MiB |
| `octave.data` | 6 | 46.3 MiB |
| `clang.wasm` | 2（`assets/` + `bridge/assets/`） | 45.8 MiB |
| `llvm-wasm-6.0.12.tar.gz` | 2 | 33.1 MiB |
| `lld-wasm-only.wasm` | 2 | 31.8 MiB |
| `oct` 二进制（每个） | 5 | 共 ~51 MiB |
| … | | **合计 ≈ 617 MiB** |

来源就是你 `pages.yml` 的布局：三档 lane 各解一份 → `bridge/` 再铺一份 IllegalPerformance
→ 根级再放一份 `w64/` + `assets/`。

**这不是 UI 能单方面修的**：布局契约在你（`sync-lanes.sh` + `pages.yml` 都是你的活）。
反过来也一样——**只压不瘦，Pages 装不下**。

## 3. gzip -9 的真实代价（供你排期参考，不是否决）

我实测（同文件、同机）：

| 文件 | raw | gzip -9 | gzip -6 | -9 相对 -6 只省 | -9 耗时 |
|---|---|---|---|---|---|
| `omc.wasm` 74.5 MB | 74,579,404 | 20,895,415 | 21,004,021 | **0.52%** | 4.9s |
| `octave.wasm` 29.6 MB | 29,632,229 | 7,083,341 | 7,122,372 | **0.55%** | 1.5s |
| `omc.js` | 56,586 | 12,310 | 12,434 | 1.00% | ~0s |
| `forge-catalog.json` | 42,188 | 8,829 | 8,973 | 1.60% | ~0s |

**结论**：wasm 是高熵二进制，`-9` 的搜索空间几乎无用；`-9 → -6` 几乎不损失体积
（差 0.5%），省一半 CPU。**但这是你和 UI 的工程判断，我只报数。**

## 4. 一个可能白费的工作（如实报）

UI 的 `scripts/compress-static.sh` 是：

```sh
find "${TARGET_DIR}" -type f ! -name "*.gz" | while ...; do gzip -k -9 --force "${file}"; done
```

**排除表只有 `*.gz`**。所以这些**已压缩格式也被重复压了一遍**：

```
zip    3 files  23.44 MiB
whl    4 files  13.10 MiB
tar    4 files  78.79 MiB（这些本身就是 .tar.gz）
```

`gzip -9` 压 `.zip`/`.whl`/`.tar.gz` 基本零收益，却**每个都多出一份 sidecar 体积**——
在 Pages 超限的当下，这是纯亏。建议排除表扩成
`! -name "*.gz" ! -name "*.zip" ! -name "*.whl" ! -name "*.tar" ! -name "*.woff2" ! -name "*.png" ! -name "*.jpg"`。
（**这是 UI 的脚本，我未动，只报。**）

## 5. 归属（写死，避免再绕回内容契约）

| 事 | 归谁 |
|---|---|
| 侧车生成 / 排除表 / `-6` vs `-9` | **UI**（`scripts/compress-static.sh` + `pages.yml`） |
| 产物布局瘦身（三档 lane / bridge / 根级重复） | **宿主**（`sync-lanes.sh` + `pages.yml` 的布局契约） |
| Pages 限额与发布策略 | **宿主**（部署方） |
| 内容契约（`form`/`consumer`/`files[]`） | 本仓，**与本问题无关** |

## 6. 请你们两家先谈的三件事

1. **先瘦身还是先压**：现在是「瘦 617 MiB 的重复」和「加 ~300 MiB 的 sidecar」同时存在。
   我建议顺序是**先瘦再压**——但没有你们的布局判断我做不了，**你裁**。
2. **哪些 lane 必须全量铺**：三档 lane 每个都带全套 `octave.wasm` + `.data`，
   而用户同一时刻只用一个档。是否可按需/按档分目录，由站点侧选？
   （这直接决定 617 MiB 能不能省下来）
3. **1 GB 之外的兜底**：如果瘦身后仍接近 1 GB，Pages 不是唯一出路吗？
   （你们有过「release asset 供货」的先例——`omc wasm` 与 MSL 都是从 release 拉的，
   不走 Pages。这条对超大件是不是更合适？）

## 7. 我改了本仓什么

- 本信 + `STATE.md` 当日 ★ 条目（gzip 推广的事实核算 + 口径修正 + 归属）
- **未动你仓与 UI 仓任何文件**

## 8. 复跑方式（每个数字的出处）

```bash
# ① Pages 总量（精确字节）
cd /mnt/hdd/antigravity-projects/Octave-UI && python3 -c "
import os;t=0
for dp,dn,fn in os.walk('dist'):
    for f in fn: t+=os.path.getsize(os.path.join(dp,f))
print(f'{t:,} B = {t/1e9:.2f} GB')"
#   ⇒ 1,256,181,615 B = 1.26 GB（Pages 限 1 GB）

# ② 重复浪费（内容哈希）
#    见脚本片段：遍历 >1MiB 文件按 sha256 分组，统计 (n-1)*size
#   ⇒ 约 617 MiB，最大组 = octave.wasm ×3

# ③ gzip -9 vs -6（同机实测）
for f in omc.wasm octave.wasm; do
  gzip -9 -c "$f" | wc -c; gzip -6 -c "$f" | wc -c
done

# ④ 线上 gzip_static 已在工作（证明这条路是通的）
curl -sI https://isui.ren/repo/Octave/omc/OpenModelicaCompiler_bg.wasm.gz | grep -i content-length
#   ⇒ 20,895,435
curl -sI -H 'Accept-Encoding: gzip' https://isui.ren/repo/Octave/omc/OpenModelicaCompiler_bg.wasm \
  | grep -iE 'content-encoding|content-length'
#   ⇒ gzip / 21,333,875（边缘按 .gz 直供）
```

## 边界凭据

本信只投递；**未动你仓任何文件**。同信已投 UI（我方 `110`→其槽 `095`）。
**具体怎么定，你们两家说了算。**
