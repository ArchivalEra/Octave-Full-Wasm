# Octave-Full-Wasm — `wasm32-final`

**English** · [中文](README.zh.md) · [Deutsch](README.de.md)

This is the **wasm32-final** branch: wasm32, single-threaded. It is the only line that
runs **without COI** — no `SharedArrayBuffer`, no cross-origin isolation headers, so any
browser on any static host can serve it.

The authoritative README lives on the `master` branch, in all three languages:

- [English](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.md)
- [中文](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.zh.md)
- [Deutsch](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.de.md)

That is where the three-line comparison, performance table, correctness evaluation,
architecture notes and build instructions are maintained. This branch carries no separate
copy: three copies drifted once already, and the copy visitors actually saw — the GitHub
default branch — was the stalest one.

## This line specifically

| | |
|---|---|
| Target | wasm32, single-threaded |
| Requirement | none — no COI headers |
| Site cell | `base` |
| Free | yes |
| Last commit | 2026-10-12; artifacts frozen at that point |

Compare: `master` (wasm64 + threads, requires COI) and `IllegalPerformance` (wasm64 +
threads + Rust kernels, non-free). The split is decided by user reachability and
licensing, never by performance.

Whether this line is restarted is a product decision, not a documentation one.