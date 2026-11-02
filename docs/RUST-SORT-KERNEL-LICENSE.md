# The Rust sort kernel is AGPL, not "non-free"

> This file exists because a released `manifest.json` once cited
> `LicenseRef-nonfree-rust-sort-kernel` for the `wasm64ip` product, and the URL behind that
> claim had to point somewhere real. **The claim itself was wrong, and it has been withdrawn.**

## What actually happened

The label came from `HISTORY.md` §5.x, where the user's own words describe the
`IllegalPerformance` line as *"non-free because we used a Rust patch — this is the line that
leaves the open-source community"*. That is a statement about **upstream not accepting the
patch** — a maintenance/community relationship — not about licensing.

I read it as a licensing fact and wrote it into a public release. That was a category error,
and the correction is recorded here rather than quietly overwritten.

## The facts, checked rather than remembered

| Question | Evidence |
|---|---|
| Whose code is the Rust kernel? | `build/113/rust/src/lib.rs` — this repository's own source, `#![no_std]` |
| Any third-party crates? | `build/113/rust/Cargo.lock` lists exactly one package: `rs_sort` itself |
| What does it link against? | only `malloc`/`realloc`/`free`/`posix_memalign`/`abort` from the host libc |
| Where is the seam? | `upstream/octave/liboctave/array/Array-base.cc`, our own fork commit `f4bf15b`, and the symbol is declared **`__attribute__((weak))`** |
| What is the upstream licence? | GPL-3.0 (Octave), which AGPL-3.0-or-later is compatible with |

So there is no non-free component anywhere in these artifacts. Every product — `wasm32`,
`wasm64std`, and `wasm64ip` — ships under **AGPL-3.0-or-later**, which is the licence of this
repository.

## Why the three products are still separate

The separation itself is real and stays: `wasm32` and `wasm64std` do not link
`librustsort.a`, `wasm64ip` does. That is a **build distinction with a real behavioural
difference** (the Rust kernel is measurably faster on some sorts), not a licensing barrier.
A client picks by architecture and behaviour; nothing here restricts redistribution.

## The rule this cost

A word that describes *maintenance posture* must never be reused as a *licence term*.
`HISTORY.md` now carries the original sentence unchanged — it is history and it is accurate
about what was said — but anything that reads it for licensing must come through this file
first.
