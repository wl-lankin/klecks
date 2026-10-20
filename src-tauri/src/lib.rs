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

#[cfg(target_os = "macos")]
fn mac_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
    let h = app.handle();
    // No "Close Window" item, so Cmd+W stays free for closing tabs.
    let app_menu = Submenu::with_items(
        h,
        "Klecks",
        true,
        &[
            &PredefinedMenuItem::about(h, None, None)?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::hide(h, None)?,
            &PredefinedMenuItem::hide_others(h, None)?,
            &PredefinedMenuItem::show_all(h, None)?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::quit(h, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        h,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(h, None)?,
            &PredefinedMenuItem::redo(h, None)?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::cut(h, None)?,
            &PredefinedMenuItem::copy(h, None)?,
            &PredefinedMenuItem::paste(h, None)?,
            &PredefinedMenuItem::select_all(h, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        h,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(h, None)?,
            &PredefinedMenuItem::maximize(h, None)?,
            &PredefinedMenuItem::fullscreen(h, None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(h, &[&app_menu, &edit, &window])?)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            updates::update_check,
            updates::update_status,
            updates::update_restart,
            updates::update_on_quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Klecks");
}
