use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use crate::WinError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayCommand {
    ShowMain,
    TogglePlay,
    NextTrack,
    PrevTrack,
    ToggleMiniPlayer,
    Quit,
}

pub struct TrayController {
    _tray: TrayIcon,
    id_show: MenuId,
    id_play: MenuId,
    id_next: MenuId,
    id_prev: MenuId,
    id_mini: MenuId,
    id_quit: MenuId,
    play_item: MenuItem,
}

impl TrayController {
    /// Must be constructed on the thread running the Win32 event loop.
    pub fn new(icon_rgba: Vec<u8>, width: u32, height: u32) -> Result<Self, WinError> {
        let icon = Icon::from_rgba(icon_rgba, width, height)
            .map_err(|e| WinError::Tray(e.to_string()))?;

        let menu = Menu::new();
        let show_item = MenuItem::new("Hiện BlueSymphony", true, None);
        let play_item = MenuItem::new("Phát / Tạm dừng", true, None);
        let next_item = MenuItem::new("Bài tiếp theo", true, None);
        let prev_item = MenuItem::new("Bài trước", true, None);
        let mini_item = MenuItem::new("Mini-Player", true, None);
        let quit_item = MenuItem::new("Thoát", true, None);

        let id_show = show_item.id().clone();
        let id_play = play_item.id().clone();
        let id_next = next_item.id().clone();
        let id_prev = prev_item.id().clone();
        let id_mini = mini_item.id().clone();
        let id_quit = quit_item.id().clone();

        menu.append(&show_item)
            .and_then(|_| menu.append(&PredefinedMenuItem::separator()))
            .and_then(|_| menu.append(&play_item))
            .and_then(|_| menu.append(&next_item))
            .and_then(|_| menu.append(&prev_item))
            .and_then(|_| menu.append(&mini_item))
            .and_then(|_| menu.append(&PredefinedMenuItem::separator()))
            .and_then(|_| menu.append(&quit_item))
            .map_err(|e| WinError::Tray(e.to_string()))?;

        let tray = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(false)
            .with_tooltip("BlueSymphony")
            .with_icon(icon)
            .build()
            .map_err(|e| WinError::Tray(e.to_string()))?;

        Ok(Self {
            _tray: tray,
            id_show,
            id_play,
            id_next,
            id_prev,
            id_mini,
            id_quit,
            play_item,
        })
    }

    pub fn poll(&self) -> Option<TrayCommand> {
        if let Ok(evt) = MenuEvent::receiver().try_recv() {
            if evt.id == self.id_show {
                return Some(TrayCommand::ShowMain);
            } else if evt.id == self.id_play {
                return Some(TrayCommand::TogglePlay);
            } else if evt.id == self.id_next {
                return Some(TrayCommand::NextTrack);
            } else if evt.id == self.id_prev {
                return Some(TrayCommand::PrevTrack);
            } else if evt.id == self.id_mini {
                return Some(TrayCommand::ToggleMiniPlayer);
            } else if evt.id == self.id_quit {
                return Some(TrayCommand::Quit);
            }
        }

        while let Ok(evt) = TrayIconEvent::receiver().try_recv() {
            match evt {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
                | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => return Some(TrayCommand::ShowMain),
                _ => {}
            }
        }

        None
    }

    pub fn set_playing(&self, playing: bool) {
        self.play_item
            .set_text(if playing { "Tạm dừng" } else { "Phát" });
    }
}
