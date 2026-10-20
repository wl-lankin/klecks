//! Automatic updates through the Tauri updater: a check shortly after start and every six hours and
//! a background download. An update never interrupts work: on macOS the new bundle is swapped in
//! right away and takes effect on the next launch, on Windows the installer runs when Klecks quits
//! (or when the user clicks "restart" in the top bar).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK_AFTER: Duration = Duration::from_secs(20);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_ERROR: usize = 160;

/// `state` is one of: idle, checking, current, downloading, ready (restart applies it), error.
#[derive(Clone, Serialize)]
pub struct Status {
    state: &'static str,
    version: Option<String>,
    message: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Status { state: "idle", version: None, message: None }
    }
}

#[derive(Default)]
pub struct Updates {
    status: Mutex<Status>,
    /// Windows only: the downloaded installer, run on quit or restart.
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    busy: AtomicBool,
}

struct Busy<'a>(&'a AtomicBool);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn short_error(err: &dyn std::fmt::Display) -> String {
    let line = err.to_string();
    let line = line.lines().next().unwrap_or("Unbekannter Fehler").trim().to_string();
    if line.chars().count() <= MAX_ERROR {
        return line;
    }
    let mut out: String = line.chars().take(MAX_ERROR - 1).collect();
    out.push('…');
    out
}

fn set_status(app: &AppHandle, state: &'static str, version: Option<String>, message: Option<String>) {
    let status = Status { state, version, message };
    *app.state::<Updates>().status.lock().unwrap() = status.clone();
    let _ = app.emit("update-state", status);
}

async fn check_cycle(app: &AppHandle, manual: bool) {
    let updates = app.state::<Updates>();
    if updates.status.lock().unwrap().state == "ready" || updates.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let _busy = Busy(&updates.busy);
    if manual {
        set_status(app, "checking", None, None);
    }
    let found = match app.updater() {
        Ok(updater) => updater.check().await.map_err(|e| short_error(&e)),
        Err(e) => Err(short_error(&e)),
    };
    let update = match found {
        Err(msg) => {
            eprintln!("[klecks] Update-Prüfung fehlgeschlagen: {msg}");
            set_status(app, if manual { "error" } else { "idle" }, None, manual.then_some(msg));
            return;
        }
        Ok(None) => {
            set_status(app, "current", None, None);
            return;
        }
        Ok(Some(update)) => update,
    };
    let version = update.version.clone();
    set_status(app, "downloading", Some(version.clone()), None);
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            let msg = short_error(&e);
            eprintln!("[klecks] Update {version}: Download fehlgeschlagen: {msg}");
            set_status(app, "error", Some(version), Some(msg));
            return;
        }
    };
    if cfg!(target_os = "windows") {
        *updates.pending.lock().unwrap() = Some((update, bytes));
        set_status(app, "ready", Some(version), None);
        return;
    }
    let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match result {
        Ok(Ok(())) => set_status(app, "ready", Some(version), None),
        Ok(Err(e)) => set_status(app, "error", Some(version), Some(short_error(&e))),
        Err(e) => set_status(app, "error", Some(version), Some(short_error(&e))),
    }
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            check_cycle(&app, false).await;
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// Runs the pending Windows installer; it ends this process. False if there is nothing to install.
fn run_pending_installer(app: &AppHandle) -> bool {
    let pending = app.state::<Updates>().pending.lock().unwrap().take();
    match pending {
        Some((update, bytes)) => match update.install(bytes) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[klecks] Update-Installation fehlgeschlagen: {}", short_error(&e));
                false
            }
        },
        None => false,
    }
}

#[tauri::command]
pub fn update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move { check_cycle(&app, true).await });
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    app.state::<Updates>().status.lock().unwrap().clone()
}

/// The frontend calls this after the user confirmed there is nothing left to save.
#[tauri::command]
pub fn update_restart(app: AppHandle) {
    if !run_pending_installer(&app) {
        app.restart();
    }
}

/// Called right before the window closes, after unsaved work was handled.
#[tauri::command]
pub fn update_on_quit(app: AppHandle) {
    run_pending_installer(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_are_one_short_line() {
        assert_eq!(short_error(&"a\nb"), "a");
        assert_eq!(short_error(&"x".repeat(500)).chars().count(), MAX_ERROR);
    }
}
