# Octave-Full-Wasm

[English](README.md) · [中文](README.zh.md) · [Deutsch](README.de.md)

GNU Octave 11.3.0 compiled to WebAssembly, running entirely in the browser. Pure
client-side compute: no server ever executes your code.

This README is written for people who will **build, extend or debug** this repository.
It states what the thing is, which line to pick, how fast each line is, and where the
authoritative facts live. Per-batch history is in [`HISTORY.md`](HISTORY.md); live status
is [`STATE.md`](STATE.md).

All three language versions are kept in sync; a pre-push gate rejects a push that updates
only one of them.

---

## The three lines

One interpreter, three independently maintained product lines. The split is decided by
**user reachability and licensing — never by performance**.

| Branch | Target | Requirement | Free |
|---|---|---|---|
| **`wasm32-final`** | wasm32, single-threaded | none — **the only line that runs without COI** | yes |
| **`master`** | wasm64 + threads | COI headers + multithreading | yes |
| **`IllegalPerformance`** | wasm64 + threads + Rust kernels | COI headers | no — patches the toolchain away from upstream support |

Serving `master` without `crossOriginIsolated` silently drops the page to the wasm32 lane.
There is no error, just a different lane. A site displays exactly two cells: `base`
(wasm32) and `w64` (wasm64). Any other cell name is a dead lane and a gate rejects it.

## Performance

Wall time in seconds, lower is better. Native reference is `octave-cli` 11.3.0 on this
machine (median of 5 warm runs); wasm figures are medians of 3 interleaved runs.
Measured 2026-10-07.

Raw data: [`docs/charts/perf-data.json`](docs/charts/perf-data.json).
Narrative and log: `HISTORY.md` §5.96, `w64-logs/bigcompare-final.log`.

![Five-way performance comparison](docs/charts/perf-5way.svg)

| workload | native ref-BLAS | native OpenBLAS ×24 | wasm32-final | wasm64 | IllegalPerformance |
|---|---|---|---|---|---|
| dot 1e7 | 0.0082 | 0.0048 | 0.0080 | 0.0100 | 0.0110 |
| matmul 500 | 0.0257 | 0.0029 | 0.0220 | 0.0040 | 0.0050 |
| matmul 1000 | 0.1971 | 0.0089 | 0.1600 | 0.0230 | 0.0240 |
| lu 800 | 0.0415 | 0.0147 | 0.0340 | 0.0140 | 0.0150 |
| lu 1500 | 0.2598 | 0.0636 | 0.2180 | 0.0620 | 0.0720 |
| svd 400 | 0.1650 | 0.2243 | 0.1740 | 0.1550 | 0.1870 |
| sum 1e7 | 0.0086 | 0.0076 | 0.0080 | 0.0080 | 0.0090 |
| sort 2e6 | 0.2111 | 0.2020 | 0.2280 | 0.2400 | 0.1110 |
| loop 1e6 | 0.4934 | 0.5226 | 0.6220 | 0.5780 | 0.5890 |

Geometric mean against the native reference: wasm32-final 1.05×, wasm64 1.99×,
IllegalPerformance 1.96×.

![IllegalPerformance speedup versus each baseline](docs/charts/perf-speedup-IP.svg)

The wasm lines beat single-threaded native Octave on BLAS-heavy work because they ship an
OpenBLAS built with relaxed-SIMD FMA and run it multi-threaded. They do not beat a
hand-tuned 24-thread native OpenBLAS on `matmul` (0.0230 s against 0.0089 s).
Memory-bandwidth-bound workloads (`dot`, `sum`) land on the same figure on every line.

End-to-end Rust sort A/B (a different measurement, on the product artifact rather than the
kernel): `w64_rustsort_ab_asc_ms` 165 ms, `w64_rustsort_ab_asc_ratio` 0.506 ⇒ 2.0×.
Re-run: `bash build/113/sort-ab.sh`.

## Correctness

Results are compared against native Octave on identical inputs, bit for bit rather than
approximately.

| Area | Verdict |
|---|---|
| Elementary math (`libm`) | bit-identical to musl for `sin`, `exp`, `log`, `pow` |
| Sort (Rust kernel) | bit-identical over 22 domains including NaN and duplicate-heavy inputs |
| Arithmetic, `sum`, `lu`, `svd`, … | bit-identical |
| BLAS/LAPACK | same sources and flags; relaxed-SIMD FMA changes summation order, so this axis is compared against a documented tolerance envelope |

A `libm` replacement spike was rejected on measurement: geomean 0.964 per call
(`libm_spike_geomean`), against a 1.5× adoption threshold. Re-run:
`sh build/113/bench-libm-spike.sh 8`.

The Rust sort kernel sits behind two gates. A differential gate compares 22 input domains
bit for bit, and a mutation self-test injects deliberate errors into the kernel and
requires the differential gate to catch them (4/4 caught). A kernel is not adopted unless
both pass. Re-run: `bash test/fixtures/rustsort-spike/run-spike.sh`.

## Architecture

1. **The interpreter.** Upstream Octave forked at `upstream/octave` (branch `wasm/11.3.0`),
   compiled with Emscripten 6.0.12. Upstream releases land through merge → rebuild →
   lane SOP; `witness-upstream-pin.py` asserts the container tree matches the fork pin on
   every commit.

2. **The lanes.** The same wasm built per target (wasm32, wasm64+threads) and per component
   set (BLAS flavour, allocator, Rust kernels). Lane knowledge is data:
   [`build/lanes.json`](build/lanes.json) is the single source, and
   `check-lanes-single-source.py` reconciles it against four consumers — the page selector,
   the site generator, the purity gate and the plugin table.

3. **The asset layer.** `.oct` modules, `.m` bundles and data files are fetched on demand
   and mounted into Octave's in-memory filesystem with per-file sha256 verification.
   Packages come from the shelf (prebuilt tarballs) or are compiled in-browser by a bundled
   clang/lld toolchain. Note that `addpath` reads MEMFS, not the site's HTTP tree — anything
   that must be visible to Octave has to be written into MEMFS first.

4. **The fact system.** Every claim about the build is a ledger entry carrying its re-run
   command. [`build/FACTS.json`](build/FACTS.json) holds the numbers, `STATE.md` the live
   status, `HISTORY.md` the append-only record, and 64 gates (14 platform, 50
   repository-specific) check that documents, artifacts and ledger agree.

Swappable components are plugins with a contract rather than build flags: mode-table knob →
declared label in the artifact → artifact probe → two-way gate → ledger entry.

## Build and run

```sh
# serve a built site (COI headers are mandatory for the w64 lane)
python3 build/serve-coi.py --dir /mnt/hdd/octave-wasm-build/site --port 8761
```

A plain `python3 -m http.server` cannot send COI headers, and the page then silently serves
the wasm32 lane instead.

Building from scratch needs the `o113` container (Emscripten 6.0.12 plus the Octave fork)
and the recipes in [`build/CLIBS.md`](build/CLIBS.md). Relinking an existing tree goes
through one entry point — `bash build/113/relink.sh link product` — which owns every
environment variable for a mode; do not set them by hand. `bash build/113/relink.sh explain
product` prints the recipe.

Deployment is manual; there is no CI auto-deploy. See [`DEPLOY.md`](DEPLOY.md). Embedding
the interpreter in your own page: [`docs/embed-api.md`](docs/embed-api.md).

## Repository map

| Path | What |
|---|---|
| [`STATE.md`](STATE.md) | Live status — what is true right now |
| [`maintaince.md`](maintaince.md) | Direction and map |
| [`HISTORY.md`](HISTORY.md) | Append-only per-batch record |
| [`CONTEXT.md`](CONTEXT.md) | Glossary — one authoritative definition per term |
| [`AGENTS.md`](AGENTS.md) | Operating rules for agents working here |
| [`build/FACTS.json`](build/FACTS.json) | Measured-numbers ledger; each key carries its re-run command |
| [`build/lanes.json`](build/lanes.json) | Single source of lane knowledge |
| [`build/CLIBS.md`](build/CLIBS.md) | C library build recipes |
| `build/113/` | Build recipes, gates, lane scripts, engineering notes |
| `bridge/` | Browser-side glue: asset loader, lane selector, worker, page host |
| `test/browser/` | Browser acceptance suites |
| `zreflect/` | Fact system: gate registry, knob registry, ledger |
| `upstream/` | Octave fork (submodule) |
| `shelf/` | Package shelf (separate repo, submodule) |
| `mail/` | Cross-repo correspondence — this repository's inbox |

## Repository contents

<!-- AUTO:FILES -->
```
group                           files        bytes
site/                             222     195.6 MB
build/                            394       2.5 MB
test/                             117     802.1 KB
(root)                             11     438.2 KB
upstream-patches/                  20     435.1 KB
.scratch/                          72     285.0 KB
bridge/                            17     191.9 KB
.githooks/                         17     130.1 KB
vendor/                            21     123.5 KB
docs/                               8      50.0 KB
dist/                               2      23.8 KB
.zcode/                             1        791 B
upstream/                          18        720 B
(total)                           920     200.5 MB
```

Per-file listing: `git ls-files` — this block is a summary so the README stays readable.
Re-run: `python3 .githooks/update-readme.py --check`
<!-- /AUTO -->

## Hooks and gates

Gates live in `reflect-hooks/` and are wired through `core.hooksPath`. `pre-commit`
re-renders the machine blocks in this README and in `STATE.md`, then runs the fact-system
gates, the repository-specific gates (whitelist, consistency, falsifiability, readiness
anti-patterns, mail boundary) and both self-test benches. `pre-push` additionally requires
all three READMEs to be updated in the same push.

```sh
. reflect-hooks/Einfacht.env
python3 zreflect/registry.py --run commit              # gates declaring runs_at="commit"
sh gates-selftest.sh && sh build/gates-selftest.sh     # prove each gate can fail
```

Every gate carries `--selftest`. A gate that cannot be shown to fail is not a gate.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first — it is the operating contract, not a style guide.
Three rules are absolute: no server-side execution, no force-push or history rewriting,
and every new file must be added to the `.gitignore` whitelist or the pre-commit gate
rejects it.

## License

AGPL-3.0-or-later for the build glue, the browser host and the Octave fork's
modifications. Octave itself is GPL-3.0-or-later; BLAS/LAPACK, SuiteSparse, FFTW and
related libraries keep their own licenses. Some bundled components are GPL-2.0-only, which
is incompatible with AGPL-3.0, so this combination can only be distributed under
AGPL-3.0.

This program is free software: you can redistribute it and/or modify it under the terms of
the GNU Affero General Public License as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version. It is distributed in the
hope that it will be useful, but without any warranty; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

Per AGPL-3.0 §13, users interacting with it over a network are entitled to the
corresponding source: this repository is that source, and the build reproduces in the
`o113` container. Per-component licenses and copyrights:
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
