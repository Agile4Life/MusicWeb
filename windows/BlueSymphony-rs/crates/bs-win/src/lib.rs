pub mod dpapi;
pub mod dwm;
pub mod hotkeys;
pub mod taskbar;
pub mod tray;
pub mod web_login;

#[derive(Debug, thiserror::Error)]
pub enum WinError {
    #[error("Windows API error: {0}")]
    Api(#[from] windows::core::Error),
    #[error("Tray error: {0}")]
    Tray(String),
    #[error("Hotkey error: {0}")]
    Hotkey(String),
    #[error("Web login error: {0}")]
    WebLogin(String),
}
