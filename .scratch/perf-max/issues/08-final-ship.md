**Type:** task
**Status:** resolved（2026-10-02，已发运）
**Blocked by:** 07

## Question

**终局发运**：把 07 决定的形态经受管辖入口 promote 到 8761（**promote 前人工确认**），
随后整套收尾：boot 自检、四档 SHA 三层、probe-lane、全量 `PROBES=1`、parity `--strict`、
make-dist 包内逐档核 sha、新数字落 FACTS 台账（`--accept-changes` 逐条）。
铁律：**8761 在 promote 之前一动不动**。

## Answer

（2026-10-02 用户令"发运"执行完毕。**8761 现役 w64 档 = `-O3 + 8GB` 合体版**，sha `3b0d5e2ff124e41f…`。）

**流程（全部走受管辖入口）**：
1. **候选** = `w64-ob-o3-out`（-O3 线程版 OpenBLAS + `MAXIMUM_MEMORY=8GB`，`maximum:131072n` 已验）
   —— -O3 与 8GB 无需二选一，同一次 relink 产出。
2. **8854 全量先验**（= "8768 先验"的等价闸门）：74 套 / 1351 PASS / 0 FAIL **全绿**，
   引擎矩阵（browser-floor 8/0 + engine-parity 22/0，Chromium 154 + Firefox）含在内。
3. **台账先行**（promote 守卫的口径）：4 条 `--accept-changes` 逐条
   （`w64_wasm_sha`→3b0d5e2f、`w64_v128` 6295→6602、`w64_wasm_bytes` +66KB、`env_vars` 29→30），
   dry-run 守卫全过（base/threads 逐字节不变 + 台账对齐）。
4. **promote 8761** → 开机 **1.2 s** → **SHA 三层**（磁盘/HTTP 逐字节 == 3b0d5e2f；
   页面身份证 ③a **4/0**）→ 四格选档 **33/0**。
5. **8761 全量 r6**：74 套 / 1351 PASS / 0 FAIL **全绿**（现役身上）。
6. **台账再改口 2 条**（现役复测）：`mem_live_ceiling_gib` 1.49→**7.45**、
   `w64_big_heap` no→**yes**（堆探针在 8761 上重跑，源文件 `w64-logs/heap-ceiling.log`）。
7. 收尾：`site/` 同步（只 `w64/` 三件）→ dist 四档 sha 逐档 SAME → parity `--strict` 三处一致
   （siteWebGL 的 w64 已同步）→ DEPLOY/README 的 w64 行订正（8GB / 7.45 GiB / -O3）。

**边界与备注**：
- 备份与回滚：旧 2GB 产物存 `w64-artifacts-2g-backup-20261002/`；promote 脚本自带回滚预案（已打印）。
- base/threads/w64-base 三档 sha 逐字节未动（`wasm_sha`/`threads_wasm_sha`/`w64_base_wasm_sha` 不变）。
- Chromium 125（无 memory64）走 threads 档、不受本批影响 —— 未重跑该格（它不实例化 w64）。
- 发运令只覆盖 w64 形态；票 07 已随"单王"决策关闭，本票随之可结。
