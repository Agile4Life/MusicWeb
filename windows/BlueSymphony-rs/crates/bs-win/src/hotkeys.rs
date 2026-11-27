use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};

use crate::WinError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobalHotkeyAction {
    PlayPause,
    NextTrack,
    PrevTrack,
    ToggleMiniPlayer,
}

pub struct GlobalHotkeyManager {
    _manager: GlobalHotKeyManager,
    play_pause_id: Option<u32>,
    next_id: Option<u32>,
    prev_id: Option<u32>,
    mini_id: Option<u32>,
}

impl GlobalHotkeyManager {
    pub fn new() -> Result<Self, WinError> {
        let manager = GlobalHotKeyManager::new().map_err(|e| WinError::Hotkey(e.to_string()))?;

        let hk_play = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
        let hk_next = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::ArrowRight);
        let hk_prev = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::ArrowLeft);
        let hk_mini = HotKey::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);

        let play_pause_id = register_optional(&manager, hk_play, "Ctrl+Alt+Space");
        let next_id = register_optional(&manager, hk_next, "Ctrl+Alt+Right");
        let prev_id = register_optional(&manager, hk_prev, "Ctrl+Alt+Left");
        let mini_id = register_optional(&manager, hk_mini, "Ctrl+Shift+M");

        Ok(Self {
            _manager: manager,
            play_pause_id,
            next_id,
            prev_id,
            mini_id,
        })
    }

    pub fn poll(&self) -> Option<GlobalHotkeyAction> {
        while let Ok(evt) = GlobalHotKeyEvent::receiver().try_recv() {
            if evt.state != HotKeyState::Pressed {
                continue;
            }
            let id = evt.id;
            if Some(id) == self.play_pause_id {
                return Some(GlobalHotkeyAction::PlayPause);
            } else if Some(id) == self.next_id {
                return Some(GlobalHotkeyAction::NextTrack);
            } else if Some(id) == self.prev_id {
                return Some(GlobalHotkeyAction::PrevTrack);
            } else if Some(id) == self.mini_id {
                return Some(GlobalHotkeyAction::ToggleMiniPlayer);
            }
        }
        None
    }
}

fn register_optional(manager: &GlobalHotKeyManager, hk: HotKey, label: &str) -> Option<u32> {
    match manager.register(hk) {
        Ok(()) => Some(hk.id()),
        Err(err) => {
            tracing::warn!("Could not register global hotkey {label}: {err}");
            None
        }
    }
}
