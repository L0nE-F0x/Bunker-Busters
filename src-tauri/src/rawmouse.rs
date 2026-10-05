//! Raw mouse motion for mouse-look on Linux/X11 (incl. XWayland).
//!
//! WebKitGTK's X11 pointer lock measures motion as the distance from the lock point and warps the
//! cursor back after every event (`XWarpPointer`). Under XWayland an X client can't move the real
//! cursor, so on Hyprland the pointer drifts to the window edge and the page gets ~nothing: mouse
//! look looked frozen. XInput2 *raw* motion is fed by XWayland from the compositor's relative-pointer
//! events (what Wine/SDL games use), so we read that on our own X connection and let the page poll
//! it while it holds pointer lock. WebKit's lock still hides and confines the cursor.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static DELTA: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// Accumulated (dx, dy) since the last call, in accelerated pointer units (≈ CSS px).
#[tauri::command]
pub fn raw_mouse_delta() -> Option<(f64, f64)> {
    if !ACTIVE.load(Ordering::Relaxed) {
        return None;
    }
    let mut d = DELTA.lock().unwrap();
    let out = *d;
    *d = (0.0, 0.0);
    Some(out)
}

/// Must run before anything else touches Xlib (i.e. before GTK starts): with a second thread using
/// Xlib, Xlib needs its internal locking or the two threads can hang each other.
pub fn init_threads() -> bool {
    match x11_dl::xlib::Xlib::open() {
        Ok(xl) => unsafe { (xl.XInitThreads)() != 0 },
        Err(_) => false,
    }
}

/// Start the reader thread if we're on X11. Safe to call once at startup.
pub fn start() {
    std::thread::Builder::new()
        .name("raw-mouse".into())
        .spawn(|| {
            if let Err(e) = run() {
                eprintln!("[bunker-busters] raw mouse input unavailable: {e}");
            }
        })
        .ok();
}

fn run() -> Result<(), String> {
    use std::os::raw::{c_int, c_uchar};
    use x11_dl::{xinput2, xlib};

    let xl = xlib::Xlib::open().map_err(|e| e.to_string())?;
    let xi = xinput2::XInput2::open().map_err(|e| e.to_string())?;
    unsafe {
        let dpy = (xl.XOpenDisplay)(std::ptr::null());
        if dpy.is_null() {
            return Err("no X display".into());
        }
        let (mut opcode, mut ev, mut err) = (0, 0, 0);
        if (xl.XQueryExtension)(dpy, c"XInputExtension".as_ptr(), &mut opcode, &mut ev, &mut err) == 0 {
            return Err("no XInput extension".into());
        }
        // ≥2.1: raw events reach root listeners even while another client (WebKit's pointer lock)
        // holds the grab. Announcing 2.0 gets the old rules, i.e. nothing during pointer lock.
        let (mut major, mut minor) = (2, 2);
        if (xi.XIQueryVersion)(dpy, &mut major, &mut minor) != 0 {
            return Err("XInput2 not supported".into());
        }
        let mut mask = [0u8; 4];
        mask[(xinput2::XI_RawMotion >> 3) as usize] |= 1 << (xinput2::XI_RawMotion & 7);
        let mut em = xinput2::XIEventMask { deviceid: xinput2::XIAllMasterDevices, mask_len: mask.len() as c_int, mask: mask.as_mut_ptr() };
        let root = (xl.XDefaultRootWindow)(dpy);
        (xi.XISelectEvents)(dpy, root, &mut em, 1);
        (xl.XFlush)(dpy);
        ACTIVE.store(true, Ordering::Relaxed);
        eprintln!("[bunker-busters] raw mouse input: XInput2 {major}.{minor}");

        let mut event: xlib::XEvent = std::mem::zeroed();
        loop {
            (xl.XNextEvent)(dpy, &mut event);
            let cookie = &mut event.generic_event_cookie;
            if cookie.type_ != xlib::GenericEvent || cookie.extension != opcode || (xl.XGetEventData)(dpy, cookie) == 0 {
                continue;
            }
            if cookie.evtype == xinput2::XI_RawMotion {
                let raw = &*(cookie.data as *const xinput2::XIRawEvent);
                let v = raw.valuators;
                let bits = std::slice::from_raw_parts(v.mask as *const c_uchar, v.mask_len as usize);
                let (mut dx, mut dy, mut k) = (0.0, 0.0, 0usize);
                for axis in 0..(v.mask_len as usize * 8).min(16) {
                    if bits[axis / 8] & (1 << (axis % 8)) != 0 {
                        let val = *v.values.add(k);
                        k += 1;
                        match axis {
                            0 => dx = val,
                            1 => dy = val,
                            _ => {}
                        }
                    }
                }
                let mut d = DELTA.lock().unwrap();
                d.0 += dx;
                d.1 += dy;
            }
            (xl.XFreeEventData)(dpy, cookie);
        }
    }
}
