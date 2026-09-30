// Octave-Full-Wasm — **档清单的入库默认值**（工单 23，2026-09-30）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 这个文件是**默认/底线**版本：声明"只有基础档与线程档"（= 本仓历史上双档站点的形态）。
// 站点上那一份由 `build/gen-lanes.sh <站点目录>` 按**磁盘上真实存在的档**生成并覆盖它，
// 生成物头部有"不要手改"的告警。两份的关系：
//
//   · 仓库里这份 = 给"页面引用必须入库"这条闸门一个**存在且被跟踪**的对象
//     （`bridge/index.html` 与 `bridge/octave-worker.js` 都引用 `lanes.js`），
//     同时保证"从仓库装配一个站点"时页面不会 404；
//   · 站点上那份 = 真相（哪些档真的部署了），由生成器写。
//
// ⚠️ 为什么不能省掉它：`bridge/lane.js` 的能力驱动选档在**没有清单**时会退回
//    [base, threads]，但那是**兜底**（会打告警）—— 兜底不该是常态。
(function (g) { g.__octaveLanes = ["base", "threads"]; })(typeof window !== 'undefined' ? window : self);
