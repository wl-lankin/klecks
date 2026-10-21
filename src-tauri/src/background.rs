//! Klecks keeps running in the background so the snipping shortcut always works: it starts hidden
//! at login, closing the window only hides it, and a tray (Windows) / menu bar (macOS) icon opens
//! it again. On macOS the Dock icon disappears while the window is hidden.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

pub const BACKGROUND_ARG: &str = "--background";

pub fn started_in_background() -> bool {
    std::env::args().any(|a| a == BACKGROUND_ARG)
}

pub fn show_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// From any thread: window and activation-policy changes belong on the main thread.
pub fn show_main_soon(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || show_main(&handle));
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "Klecks öffnen", true, None::<&str>)?;
    let snip = MenuItem::with_id(app, "tray-snip", "Bildschirmausschnitt aufnehmen", true, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let login = CheckMenuItem::with_id(app, "tray-login", "Beim Anmelden starten", true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Klecks beenden", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&open, &snip, &sep()?, &login, &sep()?, &quit])?;

    let shortcut = if cfg!(target_os = "macos") { "⌃⇧⌘K" } else { "Win+Shift+K" };
    let login_item = login.clone();
    let mut builder = TrayIconBuilder::with_id("klecks")
        .tooltip(format!("Klecks · Ausschnitt mit {shortcut}"))
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(move |app: &AppHandle, event| match event.id.as_ref() {
            "tray-open" => show_main(app),
            "tray-snip" => crate::snip::start(app),
            "tray-login" => {
                let on = !app.autolaunch().is_enabled().unwrap_or(false);
                set_autostart(app, on);
                let _ = login_item.set_checked(app.autolaunch().is_enabled().unwrap_or(on));
            }
            "tray-quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if !cfg!(target_os = "macos") {
                    show_main(tray.app_handle());
                }
            }
        });
    #[cfg(target_os = "macos")]
    {
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
        builder = builder.icon(icon).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// The frontend decides: it asks about unsaved images, then calls `app_quit`.
pub fn request_quit(app: &AppHandle) {
    let _ = app.emit_to("main", "quit-request", ());
}

pub fn set_autostart(app: &AppHandle, on: bool) {
    let result = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
    if let Err(e) = result {
        eprintln!("[klecks] Autostart: {e}");
    }
    #[cfg(target_os = "macos")]
    if on {
        associate_bundle(app);
    }
}

/// On the very first run autostart is switched on, so the shortcut works without opening Klecks.
/// Later the user's choice stands.
pub fn init_autostart(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join("autostart-initialized");
    if marker.exists() {
        // Rewrite the entry, so it follows the app when it was moved or updated.
        if app.autolaunch().is_enabled().unwrap_or(false) {
            set_autostart(app, true);
        }
        return;
    }
    set_autostart(app, true);
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&marker, b"1");
}

/// Names the app in the LaunchAgent, so the Login Items list shows "Klecks" instead of a path.
#[cfg(target_os = "macos")]
fn associate_bundle(app: &AppHandle) {
    let Some(home) = std::env::var_os("HOME") else { return };
    let name = &app.package_info().name;
    let plist = std::path::PathBuf::from(home).join("Library").join("LaunchAgents").join(format!("{name}.plist"));
    let Ok(text) = std::fs::read_to_string(&plist) else { return };
    if let Some(fixed) = with_bundle_id(&text, &app.config().identifier) {
        let _ = std::fs::write(&plist, fixed);
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn with_bundle_id(plist: &str, identifier: &str) -> Option<String> {
    const KEY: &str = "<key>AssociatedBundleIdentifiers</key>";
    const EMPTY: &str = "<array></array>";
    let after_key = plist.find(KEY)? + KEY.len();
    let rest = &plist[after_key..];
    let start = after_key + (rest.len() - rest.trim_start().len());
    if !plist[start..].starts_with(EMPTY) {
        return None;
    }
    Some(format!("{}<array><string>{identifier}</string></array>{}", &plist[..start], &plist[start + EMPTY.len()..]))
}

#[tauri::command]
pub fn autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, on: bool) -> bool {
    set_autostart(&app, on);
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn show_window(app: AppHandle) {
    show_main(&app);
}

/// Really ends Klecks. On Windows a downloaded update installs on the way out.
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    crate::updates::install_pending_on_quit(&app);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::with_bundle_id;

    #[test]
    fn names_the_bundle_once() {
        let plist = "<key>AssociatedBundleIdentifiers</key>\n<array></array>";
        let fixed = with_bundle_id(plist, "de.wlankin.klecks").unwrap();
        assert!(fixed.contains("<string>de.wlankin.klecks</string>"));
        assert!(with_bundle_id(&fixed, "de.wlankin.klecks").is_none());
    }
}
