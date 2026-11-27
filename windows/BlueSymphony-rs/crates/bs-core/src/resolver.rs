use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::RwLock;

use crate::api::ApiClient;
use crate::config::API_BASE;
use crate::models::Track;
use crate::nct::NctClient;

const HIT_TTL: Duration = Duration::from_secs(5 * 60);
const MISS_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
struct CacheEntry {
    url: Option<String>,
    expires_at: Instant,
    generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct ResolveResponse {
    miss: Option<bool>,
    source: Option<String>,
    #[serde(rename = "resolvedId")]
    resolved_id: Option<String>,
    #[serde(rename = "streamUrl")]
    stream_url: Option<String>,
}

#[derive(Clone)]
pub struct StreamResolver {
    api: ApiClient,
    nct: NctClient,
    cache: Arc<RwLock<HashMap<String, CacheEntry>>>,
    generations: Arc<RwLock<HashMap<String, u64>>>,
}

impl StreamResolver {
    pub fn new(api: ApiClient, nct: NctClient) -> Self {
        Self {
            api,
            nct,
            cache: Arc::new(RwLock::new(HashMap::new())),
            generations: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn clear_cache(&self) {
        self.cache.write().await.clear();
        self.nct.clear_cache().await;
    }

    /// Resolves a track's playable audio URL, mirroring `API.swift` & `clientResolutionService.ts`.
    pub async fn resolve_url(&self, track: &Track, invalidate: bool) -> Option<String> {
        // 1. Direct NhacCuaTui ID
        if let Some(key) = track.nhaccuatui_id.as_deref().filter(|k| !k.is_empty()) {
            if let Ok(Some(url)) = self.nct.stream_url(key, invalidate).await {
                return Some(url);
            }
        }

        // 2. SoundCloud deterministic stream route
        if let Some(sc_id) = track.soundcloud_numeric_id() {
            return Some(soundcloud_stream_url(&sc_id, invalidate));
        }

        // 3. Google Drive or direct uploaded Supabase Storage URL
        if let Some(drive_id) = track.drive_file_id() {
            return Some(drive_stream_url(&drive_id));
        }
        if let Some(fp) = track.file_path.as_deref() {
            if fp.starts_with("https://") && !fp.contains("youtube.com") && !fp.contains("youtu.be")
            {
                if fp.contains("supabase.co/storage") || fp.ends_with(".mp3") || fp.ends_with(".flac")
                    || fp.ends_with(".m4a") || fp.ends_with(".wav")
                {
                    return Some(fp.to_string());
                }
            } else if fp.starts_with("/api/") {
                return Some(format!("{API_BASE}{fp}"));
            }
        }

        let cache_key = track.id.clone();
        let generation = if invalidate {
            let mut gens = self.generations.write().await;
            let next = gens.get(&cache_key).copied().unwrap_or(0) + 1;
            gens.insert(cache_key.clone(), next);
            self.cache.write().await.remove(&cache_key);
            next
        } else {
            let current_gen = self
                .generations
                .read()
                .await
                .get(&cache_key)
                .copied()
                .unwrap_or(0);
            if let Some(hit) = self.cache.read().await.get(&cache_key) {
                if hit.generation == current_gen && hit.expires_at > Instant::now() {
                    return hit.url.clone();
                }
            }
            current_gen
        };

        // 4. Cross-catalog match on NCT first (handles Spotify trending/albums cleanly)
        if let Some(nct_key) = self.nct.match_track(track).await {
            if let Ok(Some(url)) = self.nct.stream_url(&nct_key, invalidate).await {
                self.store_cache(cache_key, Some(url.clone()), generation)
                    .await;
                return Some(url);
            }
        }

        // 5. Backend unified resolver
        let dur_str = track
            .duration
            .filter(|d| *d > 0.0)
            .map(|d| (d.round() as i64).to_string());
        let mut query = vec![("title", track.title.as_str())];
        if let Some(a) = track.artist.as_deref().filter(|s| !s.is_empty()) {
            query.push(("artist", a));
        }
        if let Some(ref d) = dur_str {
            query.push(("duration", d.as_str()));
        }
        if let Some(al) = track.album.as_deref().filter(|s| !s.is_empty()) {
            query.push(("album", al));
        }
        if invalidate {
            query.push(("invalidate", "1"));
        }

        let resolved_from_server = self
            .api
            .get_json::<ResolveResponse>("api/resolve-stream", &query)
            .await
            .ok()
            .and_then(|r| url_from_resolve(&r));

        // 6. YouTube last resort (never bypass PO token or fetch googlevideo directly)
        let final_url = resolved_from_server.or_else(|| {
            track
                .youtube_id
                .as_deref()
                .filter(|id| !id.is_empty())
                .map(youtube_stream_url)
        });

        self.store_cache(cache_key, final_url.clone(), generation)
            .await;
        final_url
    }

    /// Touches the first two bytes so edge workers warm the stream cache before the next track starts.
    pub fn prewarm(&self, track: Track) {
        let resolver = self.clone();
        let http = self.api.http().clone();
        tokio::spawn(async move {
            let Some(url) = resolver.resolve_url(&track, false).await else {
                return;
            };
            let _ = http
                .get(&url)
                .header("Range", "bytes=0-1")
                .timeout(Duration::from_secs(20))
                .send()
                .await;
        });
    }

    async fn store_cache(&self, key: String, url: Option<String>, expected_gen: u64) {
        let current_gen = self
            .generations
            .read()
            .await
            .get(&key)
            .copied()
            .unwrap_or(0);
        if current_gen != expected_gen {
            return;
        }
        let ttl = if url.is_some() { HIT_TTL } else { MISS_TTL };
        let mut cache = self.cache.write().await;
        if cache.len() >= 300 {
            cache.clear();
        }
        cache.insert(
            key,
            CacheEntry {
                url,
                expires_at: Instant::now() + ttl,
                generation: expected_gen,
            },
        );
    }
}

fn url_from_resolve(r: &ResolveResponse) -> Option<String> {
    if r.miss == Some(true) {
        return None;
    }
    if let Some(s) = r.stream_url.as_deref().filter(|s| !s.is_empty()) {
        if s.starts_with("http") {
            return Some(s.to_string());
        }
        return Some(format!("{API_BASE}/{path}", path = s.trim_start_matches('/')));
    }
    if r.source.as_deref() == Some("youtube") {
        if let Some(id) = r.resolved_id.as_deref().filter(|id| !id.is_empty()) {
            return Some(youtube_stream_url(id));
        }
    }
    None
}

pub fn soundcloud_stream_url(id: &str, refresh: bool) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(id.as_bytes()).collect();
    if refresh {
        format!("{API_BASE}/api/soundcloud/stream?id={encoded}&refresh=1")
    } else {
        format!("{API_BASE}/api/soundcloud/stream?id={encoded}")
    }
}

pub fn drive_stream_url(file_id: &str) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(file_id.as_bytes()).collect();
    format!("{API_BASE}/api/drive-stream?fileId={encoded}")
}

pub fn youtube_stream_url(id: &str) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(id.as_bytes()).collect();
    format!("{API_BASE}/api/yt-stream?id={encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_from_resolve_handles_relative_and_miss() {
        let hit = ResolveResponse {
            miss: None,
            source: Some("soundcloud".into()),
            resolved_id: Some("123".into()),
            stream_url: Some("/api/soundcloud/stream?id=123".into()),
        };
        assert_eq!(
            url_from_resolve(&hit).as_deref(),
            Some("https://www.bluesymphony.site/api/soundcloud/stream?id=123")
        );

        let miss = ResolveResponse {
            miss: Some(true),
            source: None,
            resolved_id: None,
            stream_url: None,
        };
        assert!(url_from_resolve(&miss).is_none());
    }
}
