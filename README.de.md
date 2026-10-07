# Octave-Full-Wasm

[English](README.md) · [中文](README.zh.md) · [Deutsch](README.de.md)

GNU Octave 11.3.0 nach WebAssembly kompiliert — eine vollständige
Numerik-Umgebung (Interpreter, BLAS/LAPACK, Plotten, ~500 Pakete), die
**komplett im Browser läuft**: rein clientseitige Berechnung, **keine
serverseitige Ausführung**.

**Aktuelle Produktionslinie: `w64` (WebAssembly memory64 + Threads +
relaxed-FMA OpenBLAS + mimalloc + Rust-`sort`-Kernel)**, hinter derselben
Web-Oberfläche wie jede andere Spur betrieben. Alle numerischen Ergebnisse
sind IEEE 754 binary64 — nachfolgend explizit auditiert.

---

## Leistung (gemessen 2026-10-07, Median aus 5 nativen / 3 wasm-Läufen)

![Fünf-Wege-Leistungsvergleich](docs/charts/perf-5way.svg)

| Arbeitslast (s) | nativ ref-BLAS | nativ OpenBLAS ×24 | wasm32-final | wasm64-NEXT | **IllegalPerformance** |
|---|---|---|---|---|---|
| dot 1e7 | 0,0082 | **0,0048** | 0,0080 | 0,0100 | 0,0110 |
| matmul 500 | 0,0257 | **0,0029** | 0,0220 | 0,0040 | 0,0050 |
| matmul 1000 | 0,1971 | **0,0089** | 0,1600 | 0,0230 | 0,0240 |
| lu 800 | 0,0415 | **0,0147** | 0,0340 | 0,0140 | 0,0150 |
| lu 1500 | 0,2598 | **0,0636** | 0,2180 | 0,0620 | 0,0720 |
| svd 400 | 0,1650 | 0,2243 | 0,1740 | **0,1550** | 0,1870 |
| sum 1e7 | 0,0086 | **0,0076** | 0,0080 | 0,0080 | 0,0090 |
| **sort 2e6** | 0,2111 | 0,2020 | 0,2280 | 0,2400 | **0,1110** |
| loop 1e6 | **0,4934** | 0,5226 | 0,6220 | 0,5780 | 0,5890 |

![IllegalPerformance-Beschleunigung gegenüber jeder Basis](docs/charts/perf-speedup-IP.svg)

**IllegalPerformance als Vielfaches** (Basiszeit ÷ IP-Zeit; geometrisches Mittel
über alle 9):

- **1,96× gegenüber nativem Octave** (Standard-ref-BLAS; nur-BLAS-Achsen **3,16×**)
- **1,86× gegenüber wasm32-final** (die eingefrorene wasm32-Linie; matmul 1000
  allein **6,7×**)
- **0,99× gegenüber wasm64-NEXT** — überall Parität, außer dem definierenden
  Gewinn: **sort 2,16×**
- **0,80× gegenüber nativem OpenBLAS ×24** — die native Multithreading-Grenze
  liegt bei reinem BLAS noch 1,25× vorn, aber IllegalPerformance **gewinnt
  sort (1,82×) und svd (1,20×)**

## IEEE-754-Produktionsbewertung

Ein 24-Feld-Batterie (`test/fixtures/ieee754/battery.m`) lief auf **6
Konfigurationen** (4 wasm-Spuren + nativ ref-BLAS + nativ OpenBLAS ×24):

- **23/24 Felder überall bitidentisch**: round-half-to-even, ±0-Bitmuster,
  kanonisches NaN, Inf/Division, Subnormale, eps-Grenzen, gesetzter `rand`
  (MT19937 nativ↔wasm identisch), `sin`/`pow`/Division (musl vs glibc
  stichprobenartig bitidentisch).
- Der einzige Unterschied = **dgemm-Summenreihenfolge gegenüber einer
  schrittweisen Referenz** (max. 6,6 ulp) — **auch im nativen OpenBLAS
  vorhanden** (3522 von 10000 Elementen, 4,99e-16). Jede Addition/Multiplikation
  ist korrekt gerundet; nur die Reihenfolge weicht ab → IEEE-konform.
- `relaxed_madd` (81 Stellen, OpenBLAS-rsimd-Kernel): WebAssembly erlaubt
  fused *oder* unfused — **beide sind IEEE-754-konforme Ergebnisse**.
  Offenlegung: w64-BLAS-Ergebnisse können **zwischen Browser-Engines** im
  letzten Ulp variieren (gleiche Klasse wie natives OpenBLAS über
  CPU-Mikroarchitekturen hinweg). Elementare Mathematik ist unberührt
  (0 Abweichung).

**Urteil: wasm32-final und die IllegalPerformance-Linie sind für die
Produktion freigegeben.** Reproduktion: `test/fixtures/ieee754/battery.m`,
Protokolle in `w64-logs/ieee-*.log`.

## Was auf der IllegalPerformance-Linie gelandet ist

- **rust-sort** — ein Rust-Kernel (driftsort) für `sort`, als
  *Quellnaht* angebunden: schwaches Symbol + Linkzeit-Knauf (`RUST_SORT`);
  Entfernen = Neulinken ohne Bibliothek, null Baumobjekt-Änderung.
  Differentialtor: 22 Domänen bitidentisch + 4/4 Mutanten erwischt;
  **sort 2e6 = 2,16× gegenüber wasm64-NEXT, 1,82× gegenüber nativem OpenBLAS**.
- **G6-Latenzinstrument** — Charge-Quit-Latenzobergrenze für jeden
  blockbasierten Kernel (Kandidat ④ xpow-Treiber mit ≤2,1 % **verworfen**).
- Abschlussaudit: libm (IEEE-festgenagelt), fill/fft (bandbreitengebunden),
  xpow-Treiber (≤2,1 %) — **kein bekannter Spielraum mehr**
  (Reproduzenten in `w64-logs/`).

## Architektur

Vier Deployment-**Spuren** desselben Interpreters, automatisch pro
Browser-Fähigkeit gewählt (`lanes.js`): `base` (wasm32, single-thread) →
`threads` (wasm32 + pthread) → `w64` (memory64 + Threads + FMA + mimalloc +
rust-sort) / `w64-base`. Ohne COI-Header serviert sinkt man **lautlos** auf
`base` — siehe das [Deployment-Ticket](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/2).

Austauschbare Komponenten (BLAS, Allokator, Rust-Kernel) sind **Plugins mit
Kontrakt**: Modustabellen-Knauf → declared-Label → Artefakt-Sonde →
zweiseitiges Tor (`plugin-check.py`) → Faktenschlüssel. Octave-Updates
landen über die **Fork/Submodule-Pipeline**: `upstream/octave` (Branch
`wasm/11.3.0`) ist unser Fork — Upstream mergen, neu bauen, Spur-SOP laufen
(`build/113/NOTES-upstream.md`); die Pin/Witness-Tore
(`witness-upstream-pin.py`) behaupten bei jedem Commit Containerbaum == Fork-Pin.

## Ausführen

```sh
python3 build/serve-coi.py --dir /mnt/hdd/octave-wasm-build/site --port 8761
# öffne http://127.0.0.1:8761/   (COI-Header sind Pflicht — siehe Issue #2)
```

Harte Deploy-Anforderungen + Abnahmeprogramm: [DEPLOY.md](DEPLOY.md) und
[Issue #2](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/2).
UI-Anbindung: [Embed-API](docs/embed-api.md) und
[Issue #1](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/1).

## Zweige (drei unabhängig wartbare Linien)

| Zweig | Fork-Pin (`upstream/octave`) | Rolle |
|---|---|---|
| `wasm32-final` | — (eingefroren) | wasm32-Archivlinie |
| `wasm64-NEXT` | `a5a7208` (Patches + f77-Fix, **keine Rust-Naht**) | gemäßigte wasm64-Linie — verifiziert: Neuaufbau vom Fork-Pin reproduziert das deployed Artefakt byteidentisch |
| `IllegalPerformance` | `f4bf15b` (+ rust-sort-Naht) | aggressive wasm64-Linie — **heute ausgeliefert** |

Alle drei essen Upstream-Octave-Updates über dieselbe Fork-Pipeline
(`upstream/octave` Branch `wasm/11.3.0`); jede Linie pinnt ihren eigenen
Fork-Commit. Linienwechsel im gemeinsamen Build-Container = submodule update +
neu provisionieren + `relink.sh`/`link-web.sh` dieser Linie deployen
(siehe `maintaince.md`).

## Repository-Karte

- `STATE.md` — Live-Status; `build/FACTS.json` — Messwert-Ledger (130 Schlüssel,
  jeder mit Wiederholbefehl)
- `HISTORY.md` — append-only Chargenaufzeichnung (§5.77–§5.97 tragen die obigen
  Belege)
- `maintaince.md` — Richtungskarte; `docs/embed-api.md` — Embed-Kontrakt;
  `DEPLOY.md` — Deployment
- `build/113/` — Spur-Bauprone + Tore; `test/browser/` — 77-Suiten-Abnahme
  (`SWEEP_JOBS=4` parallelisierbar)
- `.scratch/open-questions/issues/` — lokaler Ticket-Tracker

Die Liste der verfolgten Dateien (Pfad + Bytes) pflegt der Hook im
[AUTO:FILES-Block von README.md](README.md).

## Hooks

Dieses Repo nutzt eine Whitelist-`.gitignore` (standardmäßig verweigern, pro
Pfad freigeben) + git hooks:

- `pre-commit`: rechnet den AUTO-Block der README nach, prüft die Whitelist,
  lässt die Faktus/Konsistenz/Plugin/Instrument-Tore laufen und das
  **dreisprachige README-Synchronisationstor**
  (`check_readme_sync.py`, aus [Einfacht](https://github.com/ArchivalEra/Einfacht)
  übernommen): alle drei Sprach-READMEs müssen existieren, nicht leer und
  querverlinkt sein.
- `pre-push`: README-Frische + der **Push-Set-Modus** des dreisprachigen Tors —
  ein Push, der eine Sprach-README berührt, muss alle drei im selben Batch
  aktualisieren.
- Installation: `bash .githooks/install.sh` (setzt `core.hooksPath`).

## Lizenz

**AGPL-3.0-or-later** (Volltext: [`LICENSE`](LICENSE)). Die verteilte
wasm-Binärdatei linkt statisch GPLv3-Octave, GPLv2+-FFTW, LGPL-libsndfile und
mehrere BSD/permissive-Komponenten — dieser Mix hat **keine Wahl außer
AGPL-3.0**.

Dieses Programm ist freie Software: Sie können es unter den Bedingungen der GNU
Affero General Public License, wie von der Free Software Foundation
veröffentlicht, weiterverbreiten und/oder modifizieren, entweder gemäß Version 3
der Lizenz oder (nach Ihrer Option) jeder späteren Version. Das Programm wird
in der Hoffnung weiterverbreitet, dass es nützlich ist, aber **OHNE JEDE
GARANTIE**; sogar ohne die implizite Garantie der MARKTFÄHIGKEIT oder der
EIGNUNG FÜR EINEN BESTIMMTEN ZWECK.

Gemäß AGPL-3.0 §13 erhalten Nutzer, die über ein Netzwerk mit ihm interagieren,
das Recht auf den entsprechenden Quellcode: **dieses Repository ist dieser
Quellcode**; der Build reproduziert vollständig im `o113`-Container (Rezepte in
`build/CLIBS.md`). Komponentenlizenzen und -urheberrechte:
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
