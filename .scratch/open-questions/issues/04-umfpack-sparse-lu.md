# 04: UMFPACK 稀疏 `lu` 的整页陷阱

**What to build:** 稀疏 `lu` 会打挂整页（不是报错，是整页）——找出触发条件与最小复现，
以及它与 7.2 相比是否是能力回归。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Settling:** 不存在 —— 本工单第一交付物：最小复现 + `SKIP=` 二分脚本，能稳定复现"整页挂"
且能在缩到最小后给出确定性的通过/失败。

**Type:** research

- [ ] 先读 `build/113/NOTES-umfpack.md:29-31,60-74`，确认悬案仍在
- [ ] 最小复现：从整页降到最小 `.m`，记录每步是否仍整页挂
- [ ] 判定是"从未支持"还是"7.2 之后回归"（两者结论不同，处置也不同）
- [ ] 结论回填 NOTES，工单置 `resolved`
