mod updates;

use std::borrow::Cow;
use tauri::ipc::{InvokeBody, Request, Response};

fn header_path(request: &Request) -> Result<String, String> {
    let raw = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing path")?;
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|e| e.to_string())
}

fn raw_body<'a>(request: &'a Request) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("expected binary body".into()),
    }
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = header_path(&request)?;
    std::fs::write(&path, raw_body(&request)?).map_err(|e| e.to_string())
}

/// Takes PNG bytes and puts them on the system clipboard as a real image.
#[tauri::command]
fn copy_image(request: Request<'_>) -> Result<(), String> {
    let img = image::load_from_memory_with_format(raw_body(&request)?, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?
        .into_rgba8();
    let (width, height) = img.dimensions();
    arboard::Clipboard::new()
        .and_then(|mut cb| {
            cb.set_image(arboard::ImageData {
                width: width as usize,
                height: height as usize,
                bytes: Cow::Owned(img.into_raw()),
            })
        })
        .map_err(|e| e.to_string())
}

/// Only called when the user explicitly pastes. Returns width, height (u32 LE) followed by RGBA.
#[tauri::command]
fn paste_image() -> Result<Response, String> {
    let img = arboard::Clipboard::new()
        .and_then(|mut cb| cb.get_image())
        .map_err(|_| "no image on clipboard".to_string())?;
    let mut out = Vec::with_capacity(8 + img.bytes.len());
    out.extend_from_slice(&(img.width as u32).to_le_bytes());
    out.extend_from_slice(&(img.height as u32).to_le_bytes());
    out.extend_from_slice(&img.bytes);
    Ok(Response::new(out))
}

/// The full native menu bar. Every Klecks item emits a "menu" event with the command id, so a key
/// equivalent caught by the menu ends up in the same command as a key press in the webview.
/// Only the size, for presetting a new canvas when the user opens that dialog.
#[tauri::command]
async fn clipboard_image_size() -> Option<(u32, u32)> {
    let img = arboard::Clipboard::new().ok()?.get_image().ok()?;
    Some((img.width as u32, img.height as u32))
}

#[cfg(target_os = "macos")]
fn mac_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::Wry;
    let h = app.handle();
    let item = |id: &str, text: &str, acc: Option<&str>| -> tauri::Result<MenuItem<Wry>> {
        MenuItem::with_id(h, id, text, true, acc)
    };
    let sep = || PredefinedMenuItem::separator(h);
    let sub = |title: &str, items: &[&dyn IsMenuItem<Wry>]| Submenu::with_items(h, title, true, items);

    let app_menu = sub(
        "Klecks",
        &[
            &item("about", "Über Klecks", None)?,
            &item("updates", "Nach Updates suchen …", None)?,
            &sep()?,
            &PredefinedMenuItem::hide(h, Some("Klecks ausblenden"))?,
            &PredefinedMenuItem::hide_others(h, Some("Andere ausblenden"))?,
            &PredefinedMenuItem::show_all(h, Some("Alle einblenden"))?,
            &sep()?,
            &PredefinedMenuItem::quit(h, Some("Klecks beenden"))?,
        ],
    )?;
    let file = sub(
        "Ablage",
        &[
            &item("new", "Neue Leinwand …", Some("CmdOrCtrl+N"))?,
            &item("open", "Bild öffnen …", Some("CmdOrCtrl+O"))?,
            &item("pasteNew", "Als neues Bild einfügen", Some("CmdOrCtrl+Shift+V"))?,
            &sep()?,
            &item("save", "Sichern", Some("CmdOrCtrl+S"))?,
            &item("saveAs", "Sichern unter …", Some("CmdOrCtrl+Shift+S"))?,
            &item("copyImage", "Fertiges Bild kopieren", Some("CmdOrCtrl+Shift+C"))?,
            &sep()?,
            &item("closeTab", "Bild schließen", Some("CmdOrCtrl+W"))?,
        ],
    )?;
    // Cut, Copy and Paste stay native so text fields keep working; the webview turns them into
    // copy/cut/paste DOM events, which Klecks handles outside of text fields.
    let edit = sub(
        "Bearbeiten",
        &[
            &item("undo", "Rückgängig", Some("CmdOrCtrl+Z"))?,
            &item("redo", "Wiederholen", Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(h, Some("Ausschneiden"))?,
            &PredefinedMenuItem::copy(h, Some("Kopieren"))?,
            &PredefinedMenuItem::paste(h, Some("Einfügen"))?,
            &item("duplicate", "Duplizieren", Some("CmdOrCtrl+D"))?,
            &item("selectAll", "Alles auswählen", Some("CmdOrCtrl+A"))?,
            &sep()?,
            &item("palette", "Befehlspalette …", Some("CmdOrCtrl+K"))?,
        ],
    )?;
    let image = sub(
        "Bild",
        &[
            &item("resize", "Bildgröße …", Some("CmdOrCtrl+Alt+I"))?,
            &item("canvas", "Zeichenfläche …", Some("CmdOrCtrl+Alt+C"))?,
            &item("cropSel", "Auf Auswahl zuschneiden", Some("CmdOrCtrl+Shift+X"))?,
            &sep()?,
            &item("rotCW", "Um 90° nach rechts drehen", None)?,
            &item("rotCCW", "Um 90° nach links drehen", None)?,
            &item("rot180", "Um 180° drehen", None)?,
            &item("flipH", "Horizontal spiegeln", None)?,
            &item("flipV", "Vertikal spiegeln", None)?,
            &sep()?,
            &item("invert", "Farben umkehren", Some("CmdOrCtrl+Shift+I"))?,
            &item("gray", "Graustufen", None)?,
            &item("flatten", "Markierungen ins Bild übernehmen", Some("CmdOrCtrl+E"))?,
            &sep()?,
            &item("frame", "Schmuckrahmen ein/aus", Some("CmdOrCtrl+B"))?,
        ],
    )?;
    let view = sub(
        "Ansicht",
        &[
            &item("zoomIn", "Vergrößern", Some("CmdOrCtrl+="))?,
            &item("zoomOut", "Verkleinern", Some("CmdOrCtrl+-"))?,
            &item("fit", "Ins Fenster einpassen", Some("CmdOrCtrl+0"))?,
            &item("actual", "Originalgröße", Some("CmdOrCtrl+1"))?,
            &sep()?,
            &item("theme", "Hell/Dunkel wechseln", None)?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(h, Some("Vollbild"))?,
        ],
    )?;
    let window = sub(
        "Fenster",
        &[
            &PredefinedMenuItem::minimize(h, Some("Im Dock ablegen"))?,
            &PredefinedMenuItem::maximize(h, Some("Zoomen"))?,
        ],
    )?;
    let help = sub("Hilfe", &[&item("shortcuts", "Tastenkürzel", None)?])?;
    app.set_menu(Menu::with_items(h, &[&app_menu, &file, &edit, &image, &view, &window, &help])?)?;
    app.on_menu_event(|app, event| {
        let _ = tauri::Emitter::emit(app, "menu", event.id().0.as_str());
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(updates::Updates::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            mac_menu(app)?;
            if !cfg!(debug_assertions) {
                updates::spawn(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            copy_image,
            paste_image,
            clipboard_image_size,
            updates::update_check,
            updates::update_status,
            updates::update_restart,
            updates::update_on_quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Klecks");
}
