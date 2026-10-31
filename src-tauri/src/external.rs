//! Links out of the game: `open_external` opens one of our own pages (the bug report form, the site,
//! the licences) in the player's browser, and `guard()` keeps the game window on the game, so a link
//! to an outside page never replaces the game with no way back.
//!
//! Only two places are ever opened: the GitHub repository (issues, releases) and the website.

use std::process::{Command, Stdio};
use tauri::Url;

/// The URL, normalised, if it's one of ours: https, no credentials or port, and either
/// github.com/L0nE-F0x/Bunker-Busters[/…] or bunker-busters.netlify.app. Parsing first (rather than
/// comparing prefixes) is what stops `https://bunker-busters.netlify.app.evil.example`,
/// `https://bunker-busters.netlify.app@evil.example` and `…/Bunker-Busters/../../elsewhere`.
pub fn allowed(raw: &str) -> Option<Url> {
    if raw.len() > 8192 {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return None;
    }
    match url.host_str()? {
        "bunker-busters.netlify.app" => Some(url),
        "github.com" => {
            let path = url.path();
            (path == "/L0nE-F0x/Bunker-Busters" || path.starts_with("/L0nE-F0x/Bunker-Busters/")).then_some(url)
        }
        _ => None,
    }
}

/// Opens one of our pages in the system browser (the game's "Report a bug", credits and licences).
/// Anything else is refused. Returns once the browser launcher has started; it doesn't wait for it.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let Some(url) = allowed(&url) else {
        eprintln!("[bunker-busters] open_external refused: {url}");
        return Err("That link isn't one the game opens.".into());
    };
    launch(url.as_str()).map_err(|e| format!("Couldn't open your browser ({e})."))
}

/// Navigations in the game window: its own pages (tauri://localhost, http(s)://tauri.localhost, the
/// dev server on localhost, a `BB_START_URL` origin) go ahead. A page anywhere else would replace the
/// game, so it's cancelled: ours open in the browser instead, the rest are dropped.
pub fn guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bb-links")
        .on_navigation(|_, url| {
            if !leaves_app(url) {
                return true;
            }
            match allowed(url.as_str()) {
                Some(ours) => {
                    if let Err(e) = launch(ours.as_str()) {
                        eprintln!("[bunker-busters] couldn't open {ours} in the browser: {e}");
                    }
                }
                None => eprintln!("[bunker-busters] blocked navigation away from the game: {url}"),
            }
            false
        })
        .build()
}

fn leaves_app(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false; // tauri://, about:, data:, blob: …
    }
    let local = match url.host_str() {
        Some(h) => h == "localhost" || h.ends_with(".localhost") || h == "127.0.0.1" || h == "[::1]",
        None => true,
    };
    if local {
        return false;
    }
    let start = std::env::var("BB_START_URL").ok().and_then(|s| Url::parse(&s).ok());
    !start.is_some_and(|s| s.origin() == url.origin())
}

/// Hands the URL to the desktop's opener without a shell in between, and reaps it in the background.
fn launch(url: &str) -> std::io::Result<()> {
    let mut cmd = opener(url);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = cmd.spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(target_os = "linux")]
fn opener(url: &str) -> Command {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(url);
    linux_env::for_child(&mut cmd);
    cmd
}

#[cfg(windows)]
fn opener(url: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // url.dll's FileProtocolHandler passes the URL to ShellExecute (the default browser). Unlike
    // `cmd /c start`, nothing parses `&`, `^` or `%` in it. A parsed URL never contains spaces or quotes,
    // so Rust passes it through unquoted.
    let mut cmd = Command::new("rundll32.exe");
    cmd.args(["url.dll,FileProtocolHandler", url]).creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(any(target_os = "linux", windows)))]
fn opener(url: &str) -> Command {
    let mut cmd = Command::new("open");
    cmd.arg(url);
    cmd
}

/// The browser must start with the player's own environment, not the game's.
#[cfg(target_os = "linux")]
pub mod linux_env {
    use std::ffi::{OsStr, OsString};
    use std::process::Command;
    use std::sync::OnceLock;

    /// What `select_gpu()` may set for the game alone. A browser started with them would render on the
    /// NVIDIA GPU through PRIME, which once froze the owner's session (CLAUDE.md, GPU safety).
    const GAME_ONLY: [&str; 7] = [
        "__NV_PRIME_RENDER_OFFLOAD",
        "__GLX_VENDOR_LIBRARY_NAME",
        "__VK_LAYER_NV_optimus",
        "__EGL_VENDOR_LIBRARY_FILENAMES",
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        "GDK_BACKEND",
        "GDK_CORE_DEVICE_EVENTS",
    ];
    static BEFORE: OnceLock<Vec<(&'static str, Option<OsString>)>> = OnceLock::new();

    /// Call first thing in `main`, before `select_gpu()` changes anything.
    pub fn remember() {
        let _ = BEFORE.set(GAME_ONLY.iter().map(|k| (*k, std::env::var_os(k))).collect());
    }

    pub fn for_child(cmd: &mut Command) {
        for (k, v) in BEFORE.get().map(Vec::as_slice).unwrap_or_default() {
            match v {
                Some(v) => cmd.env(k, v),
                None => cmd.env_remove(k),
            };
        }
        if let Some(appdir) = std::env::var_os("APPDIR") {
            for (k, v) in appimage_fixes(&appdir, std::env::vars_os()) {
                match v {
                    Some(v) => cmd.env(k, v),
                    None => cmd.env_remove(k),
                };
            }
        }
    }

    /// Inside the AppImage its launcher points GTK, GIO, PATH, XDG_DATA_DIRS… at the image's own files.
    /// A browser started from here would load modules from a mount that disappears when the game quits.
    /// Returns the changes: list variables keep their other entries, the rest are removed.
    pub fn appimage_fixes(appdir: &OsStr, vars: impl Iterator<Item = (OsString, OsString)>) -> Vec<(OsString, Option<OsString>)> {
        let dir = appdir.to_string_lossy().trim_end_matches('/').to_string();
        let inside = |p: &str| !dir.is_empty() && (p == dir || p.starts_with(&format!("{dir}/")));
        let mut out = Vec::new();
        for (k, v) in vars {
            let key = k.to_string_lossy();
            if matches!(key.as_ref(), "APPDIR" | "APPIMAGE" | "ARGV0" | "OWD") {
                out.push((k, None));
                continue;
            }
            let val = v.to_string_lossy();
            if dir.is_empty() || !val.contains(dir.as_str()) {
                continue;
            }
            let parts: Vec<&str> = val.split(':').collect();
            let kept: Vec<&str> = parts.iter().copied().filter(|p| !inside(p)).collect();
            if kept.len() == parts.len() {
                continue; // mentions the path but doesn't point into the image
            }
            let kept: Vec<&str> = kept.into_iter().filter(|p| !p.is_empty()).collect();
            out.push((k, (!kept.is_empty()).then(|| OsString::from(kept.join(":")))));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_our_pages() {
        for ok in [
            "https://github.com/L0nE-F0x/Bunker-Busters",
            "https://github.com/L0nE-F0x/Bunker-Busters/issues/new?template=bug_report.yml&version=1.0.4&title=%5BBug%5D%20x",
            "https://github.com/L0nE-F0x/Bunker-Busters/releases/latest",
            "https://bunker-busters.netlify.app",
            "https://bunker-busters.netlify.app/licenses.txt",
            "https://bunker-busters.netlify.app/#get",
            "HTTPS://GitHub.com/L0nE-F0x/Bunker-Busters/issues",
            "https://github.com:443/L0nE-F0x/Bunker-Busters",
        ] {
            assert!(allowed(ok).is_some(), "should open {ok}");
        }
        for bad in [
            "http://bunker-busters.netlify.app/",
            "https://bunker-busters.netlify.app.evil.example/",
            "https://bunker-busters.netlify.app@evil.example/",
            "https://user:pw@bunker-busters.netlify.app/",
            "https://bunker-busters.netlify.app:8443/",
            "https://evil.example/https://bunker-busters.netlify.app",
            "https://github.com/L0nE-F0x/Bunker-Busters-evil",
            "https://github.com/L0nE-F0x/Bunker-Busters.evil",
            "https://github.com/L0nE-F0x/Bunker-Busters/../../evil/repo",
            "https://github.com/L0nE-F0x/Bunker-Busters/%2e%2e/%2e%2e/evil/repo",
            "https://github.com/L0nE-F0x/Bunker-Busters\\..\\..\\evil",
            "https://github.com/evil/Bunker-Busters",
            "https://gist.github.com/L0nE-F0x/Bunker-Busters",
            "https://github.com./L0nE-F0x/Bunker-Busters",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://bunker-busters.netlify.app\n.evil.example",
            "bunker-busters.netlify.app",
            "",
        ] {
            assert!(allowed(bad).is_none(), "should refuse {bad:?}");
        }
        assert!(allowed(&format!("https://bunker-busters.netlify.app/?q={}", "a".repeat(9000))).is_none());
    }

    #[test]
    fn opened_url_is_normalised() {
        let u = allowed("https://github.com/L0nE-F0x/Bunker-Busters/issues/new?title=a b\"c").unwrap();
        assert!(!u.as_str().contains(' ') && !u.as_str().contains('"'), "{u}");
    }

    #[test]
    fn game_pages_stay_in_the_window() {
        for local in [
            "tauri://localhost/play/index.html",
            "http://tauri.localhost/play/index.html",
            "https://tauri.localhost/play/index.html",
            "http://localhost:5173/play/?bench",
            "http://127.0.0.1:5173/",
            "about:blank",
        ] {
            assert!(!leaves_app(&Url::parse(local).unwrap()), "{local}");
        }
        for away in ["https://github.com/L0nE-F0x/Bunker-Busters", "https://example.com/", "http://192.168.1.5:5173/"] {
            assert!(leaves_app(&Url::parse(away).unwrap()), "{away}");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn appimage_env_is_cleaned_for_the_browser() {
        use std::ffi::OsString;
        let os = |s: &str| OsString::from(s);
        let vars = vec![
            (os("PATH"), os("/tmp/.mount_BunkerX/usr/bin:/usr/local/bin:/usr/bin")),
            (os("XDG_DATA_DIRS"), os("/tmp/.mount_BunkerX/usr/share:/usr/share")),
            (os("GTK_PATH"), os("/tmp/.mount_BunkerX/usr/lib/gtk-3.0")),
            (os("LD_LIBRARY_PATH"), os("/tmp/.mount_BunkerX/usr/lib")),
            (os("APPIMAGE"), os("/home/p/BunkerBusters.AppImage")),
            (os("HOME"), os("/home/p")),
            (os("OTHER"), os("/tmp/.mount_BunkerXY/kept")),
        ];
        let fixes = linux_env::appimage_fixes(&os("/tmp/.mount_BunkerX/"), vars.into_iter());
        let get = |k: &str| fixes.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        assert_eq!(get("PATH"), Some(Some(os("/usr/local/bin:/usr/bin"))));
        assert_eq!(get("XDG_DATA_DIRS"), Some(Some(os("/usr/share"))));
        assert_eq!(get("GTK_PATH"), Some(None));
        assert_eq!(get("LD_LIBRARY_PATH"), Some(None));
        assert_eq!(get("APPIMAGE"), Some(None));
        assert_eq!(get("HOME"), None);
        assert_eq!(get("OTHER"), None, "a sibling path that only shares the prefix stays");
    }
}
