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

Toolchain: Emscripten **6.0.12** (alle drei Linien neu gebaut und ausgeliefert;
Die 6.0.12-Ausrollung der drei Linien ist in `build/113/NOTES-emsdk-upgrade.md` §8.8 dokumentiert.
Die Annahme-Triage je Linie steht in `build/113/NOTES-emsdk-upgrade.md` §8.9.

Alle drei Linien sind **gepusht und synchron** (local = origin = mirror), jede unter Emscripten 6.0.12 neu gebaut und im Browser verifiziert.

Die Downstream-Integration mit der Browser-clang+lld-Toolchain ([LLVM-wasm](https://github.com/ArchivalEra/LLVM-wasm)) ist in `.scratch/open-questions/issues/65-clang-wasm-toolchain-host-integration.md` dokumentiert.

Ein host-seitiger Integrationsbericht für die Browser-clang+lld-Toolchain liegt in `build/113/ISSUE-for-LLVM-wasm.md` (gegen das Issue-Gate jenes Repos validiert).

Ausgehender Issue upstream: [LLVM-wasm#1](https://github.com/ArchivalEra/LLVM-wasm/issues/1) (wasm64-Sysroot fehlt im Release-Bundle).

Die **unabhängige Downstream-Re-Verifikation** des Fixes zu [LLVM-wasm#1](https://github.com/ArchivalEra/LLVM-wasm/issues/1) ist an echten Artefakten durchgelaufen (v0.1.1).

**Browser-seitige `.oct`-Kompilierung ist end-to-end belegt**: die clang+lld-Toolchain im Browser baut ein echtes Octave-`.oct` (788 echte Header); nach `addpath` meldet der Live-Host `exist=3` und führt es aus. Siehe `build/113/NOTES-client-compile.md`.

A+B-Design für client-seitige `.oct`-Kompilierung: `build/113/NOTES-client-compile-design.md` — gepinnt über die bestehende Fork-Pipeline (keine Plugin-Bibliothek zu pflegen), validiert durch echte Paketquelle im Browser.

Das Fakten-Ledger erfasst jetzt den 6.0.12-Stand der drei Linien (`lane6012_*`) sowie die Client-Compile-/Upstream-Arbeit dieser Sitzung.

`pkg load <Name>` klärt jetzt zuerst die **Herkunft** eines Pakets: mitgelieferte Assets über `OctaveAssets.load`, Regal-Pakete (Forge-Katalog) über `OctaveAssets.install` (same-origin Tarball + sha256 + Gunzip/Untar in der Engine). **Auf 8761 ausgeliefert und im Browser verifiziert** (echter Tarball-Download + `csaps` bitgenau wie der Host-Octave). Siehe `build/113/NOTES-forge-ondemand.md` §10 (T4) und die Abnahmesuite `test/browser/accept-catalog-load.mjs` (27/0, inkl. 4 Gegenproben).

Die Installation des Forge-Pakets `datatypes` vom Regal macht die **modernen MATLAB-Typen** nutzbar: `table([1;2;3],{'a';'b';'c'})` liefert `class=table` (height 3, width 2), `string(42)` ergibt `"42"`. Nicht implementierte MATLAB-Namen melden jetzt den echten Octave-Text ("belongs to the 'datatypes' package … not installed") statt eines `makeinfo`-Subprozessfehlers. Siehe `build/113/REQUIREMENTS-store-and-matlab.md`. (`help sin`/`help ode45`/`lookfor` bleiben unberührt; die drei Help-Suiten prüfen jetzt, dass `__makeinfo__` auf den sanktionierten webshims-Downgrade zeigt.)

Diese Engine hat bereits alles, was ein Simulink-artiges **Blockdiagramm**-Backend braucht — State-Space-/Übertragungsfunktions-Blöcke, `ode45`, **steifes `ode15s`**, LQR, `zpkdata` (Probe `test/browser/probe-blockdiag-backend.mjs`, 6/0). Ein Blockdiagramm-Frontend kann also **auf dieser Engine** gebaut werden (eigenes JS-Repo), statt eine zweite Laufzeit wie Pyodide einzuführen. Siehe `build/113/NOTES-plugin-survey.md`.

Diese Untersuchung behandelt auch das, was diese Engine **nicht** erreicht: MATLAB hat drei Achsen (Sprache / Simulink / Simscape), wir decken die ersten beiden ab — **nicht-kausale physikalische Modellierung (Simscape) ist hier nicht abgedeckt**, und **OpenModelica** ist dafür die realistische Antwort (wasm-Pfad im offiziellen Repo, Rust-Neuschreibung, ausgelieferter Browser-FMI-Simulator; AGPLv3/OSMC-PL). Siehe §8 dort.

**WebGPU funktioniert hier, im Worker gemessen**: `navigator.gpu` liefert sowohl im Hauptthread als auch in einem DOM-freien Worker einen echten Adapter/Device (vendor=nvidia), und ein dort ausgeführter Compute-Shader ergibt für `[1,1,1,1]×2` das Ergebnis `[2,2,2,2]`. GPU-Compute ist also **keine** strukturelle Lücke — und anders als CUDA (herstellerprivater Stack, auf Telefonen abwesend) ist WebGPU eine einzige API für NVIDIA/AMD/Intel/Apple. WebSerial/USB/HID sind ebenfalls nativ verfügbar. Siehe `test/browser/probe-webgpu-capability.mjs`.

Ein Folge**experiment bestätigte, dass Modelica im Browser läuft**: ein Drittanbieter-Port OpenModelica→wasm führt `BouncingBall.mo` durch den vollen Zyklus `parse → C → emcc+wasm-ld im Browser → Simulation → Plot` (Beleg: `build/113/evidence-omc-web-demo.png`; Protokoll: `build/113/NOTES-experiment-omc-wasm.md`). „Modelica im Web" ist also bewiesen, nicht spekulativ — die Solver-Abdeckung jenes **Drittanbieter**-Wegs ist allerdings schmal (Euler/RK/dassl).

Der **offizielle** Weg ist ein erstklassiges CMake-Ziel in OpenModelicas eigenem Baum (`rust_omc.cmake`: `RUST_OMC_WASM_RUNTIME`, `wasm32-wasip1`-Cross-Compile, `omc.wasm`, Artefakt-Übergabe) — also dieselbe Form wie die eigene Pipeline dieses Repos (Upstream-Submodul + Pin + Cross-Compile + Same-Origin-Hosting). Er wird also so gebaut, wie wir Octave bauen, nicht durch Kopieren eines Drittanbieter-Rezepts (siehe §11).

Und es kann sich **dieselbe Seite** teilen — gemessen, nicht angenommen: diese Engine löst **index-1 DAE** (`ode15i`, `Mass`-Matrix; eine RC-Schaltung ergibt V(5)=0.9931 gegen Theorie 0.9933), aber **nicht index-3** (ein Zwangspendel schlägt fehl) — und Indexreduktion ist genau das, was der OpenModelica-Compiler tut. Beide Engines lesen/schreiben `.mat`, was omc-web ohnehin ausgibt. Die Paarung entspricht also der Simscape↔MATLAB-Aufteilung: OM modelliert, Octave analysiert, `.mat` dazwischen (siehe §8 des Protokolls).

Das klärt auch den Repo-Plan: ein separates „Blockdiagramm-Repo" ist **nicht** nötig — MSL `Blocks` liefert bereits die kausale Blockbibliothek, und OMEdit bringt bereits einen Qt-for-WebAssembly-Grafikeditor mit; OpenModelica ist also ein **gleichrangiger Upstream** (Lizenz AGPLv3/OSMC-PL passt), d. h. ein 20. Submodul neben Octave, das eine zweite Engine-Lane auf derselben Seite versorgt. Siehe §9.

Die Brücke zur MATLAB-Semantik existiert auf der Schnittstellenebene ebenfalls bereits: OMs Skript-API (`sendExpression`, genutzt vom offiziellen `OMMatlab`-MATLAB-Client über ZeroMQ) wird im Browser als **`omc_eval`** exponiert — dasselbe Kommandoprotokoll, anderer Transport. Fehlt also nur eine Octave-seitige `omc_*`-Funktionsfamilie (Skript bauen → `omc_eval` aufrufen → `.mat` zurücklesen); OMMatlab selbst läuft nicht im Browser (es braucht einen lokalen Prozess-Socket). Siehe §10.

**Symbolisches Rechnen — die Routenvoraussetzung ist jetzt gemessen, nicht angenommen**: In diesem Build ist `sym` = 0, und Forge's `symbolic`-Paket ist reines `.m` (null `.cc`), treibt aber alles über Python/SymPy — während das wasm dieses Builds **null** Bytes für `pyexec`/`pyeval`/`pycall` enthält und keine Shell hat. Das Paket läuft also nicht unverändert; der einzige Weg ist eine echte Python-Laufzeit im Browser. Gemessen: **Pyodide + SymPy funktioniert** — `diff(sin(x),x)` ergibt exakt `cos(x)`, sowohl im COI-Worker als auch **ohne** COOP/COEP (die Basis-Linie hat es also auch), samt lautem Fehlschlag als Gegenprobe (`test/browser/probe-pyodide-sympy.mjs`, 5/0). Zur Frage „Python vorkompilieren": Statische Kompilierung nach JS (Transcrypt-Art) ist **nicht machbar**, nicht bloß langsamer (Transcrypts eigenes README: „No eval and exec of Python code"; SymPy, gemessen: 340 `eval(` / 61 `exec(` Aufrufstellen). Vorkompilierter **Bytecode** (`.pyc`) ist machbar und derzeit gar nicht umgesetzt; die gemessene A/B ergibt **7.26×** bei `import sympy` (2757 → 380 ms, Kompilieraufrufe 472 → 0), bei 3.28× der Wheel-Bytes. Siehe `build/113/PLAN-matlab-gaps.md`.

**Urteil zur Frage „ist Pyodide ein Performance-Ballast“** (Dreiweg-Messung, dieselbe Bench, dasselbe SymPy 1.14.0, dieselben Ground Types): natives CPython (uv 3.14) = 1,00×; **Browser-Pyodide = 2,04×** (geometrisches Mittel über 15 CAS-Ops, pro Op 1,6–3,2×); natives Octave + `symbolic` mit persistentem IPC = 7,54× (die Browser-Variante ist sogar **3,69× schneller**, weil `symbolic` bei jedem Op Variablen über eine Pipe marshallt). Kaltstart = Pyodide-Laden + sympy-Paket ≈ 2,3 s (lazy ladbar, nie im Boot-Pfad). Also: ≈2× ist keine Größenordnungsänderung und ändert die Architekturwahl nicht. Re-Run: `sh test/fixtures/sympy-perf/run-perf.sh`.

**Nachfrage: wie viel bringt vorkompiliertes `.pyc` wirklich?** (viergeteilte Messung — nur `import` zu messen, wäre irreführend): `import sympy` **2,71 s → 0,37 s (7,40×)**; geometrisches Mittel der **Erstaufrufe** pro Op **1,29×** (SymPy importiert Submodule lazy); **Steady State 0,99× — unverändert, wie es sein muss** (die Kontrolle dafür, dass Vorkompilierung kein Allheilmittel ist). Entscheidend ist die vierte Zahl: ein zweiter `import sympy` in derselben Sitzung kostet mit Quell-Wheels weiterhin 2,73 s — d. h. **der Browser hat keinen impliziten Bytecode-Cache** (natives CPython schreibt `__pycache__`; site-packages ist hier nur lesbar); jeder Kaltstart kompiliert die 472 Module neu. `.pyc`-Wheels kaufen also genau eines: **die Startkonstante pro Sitzung sinkt um ~85%**, zum Preis von 3,28× Bytes. `test/fixtures/sympy-perf/compare-pyc.py`.

**Wo das symbolische Rechnen in den "Zusatzinhalten" beheimatet ist**: das Paket `symbolic` ist ein gewöhnlicher Shelf-Eintrag, die Pyodide-Laufzeit (~27 MB) aber ist **Infrastruktur, kein Shelf-Eintrag** — dieselbe Klasse wie die clang-Toolchain: Same-Origin-Hosting, per URL+sha256 in `upstream-lock.json` gepinnt, ein wiederherstellbares Bereitstellungsartefakt, das mehrere Pakete teilen. Und das aktuelle `kinds`-Feld **belügt sich hier selbst**: gemessen liefert `detect_kinds('symbolic-3.2.2.tar.gz')` den Wert `['m']` — identisch mit dem wirklich sofort nutzbaren `cgi` —, während die `DESCRIPTION` `SystemRequirements: python, sympy, mpmath` nennt: Es lässt sich installieren und danach nicht ausführen. Daher eine neue Shelf-Achse (`needs: ["pyodide"]`); die Größenordnung ist gemessen: Nur **2 von 144** Upstream-Paketen brauchen sie (`symbolic`, `pythonic`). Im Store-artigen UI muss diese Zeile "lädt bei Bedarf ~27 MB Laufzeit" anzeigen. Siehe `REQUIREMENTS-store-and-matlab.md` §A4b.

**Rahmung (Nutzervorgabe 2026-10-14): "Plugin-Markt / Store" ist nur eine UI-Form von **Zusatzinhalten** (extra content), nicht das Konzept selbst.** Wie diese Dinge auch heißen mögen — sie sind letztlich nur Fähigkeitserweiterungen dieser Web-Version von Octave; der Begriff auf Konzeptebene ist **Zusatzinhalte** (maßgebliche Definition in `CONTEXT.md`): mitgelieferte Assets / Shelf-Pakete / **gemeinsame Fähigkeitsschichten** (clang-Toolchain, Pyodide-Laufzeit) / Build-Zeit-Komponenten-Plugins. Das "Shelf" ist ihr Metadatenträger, "On-Demand-Pull" ihr Beschaffungsmechanismus. => Bei Fähigkeiten "Zusatzinhalte" schreiben; "Store" nur für die Oberfläche.

**Vereinheitlichte "Zusatzinhalte"-Schnittstelle über die drei Repos (entschieden 2026-10-14)**: eine Naht zwischen Octave-Full-Wasm, LLVM-wasm und dem Shelf-Repo — **die Naht liegt am Datensatz, nicht an der Methode**: ein Satztyp (`form` = Auslieferungsform, `content` = Inhalt — zwei getrennt benannte Achsen, Schluss mit der `kind`/`kinds`-Überladung) + Fähigkeitsschichten (Pyodide/clang) als gewöhnliche `form:"tree"`-Einträge im SELBEN Abhängigkeitsgraphen + ein Host-Rückgabewert mit **vier Zuständen** (ok/failed/not-found/cannot-know, nicht zu einem Boolean kollabierbar — die T4-Lehre "nicht gelesen ist nicht abwesend" als typisierte Invariante) + der Port in `build/extra-content/`. Siehe `build/113/NOTES-extra-content-seam.md`.

**Organisatorische Entscheidung (2026-10-14, Nutzer: du waehlst)**: Die Backend-Integration der Zusatzinhalte **bleibt bei diesem Repo**; nicht-Kern-Inhalte (Metadaten + Bereitstellungsrezepte fuer Pakete/Laufzeiten/Toolchain) gehoeren dem **Agenten des Zusatzinhalte-Repos**; das **UI-Repo haelt zwei Vertraege** — einen mit diesem Repo (Engine / `docs/embed-api.md` / vier-Zustaende-Rueckgabe von `install`) und einen mit dem Zusatzinhalte-Repo (Inhalts-Governance / der Port). **Verworfen: ein Integrator-Repo dazwischen** (das Integrationswissen liegt hier — Lane/COI/Promote/Gates/die Qt-abgeleitete Embed-API; ein Integrator muesste es neu lernen oder wuerde zur Fassade); **verworfen: reines Standard-propagieren** (ein Standard ist eine Taetigkeit, keine Struktur — ohne Eigentuemer driftet er). Es gibt weiterhin **genau einen Same-Origin-Endpunkt zur Laufzeit**; die zwei Vertraege sind zwei Gespraechspartner, keine zwei Origins (COEP blockiert Cross-Origin-Fetch, gemessen). Siehe `build/113/NOTES-extra-content-seam.md` §8.

**Migration: Shelf-Repo -> Zusatzinhalte-Repo (privat, 2026-10-14)**: Das frühere `Octave-Forge-Shelf` (public) ist jetzt **`Octave-Extra-Content` (privat)** — das `shelf/`-Submodul dieses Repos zeigt darauf. Neben den ursprünglichen Paketarchiven kommen `recipes/` (Bereitstellungsrezepte für die LLVM-wasm-Toolchain und die Pyodide/SymPy-Laufzeit: URL + sha256 + Budgets) und `port/` (eine Kopie der content-list-Portspezifikation) hinzu. **Damit ist Organisations-Entscheidung ③ (kein Zwischenhändler) umgesetzt**: dieses Repo ist der Kern-Host / konsumierende Adapter, das Zusatzinhalte-Repo der produzierende Adapter, und die UI hat je einen Vertrag. **Ehrliche Folge von privat**: Dieses Repo ist public, daher können **externe Clones `shelf/` nicht initialisieren** — eine Fähigkeits-Einbuße, kein Build-Fehler (Gates tolerieren das per SKIP). Das alte public-Repo `Octave-Forge-Shelf` ist jetzt **archiviert** (schreibgeschuetzt; Loeschen braucht einen `delete_repo`-Scope, den der Token nicht hat, also wartet es auf ein interaktives `gh auth refresh`); der lokale Klon wurde entfernt. Siehe `build/113/NOTES-extra-content-seam.md` §8. (Pin-Verlauf: das Zusatzinhalte-Repo ging 980e093 -> Upgrade 7eee94d -> Whitelist-.gitignore af7508c; die beiden spaeteren Commits betreffen nur Doku/.gitignore, `packages/`+`tools/` bleiben byte-identisch zu 980e093 — keine funktionale Aenderung, kein Site-Rebuild noetig.) (Wissenstransfer 2026-10-14: drei Erfahrungsdokumente an das Zusatzinhalte-Repo gesendet — `docs/{FORK-PIPELINE,FACT-SYSTEM,LANES-AND-MEMORY-MODEL}.md`, je auf seine Rolle als produzierender Adapter zugeschnitten, mit reproduzierbaren Befehlen und echten Fehlertexten — und das Speichermodell-/Linien-Dokument an das OM-Repo.) (Uebergabe 2026-10-14: Das Zusatzinhalte-Repo ist nach /mnt/hdd/zcode-projects/Octave-Extra-Content geklont (via `gh repo clone`, autoritativer Remote-Stand), vor Ort verifiziert: Tool-Selbsttest 14/0, 12 Pakete, alle drei Docs vorhanden; README nennt nun eine vierschrittige Zuerst-lesen-Reihenfolge.)


**Eine Linie, eine Architektur** (Nutzervorgabe 2026-10-12): Die `master`-Linie zielt auf wasm64 und kompiliert nur wasm64; die wasm32-Linie entsprechend nur wasm32. Erzwungen durch `build/113/check-lane-purity.py`.

Website-Asset-Bundles werden pro Charge geprüft: `site/assets/m/*.js` aus den `build/`-Quellen neu bauen und Hashes vergleichen (Mount-Punkte wörtlich aus `build/assets-meta.json`, nicht geraten).
die eingefrorene `wasm32-final`-Archivlinie neu gebaut, aber nicht promoted).

Alle drei Linien sind jetzt auf **derselben Toolchain (Emscripten 6.0.12)** neu gebaut
und im Browser verifiziert — einschließlich der eingefrorenen `wasm32-final`-Linie.

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

Dieses Repository enthält **keine CI-Auto-Deploy** — Deployment ist manuell, siehe [DEPLOY.md](DEPLOY.md).
Harte Deploy-Anforderungen + Abnahmeprogramm: [DEPLOY.md](DEPLOY.md) und
[Issue #2](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/2).
UI-Anbindung: [Embed-API](docs/embed-api.md) und
[Issue #1](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/1).

## Zweige (drei unabhängig wartbare Linien)

| Zweig | Fork-Pin (`upstream/octave`) | Rolle |
|---|---|---|
| `wasm32-final` | — (eingefroren) | wasm32-Archivlinie |
| `wasm64-NEXT` | `a5a7208` (Patches + f77-Fix, **keine Rust-Naht**) | gemäßigte wasm64-Linie — verifiziert: Neuaufbau vom Fork-Pin reproduziert das deployed Artefakt byteidentisch |
| `IllegalPerformance` | `f4bf15b` (+ rust-sort-Naht) | aggressive wasm64-Linie — **ausgeliefert 2026-10-07** (8761 w64 = `f6fec91f`, IEEE-bewertet, sort 2,16× gegenüber dieser Basis) |

Alle drei essen Upstream-Octave-Updates über dieselbe Fork-Pipeline
(`upstream/octave` Branch `wasm/11.3.0`); jede Linie pinnt ihren eigenen
Fork-Commit. Linienwechsel im gemeinsamen Build-Container = submodule update +
neu provisionieren + `relink.sh`/`link-web.sh` dieser Linie deployen +
`OCTAVE_WASM_BASE` auf die Site dieser Linie zeigen lassen + `core.hooksPath` auf die
Hooks dieser Linie setzen (Faktensystem liegt auf `IllegalPerformance` in
`reflect-hooks/`, auf den anderen beiden in `.githooks/`) — siehe `maintaince.md`.

## Repository-Karte

- `STATE.md` — Live-Status; `build/FACTS.json` — Messwert-Ledger (jeder Schlüssel
  mit Wiederholbefehl)
- `zreflect/` — das Faktensystem (**Einfacht-Refaktorierung adoptiert 2026-10-09**:
  Gate-Plattform / entdecktes Gate-Register / Knopf-Register / World-Gate);
  `zreflect/measure_octave.py` ist die Datenschicht dieses Repos,
  `reflect-hooks/Einfacht.env` der Knopf-Träger
- `HISTORY.md` — append-only Chargenaufzeichnung (§5.77–§5.107 tragen die obigen
  Belege)
- `maintaince.md` — Richtungskarte; `docs/embed-api.md` — Embed-Kontrakt;
  `DEPLOY.md` — Deployment
- **Octave-Forge On-Demand-Pull** (v1 läuft, 2026-10-09; **ausgeliefert 2026-10-10** an
  8761/8768/Repo-`site/`): `OctaveAssets.catalog()` liest ein Site-Regal,
  `OctaveAssets.install(name)` lädt+prüft+installiert ein Paket (samt Abhängigkeitsabschluss) erst
  **auf Anfrage** — **0 Bytes für nie genutzte Pakete**. Regal = `shelf/`-Submodule (nur Metadaten,
  eine Datei pro Paket); Site-Katalog = `build/forge-catalog.py` (Tor:
  `build/113/check-forge-catalog.py`); Abnahme = `test/browser/accept-forge-ondemand.mjs`;
  Design = `build/113/NOTES-forge-ondemand.md` (das
  **Octave-Forge-On-Demand-Pull**-Pluginsystem: Client-Regal + Laufzeit-Installation,
  verzahnt mit der Fork/Lock-Pipeline; v1 deckt reine `.m`-Pakete ab, `.oct`-Beschleuniger = v2/T8)
- `build/113/` — Spur-Bauprone + Tore; `test/browser/` — Abnahme-Harness
  (`SWEEP_JOBS=4` parallelisierbar; letzter grüner Lauf = `accept_suites` /
  `accept_pass` im Ledger)
- Grafik (seit 2026-10-09 **Engine-autoritativ**): `bridge/octave-core.js`
  schützt den Kern-`m/plot`-Baum vor Host-Schatten-Stubs (Snapshot + Restore +
  Löschen von Neuanlagen), `p5canvas.js`/`queue.js` lösen das Modul über
  `window.__octaveHosts` auf — so erreichen Figuren im Embed-Modus das DOM;
  Abnahme = `accept-gfx-isolation` + `accept-gfx-render`
- Worker-Modus (`?worker=1`, **repariert 2026-10-10**): jede `eval` kam nie zurück (der
  Worker-Zweig rief weiterhin `octaveUiAppend` auf, nachdem der Seitenadapter
  extrahiert worden war) — der Ausgabe-Flush kann die Warteschlange nicht mehr
  blockieren; Abnahme = `accept-worker`
- `.scratch/open-questions/issues/` — lokaler Ticket-Tracker
- `docs/agents/upstream-issues.md` — Issues, zurückgespiegelt an [Einfacht](https://github.com/ArchivalEra/Einfacht) (Archivkopien); `docs/agents/ui-issue-interface-change.md` — Mitteilung von Schnittstellen-/Verhaltensänderungen an das UI-Repo

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
