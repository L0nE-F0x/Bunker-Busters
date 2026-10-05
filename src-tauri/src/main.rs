// Bunker Busters desktop shell: the same web game, hosted in a native WebKitGTK/WebView2/WKWebView
// window so it can be pointed at a specific GPU (see scripts/run-nvidia.sh) independently of the
// user's everyday browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod rawmouse;
mod update;

use std::time::Duration;
use tauri::Manager;

/// Linux hybrid-graphics laptops (Intel/AMD iGPU drives the screen, NVIDIA dGPU idle): route this
/// app — and only this app — onto the NVIDIA card. Must run before GTK/EGL initialise.
///
/// Measured on Intel + RTX 4050 under Hyprland: native-Wayland dmabuf presentation is rejected by
/// the compositor and native Wayland without dmabuf caps at ~45 fps; XWayland without dmabuf runs
/// at full refresh. So: PRIME render offload + XWayland + no dmabuf renderer (+ core device events,
/// or GTK under XWayland never delivers mouse clicks to the page).
///
/// Opt out with BB_GPU=integrated (or any explicit __NV_PRIME_RENDER_OFFLOAD setting).
#[cfg(target_os = "linux")]
fn select_gpu() {
    use std::{env, fs, path::Path};

    if env::var("BB_GPU").map(|v| v == "integrated").unwrap_or(false) || env::var_os("__NV_PRIME_RENDER_OFFLOAD").is_some() {
        return;
    }
    let nvidia = Path::new("/proc/driver/nvidia/version").exists();
    // hybrid = NVIDIA driver loaded *and* more than one GPU render node
    let render_nodes = fs::read_dir("/dev/dri")
        .map(|d| d.flatten().filter(|e| e.file_name().to_string_lossy().starts_with("renderD")).count())
        .unwrap_or(0);
    if !nvidia || render_nodes < 2 {
        return;
    }
    eprintln!("[bunker-busters] hybrid NVIDIA laptop detected: rendering on the NVIDIA GPU (set BB_GPU=integrated to disable)");
    // Edition 2021: set_var is safe; we're single-threaded at this point.
    env::set_var("__NV_PRIME_RENDER_OFFLOAD", "1");
    env::set_var("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
    env::set_var("__VK_LAYER_NV_optimus", "NVIDIA_only");
    let egl = "/usr/share/glvnd/egl_vendor.d/10_nvidia.json";
    if Path::new(egl).exists() {
        env::set_var("__EGL_VENDOR_LIBRARY_FILENAMES", egl);
    }
    env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    if env::var_os("WAYLAND_DISPLAY").is_some() && env::var_os("DISPLAY").is_some() {
        env::set_var("GDK_BACKEND", "x11");
        // GTK3's XInput2 handling under XWayland (Hyprland) drops mouse button presses: the page
        // got hover/motion but never a click, so the menu looked frozen. Core device events fix it.
        if env::var_os("GDK_CORE_DEVICE_EVENTS").is_none() {
            env::set_var("GDK_CORE_DEVICE_EVENTS", "1");
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        select_gpu();
        // mouse-look source on X11/XWayland (see rawmouse.rs)
        let x11 = std::env::var("GDK_BACKEND").map(|b| b == "x11").unwrap_or(false) || std::env::var_os("WAYLAND_DISPLAY").is_none();
        // XInitThreads has to come before GTK opens its display; only then is a reader thread safe
        if x11 && rawmouse::init_threads() {
            rawmouse::start();
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            update::update_check,
            update::update_install,
            update::update_progress,
            #[cfg(target_os = "linux")]
            rawmouse::raw_mouse_delta
        ])
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

            // Testing the updater end to end without clicking: check, install, restart.
            if std::env::var_os("BB_SELF_UPDATE").is_some() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move { update::self_update_for_test(handle).await });
            }

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
