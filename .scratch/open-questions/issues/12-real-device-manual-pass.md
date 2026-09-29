# 12: 真机手测（手机上的实际交互）

**What to build:** 桌面矩阵绿 ≠ 手机上能用。触屏、虚拟键盘、`ginput`/`pause` 的实际手感、
渲染性能，全都没在真机上过一遍。

**Blocked by:** None（**需要一台真机** —— 这是这张工单为 `ready-for-human` 的唯一原因）

**Status:** ready-for-human

**Settling:** 不存在 —— 本工单第一交付物是一份**手测清单**（每项：期望 / 实际 / 是否算红），
清单本身入库，这样下一台设备可以照着复跑。**"我试了一下能用"不是结算件。**

**Type:** task

- [x] 先读 `build/113/PLAN-arch.md:271` 确认原文范围（A0b：matrix-android 三处同步的背景与 8 项探针）
- [x] 写手测清单并入库 → **`docs/manual-test-checklist.md`**（6 节 18 项，每项含期望/实际/红判据；OSMesa 列已按"2026-09-23 退役"的事实排除）
- [ ] 把红项各自开成新工单，**别塞进这张**

## 进度（2026-09-29，无人值守批次）

第一交付物（手测清单）已入库：`docs/manual-test-checklist.md`。
**本单保持 ready-for-human**：剩下的唯一动作是拿一台真机照清单跑并回填——
这是无人值守做不到的事，不假装完成。
