use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use chrono::{Datelike, Utc};
use regex::Regex;
use serde::Deserialize;
use tokio::sync::RwLock;
use unicode_normalization::UnicodeNormalization;

use crate::error::ApiError;
use crate::lossy::{lossy_opt_f64, lossy_opt_string, lossy_vec};
use crate::models::Track;

const NCT_BASE: &str = "https://graph.nhaccuatui.com/api";

#[derive(Debug, Clone, Deserialize)]
struct Envelope<T> {
    code: Option<i64>,
    data: Option<T>,
}

#[derive(Debug, Clone, Deserialize)]
struct NctStream {
    #[serde(default, deserialize_with = "lossy_opt_string")]
    stream: Option<String>,
    #[serde(rename = "type", default, deserialize_with = "lossy_opt_string")]
    kind: Option<String>,
    #[serde(rename = "onlyVIP")]
    only_vip: Option<bool>,
    status: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct NctSong {
    #[serde(default, deserialize_with = "lossy_opt_string")]
    key: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    name: Option<String>,
    #[serde(rename = "artistName", default, deserialize_with = "lossy_opt_string")]
    artist_name: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    image: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_f64")]
    duration: Option<f64>,
    #[serde(rename = "streamURL", default, deserialize_with = "lossy_vec")]
    stream_url: Vec<NctStream>,
}

impl NctSong {
    fn best_stream(&self) -> Option<String> {
        let free: Vec<&NctStream> = self
            .stream_url
            .iter()
            .filter(|s| {
                s.only_vip != Some(true)
                    && s.status == Some(1)
                    && s.stream.as_deref().is_some_and(|u| !u.trim().is_empty())
            })
            .collect();

        let pick = free
            .iter()
            .find(|s| s.kind.as_deref() == Some("320"))
            .or_else(|| free.iter().find(|s| s.kind.as_deref() == Some("128")))
            .or_else(|| free.first());

        pick.and_then(|s| s.stream.clone())
    }

    fn into_track(self) -> Option<Track> {
        let key = self.key.filter(|k| !k.is_empty())?;
        let mut t = Track::new(
            format!("nct-{key}"),
            self.name.unwrap_or_else(|| "Không có tên".to_string()),
        );
        t.artist = self.artist_name;
        t.duration = self.duration;
        t.cover_url = self.image;
        t.nhaccuatui_id = Some(key);
        t.source = Some("nhaccuatui".to_string());
        Some(t)
    }
}

#[derive(Debug, Clone, Deserialize)]
struct NctChart {
    #[serde(default, deserialize_with = "lossy_opt_string")]
    title: Option<String>,
    #[serde(default, deserialize_with = "lossy_opt_string")]
    name: Option<String>,
    #[serde(default, deserialize_with = "lossy_vec")]
    items: Vec<NctSong>,
}

#[derive(Debug, Clone, Deserialize)]
struct NctSearchAll {
    #[serde(default, deserialize_with = "lossy_vec")]
    songs: Vec<NctSong>,
}

#[derive(Debug, Clone)]
struct CachedNctStream {
    url: String,
    expires_at_unix: i64,
}

#[derive(Clone)]
pub struct NctClient {
    http: reqwest::Client,
    streams: Arc<RwLock<HashMap<String, CachedNctStream>>>,
}

impl NctClient {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            streams: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn chart_keys() -> Vec<String> {
        let year = Utc::now().year();
        vec![
            format!("1-5-d7-{year}"),
            format!("1-5-d7-{}", year - 1),
            format!("1-5-d360-{}", year - 1),
        ]
    }

    pub async fn chart(&self) -> Result<(String, Vec<Track>), ApiError> {
        for key in Self::chart_keys() {
            let path = format!("v1/playlist/charts/{key}");
            if let Ok(chart) = self.get::<NctChart>(&path, &[("key", &key)]).await {
                if !chart.items.is_empty() {
                    self.remember_all(&chart.items).await;
                    let title = chart
                        .title
                        .or(chart.name)
                        .unwrap_or_else(|| "Top 50 NhacCuaTui".to_string());
                    let tracks = chart
                        .items
                        .into_iter()
                        .filter_map(NctSong::into_track)
                        .collect();
                    return Ok((title, tracks));
                }
            }
        }
        Err(ApiError::Server(Some(
            "Không tải được bảng xếp hạng NhacCuaTui.".to_string(),
        )))
    }

    pub async fn search(&self, keyword: &str) -> Result<Vec<Track>, ApiError> {
        let r: NctSearchAll = self
            .get("v3/search/all", &[("keyword", keyword), ("correct", "false")])
            .await?;
        self.remember_all(&r.songs).await;
        Ok(r.songs.into_iter().filter_map(NctSong::into_track).collect())
    }

    pub async fn stream_url(&self, key: &str, fresh: bool) -> Result<Option<String>, ApiError> {
        if !fresh {
            let now = Utc::now().timestamp();
            let guard = self.streams.read().await;
            if let Some(hit) = guard.get(key) {
                if hit.expires_at_unix > now + 120 {
                    return Ok(Some(hit.url.clone()));
                }
            }
        }
        let path = format!("v1/song/detail/{key}");
        let song: NctSong = self
            .get(&path, &[("key", key), ("isDailyMix", "false")])
            .await?;
        let best = song.best_stream();
        self.remember(&song).await;
        Ok(best)
    }

    /// Finds the same song on NCT for metadata-only tracks (Spotify trending, albums).
    pub async fn match_track(&self, track: &Track) -> Option<String> {
        let title = fold(&track.title);
        if title.is_empty() {
            return None;
        }
        let artist = fold(
            track
                .primary_artist()
                .as_deref()
                .or(track.artist.as_deref())
                .unwrap_or(""),
        );
        let keyword = format!(
            "{} {}",
            track.title,
            track.primary_artist().as_deref().unwrap_or("")
        );
        let found: NctSearchAll = self
            .get(
                "v3/search/all",
                &[("keyword", keyword.trim()), ("correct", "false")],
            )
            .await
            .ok()?;

        let matched = found.songs.into_iter().find(|s| {
            let t = fold(s.name.as_deref().unwrap_or(""));
            let a = fold(s.artist_name.as_deref().unwrap_or(""));
            let title_ok =
                t == title || t.starts_with(&format!("{title} ")) || title.starts_with(&format!("{t} "));
            let artist_ok = artist.is_empty() || a.contains(&artist) || artist.contains(&a);
            let td = track.duration.unwrap_or(0.0);
            let sd = s.duration.unwrap_or(0.0);
            let duration_ok = td <= 0.0 || sd <= 0.0 || (td - sd).abs() <= 10.0;
            title_ok && artist_ok && duration_ok
        });

        if let Some(song) = matched {
            let key = song.key.clone();
            self.remember(&song).await;
            key
        } else {
            None
        }
    }

    pub async fn clear_cache(&self) {
        self.streams.write().await.clear();
    }

    async fn get<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T, ApiError> {
        let ts = Utc::now().timestamp_millis().to_string();
        let mut url = url::Url::parse(&format!("{NCT_BASE}/{path}"))
            .map_err(|e| ApiError::Network(e.to_string()))?;
        {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in query {
                pairs.append_pair(k, v);
            }
            pairs.append_pair("timestamp", &ts);
        }

        let res = self
            .http
            .get(url)
            .header("Accept", "application/json")
            .header("Referer", "https://www.nhaccuatui.com/")
            .timeout(std::time::Duration::from_secs(12))
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        if !res.status().is_success() {
            return Err(ApiError::Server(None));
        }

        let env: Envelope<T> = res
            .json()
            .await
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        if env.code != Some(0) {
            return Err(ApiError::Server(None));
        }
        env.data
            .ok_or_else(|| ApiError::Decode("Missing NCT data".to_string()))
    }

    async fn remember_all(&self, songs: &[NctSong]) {
        for s in songs {
            self.remember(s).await;
        }
    }

    async fn remember(&self, song: &NctSong) {
        let Some(key) = song.key.as_deref().filter(|k| !k.is_empty()) else {
            return;
        };
        let Some(url) = song.best_stream() else {
            return;
        };
        let expires_at_unix = url::Url::parse(&url)
            .ok()
            .and_then(|u| {
                u.query_pairs()
                    .find(|(k, _)| k == "e")
                    .and_then(|(_, v)| v.parse::<i64>().ok())
            })
            .unwrap_or_else(|| Utc::now().timestamp() + 3600);

        self.streams.write().await.insert(
            key.to_string(),
            CachedNctStream {
                url,
                expires_at_unix,
            },
        );
    }
}

/// Lowercased, Vietnamese diacritic-free, annotation-free text for catalog matching.
pub fn fold(input: &str) -> String {
    static BRACKET_RE: OnceLock<Regex> = OnceLock::new();
    let re = BRACKET_RE
        .get_or_init(|| Regex::new(r"\([^)]*\)|\[[^\]]*\]").expect("valid bracket regex"));

    let stripped = re.replace_all(input, " ");
    let replaced = stripped.replace(['đ', 'Đ'], "d");
    let decomposed: String = replaced
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect();

    let lowered = decomposed.to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut prev_space = true;
    for ch in lowered.chars() {
        if ch.is_alphanumeric() {
            out.push(ch);
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_handles_vietnamese_diacritics_and_annotations() {
        assert_eq!(
            fold("Đừng Làm Trái Tim Anh Đau (Live Version) [2024]"),
            "dung lam trai tim anh dau"
        );
        assert_eq!(fold("Sơn Tùng M-TP"), "son tung m tp");
    }
}

