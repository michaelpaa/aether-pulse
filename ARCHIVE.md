# GAMINGZONE — Chat-Archiv / New-Chat-Brief

Stand: 15. August 2026. Dieser Chat ist zu lang; **nicht von vorne neu bauen**.

Lokaler Ordner: `/Users/paashooting/aether-pulse`  
GitHub: https://github.com/michaelpaa/gamingzone  
Live-Hub: https://michaelpaa.github.io/gamingzone/

Neuer Chat: Repo öffnen, diese Datei plus `AGENTS.md` verlinken oder „lies ARCHIVE.md“ schreiben.

---

## Was das Projekt ist

Statische Arcade-Hub-Seite **GAMINGZONE** (früher AETHER PULSE / ARENA TRIPLE). Kein Server, kein Build, kein npm. GitHub Actions deployt bei Push auf `main` nach GitHub Pages.

Vier Spiele:

| # | Name | Pfad | Live | Genre |
|---|------|------|------|--------|
| 1 | **AETHER PULSE** | `pulse/` | https://michaelpaa.github.io/gamingzone/pulse/ | Neon-Arena-Shooter |
| 2 | **NEON KART** | `kart/` | https://michaelpaa.github.io/gamingzone/kart/ | Drift-Racer mit Bordkanone (10 Treffer = langsamer) |
| 3 | **IRON FIST** | `fight/` | https://michaelpaa.github.io/gamingzone/fight/ | Tekken-Style, Best-of-3 |
| 4 | **SUPER CHICKEN 3D / CLUCK GP** | `chicken/` | https://michaelpaa.github.io/gamingzone/chicken/ | 3D-Kart-Hybrid, echte GLBs |

Hub: `index.html` + `css/hub.css`. Zurück-Link in jedem Spiel: `← ZONE` → `../`.

Mobile: virtuelle Joysticks + Aktionstasten (iPhone). Desktop: Tastatur-Overlay neben dem Spiel.

---

## Super Chicken 3D / Cluck GP (aktueller Fokus)

Aktueller Build: **`CLUCK_GP_MARIO1`** (`window.CLUCK_GP_BUILD`, Cache-Bust `?v=mario1` in `chicken/index.html`).

Commit: `9ef2799` — *Rebuild Cluck GP as an original sky-isle lap with camera setup and unswapped steer.*

### Steuerung

- **WASD / Pfeile:** Gas, Bremse, Lenken (A / ← = links, D / → = rechts — war vertauscht, ist gefixt)
- **Leertaste:** schießen
- **Q:** Waffe wechseln (Egg / Homing Corn / Feather)
- **Shift / E:** Boost (lädt sich auf)
- Mobile: Joystick lenken · GAS · BRAKE · BOOST · FIRE · WEAPON

3 Runden, 4 Fahrer, Item-Boxen, Boost-Pads, Sprung, Fall-Reset.

### Kamera vor dem Start

Im Start-Overlay (bevor **ENGAGE**):

- Zoom-Slider Nah ↔ Fern (`#cam-zoom`)
- Toggle **CHASE** vs **FIRST PERSON** (FPV / Hood)
- Gilt live für die geparkte Figur und für das Rennen

### 18+ Opt-in

- Standard: lustige Cartoon-Hühner (Chickensoft-Maskottchen, CC BY 4.0) auf Kenney-CC0-Karts
- Button **18+ UNLOCK ADULT** (Menü) oder **18+ CHICKENS** (HUD)
- Bestätigen im Dialog, **nicht gespeichert** (kein localStorage)
- Stilisierte erwachsene Fahrerinnen (`venus` / `ivy` / `sienna` / `lola.glb`) — nie kindlich, nie Fotos echter Personen

### Treffer in 18+

- Synthetisches Stöhnen (`playMoan()` in `chicken/game.js`)
- Floating-Text **aaaahhhh** / **aah!** (`#hit-floats`)

### Assets — Kenney, nicht Nintendo

Michael wollte „Super Mario rein coden“. **Nicht tun:** keine Nintendo-/Mario-ROMs, -Modelle, -Musik, -Tracks, -Texturen.

Stattdessen: **eigene Sky-Isle-Runde** + vendorte **Kenney CC0**-Packs unter `chicken/assets/kenney/` (Platformer, Nature, Racing, Car Kit). Credits: `chicken/assets/CREDITS.txt`.

Three.js ist **lokal** unter `chicken/vendor/` (kein CDN beim Boot). Import-Map in `chicken/index.html`.

---

## Bekannte Hänger (nicht wiederholen)

Cluck GP hing mehrfach beim Öffnen. Die Fixes sind schon live — **keine neuen Timeout-Labels** als Scheinlösung.

| Phase | Symptom | Ursache | Fix |
|-------|---------|---------|-----|
| CDN | „3D-Engine hängt (CDN)“ | Three.js von CDN | `a728abd` — Three.js vendored |
| Modelle | Loader bei ~0 %, „Lade echte 3D-Modelle…“ | fehlende Kart-Texturen / Adult-GLBs, Loader wartet ewig | `c2b295f` — fehlende Assets nicht blockieren |
| Texturen | Loader ~60 %, „Lade Strecke… Timeout 8s“ | Timeout zeigte nur Text, Boot endete nicht | `bde4511` — prozedurale Strecke, Menü ohne Texture-Wait |
| Track-Boot / hangfix5 | „Starte Strecke…“ für immer | `buildWorld()` synchron **vor** `showMenu()`, Loader lag über ENGAGE | `83c754c` **hangfix6**: ENGAGE liegt in HTML, `showMenu()` als Erstes nach THREE |
| mario1 | billige Ring-Strecke | Wunsch nach Mario-Look | `9ef2799` — eigene Sky-Isle, Kenney-Props idle-only, Deko nach erstem Frame |

Regel: **HTML-Menü zuerst sichtbar.** Loader ist `hidden`. Welt/Deko erst nach ENGAGE bzw. nach dem ersten Frame, gechunkt. `showMenu()` steht direkt nach den DOM-Refs in `chicken/game.js`.

---

## Deploy

- Branch: **`main`** (Pages-Workflow `.github/workflows/pages.yml` bei jedem Push)
- Nach Code-Änderung: auf `main` committen, pushen, Cache-Bust in `chicken/index.html` erhöhen (`?v=…`)
- Lokal: Ordner als statische Site serven, oder Dateien direkt öffnen (Module brauchen einen lokalen Server)

```bash
cd /Users/paashooting/aether-pulse
python3 -m http.server 8080
# http://127.0.0.1:8080/chicken/
```

---

## Weiter im neuen Chat

1. Workspace: `/Users/paashooting/aether-pulse` (Remote `michaelpaa/gamingzone`).
2. `ARCHIVE.md` und `AGENTS.md` lesen — Code liegt schon da.
3. Live prüfen: https://michaelpaa.github.io/gamingzone/chicken/ (Build-String `CLUCK_GP_MARIO1` in der Konsole).
4. Nicht neu scaffolden. Nicht Three.js wieder auf CDN setzen. Kein Nintendo-Content.

Offene Richtung (letzter Wunsch vor Archiv): Strecke teurer/mario-artiger mit freien Packs, Lenkung/Zoom/FPV/18+-Stöhnen beibehalten.
