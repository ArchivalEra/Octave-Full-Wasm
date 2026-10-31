# Octave-Full-Wasm

[English](README.md) · [中文](README.zh.md) · [Deutsch](README.de.md)

GNU Octave 11.3.0 nach WebAssembly kompiliert, der gesamte Interpreter laeuft im Browser.
Reine Client-Berechnung: Ihr Code wird nie auf einem Server ausgefuehrt.

Diese README richtet sich an Menschen, die dieses Repository **bauen, erweitern oder
debuggen**. Sie nennt vier Dinge: was das ist, welche Linie zu waehlen ist, wie schnell
jede Linie ist und wo die massgeblichen Fakten liegen. Die Historie pro Charge steht in
[`HISTORY.md`](HISTORY.md), der Live-Status in [`STATE.md`](STATE.md).

Alle drei Sprachfassungen werden gleichzeitig gepflegt; ein Push, der nur eine davon
aktualisiert, wird vom pre-push-Gate abgelehnt.

---

## Die drei Linien

Ein Interpreter, drei unabhaengig gepflegte Produktlinien. Die Aufteilung richtet sich nach
**Erreichbarkeit fuer Nutzer und Lizenzierung — nie nach Leistung**.

| Branch | Ziel | Voraussetzung | Frei |
|---|---|---|---|
| **`wasm32-final`** | wasm32, ein Thread | keine — **die einzige Linie ohne COI** | ja |
| **`master`** | wasm64 + Threads | COI-Header + Multithreading | ja |
| **`IllegalPerformance`** | wasm64 + Threads + Rust-Kernel | COI-Header | nein — patcht die Toolchain weg von der Upstream-Unterstuetzung |

Wird `master` ohne `crossOriginIsolated` ausgeliefert, faellt die Seite **still** auf die
wasm32-Linie zurueck: kein Fehler, nur eine andere Linie. Eine Site zeigt genau zwei Zellen:
`base` (wasm32) und `w64` (wasm64). Jeder andere Zellenname ist eine tote Linie, und ein
Gate weist ihn ab.

## Leistung

Wandzeit in Sekunden, kleiner ist besser. Referenz nativ: `octave-cli` 11.3.0 auf dieser
Maschine (Median aus 5 warmen Laeufen); die wasm-Werte sind Mediane aus 3 verschraenkten
Laeufen. Gemessen am 2026-10-07.

Rohdaten: [`docs/charts/perf-data.json`](docs/charts/perf-data.json).
Bericht und Log: `HISTORY.md` §5.96, `w64-logs/bigcompare-final.log`.

![Fuenf-Wege-Leistungsvergleich](docs/charts/perf-5way.svg)

| Last | nativ Referenz-BLAS | nativ OpenBLAS ×24 | wasm32-final | wasm64 | IllegalPerformance |
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

Geometrisches Mittel gegen die native Referenz: wasm32-final 1.05×, wasm64 1.99×,
IllegalPerformance 1.96×.

![Beschleunigung von IllegalPerformance gegenueber jeder Basis](docs/charts/perf-speedup-IP.svg)

Die wasm-Linien schlagen ein einthreadiges natives Octave bei BLAS-lastiger Arbeit, weil
sie ein OpenBLAS mit relaxed-SIMD-FMA mitbringen und es multithreaded ausfuehren. Bei
`matmul` schlagen sie ein handoptimiertes 24-Thread-OpenBLAS **nicht** (0.0230 s gegen
0.0089 s). Speicherbandbreiten-gebundene Lasten (`dot`, `sum`) landen auf jeder Linie beim
selben Wert.

Der Rust-Sort-A/B ist eine **andere Messung** (am Produktartefakt statt am Kernel):
`w64_rustsort_ab_asc_ms` 165 ms, `w64_rustsort_ab_asc_ratio` 0.506 ⇒ 2.0×.
Erneut ausfuehren: `bash build/113/sort-ab.sh`.

## Numerische Korrektheit

Ergebnisse werden mit nativem Octave auf identischen Eingaben verglichen, Bit fuer Bit
statt naeherungsweise.

| Bereich | Befund |
|---|---|
| Elementarmathematik (`libm`) | Bit-identisch zu musl fuer `sin`, `exp`, `log`, `pow` |
| Sortieren (Rust-Kernel) | Bit-identisch ueber 22 Domaenen, inklusive NaN und duplikatreicher Eingaben |
| Arithmetik, `sum`, `lu`, `svd`, … | Bit-identisch |
| BLAS/LAPACK | gleiche Quellen und Flags; relaxed-SIMD-FMA aendert die Summationsreihenfolge, daher wird diese Achse gegen ein dokumentiertes Toleranzband verglichen |

Ein `libm`-Ersatz-Spike wurde per Messung abgelehnt: geometrisches Mittel 0.964 pro Aufruf
(`libm_spike_geomean`), bei einer Schwelle von 1.5×. Erneut ausfuehren:
`sh build/113/bench-libm-spike.sh 8`.

Der Rust-Sort-Kernel haengt hinter zwei Gates: ein Differenz-Gate vergleicht 22
Eingabedomaenen Bit fuer Bit, und ein Mutations-Selbsttest injiziert absichtliche Fehler in
den Kernel und verlangt, dass das Differenz-Gate sie faengt (4/4 gefangen). Ein Kernel wird
nur uebernommen, wenn beide bestehen. Erneut ausfuehren:
`bash test/fixtures/rustsort-spike/run-spike.sh`.

## Architektur

1. **Der Interpreter.** Upstream-Octave, geforkt unter `upstream/octave` (Branch
   `wasm/11.3.0`), kompiliert mit Emscripten 6.0.12. Upstream-Releases landen ueber
   Merge → Rebuild → Linien-SOP; `witness-upstream-pin.py` prueft bei jedem Commit, dass
   der Baum im Container dem Fork-Pin entspricht.

2. **Die Linien.** Dasselbe wasm, gebaut pro Ziel (wasm32, wasm64+Threads) und pro
   Komponentensatz (BLAS-Variante, Allokator, Rust-Kernel). Linienwissen ist **Daten**:
   [`build/lanes.json`](build/lanes.json) ist die einzige Quelle, und
   `check-lanes-single-source.py` gleicht sie gegen **vier Konsumenten** ab — den
   Linienwaehler der Seite, den Site-Generator, das Reinheits-Gate und die Plugin-Tabelle.

3. **Die Asset-Schicht.** `.oct`-Module, `.m`-Buendel und Datendateien werden bei Bedarf
   geladen und in das In-Memory-Dateisystem von Octave geschrieben, mit sha256-Pruefung pro
   Datei. Pakete kommen entweder vom Shelf (vorgebaute Tarballs) oder werden im Browser von
   einer mitgelieferten clang/lld-Toolchain kompiliert. Beachten Sie: `addpath` liest
   **MEMFS**, nicht den HTTP-Baum der Site — alles, was Octave sehen soll, muss zuerst in
   MEMFS geschrieben werden.

4. **Das Faktensystem.** Jede Aussage ueber den Build ist ein Ledger-Eintrag mit eigenem
   Nachfahrbefehl. [`build/FACTS.json`](build/FACTS.json) haelt die Zahlen, `STATE.md` den
   Live-Status, `HISTORY.md` die Append-only-Aufzeichnung, und 64 Gates (14 Plattform,
   50 Repo-spezifisch) pruefen, ob Dokumente, Artefakte und Ledger uebereinstimmen.

Austauschbare Komponenten sind **Plugins mit Vertrag**, keine Build-Flags: Modustabellen-
Schalter → deklariertes Label im Artefakt → Artefakt-Probe → Zweiweg-Gate → Ledger-Eintrag.

## Bauen und starten

```sh
# eine gebaute Site ausliefern (COI-Header sind fuer die w64-Linie Pflicht)
python3 build/serve-coi.py --dir /mnt/hdd/octave-wasm-build/site --port 8761
```

Ein normales `python3 -m http.server` kann keine COI-Header senden, und die Seite liefert
dann **still** die wasm32-Linie aus.

Ein Neubau von Grund auf braucht den `o113`-Container (Emscripten 6.0.12 plus den
Octave-Fork) und die Rezepte in [`build/CLIBS.md`](build/CLIBS.md). Das Neulinken eines
bestehenden Baums laeuft ueber **einen** Einstiegspunkt — `bash build/113/relink.sh link
product` — der alle Umgebungsvariablen fuer einen Modus besitzt; nicht von Hand setzen.
`bash build/113/relink.sh explain product` druckt das Rezept.

Das Deployment ist manuell; es gibt kein CI-Auto-Deploy. Siehe [`DEPLOY.md`](DEPLOY.md).
Den Interpreter in eine eigene Seite einbetten: [`docs/embed-api.md`](docs/embed-api.md).

## Repo-Karte

| Pfad | Was |
|---|---|
| [`STATE.md`](STATE.md) | Live-Status — was jetzt wahr ist |
| [`maintaince.md`](maintaince.md) | Richtung und Karte |
| [`HISTORY.md`](HISTORY.md) | Append-only-Aufzeichnung pro Charge |
| [`CONTEXT.md`](CONTEXT.md) | Glossar — eine massgebliche Definition pro Begriff |
| [`AGENTS.md`](AGENTS.md) | Betriebsvertrag fuer Mitarbeitende in diesem Repo |
| [`build/FACTS.json`](build/FACTS.json) | Ledger der gemessenen Zahlen; jeder Schluessel traegt seinen Nachfahrbefehl |
| [`build/lanes.json`](build/lanes.json) | Einzige Quelle des Linienwissens |
| [`build/CLIBS.md`](build/CLIBS.md) | Build-Rezepte der C-Bibliotheken |
| `build/113/` | Build-Rezepte, Gates, Linien-Skripte, technische Notizen |
| `bridge/` | Browser-Glue: Asset-Loader, Linienwaehler, Worker, Seiten-Host |
| `test/browser/` | Browser-Abnahmesuiten |
| `zreflect/` | Faktensystem: Gate-Registry, Knob-Registry, Ledger |
| `upstream/` | Octave-Fork (Submodule) |
| `shelf/` | Paket-Shelf (eigenes Repo, Submodule) |
| `mail/` | Repo-uebergreifende Korrespondenz — der Eingang dieses Repos |

## Repo-Inhalt

<!-- AUTO:FILES -->
<!-- /AUTO -->

## Hooks und Gates

Die Gates liegen in `reflect-hooks/` und sind ueber `core.hooksPath` verdrahtet.
`pre-commit` rechnet die Maschinenbloecke in dieser README und in `STATE.md` neu, faehrt
dann die Faktensystem-Gates, die Repo-spezifischen Gates (Whitelist, Konsistenz,
Falsifizierbarkeit, Readiness-Antimuster, Mail-Grenze) und beide Selbsttest-Baenke.
`pre-push` verlangt zusaetzlich, dass alle drei READMEs im selben Push aktualisiert werden.

Von Hand ausfuehren:

```sh
. reflect-hooks/Einfacht.env
python3 zreflect/registry.py --run commit              # alle Gates mit runs_at="commit"
sh gates-selftest.sh && sh build/gates-selftest.sh     # beweisen, dass jedes Gate rot werden kann
```

Jedes Gate traegt `--selftest`. Ein Gate, dessen Fehlschlag nicht gezeigt werden kann, ist
kein Gate.

## Mitwirken

Lesen Sie zuerst [`AGENTS.md`](AGENTS.md) — das ist der Betriebsvertrag, kein Styleguide.
Drei Regeln sind absolut: keine serverseitige Ausfuehrung, kein Force-Push und kein
Umschreiben der Historie, und jede neue Datei muss in die `.gitignore`-Whitelist eingetragen
werden, sonst weist das pre-commit-Gate sie ab.

Am 2026-10-30 kamen zwei Schreiben. Eine Kursseite wollte ein herunterladbares wasm32-Artefakt einbetten; dieses Repository hatte **null Releases**, also ist jetzt das erste veroeffentlicht (`wasm32-11.3.0-1ed3e528`, 37,96 MiB roh / 9,90 MiB gzip, mit sha256 pro Datei in `SHA256SUMS.json`). Der `octave.wasm`-Sha des Artefakts ist byte-identisch mit der im Betrieb ausgelieferten Basis-Zelle — externe Nutzer bekommen, was tatsaechlich laeuft, statt eines separat gebauten Binaerobjekts.

Das andere Schreiben mass die Pages-Ausgabe der UI mit 1,26 GB — 256 MB ueber GitHubs harter 1-GB-Grenze — bei 617 MiB duplizierten Bytes. Das Nachrechnen bestaetigte die Zahlen, aber die Zuordnung lag eine Ebene daneben: die Layout-Skripte liegen im UI-Repository, waehrend die Duplikation aus diesem hier kam. Zwei der drei Produktlinien trugen noch tote Linienverzeichnisse (`threads/` und `w64-base/`, je 76 MiB) in ihren `site/`-Spiegeln — Ueberbleibsel des Vier-Zellen-Layouts vom 1. Oktober, das die spaeteren Drei-Linien-Entscheidungen nur aus einer Linie entfernt hatten. Die UI kopiert das `site/` jeder Linie komplett, also stammten 113 MiB ihrer Duplikation aus toten Linien aus diesem Repo. Beide Linien sind bereinigt; die laufende Site war bereits korrekt, korrigiert wurden also die Spiegel, die die UI liest, nicht das Deployment.

`AGENTS.md` wurde am 2026-10-30 neu geschrieben (Anweisung: „agents.md kann neu geschrieben werden; das alte aufgeblaehte Ding gehoert wirklich entsorgt"). Von 282 auf 145 Zeilen, indem drei Inhaltssorten getrennt wurden, die sich in einer Datei angesammelt hatten: die Regeln, die nicht gebrochen werden duerfen (behalten, verdichtet), die Befehlsfolgen (entfernt — die Skripte unter `build/` sind ihre eigene Dokumentation und tragen je ein `--selftest`) und die ausfuehrlichen Erzaehlungen vergangener Vorfaelle (entfernt — sie stehen in `HISTORY.md` unter `§5.x`). Ein Eintrag war woertlich doppelt vorhanden. Was im Abschnitt ueber still fehlschlagende Fallen bleibt, behaelt pro Punkt einen Satz dazu, *warum* der Fehlschlag still ist — das unterscheidet einen Vertrag von einer Liste von Ermahnungen.

Dieselbe Anweisung lockerte die Korrespondenzregel: das Repository der Kursseite war zuvor tabu und ist jetzt **schreibgeschuetzt plus Briefzustellung** — ein Brief darf in sein `mail/`, sonst nichts. Die Praemisse der drei Mail-Regeln ist offenbar „der Empfaenger hat einen Eingang“ und nicht „der Empfaenger gehoert zur Koalition“, und jene Site hat am selben Tag einen angelegt. `outbox/` wird zum Rueckfall fuer Empfaenger ohne Eingang.

Beim Ausliefern einer Site ueber HTTP gab es einen Defekt, der festgehalten gehoert: `build/serve-coi.py` sendete weder `Cache-Control` noch `ETag`, also uebertrug jedes Neuladen der Seite erneut die vollen 119,9 MB — drei Ladevorgaenge, drei vollstaendige Uebertragungen, gemessen mit CDP `Network.loadingFinished` unter einem persistenten Profil. Die Korrektur ist ein aus `size`+`mtime_ns` abgeleiteter `ETag` (kein Inhalts-Hashing einer 29-MB-Datei) plus `Cache-Control: no-cache`, mit einer `send_head()`-Ueberschreibung, die bei `If-None-Match` mit 304 antwortet. Nach der Aenderung uebertraegt der erste Ladevorgang 119,9 MB und jedes weitere Neuladen 12.790 B — eine Reduktion um 99,99%. `no-cache` statt erlaubendem Caching, weil die Regel dieses Repos „nie ein veraltetes Artefakt ausliefern“ eine Rueckpruefung verlangt, und nicht `no-store`, weil das Caching ueberhaupt abschaltet (genau der Fehlschlag, den ein anderes Repo erlitten und gemeldet hat). Der Selbsttest wuchs von 5 auf 9 Faelle, inklusive einer Gegenprobe, dass kein Pfad jemals `no-store` senden darf.

Eine Lehre aus der Korrektur: der erste 304-Zweig sendete `ETag`/`Cache-Control` erneut, und `end_headers()` sendete sie noch einmal, sodass zwei Header gleichen Namens entstanden. Doppelte Header werfen keinen Fehler, aber ein nachgelagerter Client liest moeglicherweise den falschen.

Ein GitRoll-Scan meldete 931 Befunde fuer dieses Repo (Issue #7, davon ein BLOCKER). Die Pruefung ergab genau einen echten Defekt: der Forge-Fetcher meldete Aufloesungsfehler nur auf stderr, waehrend der Aufrufer nie einen Rueckgabewert pruefte — ein fehlendes oder versionsinkompatibles Paket endete also mit Exit-Code 0, und der Build verpackte danach ein unvollstaendiges Regal, waehrend alle Gates gruen blieben. Die Korrektur macht unaufgeloeste Pakete und Downloads mit falscher Pruefsumme gleichermassen toedlich, trennt Umgebungsfehler (Exit 2) von Aufloesungsfehlern (Exit 1) und ergaenzt einen Selbsttest mit acht Faellen; wird eine der Wachen auf ihr altes Verhalten zurueckmutiert, wird der Selbsttest rot. Die uebrigen 930 Befunde sind nach Zustaendigkeit aufgeteilt und im Issue dokumentiert: 363 `var`-Verwendungen sind eine bewusste ES5-Kompatibilitaetsentscheidung statt Schuld, die einzige gemeldete Schwachstelle liegt in einer Drittanbieter-Service-Worker-Bibliothek, und die Komplexitaetsbefunde sind Lesbarkeitsarbeit, die ein eigenes Ticket braucht.

Drei Korrekturen aus Nutzeranweisungen haben die GitRoll-Arbeit umgelenkt. **Die Browser-Untergrenze liegt bei Chrome 123**, die 363 `var`-Befunde sind also echte Schuld statt einer Kompatibilitaetsanforderung — meine fruehere Einordnung war falsch. Ein konservativer Konverter schreibt sie um (363 → 20 verbleibend) und verweigert vier Formen: `for (var …)`-Schleifen (Block-Scoping aendert die Closure-Erfassung), oberste `var`, die absichtlich auf `window`/`self` leaken (gemessene Wunde: `var Module = core.module` nach let zu wandeln brach den Plot-Pfad des Workers), `var` in Kommentaren und Mehrfach-Deklarationen in einer Zeile. Jede Datei wird vor dem Schreiben von V8 kompiliert. Die einzige gemeldete Schwachstelle ist ebenfalls behoben, im Fork dieses Repos des Drittanbieter-Service-Workers: Nachrichten werden jetzt abgelehnt, wenn ihre Herkunft nicht uebereinstimmt, weil Upstream alles akzeptierte — jede Seite konnte den Worker abmelden oder COEP von `require-corp` auf `credentialless` abschwaechen. Beide tragen Selbsttests, beide wurden per Mutation geprueft, damit sie rot werden, und die Gate-Bank wuchs von 51 auf 53.

Die Bereinigung der von GitRoll gemeldeten Schuld ging weiter: ein konservativer `var`→`let`-Konverter senkte die 363 Befunde auf 20 und verweigert Formen, bei denen Block-Scoping das Verhalten aendern wuerde (`for (var …)`-Schleifen mit Closure-Erfassung, oberste `var`, die auf `window`/`self` leaken); der Fork dieses Repos eines Drittanbieter-Service-Workers lehnt nun Nachrichten fremder Herkunft ab. Die verbleibende Arbeit ist in Ticket 72 katalogisiert: 16 `for (var …)`-Stellen mit Einzelfallpruefung, 57 Komplexitaetsbefunde mit eigenem Refactoring-Plan und rund 447 Stilhinweise.

## Notiz zum Gate-Design

Eine Korrektur aus dem neuesten Schreiben von OpenModelica, festgehalten, weil sie aendert, wie dieses Repo Gates schreibt: das Bereitschaftsgatter der Produkt-Suite griff rund 400 ms *bevor* die Asset-Schicht etwas in MEMFS geschrieben hatte, wodurch drei Zusicherungen gegen ein funktionierendes Deployment fehlschlugen. OpenModelica loeste das, indem es darauf gatet, dass `/bridge` in MEMFS nicht leer ist, statt auf das globale Ready-Flag irgendeiner Site — und lehnte die Anregung dieses Repos, an `__octaveReady` zu binden, zu Recht ab: das ist das Implementierungsdetail einer Site und wuerde aus einer Lieferpruefung eine Selbstpruefung machen. Dasselbe Experiment legte zwei Defekte in der Ende-zu-Ende-Suite dieses Repos offen (sie stuerzte ab statt rot zu melden, wenn das Manifest fehlte, und warf einen Fehler, wenn `/bridge` nicht existierte); beide sind behoben, die Suite meldet nun 6/0 auf beiden Sites und 3 bestanden / 3 fehlgeschlagen auf einer absichtlich brueckenlosen Kontrollsite. Als wiederverwendbare Regel festgehalten: **auf einen Vertrag gaten, nicht auf die globale Variable einer Implementierung.**

## Lizenz

AGPL-3.0-or-later fuer den Build-Glue, den Browser-Host und die Aenderungen am
Octave-Fork. Octave selbst ist GPL-3.0-or-later; BLAS/LAPACK, SuiteSparse, FFTW und
verwandte Bibliotheken behalten ihre eigenen Lizenzen. Einige mitgelieferte Komponenten sind
GPL-2.0-only, was mit AGPL-3.0 unvereinbar ist, daher kann diese Kombination nur unter
AGPL-3.0 verteilt werden.

Dieses Programm ist freie Software: Sie koennen es unter den Bedingungen der GNU Affero
General Public License, wie von der Free Software Foundation veroeffentlicht (Version 3
oder jede spaetere Version), weiterverbreiten und/oder veraendern. Die Verteilung erfolgt
ohne jede Gewaehrleistung, nicht einmal der impliziten Gewaehrleistung der
Marktfaehigkeit oder Eignung fuer einen bestimmten Zweck.

Nach AGPL-3.0 §13 haben Nutzer, die ueber ein Netzwerk mit dem Programm interagieren,
Anspruch auf den zugehoerigen Quellcode: dieses Repository ist dieser Quellcode, und der
Build ist im `o113`-Container reproduzierbar. Lizenzen und Urheberrechte der einzelnen
Komponenten: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
