use std::ffi::c_void;
use std::mem::size_of;

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DWMWA_CAPTION_COLOR, DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWM_SYSTEMBACKDROP_TYPE, DWMSBT_MAINWINDOW,
    DWMSBT_TRANSIENTWINDOW, DWMWCP_ROUND, DwmSetWindowAttribute,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackdropKind {
    None,
    Mica,
    Acrylic,
}

/// Applies Windows 11 dark titlebar and optional Mica/Acrylic backdrop to a raw HWND.
/// Safe and best-effort: failures on older Windows builds are ignored.
pub fn apply_window_style(hwnd_raw: isize, dark_mode: bool, backdrop: BackdropKind) {
    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as *mut c_void);

    let dark_val: i32 = if dark_mode { 1 } else { 0 };
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            (&dark_val as *const i32).cast(),
            size_of::<i32>() as u32,
        );
    }

    let backdrop_val: i32 = match backdrop {
        BackdropKind::None => 1, // DWMSBT_NONE
        BackdropKind::Mica => DWMSBT_MAINWINDOW.0,
        BackdropKind::Acrylic => DWMSBT_TRANSIENTWINDOW.0,
    };
    let _ = DWM_SYSTEMBACKDROP_TYPE(backdrop_val);
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            (&backdrop_val as *const i32).cast(),
            size_of::<i32>() as u32,
        );
    }
}

/// Sets Windows 11 titlebar caption background color (`DWMWA_CAPTION_COLOR`) using an RGB tuple.
/// Safe and best-effort: failures on older Windows builds are ignored.
pub fn apply_titlebar_color(hwnd_raw: isize, rgb: (u8, u8, u8)) {
    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as *mut c_void);
    // Win32 COLORREF is 0x00BBGGRR
    let colorref: u32 = (rgb.0 as u32) | ((rgb.1 as u32) << 8) | ((rgb.2 as u32) << 16);
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            (&colorref as *const u32).cast(),
            size_of::<u32>() as u32,
        );
    }
}

/// Requests Windows 11 rounded corners (`DWMWCP_ROUND`) on a frameless window HWND.
pub fn apply_rounded_corners(hwnd_raw: isize) {
    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as *mut c_void);
    let corner_val: i32 = DWMWCP_ROUND.0;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&corner_val as *const i32).cast(),
            size_of::<i32>() as u32,
        );
    }
}

