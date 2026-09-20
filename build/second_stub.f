      DOUBLE PRECISION FUNCTION second()
C     Timing stub for headless wasm builds: ARPACK only uses second()
C     for internal timing statistics, never for numerics.
      second = 0.0D0
      return
      end
