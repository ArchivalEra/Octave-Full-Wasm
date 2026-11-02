# NON-FREE component: the Rust sort kernel

> This file exists so that a licence declaration can point at something. `/tmp/zc-release`'s
> `manifest.json` marks the `wasm64ip` product with
> `AGPL-3.0-or-later AND LicenseRef-nonfree-rust-sort-kernel`, and `license.url` for those
> entries points here. **A licence URL that 404s is a hollow claim** — the contract's own
> §4.5 says passing V11 does not mean the licence is written correctly.

## What the non-free part is

The `wasm64ip` product links an extra archive, `librustsort.a`, built from a Rust
implementation of a stable float sort. It is enabled by the `RUST_SORT=1` knob in
`build/113/relink.sh`'s mode table:

| mode | `RUST_SORT` | licence boundary |
|---|---|---|
| `product` (wasm32) | `0` | free — never links the archive |
| `w64-std` (wasm64) | `0` | free — never links the archive |
| `w64` (wasm64) | `1` | links `librustsort.a` ⇒ this file applies |

The two free products are the ones this repository ships as its normal output; `w64` is
produced only for the non-free line. The separation lives in the **artifact**, not in a
branch: a free product simply does not contain the symbol.

## Why it is labelled `LicenseRef-…` and not an SPDX identifier

We do not have a verbatim licence text for this kernel that would map to a standard SPDX
identifier. Inventing one — or claiming plain `AGPL-3.0-or-later` for a product that links
it — would be a false statement, and the contract is explicit that "unknown" must not be
papered over with a confident-looking tag. `LicenseRef-nonfree-rust-sort-kernel` is the
SPDX mechanism for exactly this situation: it says "this is a distinct licensing term that
is not in the SPDX list", and it is deliberately not silently equal to the AGPL.

## How to obtain the free products instead

Both free products are in the same release as `wasm32` and `wasm64std` products. A client
that must stay free-only should select those two products and never the `wasm64ip` one.
`manifest.json`'s `products` map is the machine-readable form of that decision:
`wasm32` and `wasm64std` carry `"arch"` values and no `src` edge into this file.
