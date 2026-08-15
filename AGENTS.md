# AGENTS.md

GAMINGZONE ist eine **statische** Arcade-Hub-Seite (kein Build, kein npm, kein Server). Vier Browser-Spiele, Deploy per GitHub Actions auf GitHub Pages.

**Vollständiger Chat-Stand (nicht von vorne):** [ARCHIVE.md](ARCHIVE.md)

## Pfade

- Lokal: `/Users/paashooting/aether-pulse`
- Repo: `github.com/michaelpaa/gamingzone`
- Live: https://michaelpaa.github.io/gamingzone/
- Cluck GP: https://michaelpaa.github.io/gamingzone/chicken/

| Spiel | Ordner |
| --- | --- |
| AETHER PULSE | `pulse/` |
| NEON KART | `kart/` |
| IRON FIST | `fight/` |
| SUPER CHICKEN 3D / CLUCK GP | `chicken/` |

## Pflichtregeln

- **Weiterbauen, nicht neu schreiben.** Hub und die vier Spiele existieren und sind live.
- Push auf **`main`** deployt Pages (`.github/workflows/pages.yml`). Kein force-push.
- Cluck GP: Three.js **nur** aus `chicken/vendor/` (Import-Map). Kein CDN-Boot.
- **HTML-Menü zuerst.** `#overlay` / ENGAGE darf nicht hinter einem Loader warten. `showMenu()` ist der erste Schritt nach THREE. Welt/Deko nach ENGAGE bzw. gechunkt nach dem ersten Frame. Keine Fake-Timeout-Labels (hangfix5 ist gescheitert).
- Cache-Bust bei `chicken/`-Änderungen: `game.js?v=…` und `style.css?v=…` in `chicken/index.html` erhöhen. Aktuell: `mario1` / `CLUCK_GP_MARIO1`.
- **Kein Nintendo.** Keine Super-Mario-ROMs, -Modelle, -Musik, -Tracks. Nur eigene Geometrie + Kenney CC0 (`chicken/assets/kenney/`, Credits in `chicken/assets/CREDITS.txt`).
- 18+: nur Opt-in, nicht speichern. Stilisierte Erwachsene, nie kindlich, nie Fotos echter Personen. Bei Treffer: Stöhnen + „aaaahhhh“.
- Lenkung: A / ← = links, D / → = rechts (war vertauscht). Zoom + FPV sitzen im Start-Overlay vor ENGAGE.

## Lokal

```bash
cd /Users/paashooting/aether-pulse
python3 -m http.server 8080
```

Hub `/`, Chicken `/chicken/`.
