# 17: memory64 全量重编 —— 让"我们的对象也是 memory64"

**What to build:** 一条 **farm + Octave 树 + `.oct` 车道**的全量重编，产出第一份
**本项目的 memory64 产物**（先不要求它通过 Q2/Q3，只要求它**链得过**）。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** 不存在 —— 本工单第一交付物就是造它：`build/113/probe-wasm64-link.sh threads`
（现在**可复现地失败**在"wasm32 object file can't be linked in wasm64 mode"；
rc=0 且产物里量得到 i64 指令 ⇒ 重编成功，可以进 Q2；rc≠0 ⇒ 报出**下一面**墙是什么）

**Type:** task

## 第一面墙（已实测两遍，别重撞）

```
wasm-ld: error: /src/work/octave-11.3.0/libinterp/.libs/liboctinterp.a(liboctinterp_la-octave.o):
              wasm32 object file can't be linked in wasm64 mode
```

⇒ `-sMEMORY64=1` 是 **[compile+link]** ⇒ 对象必须同旗标重编。

## 形状（与 B6 的车道重建同构，**照那条路的成功做法走**）

1. **影子换旗标**：`lane-shim.sh` 现在注的是 `-pthread`；memory64 这一批注
   `-sMEMORY64=1`（可能两个都要）。它存在的原因就是"给没有地方传编译旗标的地方注旗标"。
2. **重建依赖**到新 prefix（**别覆盖现役的** `/usr/local-threads` / `/src/deps-threads`）。
3. **重建 Octave 树**到新 prefix（`configure` + `make`，数小时）。
4. **重链** + `relink.sh` 的出厂核对（`verdict=ok` 才可部署）。
5. `.oct` 车道**也要重编**（它是 side module，指针宽度必须与主模块一致）。

## 判据

- **第一层（本单的最低目标）**：`probe-wasm64-link.sh` `rc=0`，且产物里量得到 i64 指令
  （`llvm-objdump -d <wasm> | grep -c i64`）——**别只看 rc**。
- **第二层（进 Q2 的入场券）**：`verdict=ok`（身份证核对通过）。
- ⚠️ **两遍必须同 sha**（可复现性）：B6 那批刚证明过这条能被守住
  （`bce7e4cc…` 逐字节复现）—— 本批也要。

## 硬坑（照抄即可，别自己踩）

- **不许覆盖现役 farm**（`/usr/local`、`/src/deps`、`/usr/local-threads`、`/src/deps-threads`）——
  新 prefix，两套并存。现役 8761/8768 的红线是"不许退化"。
- 一次只动一个轴：本批**不要**同时做 E2 多线程或 B5。
- 长任务用后台 + 完成通知（**禁止 `sleep`**）；**跑验收时别并行干重活**。
- 容器里的构建脚本是另一份拷贝 ⇒ 改完必须 `docker cp` 并比两侧 sha。
- 需求书 `build/113/PLAN-wasm64.md` §1 有"第一次真链"的完整实测与命令。

## Answer（2026-09-28，由主会话独立复核）

**重编成功，且主会话已逐项独立复核**：
- `/src/websrc/w64-out/octave.wasm`（29,944,672 B）`verdict=ok`，身份证 **`declared.wasm64=true` /
  `measured.wasm64=true`**（write-build-manifest 现在解析 WebAssembly limits flags bit 2）；
- `llvm-readobj -h` ⇒ **`Arch: wasm64`**（对照：threads 产物 = wasm32）；
- `llvm-objdump -d | grep -c i64` = **4,189,800**（与工单交付数字一致）；
- **44/44 `.oct`** 全部 `Arch: wasm64`（`/src/libwork/octs-w64` 17 个 + `octs-w64-pkg` 27 个；
  ⚠️ 必须用 `/emsdk/upstream/bin/llvm-readobj` —— 容器 PATH 里**没有**这个命令，第一次测出 0 个是工具路径错）。
- 全部闸门绿：gates-selftest 26/26、check-build-manifest 16/16、relink 7/7、基线 8/8。

**遗留（如实记）**：`build-libs.sh` 的 glpk 在 memory64 下静默失败的**根因未查**（判别已确认与 memory64 有关，
但为什么没查）；判别实验把 wasm32 glpk 建进了 `/src/deps-w64/glpk/` ⇒ **该 farm 目录当前混编**，接手先清。
