use std::collections::VecDeque;
use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx};
use windows::Win32::UI::Shell::{
    ITaskbarList3, THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
    TaskbarList,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, CreateIcon, DestroyIcon, GWLP_WNDPROC, HICON, SetWindowLongPtrW, WM_COMMAND,
    WNDPROC,
};

const ID_PREV: u32 = 4001;
const ID_PLAY_PAUSE: u32 = 4002;
const ID_NEXT: u32 = 4003;

static PREV_WNDPROC: AtomicIsize = AtomicIsize::new(0);
static PENDING_ACTIONS: OnceLock<Mutex<VecDeque<TaskbarAction>>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskbarAction {
    Previous,
    PlayPause,
    Next,
}

/// Best-effort wrapper for Windows `ITaskbarList3` thumbnail toolbar buttons.
pub struct TaskbarToolbar {
    hwnd: HWND,
    list: ITaskbarList3,
    icon_prev: HICON,
    icon_play: HICON,
    icon_pause: HICON,
    icon_next: HICON,
}

impl TaskbarToolbar {
    pub fn attach(hwnd_raw: isize) -> Option<Self> {
        if hwnd_raw == 0 {
            return None;
        }
        let hwnd = HWND(hwnd_raw as *mut c_void);

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let list: ITaskbarList3 =
                CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok()?;
            list.HrInit().ok()?;

            let icon_prev = make_glyph_icon(Glyph::Prev)?;
            let icon_play = make_glyph_icon(Glyph::Play)?;
            let icon_pause = make_glyph_icon(Glyph::Pause)?;
            let icon_next = make_glyph_icon(Glyph::Next)?;

            let buttons = [
                make_button(ID_PREV, icon_prev, "Bài trước"),
                make_button(ID_PLAY_PAUSE, icon_play, "Phát / Tạm dừng"),
                make_button(ID_NEXT, icon_next, "Bài tiếp theo"),
            ];

            if list.ThumbBarAddButtons(hwnd, &buttons).is_err() {
                let _ = DestroyIcon(icon_prev);
                let _ = DestroyIcon(icon_play);
                let _ = DestroyIcon(icon_pause);
                let _ = DestroyIcon(icon_next);
                return None;
            }

            if PREV_WNDPROC.load(Ordering::SeqCst) == 0 {
                let prev = SetWindowLongPtrW(
                    hwnd,
                    GWLP_WNDPROC,
                    taskbar_wndproc as *const () as usize as isize,
                );
                PREV_WNDPROC.store(prev, Ordering::SeqCst);
            }

            Some(Self {
                hwnd,
                list,
                icon_prev,
                icon_play,
                icon_pause,
                icon_next,
            })
        }
    }

    pub fn update_playing(&self, is_playing: bool) {
        let btn = make_button(
            ID_PLAY_PAUSE,
            if is_playing {
                self.icon_pause
            } else {
                self.icon_play
            },
            if is_playing { "Tạm dừng" } else { "Phát" },
        );
        unsafe {
            let _ = self.list.ThumbBarUpdateButtons(self.hwnd, &[btn]);
        }
    }

    pub fn poll(&self) -> Option<TaskbarAction> {
        let queue = PENDING_ACTIONS.get_or_init(|| Mutex::new(VecDeque::new()));
        queue.lock().ok().and_then(|mut q| q.pop_front())
    }
}

impl Drop for TaskbarToolbar {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.icon_prev);
            let _ = DestroyIcon(self.icon_play);
            let _ = DestroyIcon(self.icon_pause);
            let _ = DestroyIcon(self.icon_next);
        }
    }
}

unsafe extern "system" fn taskbar_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_COMMAND {
        let code = ((wparam.0 >> 16) & 0xffff) as u32;
        if code == THBN_CLICKED {
            let cmd_id = (wparam.0 & 0xffff) as u32;
            let action = match cmd_id {
                ID_PREV => Some(TaskbarAction::Previous),
                ID_PLAY_PAUSE => Some(TaskbarAction::PlayPause),
                ID_NEXT => Some(TaskbarAction::Next),
                _ => None,
            };
            if let Some(act) = action {
                let queue = PENDING_ACTIONS.get_or_init(|| Mutex::new(VecDeque::new()));
                if let Ok(mut q) = queue.lock() {
                    q.push_back(act);
                }
                return LRESULT(0);
            }
        }
    }

    let prev_raw = PREV_WNDPROC.load(Ordering::SeqCst);
    let prev: WNDPROC = if prev_raw != 0 {
        Some(std::mem::transmute::<usize, unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT>(
            prev_raw as usize,
        ))
    } else {
        None
    };
    CallWindowProcW(prev, hwnd, msg, wparam, lparam)
}

fn make_button(id: u32, hicon: HICON, tip: &str) -> THUMBBUTTON {
    let mut sz_tip = [0u16; 260];
    for (i, ch) in tip.encode_utf16().take(259).enumerate() {
        sz_tip[i] = ch;
    }
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: hicon,
        szTip: sz_tip,
        dwFlags: THBF_ENABLED,
    }
}

#[derive(Clone, Copy)]
enum Glyph {
    Prev,
    Play,
    Pause,
    Next,
}

fn make_glyph_icon(glyph: Glyph) -> Option<HICON> {
    const W: usize = 16;
    const H: usize = 16;
    let mut bgra = [0u8; W * H * 4];
    let and_mask = [0u8; (W * H) / 8];

    let mut set_px = |x: usize, y: usize| {
        if x < W && y < H {
            let idx = (y * W + x) * 4;
            bgra[idx] = 245;
            bgra[idx + 1] = 245;
            bgra[idx + 2] = 245;
            bgra[idx + 3] = 255;
        }
    };

    match glyph {
        Glyph::Play => {
            for y in 3..=12 {
                let dist = (y as isize - 8).unsigned_abs();
                let max_x = 12usize.saturating_sub(dist);
                for x in 4..=max_x {
                    set_px(x, y);
                }
            }
        }
        Glyph::Pause => {
            for y in 3..=12 {
                for x in 4..=6 {
                    set_px(x, y);
                }
                for x in 9..=11 {
                    set_px(x, y);
                }
            }
        }
        Glyph::Next => {
            for y in 3..=12 {
                let dist = (y as isize - 8).unsigned_abs();
                let max_x = 10usize.saturating_sub(dist);
                for x in 3..=max_x {
                    set_px(x, y);
                }
                set_px(12, y);
                set_px(13, y);
            }
        }
        Glyph::Prev => {
            for y in 3..=12 {
                let dist = (y as isize - 8).unsigned_abs();
                let min_x = (6 + dist).min(12);
                for x in min_x..=12 {
                    set_px(x, y);
                }
                set_px(2, y);
                set_px(3, y);
            }
        }
    }

    unsafe { CreateIcon(None, W as i32, H as i32, 1, 32, and_mask.as_ptr(), bgra.as_ptr()).ok() }
}
