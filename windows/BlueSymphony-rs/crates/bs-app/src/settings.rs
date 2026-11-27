use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::theme::AppThemeKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme: AppThemeKind,
    pub ui_skin_version: u8,
    pub gaming_mode: bool,
    pub close_to_tray: bool,
    pub global_hotkeys: bool,
    pub romaji_enabled: bool,
    pub volume: f64,
    pub muted: bool,
    pub recent_searches: Vec<String>,
    pub window_width: f32,
    pub window_height: f32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: AppThemeKind::AppleDark,
            ui_skin_version: 1,
            gaming_mode: false,
            close_to_tray: true,
            global_hotkeys: true,
            romaji_enabled: true,
            volume: 0.85,
            muted: false,
            recent_searches: Vec::new(),
            window_width: 1280.0,
            window_height: 820.0,
        }
    }
}

impl AppSettings {
    pub fn load(path: &Path) -> Self {
        let mut settings = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Self>(&s).ok())
            .unwrap_or_default();
        if settings.ui_skin_version < 1 {
            settings.theme = AppThemeKind::AppleDark;
            settings.ui_skin_version = 1;
            settings.save(path);
        }
        settings
    }

    pub fn save(&self, path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn load_dsp_store(path: &Path) -> bs_dsp::DspStore {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<bs_dsp::DspStore>(&s).ok())
            .filter(|s| !s.profiles.is_empty())
            .unwrap_or_default()
    }

    pub fn save_dsp_store(store: &bs_dsp::DspStore, path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(store) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn push_recent_search(&mut self, term: &str) {
        let trimmed = term.trim();
        if trimmed.is_empty() {
            return;
        }
        self.recent_searches.retain(|t| t != trimmed);
        self.recent_searches.insert(0, trimmed.to_string());
        self.recent_searches.truncate(10);
    }
}

