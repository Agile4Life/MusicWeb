use std::sync::OnceLock;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::lossy::{
    lossy_opt_bool, lossy_opt_f64, lossy_opt_string, lossy_opt_u32, lossy_opt_vec,
    lossy_playlist_name, lossy_title, lossy_vec,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Track {
    #[serde(deserialize_with = "lossy_id")]
    pub id: String,
    #[serde(default = "default_title", deserialize_with = "lossy_title")]
    pub title: String,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub artist: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub album: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_f64")]
    pub duration: Option<f64>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub cover_url: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub youtube_id: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub spotify_id: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub nhaccuatui_id: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub soundcloud_id: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub soundcloud_permalink_url: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub file_path: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub source: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_f64")]
    pub disc_number: Option<f64>,
    #[serde(default, deserialize_with = "lossy_opt_f64")]
    pub track_number: Option<f64>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub spotify_album_id: Option<String>,
}

fn default_title() -> String {
    "Không có tên".to_string()
}

fn lossy_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match crate::lossy::lossy_opt_string(deserializer)? {
        Some(s) if !s.trim().is_empty() => Ok(s),
        _ => Err(serde::de::Error::custom("missing or empty id")),
    }
}

impl Track {
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            artist: None,
            album: None,
            duration: None,
            cover_url: None,
            youtube_id: None,
            spotify_id: None,
            nhaccuatui_id: None,
            soundcloud_id: None,
            soundcloud_permalink_url: None,
            file_path: None,
            source: None,
            disc_number: None,
            track_number: None,
            spotify_album_id: None,
        }
    }

    pub fn artist_name(&self) -> &str {
        match self.artist.as_deref() {
            Some(a) if !a.trim().is_empty() => a,
            _ => "Nghệ sĩ chưa xác định",
        }
    }

    /// First credited artist ("A, B & C" -> "A"), for artist lookups and NCT matching.
    pub fn primary_artist(&self) -> Option<String> {
        let raw = self.artist.as_deref()?;
        let first = raw.split([',', '&']).next()?.trim();
        if first.is_empty() {
            None
        } else {
            Some(first.to_string())
        }
    }

    /// Rows from the Supabase `tracks` table use UUID primary keys.
    pub fn is_persisted(&self) -> bool {
        Uuid::parse_str(self.id.trim()).is_ok()
    }

    pub fn soundcloud_numeric_id(&self) -> Option<String> {
        let candidates = [
            self.soundcloud_id.as_deref(),
            self.id.strip_prefix("sc-"),
            self.file_path
                .as_deref()
                .and_then(|p| p.strip_prefix("soundcloud:")),
        ];
        candidates
            .into_iter()
            .flatten()
            .map(str::trim)
            .find(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            .map(ToString::to_string)
    }

    pub fn drive_file_id(&self) -> Option<String> {
        static DRIVE_RE: OnceLock<[Regex; 4]> = OnceLock::new();
        let path = self.file_path.as_deref()?.trim();
        if path.is_empty() {
            return None;
        }
        let regexes = DRIVE_RE.get_or_init(|| {
            [
                Regex::new(r"/d/([a-zA-Z0-9_-]{20,})").expect("valid regex"),
                Regex::new(r"[?&]id=([a-zA-Z0-9_-]{20,})").expect("valid regex"),
                Regex::new(r"[?&]fileId=([a-zA-Z0-9_-]{20,})").expect("valid regex"),
                Regex::new(r"drive-stream/([a-zA-Z0-9_-]{20,})").expect("valid regex"),
            ]
        });
        for re in regexes {
            if let Some(cap) = re.captures(path).and_then(|c| c.get(1)) {
                return Some(cap.as_str().to_string());
            }
        }
        None
    }

    pub fn external_keys(&self) -> Vec<String> {
        let mut keys = Vec::new();
        if let Some(id) = &self.spotify_id {
            if !id.is_empty() {
                keys.push(format!("spotify-{id}"));
            }
        }
        if let Some(id) = &self.youtube_id {
            if !id.is_empty() {
                keys.push(format!("yt-{id}"));
            }
        }
        if let Some(id) = &self.nhaccuatui_id {
            if !id.is_empty() {
                keys.push(format!("nct-{id}"));
            }
        }
        if let Some(sc) = self.soundcloud_numeric_id() {
            keys.push(format!("sc-{sc}"));
        }
        keys
    }

    pub fn fallback_file_path(&self) -> String {
        if let Some(p) = &self.file_path {
            if !p.trim().is_empty() {
                return p.clone();
            }
        }
        if let Some(id) = &self.spotify_id {
            if !id.is_empty() {
                return format!("spotify:{id}");
            }
        }
        if let Some(id) = &self.youtube_id {
            if !id.is_empty() {
                return format!("https://www.youtube.com/watch?v={id}");
            }
        }
        if let Some(id) = &self.nhaccuatui_id {
            if !id.is_empty() {
                return format!("nct:{id}");
            }
        }
        if let Some(id) = &self.soundcloud_id {
            if !id.is_empty() {
                return format!("soundcloud:{id}");
            }
        }
        if let Some(url) = &self.soundcloud_permalink_url {
            if !url.is_empty() {
                return url.clone();
            }
        }
        format!("ext:{}", self.id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Album {
    #[serde(deserialize_with = "lossy_id")]
    pub id: String,
    #[serde(default = "default_album_name", deserialize_with = "lossy_title")]
    pub name: String,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub artist: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub cover_url: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub release_date: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub album_type: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_u32")]
    pub total_tracks: Option<u32>,
    #[serde(default, deserialize_with = "lossy_opt_vec")]
    pub tracks: Option<Vec<Track>>,
}

fn default_album_name() -> String {
    "Album".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Playlist {
    #[serde(deserialize_with = "lossy_id")]
    pub id: String,
    #[serde(default = "default_pl_name", deserialize_with = "lossy_playlist_name")]
    pub name: String,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub cover_url: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_bool")]
    pub is_public: Option<bool>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub user_id: Option<String>,
}

fn default_pl_name() -> String {
    "Playlist".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryItem {
    #[serde(deserialize_with = "lossy_id")]
    pub id: String,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub played_at: Option<String>,
    #[serde(default)]
    pub track: Option<Track>,
}

impl HistoryItem {
    pub fn played_date(&self) -> Option<DateTime<Utc>> {
        let s = self.played_at.as_deref()?;
        DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TopItem {
    pub track: Track,
    #[serde(rename = "playCount", default = "default_play_count", deserialize_with = "lossy_play_count")]
    pub play_count: u32,
}

fn default_play_count() -> u32 {
    1
}

fn lossy_play_count<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(crate::lossy::lossy_opt_u32(deserializer)?.unwrap_or(1))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArtistInfo {
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "lossy_title")]
    pub name: String,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub picture_xl: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub picture_big: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_f64")]
    pub nb_fan: Option<f64>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub source: Option<String>,
}

impl ArtistInfo {
    pub fn picture_url(&self) -> Option<&str> {
        self.picture_xl
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| self.picture_big.as_deref().filter(|s| !s.is_empty()))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LyricLine {
    pub id: usize,
    pub time: Option<f64>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Lyrics {
    pub lines: Vec<LyricLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SoundCloudUser {
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub username: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SoundCloudPlaylistSummary {
    #[serde(deserialize_with = "lossy_id")]
    pub id: String,
    #[serde(default = "default_pl_name", deserialize_with = "lossy_playlist_name")]
    pub title: String,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    pub artist: Option<String>,
    #[serde(alias = "artwork_url", default, deserialize_with = "lossy_opt_string")]
    pub cover_url: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_u32")]
    pub track_count: Option<u32>,
    #[serde(default, deserialize_with = "lossy_opt_vec")]
    pub tracks: Option<Vec<Track>>,
    #[serde(default)]
    pub user: Option<SoundCloudUser>,
}

impl SoundCloudPlaylistSummary {
    pub fn display_cover(&self) -> Option<&str> {
        self.cover_url
            .as_deref()
            .or_else(|| self.user.as_ref().and_then(|u| u.avatar_url.as_deref()))
            .filter(|s| !s.trim().is_empty())
    }

    pub fn creator_name(&self) -> Option<&str> {
        self.artist
            .as_deref()
            .or_else(|| self.user.as_ref().and_then(|u| u.username.as_deref()))
            .filter(|s| !s.trim().is_empty())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TracksEnvelope {
    #[serde(default, deserialize_with = "lossy_vec")]
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlbumResolveResult {
    #[serde(rename = "albumId", default, deserialize_with = "lossy_opt_string")]
    pub album_id: Option<String>,
    #[serde(rename = "albumName", default, deserialize_with = "lossy_opt_string")]
    pub album_name: Option<String>,
    #[serde(rename = "coverUrl", default, deserialize_with = "lossy_opt_string")]
    pub cover_url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_helpers_behave_like_ios() {
        let mut t = Track::new("sc-123456", "Test");
        t.artist = Some("Sơn Tùng M-TP, Onionn & Crew".into());
        assert_eq!(t.primary_artist().as_deref(), Some("Sơn Tùng M-TP"));
        assert!(!t.is_persisted());
        assert_eq!(t.soundcloud_numeric_id().as_deref(), Some("123456"));

        let mut db_track = Track::new("550e8400-e29b-41d4-a716-446655440000", "DB Song");
        db_track.file_path = Some("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view".into());
        assert!(db_track.is_persisted());
        assert_eq!(
            db_track.drive_file_id().as_deref(),
            Some("1AbCdEfGhIjKlMnOpQrStUvWxYz")
        );
    }
}

