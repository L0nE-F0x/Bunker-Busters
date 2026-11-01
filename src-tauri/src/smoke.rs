//! `BB_SMOKE=<report file>`: the install test in .github/workflows/smoke.yml. Watches the page until
//! the game reaches its title screen (which means the renderer started, the world was built and every
//! shader compiled) and is still drawing frames, writes a one-line JSON report to that file and to
//! stdout, then quits through the normal path: exit code 0 if the game came up, 1 if it didn't.
//!
//! `BB_SMOKE_TIMEOUT` (seconds, default 420) bounds the wait: a CI runner has no GPU, so the page
//! renders in software and the shader warm-up is slow. `BB_SMOKE_HOLD` (seconds, default 5) keeps a
//! passing window up so the workflow can take a screenshot. Nothing here runs unless BB_SMOKE is set.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// What the page reports. `window.game` is set in src/main.ts once the renderer exists; its mode goes
/// loading → title. `frame` is three's frame counter, so two reads apart show whether it still draws.
/// A runner has no GPU, so on Windows (WebView2 names the Basic Render Driver) the game stops at its
/// "running without your graphics card" notice: the probe presses Continue on Low, as a player would,
/// and the report says so (`softwareNotice`).
const PROBE: &str = r#"(() => { try {
  const sw = document.querySelector('#bootfail[data-kind="software"] .bf-actions .btn.primary');
  if (sw) { sw.click(); window.__bbSmokeSoftware = true; }
  const g = window.game, info = g && g.renderer && g.renderer.info, c = document.getElementById('game');
  return {
    href: location.href,
    ready: document.readyState,
    mode: g ? g.mode : null,
    backend: g ? g.backendLabel || null : null,
    frame: info ? info.frame : null,
    draws: info && info.render ? info.render.drawCalls : null,
    triangles: info && info.render ? info.render.triangles : null,
    canvas: c ? [c.width, c.height] : null,
    softwareNotice: !!window.__bbSmokeSoftware,
    text: g && g.mode === 'title' ? null : (document.body ? document.body.innerText.slice(0, 600) : null),
  };
} catch (e) { return { error: String(e) }; } })()"#;

fn secs(name: &str, default: u64) -> Duration {
    Duration::from_secs(std::env::var(name).ok().and_then(|v| v.trim().parse().ok()).unwrap_or(default))
}

fn probe(app: &AppHandle) -> Option<Value> {
    let win = app.get_webview_window("main")?;
    let (tx, rx) = mpsc::channel();
    win.eval_with_callback(PROBE, move |json| {
        let _ = tx.send(json);
    })
    .ok()?;
    // the page's main thread may be busy compiling shaders for a while
    let json = rx.recv_timeout(Duration::from_secs(20)).ok()?;
    Some(serde_json::from_str(&json).unwrap_or(Value::String(json)))
}

pub fn start(app: AppHandle, report: PathBuf) {
    std::thread::spawn(move || {
        let timeout = secs("BB_SMOKE_TIMEOUT", 420);
        let t0 = Instant::now();
        let mut page = Value::Null;
        let mut title_frame: Option<f64> = None;
        let (ok, why) = loop {
            std::thread::sleep(Duration::from_secs(3));
            if let Some(p) = probe(&app) {
                page = p;
            }
            let frame = page.get("frame").and_then(Value::as_f64);
            if page.get("mode").and_then(Value::as_str) == Some("title") {
                match (title_frame, frame) {
                    // on the title screen and drawing: two reads apart, the frame counter moved on
                    (Some(a), Some(b)) if b > a && page.get("draws").and_then(Value::as_f64).unwrap_or(0.0) > 0.0 => break (true, "title screen up and drawing"),
                    (None, Some(f)) => title_frame = Some(f),
                    _ => {}
                }
            }
            if t0.elapsed() > timeout {
                break (false, if title_frame.is_some() { "reached the title screen but stopped drawing" } else { "never reached the title screen" });
            }
        };
        let line = json!({
            "ok": ok,
            "result": why,
            "version": app.package_info().version.to_string(),
            "os": std::env::consts::OS,
            "installer": crate::update::installer(),
            "seconds": (t0.elapsed().as_secs_f64() * 10.0).round() / 10.0,
            "page": page,
        })
        .to_string();
        println!("[smoke] {line}");
        if let Err(e) = std::fs::write(&report, format!("{line}\n")) {
            eprintln!("[smoke] couldn't write {}: {e}", report.display());
        }
        if ok {
            std::thread::sleep(secs("BB_SMOKE_HOLD", 5));
        }
        crate::quit(&app, if ok { 0 } else { 1 });
    });
}
