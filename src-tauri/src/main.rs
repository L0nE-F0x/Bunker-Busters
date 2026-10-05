// Bunker Busters desktop shell: the same web game, hosted in a native WebKitGTK/WebView2/WKWebView
// window so it can be pointed at a specific GPU (see scripts/run-nvidia.sh) independently of the
// user's everyday browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let win = app
                .get_webview_window("main")
                .expect("main window missing from tauri.conf.json");

            // Dev/testing: open a different page (e.g. the GPU canary) instead of the game.
            if let Ok(url) = std::env::var("BB_START_URL") {
                win.navigate(url.parse()?)?;
            }

            #[cfg(target_os = "linux")]
            win.with_webview(|wv| {
                use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
                if let Some(settings) = wv.inner().settings() {
                    settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Always);
                    settings.set_enable_webgl(true);
                    // console.log → stdout, so test runs can be read from the terminal
                    settings.set_enable_write_console_messages_to_stdout(true);
                }
            })?;

            // Safety valve for automated test runs: quit after N seconds.
            if let Ok(secs) = std::env::var("BB_EXIT_AFTER") {
                let handle = app.handle().clone();
                let secs: u64 = secs.parse().unwrap_or(10);
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(secs));
                    handle.exit(0);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Bunker Busters");
}
