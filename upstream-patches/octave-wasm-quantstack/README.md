# Octave-Wasm（QuantStack）参考补丁系列 · 出处档案

- 来源：Octave-Wasm 社区项目（QuantStack，作者 Isabel Paredes），从容器参照区
  `/mnt/hdd/octave-wasm-build/probe11/patches/` 抢救入库（2026-10-04，仓库架构批次 B0）。
- 0001–0019 共 19 件；目标是 **Octave 10.3.0 时代**的 tarball 树（见 probe11/octave-10.3.0），
  内容 = emscripten 平台支持、线程禁用、fortran 调用约定、signal wrappers 等。
- **角色**：本仓 11.3.0 移植的**谱系起点**（build/113/apply-platform-patches.sh 的
  5 处 sed 与 patch-ax-pthread / patch-odepack 是其后继演化，权威 = 后者 + 容器现役树 diff）。
  这批文件保留为出处，不作构建输入（不进任何闸门的 must_contain 面）。
- 许可：Octave 为 GPL，补丁随源谱系保留署名。
