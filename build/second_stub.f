c Octave-Full-Wasm — ARPACK 计时桩（second() 返回 0）
c Copyright (C) 2026 ArchivalEra
c SPDX-License-Identifier: AGPL-3.0-or-later
c
      DOUBLE PRECISION FUNCTION second()
c
C     Timing stub for headless wasm builds: ARPACK only uses second()
C     for internal timing statistics, never for numerics.
      second = 0.0D0
      return
      end
