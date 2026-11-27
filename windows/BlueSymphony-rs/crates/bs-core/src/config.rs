use std::path::{Path, PathBuf};

use directories::ProjectDirs;
use serde::Deserialize;

/// Always call `www.` — the apex domain 308-redirects.
pub const API_BASE: &str = "https://www.bluesymphony.site";

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub supabase_url: Option<String>,
    pub supabase_anon_key: Option<String>,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
}

#[derive(Debug, Default, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    supabase_url: Option<String>,
    #[serde(default)]
    supabase_anon_key: Option<String>,
}

impl AppConfig {
    pub fn load() -> Self {
        let (data_dir, cache_dir) = Self::resolve_dirs();
        let _ = std::fs::create_dir_all(&data_dir);
        let _ = std::fs::create_dir_all(&cache_dir);

        let mut supabase_url = read_non_empty_env(&[
            "BLUESYMPHONY_SUPABASE_URL",
            "NEXT_PUBLIC_SUPABASE_URL",
        ]);
        let mut supabase_anon_key = read_non_empty_env(&[
            "BLUESYMPHONY_SUPABASE_ANON_KEY",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY",
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        ]);

        if supabase_url.is_none() || supabase_anon_key.is_none() {
            if let Some(secrets) = Self::read_secrets_file(&data_dir) {
                if supabase_url.is_none() {
                    supabase_url = secrets.supabase_url.filter(|s| !s.trim().is_empty());
                }
                if supabase_anon_key.is_none() {
                    supabase_anon_key = secrets.supabase_anon_key.filter(|s| !s.trim().is_empty());
                }
            }
        }

        Self {
            supabase_url: supabase_url.map(|s| s.trim().trim_end_matches('/').to_string()),
            supabase_anon_key: supabase_anon_key.map(|s| s.trim().to_string()),
            data_dir,
            cache_dir,
        }
    }

    pub fn is_auth_configured(&self) -> bool {
        self.supabase_url
            .as_deref()
            .is_some_and(|u| u.starts_with("http"))
            && self
                .supabase_anon_key
                .as_deref()
                .is_some_and(|k| !k.is_empty())
    }

    pub fn session_cookie_path(&self) -> PathBuf {
        self.data_dir.join("session.dpapi")
    }

    pub fn known_db_ids_path(&self) -> PathBuf {
        self.data_dir.join("known_db_ids.json")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn dsp_profiles_path(&self) -> PathBuf {
        self.data_dir.join("dsp_profiles.json")
    }

    pub fn image_cache_dir(&self) -> PathBuf {
        self.cache_dir.join("images")
    }

    fn resolve_dirs() -> (PathBuf, PathBuf) {
        if let Some(dirs) = ProjectDirs::from("site", "BlueSymphony", "BlueSymphony") {
            return (dirs.data_local_dir().to_path_buf(), dirs.cache_dir().to_path_buf());
        }
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("BlueSymphony");
        (base.clone(), base.join("cache"))
    }

    fn read_secrets_file(data_dir: &Path) -> Option<SecretsFile> {
        let mut candidates = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("secrets.toml"));
                candidates.push(dir.join("config").join("secrets.toml"));
            }
        }
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join("config").join("secrets.toml"));
            candidates.push(cwd.join("secrets.toml"));
        }
        candidates.push(data_dir.join("secrets.toml"));

        for path in candidates {
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(parsed) = toml::from_str::<SecretsFile>(&raw) {
                    return Some(parsed);
                }
            }
        }
        None
    }
}

fn read_non_empty_env(keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(val) = std::env::var(key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}
