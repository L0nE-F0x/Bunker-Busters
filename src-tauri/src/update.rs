//! In-app updates. The game asks `update_check` on the title screen; if a newer signed release is
//! on GitHub it offers "Update & restart", which calls `update_install` and polls `update_progress`.
//!
//! The manifest (`latest.json`, built by .github/workflows/release.yml) carries one entry per install
//! type, and the updater picks `linux-x86_64-appimage`, `-deb`, `windows-x86_64-nsis`, or plain
//! `linux-x86_64` for the Omarchy/Arch tarball binary (which it simply swaps in place, no root).
//! Every download is verified against the public key in tauri.conf.json before it's installed, and
//! `requireSignedVersion` there makes each signature name the version it was made for, so an old
//! release can't be passed off as a new one.
//!
//! Failures leave the installed game as it was: a check that fails just means "no update" (the card
//! never shows), and an install that fails says why in one line on the card (`plain`), with the full
//! error on stdout.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

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

pub(crate) fn installer() -> String {
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

/// The updater with time limits: the manifest request gives up after 30 s, and a connection that
/// stops sending for a minute fails the download instead of leaving the card on "Downloading…".
fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    app.updater_builder()
        .timeout(Duration::from_secs(30))
        .configure_client(|client| client.connect_timeout(Duration::from_secs(20)).read_timeout(Duration::from_secs(60)))
        .build()
}

/// One line for the player; the full error goes to stdout.
fn plain(e: &tauri_plugin_updater::Error) -> String {
    use std::io::ErrorKind;
    use tauri_plugin_updater::Error as E;
    match e {
        E::Network(status) if status.contains("404") => "The update isn't on GitHub yet. Try again in a few minutes.",
        E::Network(_) | E::Reqwest(_) => "The download didn't finish. Check your connection and try again.",
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => {
            "The download failed its signature check, so nothing was installed."
        }
        E::Io(io) if io.kind() == ErrorKind::StorageFull => "There isn't enough free disk space for the update.",
        E::Io(io) if matches!(io.kind(), ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem) => {
            "The game's folder can't be written to, so the update wasn't installed."
        }
        E::AuthenticationFailed | E::PackageInstallFailed | E::DebInstallFailed => {
            "The package wasn't installed: the password prompt was closed, or the package manager refused it."
        }
        E::TempDirNotOnSameMountPoint | E::TempDirNotFound => "There was no room to unpack the update next to the game.",
        E::InvalidUpdaterFormat | E::BinaryNotFoundInArchive => "The download wasn't the right kind of file for this copy of the game.",
        _ => "The update couldn't be installed.",
    }
    .into()
}

#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, UpdateState>) -> Result<Option<UpdateInfo>, String> {
    let update = updater(&app).map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
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

/// True while an update is being written over the installed game. Quitting then (main.rs `quit`)
/// waits for it: the tarball binary and the AppImage are replaced in place, and a write cut short
/// would leave a broken copy.
pub fn installing(app: &AppHandle) -> bool {
    app.try_state::<UpdateState>().is_some_and(|s| s.progress.lock().map(|p| p.phase == "installing").unwrap_or(false))
}

/// Download, verify, install, restart. On Windows the installer takes over and closes the app.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state.pending.lock().unwrap().clone().ok_or("No update is waiting. Reopen the title screen to check again.")?;
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
            .await?; // the signature is checked inside download(): only verified bytes come back
        set(&|p| p.phase = "installing".into());
        update.install(bytes)
    }
    .await;
    if let Err(e) = result {
        println!("[update] install of {} failed: {e}", update.version);
        let msg = plain(&e);
        set(&|p| {
            p.phase = "error".into();
            p.error = Some(msg.clone());
        });
        return Err(msg);
    }
    set(&|p| p.phase = "restarting".into());
    // give the UI a moment to show "restarting", then come back up as the new version
    tauri::async_runtime::spawn(async move {
        std::thread::sleep(Duration::from_millis(600));
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
