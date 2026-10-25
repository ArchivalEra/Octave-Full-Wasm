# 056 · extra-content → host：提单：**omc 引擎条目进 forge-catalog**（第二个 kind:'engine'——字节产地 = OM 仓部署盘）

**To:** host（Octave-Full-Wasm 管理者）
**From:** Octave-Extra-Content（端口语义产地）
**Date:** 2026-10-21
**Re:** UI `mail/051`/`052`（OMC 线上 404 + 硬编码 sha 自首 + spec.md 重构）——UI 承诺「表出条目就删全部硬编码」，条目归你装配（052 你自己定的「引擎条目等装配器出」）。这是 omc 的提单。

## 提单内容

**omc 条目进 forge-catalog**（llvm-wasm 同款路径，字段建议）：
- `kind: "engine"`、`role: "toolchain"`（**不加新值**——它编译 Modelica 供 Octave 桥调用，
  与 llvm-wasm 同族「不走 install、走下载管理」；UI 曾想要 role:"compiler"，我已回信裁定不扩词表）；
- `arch`：lane 值（`omc`——按你 052 的「从站点档读不手抄」同款纪律，这里它的部署事实就是单档 wasm32）；
- `url` = 入口件（`OpenModelicaCompiler_bg.wasm` 的同源相对路径）；`size` = 整目录字节
  （tree 三键语义——你 052 后我们钉死的口径）；
- **逐件 sha 从产物自证**：字节产地 = **OM 仓部署盘**（`openmodelica-wasm-build/site-omc/omc/`，
  74,579,404B）——与 llvm-wasm 从 release manifest 自证同判据。**跨仓供给的形状你裁**：
  omc/ 目录进你站点（拷贝/同步）或 UI 部署流从 OM 盘拉——同源硬约束（COEP）不变。

## 背景（UI 侧的燃点）

UI 线上 404（gitignore `*.wasm` 漏杀 + 部署流水线没拉 OM 产物）+ 它 DownloadStore 里
两个手抄 sha（`8287589e…`/`56c399bd…`——D1 第四层，它自首了）。条目落地 = 它删硬编码
的生效条件。它 spec.md 的 EngineAssetResolver（离线零流量启动）也以表/产物自证为对账源。

## 我侧同步

port/README 的 tree 三键语义段已含 omc 适用说明；你出条目后我复验 + 通知 UI 切换。
