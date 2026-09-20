# 第三方声明（THIRD-PARTY NOTICES）

本仓对外分发的是**一个 wasm 二进制**（`octave.js` / `octave.wasm` / `octave.data`），
它静态链接了下列组件。整体作品按 **AGPL-3.0-or-later** 分发（见 `LICENSE`）；
下列各组件的原始许可与版权声明随附于下，且在各源文件头保留。

随包预装的第三方 `.m`（Octave Forge 统计、asciiplot 等）的来源与许可另有
`vendor/MANIFEST.md` 专门记录，此处不重复。

---

## 1. GNU Octave 7.2.0 — GPL-3.0-or-later

主解释器与全部核心 `.m`。上游 <https://octave.org>。
GPLv3 与 AGPLv3 兼容（AGPL 第 13 条即 GPLv3 第 13 条的网络版扩展），
合入后整体须按 AGPL 分发，这正是本仓选 AGPL 的原因。

## 2. rwl/octave-wasm（构建骨架）— BSD-3-Clause

wasm 构建脚本、`src/main.cc` 骨架与其 `third_party` 构建配方。
本仓在 `build/` 下重写/扩展了这些脚本，并在构建容器内重编了全部组件。

```
Copyright (C) 2025 Richard Lincoln
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above
   copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials provided
   with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived
   from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
FOR A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## 3. C 库长尾（静态进二进制）

| 组件 | 版本 | 许可 |
|---|---|---|
| qrupdate | 1.1.2 | GPL-3.0-or-later |
| ARPACK | arpack-ng 3.7.0 | BSD-3-Clause |
| FFTW | 3.3.10（双精度 + 单精度） | GPL-2.0-or-later |
| Qhull | 8.0.2（reentrant） | Qhull 许可（permissive，见其 COPYING.txt） |
| GLPK | 5.0 | GPL-3.0-or-later |
| libsndfile | 1.2.2 | LGPL-2.1-or-later |
| SuiteSparse | 5.4.0（AMD/COLAMD/CAMD/CCOLAMD/CHOLMOD/UMFPACK/CXSparse） | 各子包分别 BSD / LGPL / GPL |
| PCRE | 8.43 | BSD-3-Clause |
| zlib / libbz2 | Emscripten ports | zlib 许可 / BSD-like |
| RapidJSON | 1.1.0（header-only） | MIT |
| LAPACK / BLAS / f2c / libf2c2 | 见容器内 third_party | BSD-3-Clause 系（f2c 为 MIT 系） |

GPL-2.0-or-later 的 FFTW 与 LGPL-2.1-or-later 的 libsndfile 均可合入
GPLv3/AGPLv3 作品；LGPL 部分以静态链接方式合入，本仓即以 AGPL 形式提供
其可重链接的完整对应源码（见下）。

## 4. 渲染侧（不进二进制，另行托管）

- `stereobooster/gnuplot-wasm`（gnuplot 6.0.2，gnuplot 本体在 Debian main 中为 DFSG-free）
- `MatlabJS/plotlib.js`（MIT，仅参考其 API 组织方式）

详见 `vendor/MANIFEST.md` D 节。

---

## 对应源码的获取

AGPL-3.0 第 13 条与 LGPL 对静态链接的要求，都要求向使用者提供对应源码。
本仓即该源码：构建脚本在 `build/`，第三方源码与拉取方式见 `build/CLIBS.md`、
`vendor/MANIFEST.md` 与 `HANDOFF.md`，完整构建可在 `obuild` 容器内复现。
仓库地址：<https://github.com/ArchivalEra/Octave-Full-Wasm>

各第三方组件的完整许可原文随其源码分发，未在本仓逐字复制（体积原因）；
若有需要可按上表版本号从各上游取回。
