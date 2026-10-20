# Klecks

Ein modernes Paint für macOS und Windows. Alles, was das klassische Paint kann, in einer zeitgemäßen Oberfläche, und dazu die Werkzeuge, mit denen ein Bild in Sekunden bereit zur Weitergabe ist.

**Download:** [macOS](https://github.com/wl-lankin/klecks/releases/latest/download/Klecks-macOS.dmg) · [Windows](https://github.com/wl-lankin/klecks/releases/latest/download/Klecks-Windows-Setup.exe)

## Malen

- Pinsel (rund, Kalligrafie, weicher Airbrush, Sprühdose) mit Stiftdruck, Pixelstift, Radierer
- Fülleimer mit Toleranz, Pipette, zwei Farben (Rechtsklick malt mit der zweiten)
- Linien, Rechtecke, Ellipsen und Formen (Dreiecke, Raute, Vielecke, Stern, Herz, Sprechblase, Blockpfeil, Haken, Kreuz). Sie bleiben Objekte: verschieben, skalieren, umfärben, füllen
- Text in vier Schriften, wahlweise auf Etikett oder mit Kontur
- Bereich oder Lasso auswählen, herausheben und verschieben, kopieren, ausschneiden, leeren, zuschneiden, Farben umkehren
- Bildgröße, Zeichenfläche mit Anker, Drehen, Spiegeln, Graustufen
- Öffnen und Sichern als PNG, JPEG, WebP und BMP; mehrere Bilder als Tabs

## Weitergeben

- Schwung-Pfeile (auch gebogen), Nummern für Schritt-für-Schritt-Anleitungen, Textmarker
- Unkenntlich machen (verpixeln oder weichzeichnen) und Spotlight
- Schmuckrahmen mit Verlauf, Rand, Ecken und Schatten
- **Kopieren** (⌘/Strg+Shift+C) legt das fertige Bild direkt in die Zwischenablage
- Klecks liest die Zwischenablage nur, wenn du selbst einfügst

## Bedienung

Jedes Werkzeug hat ein Kürzel (Maus über das Werkzeug halten). ⌘/Strg+K öffnet die Befehlspalette, `?` zeigt alle Tastenkürzel. Leertaste halten verschiebt die Ansicht, Shift rastet Winkel und Proportionen ein, Alt zeichnet von der Mitte aus.

## Entwicklung

```bash
npm install
npm run tauri dev
```

Tauri 2, Rust und TypeScript ohne UI-Framework. Releases und automatische Updates: [docs/RELEASE.md](docs/RELEASE.md).
