# Release und automatische Updates

Klecks aktualisiert sich selbst, ohne die Arbeit zu unterbrechen. Die installierte App fragt 20 Sekunden nach dem Start und danach alle sechs Stunden bei GitHub nach `latest.json` und lädt eine neuere Version im Hintergrund. Die Signatur wird geprüft.

- **macOS:** Das neue App-Bundle wird sofort eingesetzt und gilt ab dem nächsten Start. In der Titelleiste erscheint „Version X ist bereit · Neu starten“.
- **Windows:** Der Installer wird bereitgehalten und läuft beim Beenden von Klecks (oder sofort per „Neu starten“).

Haben Bilder ungespeicherte Änderungen, fragt Klecks vor dem Neustart nach. Nach dem Update meldet Klecks einmal „Klecks wurde auf Version X aktualisiert“. Von Hand prüfen: Menü „Klecks“ → „Nach Updates suchen …“ oder über die Befehlspalette.

## Aufbau

| Teil | Wo |
|---|---|
| Updater im Code | `src-tauri/src/updates.rs`, Oberfläche in `src/main.ts` (`initUpdates`) |
| Endpunkt, öffentlicher Schlüssel, Windows `passive` | `src-tauri/tauri.conf.json`, Abschnitt `plugins.updater` |
| Signierte Update-Dateien erzeugen | `src-tauri/tauri.updater.conf.json` (nur in der Pipeline) |
| Pipeline | `.github/workflows/release.yml` |
| Release-Text | Abschnitt `## X.Y.Z` in `CHANGELOG.md`, sonst die Nachricht des Tags |

## Dateien im Release

Jeder Installer liegt doppelt im Release: einmal mit Versionsnummer, einmal unter festem Namen für Links von der Website.

| Datei | Zweck |
|---|---|
| `Klecks_X.Y.Z_universal.dmg` | macOS, Apple Silicon und Intel |
| `Klecks-macOS.dmg` | dasselbe, fester Name |
| `Klecks_X.Y.Z_x64-setup.exe` (+ `.sig`) | Windows-Installer, auch für den Updater |
| `Klecks-Windows-Setup.exe` | dasselbe, fester Name |
| `Klecks.app.tar.gz` (+ `.sig`) | macOS-Update |
| `latest.json` | Manifest für den Updater (`darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`) |

Feste Links für die Website:

- https://github.com/wl-lankin/klecks/releases/latest/download/Klecks-macOS.dmg
- https://github.com/wl-lankin/klecks/releases/latest/download/Klecks-Windows-Setup.exe

## Wo der Schlüssel liegt

- Privat: `~/.tauri/klecks-updater.key`, Passwort in `~/.tauri/klecks-updater.pass`. Nur auf diesem Mac und in den GitHub-Secrets `TAURI_SIGNING_PRIVATE_KEY` und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Nie committen (`.gitignore` schließt `*.key` und `*.pass` aus).
- Öffentlich: `~/.tauri/klecks-updater.key.pub`, steht in `tauri.conf.json`.
- Geht der private Schlüssel verloren, nehmen installierte Apps keine Updates mehr an. Deshalb Schlüssel und Passwort zusätzlich im Passwortmanager sichern.

## Ein Release erstellen

1. Version erhöhen, überall gleich: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. Abschnitt `## X.Y.Z` oben in `CHANGELOG.md` ergänzen.
3. Committen und pushen, CI muss grün sein.
4. Tag setzen und pushen:
   ```bash
   git tag -a v1.1.0 -m "Klecks 1.1.0"
   git push origin v1.1.0
   ```
   Ein Tag mit Bindestrich (`v1.1.0-beta.1`) wird als Vorabversion markiert; die Version in den Dateien bleibt rein numerisch.
5. Lauf „Release“ unter Actions abwarten (macOS, danach Windows).
6. Entwurf prüfen (Dateien siehe oben, `latest.json` mit `signature` und `url` je Plattform) und veröffentlichen:
   ```bash
   gh release edit v1.1.0 --draft=false --latest
   ```
   Erst dann sehen installierte Apps das Update.

## Einschränkungen

- TODO Apple-Notarisierung: Das DMG ist nicht signiert. Beim ersten Öffnen: Systemeinstellungen, Datenschutz und Sicherheit, „Trotzdem öffnen“, oder `xattr -dr com.apple.quarantine /Applications/Klecks.app`. Updates sind davon nicht betroffen.
- TODO Windows-Signierung (Azure Artifact Signing, wie bei den anderen Apps): Bis dahin meldet sich SmartScreen beim ersten Start.
