//! Screen snipping: a global shortcut lets the user cut out a part of the screen, which then opens
//! in Klecks as a new image. macOS uses the system's own region picker (`screencapture -i`); on
//! Windows Klecks photographs the monitor under the cursor and lays its own picker window over it.

#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct Snip {
    /// Windows: the frozen monitor picture the picker window shows (width, height, RGBA).
    #[allow(dead_code)]
    shot: Mutex<Option<(u32, u32, Vec<u8>)>>,
    /// The finished cut-out as PNG, until the main window fetches it.
    result: Mutex<Option<Vec<u8>>>,
    /// macOS: the system picker is open, so a second shortcut press does nothing.
    #[allow(dead_code)]
    busy: AtomicBool,
}

fn deliver(app: &AppHandle, png: Vec<u8>) {
    *app.state::<Snip>().result.lock().unwrap() = Some(png);
    crate::background::show_main_soon(app);
    let _ = app.emit_to("main", "snip-ready", ());
}

#[cfg(target_os = "macos")]
pub fn start(app: &AppHandle) {
    if app.state::<Snip>().busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        struct Done(AppHandle);
        impl Drop for Done {
            fn drop(&mut self) {
                self.0.state::<Snip>().busy.store(false, Ordering::SeqCst);
            }
        }
        let _done = Done(app.clone());
        let path = std::env::temp_dir().join(format!("klecks-snip-{}.png", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let status = std::process::Command::new("/usr/sbin/screencapture").arg("-i").arg("-x").arg(&path).status();
        // Escape in the system picker leaves no file behind; that is a normal cancel.
        if status.is_ok() {
            if let Ok(png) = std::fs::read(&path) {
                let _ = std::fs::remove_file(&path);
                deliver(&app, png);
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn start(app: &AppHandle) {
    use tauri::{PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

    if app.get_webview_window("snip").is_some() {
        return;
    }
    let (cx, cy) = app.cursor_position().map(|p| (p.x as i32, p.y as i32)).unwrap_or((0, 0));
    let monitor = match xcap::Monitor::from_point(cx, cy).or_else(|_| {
        xcap::Monitor::all().and_then(|all| all.into_iter().next().ok_or(xcap::XCapError::new("no monitor")))
    }) {
        Ok(m) => m,
        Err(e) => return eprintln!("[klecks] Bildschirm nicht gefunden: {e}"),
    };
    let img = match monitor.capture_image() {
        Ok(img) => img,
        Err(e) => return eprintln!("[klecks] Bildschirmaufnahme fehlgeschlagen: {e}"),
    };
    let (w, h) = (img.width(), img.height());
    *app.state::<Snip>().shot.lock().unwrap() = Some((w, h, img.into_raw()));
    let (mx, my) = (monitor.x().unwrap_or(0), monitor.y().unwrap_or(0));
    let built = WebviewWindowBuilder::new(app, "snip", WebviewUrl::App("snip.html".into()))
        .title("Klecks Ausschnitt")
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(true)
        .build();
    match built {
        Ok(win) => {
            let _ = win.set_position(PhysicalPosition::new(mx, my));
            let _ = win.set_size(PhysicalSize::new(w, h));
        }
        Err(e) => eprintln!("[klecks] Auswahlfenster fehlgeschlagen: {e}"),
    }
}

#[tauri::command]
pub fn snip_start(app: AppHandle) {
    start(&app);
}

/// The frozen monitor picture for the picker: width and height (u32 LE), then RGBA.
#[tauri::command]
pub fn snip_shot(app: AppHandle) -> Result<Response, String> {
    let state = app.state::<Snip>();
    let guard = state.shot.lock().unwrap();
    let (w, h, rgba) = guard.as_ref().ok_or("no shot")?;
    let mut out = Vec::with_capacity(8 + rgba.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(rgba);
    Ok(Response::new(out))
}

/// The picker has drawn the picture; now it may appear without flashing an empty window.
#[tauri::command]
pub fn snip_show(window: tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn close_picker(app: &AppHandle) {
    *app.state::<Snip>().shot.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window("snip") {
        let _ = w.close();
    }
}

#[tauri::command]
pub fn snip_cancel(app: AppHandle) {
    close_picker(&app);
}

/// Crops the frozen picture to the chosen rectangle (in image pixels) and hands it to Klecks.
#[tauri::command]
pub fn snip_finish(app: AppHandle, x: u32, y: u32, width: u32, height: u32) -> Result<(), String> {
    let png = {
        let state = app.state::<Snip>();
        let guard = state.shot.lock().unwrap();
        let (w, h, rgba) = guard.as_ref().ok_or("no shot")?;
        let img = image::RgbaImage::from_raw(*w, *h, rgba.clone()).ok_or("bad shot")?;
        let x = x.min(w - 1);
        let y = y.min(h - 1);
        let cut = image::imageops::crop_imm(&img, x, y, width.clamp(1, w - x), height.clamp(1, h - y)).to_image();
        let mut png = Vec::new();
        cut.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| e.to_string())?;
        png
    };
    close_picker(&app);
    deliver(&app, png);
    Ok(())
}

#[tauri::command]
pub fn take_snip(app: AppHandle) -> Result<Response, String> {
    app.state::<Snip>().result.lock().unwrap().take().map(Response::new).ok_or_else(|| "no snip".into())
}
