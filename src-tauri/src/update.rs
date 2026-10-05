//! In-app updates. The game asks `update_check` on the title screen; if a newer signed release is
//! on GitHub it offers "Update & restart", which calls `update_install` and polls `update_progress`.
//!
//! The manifest (`latest.json`, built by .github/workflows/release.yml) carries one entry per install
//! type, and the updater picks `linux-x86_64-appimage`, `-deb`, `windows-x86_64-nsis`, or plain
//! `linux-x86_64` for the Omarchy/Arch tarball binary (which it simply swaps in place, no root).
//! Every download is verified against the public key in tauri.conf.json before it's installed.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    progress: Mutex<Progress>,
}

#[derive(Default, Clone, Serialize)]
pub struct Progress {
    /// idle | downloading | installing | restarting | error
    phase: String,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
    /// how this copy was installed: binary | appimage | deb | nsis | …
    installer: String,
}

fn installer() -> String {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    match bundle_type() {
        Some(BundleType::Deb) => "deb",
        Some(BundleType::Rpm) => "rpm",
        Some(BundleType::AppImage) => "appimage",
        Some(BundleType::Nsis) => "nsis",
        Some(BundleType::Msi) => "msi",
        Some(_) => "app",
        None => "binary",
    }
    .into()
}

#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, UpdateState>) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
        installer: installer(),
    });
    *state.pending.lock().unwrap() = update;
    Ok(info)
}

#[tauri::command]
pub fn update_progress(state: State<'_, UpdateState>) -> Progress {
    state.progress.lock().unwrap().clone()
}

/// Download, verify, install, restart. On Windows the installer takes over and closes the app.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state.pending.lock().unwrap().clone().ok_or("no update pending (check first)")?;
    let set = |f: &dyn Fn(&mut Progress)| f(&mut state.progress.lock().unwrap());
    set(&|p| *p = Progress { phase: "downloading".into(), ..Default::default() });
    let result = async {
        let bytes = update
            .download(
                |chunk, total| {
                    let mut p = state.progress.lock().unwrap();
                    p.downloaded += chunk as u64;
                    p.total = total;
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        set(&|p| p.phase = "installing".into());
        update.install(bytes).map_err(|e| e.to_string())
    }
    .await;
    if let Err(e) = result {
        set(&|p| { p.phase = "error".into(); p.error = Some(e.clone()); });
        return Err(e);
    }
    set(&|p| p.phase = "restarting".into());
    // give the UI a moment to show "restarting", then come back up as the new version
    tauri::async_runtime::spawn(async move {
        std::thread::sleep(std::time::Duration::from_millis(600));
        app.restart();
    });
    Ok(())
}

/// `BB_SELF_UPDATE=1`: check and install without any UI, logging to stdout (end-to-end test hook).
pub async fn self_update_for_test(app: AppHandle) {
    let state = tauri::Manager::state::<UpdateState>(&app);
    match update_check(app.clone(), state.clone()).await {
        Ok(Some(info)) => {
            println!("[update] {} -> {} ({})", info.current, info.version, info.installer);
            match update_install(app.clone(), state).await {
                Ok(()) => println!("[update] installed, restarting"),
                Err(e) => println!("[update] install failed: {e}"),
            }
        }
        Ok(None) => println!("[update] up to date ({})", app.package_info().version),
        Err(e) => println!("[update] check failed: {e}"),
    }
}
