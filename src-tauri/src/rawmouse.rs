//! Raw mouse motion for mouse-look on Linux/X11 (incl. XWayland).
//!
//! WebKitGTK's X11 pointer lock measures motion as the distance from the lock point and warps the
//! cursor back after every event (`XWarpPointer`). Under XWayland an X client can't move the real
//! cursor, so on Hyprland the pointer drifts to the window edge and the page gets ~nothing: mouse
//! look looked frozen. XInput2 *raw* motion is fed by XWayland from the compositor's relative-pointer
//! events (what Wine/SDL games use), so we read that on our own X connection and let the page poll
//! it while it holds pointer lock. WebKit's lock still hides and confines the cursor.
//!
//! Only *relative* pointer devices count. XWayland exposes the real mouse twice:
//! `xwayland-pointer` (absolute: raw values are screen positions, summing them spun the camera
//! ~19 turns in a few seconds) and `xwayland-relative-pointer` (true deltas). Touchpad gesture
//! devices are skipped as well.

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

        // slave devices whose X/Y axes are relative (and aren't gesture devices)
        let relative_devices = |dpy| {
            let mut ids = std::collections::HashSet::new();
            let mut n = 0;
            let info = (xi.XIQueryDevice)(dpy, xinput2::XIAllDevices, &mut n);
            if !info.is_null() {
                for dev in std::slice::from_raw_parts(info, n as usize) {
                    let name = std::ffi::CStr::from_ptr(dev.name).to_string_lossy().to_lowercase();
                    if dev._use != xinput2::XISlavePointer || name.contains("gesture") {
                        continue;
                    }
                    let classes = std::slice::from_raw_parts(dev.classes, dev.num_classes as usize);
                    let relative = classes.iter().any(|&c| {
                        (*c)._type == xinput2::XIValuatorClass && {
                            let v = &*(c as *const xinput2::XIValuatorClassInfo);
                            v.number == 0 && v.mode == xinput2::XIModeRelative
                        }
                    });
                    if relative {
                        eprintln!("[bunker-busters] raw mouse device: {} ({})", dev.deviceid, name);
                        ids.insert(dev.deviceid);
                    }
                }
                (xi.XIFreeDeviceInfo)(info);
            }
            ids
        };
        let mut rel = relative_devices(dpy);
        let mut seen = std::collections::HashSet::new();

        let mut event: xlib::XEvent = std::mem::zeroed();
        loop {
            (xl.XNextEvent)(dpy, &mut event);
            let cookie = &mut event.generic_event_cookie;
            if cookie.type_ != xlib::GenericEvent || cookie.extension != opcode || (xl.XGetEventData)(dpy, cookie) == 0 {
                continue;
            }
            if cookie.evtype == xinput2::XI_RawMotion {
                let raw = &*(cookie.data as *const xinput2::XIRawEvent);
                // a device we haven't classified yet (hotplug): look again, once per device
                if !rel.contains(&raw.sourceid) && seen.insert(raw.sourceid) {
                    rel = relative_devices(dpy);
                }
                if !rel.contains(&raw.sourceid) {
                    (xl.XFreeEventData)(dpy, cookie);
                    continue;
                }
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
                // no mouse moves 500 px in one event: anything bigger isn't a delta
                if dx.abs() < 500.0 && dy.abs() < 500.0 {
                    let mut d = DELTA.lock().unwrap();
                    d.0 += dx;
                    d.1 += dy;
                }
            }
            (xl.XFreeEventData)(dpy, cookie);
        }
    }
}

// ------------------------------------------------------------------------------------------------
// Mouse capture without WebKit's pointer lock.
//
// While WebKitGTK holds its own X pointer grab (its pointer-lock implementation), the window stops
// presenting new frames under XWayland/PRIME: the page keeps rendering, the screen freezes. A grab
// held by a *separate* X client doesn't do that (measured: screenshots stay live), so the page asks
// us to grab the pointer on its window from our own connection: invisible cursor, confined to the
// window, no events requested (mouse-look comes from raw motion above).

static CAPTURE: Mutex<Option<usize>> = Mutex::new(None); // *mut Display of the grabbing connection

/// Grab (`on`) or release the pointer for the app window. Returns whether it's captured.
#[tauri::command]
pub async fn mouse_capture(on: bool) -> bool {
    tauri::async_runtime::spawn_blocking(move || capture(on)).await.unwrap_or(false)
}

fn capture(on: bool) -> bool {
    use x11_dl::xlib;
    let Ok(xl) = xlib::Xlib::open() else { return false };
    let mut cap = CAPTURE.lock().unwrap();
    unsafe {
        if !on {
            if let Some(d) = cap.take() {
                let dpy = d as *mut xlib::Display;
                (xl.XUngrabPointer)(dpy, xlib::CurrentTime);
                (xl.XCloseDisplay)(dpy);
            }
            return false;
        }
        if cap.is_some() {
            return true;
        }
        let dpy = (xl.XOpenDisplay)(std::ptr::null());
        if dpy.is_null() {
            return false;
        }
        let Some(win) = find_app_window(&xl, dpy) else {
            (xl.XCloseDisplay)(dpy);
            return false;
        };
        // invisible cursor
        let pm = (xl.XCreatePixmap)(dpy, win, 1, 1, 1);
        let mut black: xlib::XColor = std::mem::zeroed();
        let cursor = (xl.XCreatePixmapCursor)(dpy, pm, pm, &mut black, &mut black, 0, 0);
        (xl.XFreePixmap)(dpy, pm);
        // the click that asked for capture may still hold an implicit grab: retry briefly
        for _ in 0..30 {
            let r = (xl.XGrabPointer)(dpy, win, xlib::False, 0, xlib::GrabModeAsync, xlib::GrabModeAsync, win, cursor, xlib::CurrentTime);
            if r == xlib::GrabSuccess {
                (xl.XFlush)(dpy);
                *cap = Some(dpy as usize);
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        (xl.XCloseDisplay)(dpy);
        false
    }
}

/// The viewable top-level X window owned by this process (GTK sets _NET_WM_PID).
unsafe fn find_app_window(xl: &x11_dl::xlib::Xlib, dpy: *mut x11_dl::xlib::Display) -> Option<x11_dl::xlib::Window> {
    use x11_dl::xlib;
    let pid_atom = (xl.XInternAtom)(dpy, c"_NET_WM_PID".as_ptr(), xlib::True);
    if pid_atom == 0 {
        return None;
    }
    let me = std::process::id() as u64;
    let mut stack = vec![(xl.XDefaultRootWindow)(dpy)];
    while let Some(w) = stack.pop() {
        let (mut ty, mut fmt, mut n, mut after) = (0, 0, 0, 0);
        let mut prop: *mut u8 = std::ptr::null_mut();
        if (xl.XGetWindowProperty)(dpy, w, pid_atom, 0, 1, xlib::False, xlib::XA_CARDINAL, &mut ty, &mut fmt, &mut n, &mut after, &mut prop) == xlib::Success as i32 && !prop.is_null() {
            let pid = if n > 0 { *(prop as *const std::os::raw::c_ulong) as u64 } else { 0 };
            (xl.XFree)(prop as *mut _);
            if pid == me {
                let mut attrs: xlib::XWindowAttributes = std::mem::zeroed();
                if (xl.XGetWindowAttributes)(dpy, w, &mut attrs) != 0 && attrs.map_state == xlib::IsViewable {
                    return Some(w);
                }
            }
        }
        let (mut root, mut parent) = (0, 0);
        let mut kids: *mut xlib::Window = std::ptr::null_mut();
        let mut nk = 0u32;
        if (xl.XQueryTree)(dpy, w, &mut root, &mut parent, &mut kids, &mut nk) != 0 && !kids.is_null() {
            stack.extend_from_slice(std::slice::from_raw_parts(kids, nk as usize));
            (xl.XFree)(kids as *mut _);
        }
    }
    None
}
