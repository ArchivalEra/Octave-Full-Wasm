# Octave-Full-Wasm — `wasm32-final`

[English](README.md) · [中文](README.zh.md) · **Deutsch**

Dieser Branch ist **wasm32-final**: wasm32, ein Thread. Er ist die einzige Linie, die
**ohne COI** laeuft — kein `SharedArrayBuffer`, keine Cross-Origin-Isolation-Header, also
kann ihn jeder Browser auf jedem statischen Host ausliefern.

Die massgebliche README liegt im Branch `master`, in allen drei Sprachen:

- [English](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.md)
- [中文](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.zh.md)
- [Deutsch](https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/README.de.md)

Dort werden der Vergleich der drei Linien, die Leistungstabelle, die numerische Bewertung,
die Architekturhinweise und die Bauanleitung gepflegt. Dieser Branch fuehrt keine eigene
Kopie: drei Kopien sind bereits einmal auseinandergedriftet, und die Kopie, die Besucher
tatsaechlich sahen — der GitHub-Standardbranch —, war die aelteste.

## Diese Linie konkret

| | |
|---|---|
| Ziel | wasm32, ein Thread |
| Voraussetzung | keine — keine COI-Header |
| Site-Zelle | `base` |
| Freie Software | ja |
| Letzter Commit | 2026-10-12; Artefakte ab dort eingefroren |

Zum Vergleich: `master` (wasm64 + Threads, COI erforderlich) und `IllegalPerformance`
(wasm64 + Threads + Rust-Kernel, non-free). Die Aufteilung richtet sich nach
Erreichbarkeit fuer Nutzer und Lizenzierung, nie nach Leistung.

Ob diese Linie neu gestartet wird, ist eine Produktentscheidung, keine Dokumententscheidung.