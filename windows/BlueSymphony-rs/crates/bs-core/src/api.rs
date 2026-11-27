use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use cookie_store::CookieStore;
use regex::Regex;
use reqwest::header::{CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, Method};
use reqwest_cookie_store::CookieStoreMutex;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::config::{API_BASE, AppConfig};
use crate::error::ApiError;
use crate::lossy::lossy_vec;
use crate::models::{
    Album, AlbumResolveResult, ArtistInfo, SoundCloudPlaylistSummary, Track, TracksEnvelope,
};

#[derive(Clone)]
pub struct ApiClient {
    http: Client,
    cookie_store: Arc<CookieStoreMutex>,
    cookie_file: PathBuf,
    base_url: Url,
}

impl ApiClient {
    pub fn new(config: &AppConfig) -> Result<Self, ApiError> {
        let cookie_file = config.session_cookie_path();
        let store = load_cookies_dpapi(&cookie_file).unwrap_or_default();
        let cookie_store = Arc::new(CookieStoreMutex::new(store));

        let http = Client::builder()
            .cookie_provider(Arc::clone(&cookie_store))
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("BlueSymphony-Windows/0.1.0")
            .build()
            .map_err(|e| ApiError::Network(e.to_string()))?;

        let base_url = Url::parse(API_BASE).expect("valid API_BASE");

        Ok(Self {
            http,
            cookie_store,
            cookie_file,
            base_url,
        })
    }

    pub fn http(&self) -> &Client {
        &self.http
    }

    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    pub fn persist_cookies(&self) {
        let serialized = {
            let guard = match self.cookie_store.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let mut buf = Vec::new();
            if cookie_store::serde::json::save(&guard, &mut buf).is_err() {
                return;
            }
            buf
        };

        if let Ok(encrypted) = bs_win::dpapi::protect(&serialized) {
            if let Some(parent) = self.cookie_file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&self.cookie_file, encrypted);
        }
    }

    pub fn clear_cookies(&self) {
        if let Ok(mut guard) = self.cookie_store.lock() {
            guard.clear();
        }
        let _ = std::fs::remove_file(&self.cookie_file);
    }

    pub fn import_web_cookies(&self, cookies: &[bs_win::web_login::WebCookie]) {
        if let Ok(mut guard) = self.cookie_store.lock() {
            guard.clear();
            for c in cookies {
                if c.name.trim().is_empty() {
                    continue;
                }
                let path = if c.path.trim().is_empty() { "/" } else { c.path.trim() };
                let mut header = format!("{}={}; Path={path}", c.name.trim(), c.value);
                let dom = c.domain.trim();
                if !dom.is_empty() && !c.name.starts_with("__Host-") {
                    header.push_str(&format!("; Domain={dom}"));
                }
                if c.is_secure || c.name.starts_with("__Secure-") || c.name.starts_with("__Host-")
                {
                    header.push_str("; Secure");
                }
                if c.is_http_only {
                    header.push_str("; HttpOnly");
                }
                let _ = guard.parse(&header, &self.base_url);
            }
        }
        self.persist_cookies();
    }

    pub fn endpoint_url(&self, path: &str, query: &[(&str, &str)]) -> Result<Url, ApiError> {
        let trimmed = path.trim_start_matches('/');
        let mut url = self
            .base_url
            .join(trimmed)
            .map_err(|e| ApiError::Network(e.to_string()))?;
        if !query.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in query {
                pairs.append_pair(k, v);
            }
        }
        Ok(url)
    }

    pub async fn send_raw<B: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<&B>,
    ) -> Result<Vec<u8>, ApiError> {
        let url = self.endpoint_url(path, query)?;
        let mut req = self.http.request(method, url);
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await.map_err(|e| ApiError::Network(e.to_string()))?;
        let status = res.status();
        let bytes = res
            .bytes()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?
            .to_vec();

        if status.as_u16() == 401 {
            return Err(ApiError::Unauthorized);
        }
        if !status.is_success() {
            let message = serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .and_then(|s| s.as_str())
                        .or_else(|| v.get("message").and_then(|s| s.as_str()))
                        .map(ToString::to_string)
                });
            return Err(ApiError::Server(message));
        }

        Ok(bytes)
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T, ApiError> {
        let bytes = self
            .send_raw::<serde_json::Value>(Method::GET, path, query, None)
            .await?;
        serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(e.to_string()))
    }

    pub async fn post_json<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ApiError> {
        let bytes = self.send_raw(Method::POST, path, &[], Some(body)).await?;
        serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(e.to_string()))
    }

    pub async fn post_void<B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(), ApiError> {
        let _ = self.send_raw(Method::POST, path, &[], Some(body)).await?;
        Ok(())
    }

    pub async fn patch_json<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ApiError> {
        let bytes = self.send_raw(Method::PATCH, path, &[], Some(body)).await?;
        serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(e.to_string()))
    }

    pub async fn delete_void(&self, path: &str, query: &[(&str, &str)]) -> Result<(), ApiError> {
        let _ = self
            .send_raw::<serde_json::Value>(Method::DELETE, path, query, None)
            .await?;
        Ok(())
    }

    pub async fn post_form(
        &self,
        path: &str,
        fields: &[(&str, &str)],
    ) -> Result<Vec<u8>, ApiError> {
        let url = self.endpoint_url(path, &[])?;
        let res = self
            .http
            .post(url)
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(USER_AGENT, "BlueSymphony-Windows/0.1.0")
            .form(fields)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        let bytes = res
            .bytes()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?
            .to_vec();
        Ok(bytes)
    }

    // ---- Public Discovery Endpoints ----

    pub async fn trending(&self) -> Result<Vec<Track>, ApiError> {
        let env: TracksEnvelope = self.get_json("api/trending", &[]).await?;
        Ok(env.tracks)
    }

    pub async fn new_releases(&self) -> Result<Vec<Album>, ApiError> {
        let bytes = self
            .send_raw::<serde_json::Value>(Method::GET, "api/albums/new-releases", &[], None)
            .await?;
        let raw: Vec<serde_json::Value> =
            serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(e.to_string()))?;
        Ok(raw
            .into_iter()
            .filter_map(|v| serde_json::from_value::<Album>(v).ok())
            .collect())
    }

    pub async fn album(&self, id: &str) -> Result<Album, ApiError> {
        let encoded = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
        match self.get_json(&format!("api/albums/{encoded}"), &[]).await {
            Ok(alb) => Ok(alb),
            Err(err) => {
                let numeric_id = id
                    .trim()
                    .strip_prefix("deezer-")
                    .or_else(|| id.trim().strip_prefix("dz-"))
                    .unwrap_or(id.trim());
                if !numeric_id.is_empty() && numeric_id.bytes().all(|b| b.is_ascii_digit()) {
                    if let Ok(alb) = self.fetch_deezer_album_detail(numeric_id).await {
                        return Ok(alb);
                    }
                }
                Err(err)
            }
        }
    }

    pub async fn resolve_album(
        &self,
        title: &str,
        artist: Option<&str>,
        album: Option<&str>,
        track_id: Option<&str>,
    ) -> Result<AlbumResolveResult, ApiError> {
        let mut query = vec![("title", title)];
        if let Some(a) = artist.filter(|s| !s.is_empty()) {
            query.push(("artist", a));
        }
        if let Some(al) = album.filter(|s| !s.is_empty()) {
            query.push(("album", al));
        }
        if let Some(id) = track_id.filter(|s| !s.is_empty()) {
            query.push(("track_id", id));
        }
        match self
            .get_json::<AlbumResolveResult>("api/albums/resolve", &query)
            .await
        {
            Ok(res) if res.album_id.is_some() => return Ok(res),
            Ok(_) => {
                tracing::warn!(
                    "api/albums/resolve returned no album_id for title={title:?}; trying search fallback"
                );
            }
            Err(err) => {
                tracing::warn!(
                    "api/albums/resolve failed ({err}); falling back to client-side album/Deezer search"
                );
            }
        }

        Ok(self.resolve_album_via_search(title, artist, album).await)
    }

    async fn resolve_album_via_search(
        &self,
        title: &str,
        artist: Option<&str>,
        album: Option<&str>,
    ) -> AlbumResolveResult {
        let artist_clean = artist.map(str::trim).filter(|s| !s.is_empty());
        let primary_artist = artist_clean.and_then(extract_primary_artist);
        let album_clean = album.map(str::trim).filter(|s| is_real_album_hint(s));
        let clean_title = clean_title_for_search(title);
        let title_fallback = if clean_title.is_empty() {
            title.trim().to_string()
        } else {
            clean_title
        };

        let target_album_l = album_clean.map(|s| s.to_ascii_lowercase());
        let target_artist_l = primary_artist
            .or(artist_clean)
            .map(|s| s.to_ascii_lowercase());
        let target_title_l = title_fallback.to_ascii_lowercase();

        // Pass 1: When caller provided a real album name, search albums directly (with Deezer fallback).
        if let Some(al) = album_clean {
            let mut pass1_queries: Vec<String> = Vec::new();
            if let Some(ar) = primary_artist {
                pass1_queries.push(format!("{ar} {al}"));
            }
            if !pass1_queries.iter().any(|q| q == al) {
                pass1_queries.push(al.to_string());
            }
            for q in pass1_queries {
                if let Ok(albums) = self.search_albums(&q).await {
                    if let Some((score, cand)) = pick_best_album_candidate(
                        albums,
                        target_album_l.as_deref(),
                        target_artist_l.as_deref(),
                        &target_title_l,
                    ) {
                        if score >= 40 {
                            return AlbumResolveResult {
                                album_id: Some(cand.id),
                                album_name: Some(cand.name),
                                cover_url: cand.cover_url,
                            };
                        }
                    }
                }
            }
        }

        // Pass 2: Deezer track-to-album resolution (works even without album tag).
        if !title_fallback.is_empty() {
            let mut track_queries: Vec<String> = Vec::new();
            if let Some(ar) = primary_artist {
                track_queries.push(format!("{ar} {title_fallback}"));
            }
            if !track_queries.iter().any(|q| q == &title_fallback) {
                track_queries.push(title_fallback.clone());
            }
            for q in track_queries {
                match self.search_deezer_tracks(&q, 15).await {
                    Ok(items) => {
                        if let Some(res) = pick_best_deezer_track_album(
                            &items,
                            &title_fallback,
                            primary_artist.or(artist_clean),
                            album_clean,
                        ) {
                            return res;
                        }
                    }
                    Err(err) => {
                        tracing::warn!("Deezer track search fallback failed for q={q:?}: {err}");
                    }
                }
            }
        }

        // Pass 3: Final album search fallback using title + artist.
        if !title_fallback.is_empty() {
            let q = match primary_artist {
                Some(ar) => format!("{title_fallback} {ar}"),
                None => title_fallback.clone(),
            };
            if let Ok(albums) = self.search_albums(&q).await {
                if let Some((score, cand)) = pick_best_album_candidate(
                    albums,
                    target_album_l.as_deref(),
                    target_artist_l.as_deref(),
                    &target_title_l,
                ) {
                    if score >= 20 {
                        return AlbumResolveResult {
                            album_id: Some(cand.id),
                            album_name: Some(cand.name),
                            cover_url: cand.cover_url,
                        };
                    }
                }
            }
        }

        AlbumResolveResult {
            album_id: None,
            album_name: None,
            cover_url: None,
        }
    }

    async fn search_deezer_albums(&self, q: &str, limit: usize) -> Result<Vec<Album>, ApiError> {
        let trimmed = q.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let encoded = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect::<String>();
        let url = format!("https://api.deezer.com/search/album?q={encoded}&limit={limit}");
        let res = self
            .http
            .get(&url)
            .header(USER_AGENT, "BlueSymphony-Windows/0.1.0")
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        if !res.status().is_success() {
            return Err(ApiError::Server(Some(format!(
                "Deezer album search failed ({})",
                res.status()
            ))));
        }
        let body: DeezerAlbumSearchResp = res
            .json()
            .await
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        Ok(body
            .data
            .into_iter()
            .filter_map(|item| {
                let name = item.title.as_deref().map(str::trim).filter(|s| !s.is_empty())?.to_string();
                let cover_url = item.best_cover();
                Some(Album {
                    id: item.id.to_string(),
                    name,
                    artist: item.artist.and_then(|a| a.name),
                    cover_url,
                    release_date: item.release_date,
                    album_type: item.record_type,
                    total_tracks: item.nb_tracks,
                    tracks: None,
                })
            })
            .collect())
    }

    async fn search_deezer_tracks(
        &self,
        q: &str,
        limit: usize,
    ) -> Result<Vec<DeezerTrackItem>, ApiError> {
        let trimmed = q.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let encoded = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect::<String>();
        let url = format!("https://api.deezer.com/search/track?q={encoded}&limit={limit}");
        let res = self
            .http
            .get(&url)
            .header(USER_AGENT, "BlueSymphony-Windows/0.1.0")
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        if !res.status().is_success() {
            return Err(ApiError::Server(Some(format!(
                "Deezer track search failed ({})",
                res.status()
            ))));
        }
        let body: DeezerTrackSearchResp = res
            .json()
            .await
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        Ok(body.data)
    }

    async fn fetch_deezer_album_detail(&self, numeric_id: &str) -> Result<Album, ApiError> {
        let url = format!("https://api.deezer.com/album/{numeric_id}");
        let res = self
            .http
            .get(&url)
            .header(USER_AGENT, "BlueSymphony-Windows/0.1.0")
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        if !res.status().is_success() {
            return Err(ApiError::Server(Some(format!(
                "Deezer album detail failed ({})",
                res.status()
            ))));
        }
        let detail: DeezerAlbumDetailResp = res
            .json()
            .await
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        let album_name = detail
            .title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Album")
            .to_string();
        let cover_url = detail.best_cover();
        let album_artist = detail.artist.and_then(|a| a.name);

        let tracks = detail.tracks.map(|wrap| {
            wrap.data
                .into_iter()
                .enumerate()
                .filter_map(|(idx, t)| {
                    let title = t
                        .title
                        .or(t.title_short)
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())?;
                    let mut track = Track::new(format!("deezer-{}", t.id), title);
                    track.artist = t
                        .artist
                        .and_then(|a| a.name)
                        .or_else(|| album_artist.clone());
                    track.album = Some(album_name.clone());
                    track.duration = t.duration;
                    track.cover_url = cover_url.clone();
                    track.track_number = Some((idx + 1) as f64);
                    track.source = Some("deezer".to_string());
                    Some(track)
                })
                .collect::<Vec<_>>()
        });

        Ok(Album {
            id: detail.id.to_string(),
            name: album_name,
            artist: album_artist,
            cover_url,
            release_date: detail.release_date,
            album_type: detail.record_type,
            total_tracks: detail.nb_tracks,
            tracks,
        })
    }

    pub async fn search_spotify(&self, q: &str) -> Result<Vec<Track>, ApiError> {
        let env: TracksEnvelope = self.get_json("api/spotify/search", &[("q", q)]).await?;
        Ok(env.tracks)
    }

    pub async fn search_soundcloud(&self, q: &str) -> Result<Vec<Track>, ApiError> {
        let env: TracksEnvelope = self.get_json("api/soundcloud/search", &[("q", q)]).await?;
        Ok(env.tracks)
    }

    pub async fn soundcloud_explore(&self, tag: &str, limit: usize) -> Result<Vec<Track>, ApiError> {
        let limit_str = limit.to_string();
        let env: TracksEnvelope = self
            .get_json(
                "api/soundcloud/explore",
                &[("tag", tag), ("limit", &limit_str)],
            )
            .await?;
        Ok(env.tracks)
    }

    pub async fn soundcloud_playlists(
        &self,
        q: &str,
        limit: usize,
    ) -> Result<Vec<SoundCloudPlaylistSummary>, ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            #[serde(default, deserialize_with = "lossy_vec")]
            playlists: Vec<SoundCloudPlaylistSummary>,
        }
        let limit_str = limit.to_string();
        let r: Reply = self
            .get_json("api/soundcloud/playlists", &[("q", q), ("limit", &limit_str)])
            .await?;
        Ok(r.playlists)
    }

    pub async fn soundcloud_playlist_detail(
        &self,
        id: &str,
    ) -> Result<(Option<SoundCloudPlaylistSummary>, Vec<Track>), ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            playlist: Option<SoundCloudPlaylistSummary>,
            #[serde(default, deserialize_with = "lossy_vec")]
            tracks: Vec<Track>,
        }
        let r: Reply = self
            .get_json("api/soundcloud/playlists", &[("id", id)])
            .await?;
        Ok((r.playlist, r.tracks))
    }

    pub async fn search_albums(&self, q: &str) -> Result<Vec<Album>, ApiError> {
        let server_res = match self
            .send_raw::<serde_json::Value>(Method::GET, "api/albums/search", &[("q", q)], None)
            .await
        {
            Ok(bytes) => serde_json::from_slice::<Vec<serde_json::Value>>(&bytes)
                .map(|raw| {
                    raw.into_iter()
                        .filter_map(|v| serde_json::from_value::<Album>(v).ok())
                        .collect::<Vec<_>>()
                })
                .ok(),
            Err(_) => None,
        };
        if let Some(list) = server_res.filter(|v| !v.is_empty()) {
            return Ok(list);
        }
        self.search_deezer_albums(q, 25).await
    }

    pub async fn artist(&self, name: &str) -> Result<(ArtistInfo, Vec<Track>), ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            artist: ArtistInfo,
            #[serde(rename = "topTracks", default, deserialize_with = "lossy_vec")]
            top_tracks: Vec<Track>,
        }
        let r: Reply = self.get_json("api/artist", &[("name", name)]).await?;
        Ok((r.artist, r.top_tracks))
    }

    pub async fn recommend(&self, seed: &Track, queue: &[Track]) -> Result<Vec<Track>, ApiError> {
        let history_ids: String = queue
            .iter()
            .rev()
            .take(50)
            .map(|t| t.id.as_str())
            .collect::<Vec<_>>()
            .join(",");
        let artist = seed.artist.as_deref().unwrap_or("");
        let mut query = vec![
            ("current_track_id", seed.id.as_str()),
            ("artist", artist),
            ("title", seed.title.as_str()),
            ("limit", "12"),
        ];
        if !history_ids.is_empty() {
            query.push(("history_ids", history_ids.as_str()));
        }
        let env: TracksEnvelope = self.get_json("api/queue/next", &query).await?;
        Ok(env.tracks)
    }
}

#[derive(Debug, Deserialize)]
struct DeezerArtist {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeezerAlbumItem {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    cover_xl: Option<String>,
    #[serde(default)]
    cover_big: Option<String>,
    #[serde(default)]
    cover_medium: Option<String>,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    nb_tracks: Option<u32>,
    #[serde(default)]
    record_type: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
    #[serde(default)]
    artist: Option<DeezerArtist>,
}

impl DeezerAlbumItem {
    fn best_cover(&self) -> Option<String> {
        self.cover_xl
            .as_deref()
            .or(self.cover_big.as_deref())
            .or(self.cover_medium.as_deref())
            .or(self.cover.as_deref())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    }
}

#[derive(Debug, Deserialize)]
struct DeezerAlbumSearchResp {
    #[serde(default)]
    data: Vec<DeezerAlbumItem>,
}

#[derive(Debug, Deserialize)]
struct DeezerTrackItem {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    title_short: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    artist: Option<DeezerArtist>,
    #[serde(default)]
    album: Option<DeezerAlbumItem>,
}

#[derive(Debug, Deserialize)]
struct DeezerTrackSearchResp {
    #[serde(default)]
    data: Vec<DeezerTrackItem>,
}

#[derive(Debug, Deserialize)]
struct DeezerAlbumDetailResp {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    cover_xl: Option<String>,
    #[serde(default)]
    cover_big: Option<String>,
    #[serde(default)]
    cover_medium: Option<String>,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
    #[serde(default)]
    record_type: Option<String>,
    #[serde(default)]
    nb_tracks: Option<u32>,
    #[serde(default)]
    artist: Option<DeezerArtist>,
    #[serde(default)]
    tracks: Option<DeezerTrackSearchResp>,
}

impl DeezerAlbumDetailResp {
    fn best_cover(&self) -> Option<String> {
        self.cover_xl
            .as_deref()
            .or(self.cover_big.as_deref())
            .or(self.cover_medium.as_deref())
            .or(self.cover.as_deref())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    }
}

fn is_real_album_hint(album: &str) -> bool {
    let lower = album.trim().to_ascii_lowercase();
    !lower.is_empty()
        && lower != "single"
        && lower != "unknown"
        && lower != "unknown album"
        && lower != "youtube music"
        && lower != "soundcloud single"
        && lower != "nhaccuatui"
        && !lower.starts_with("soundcloud")
}

fn extract_primary_artist(artist: &str) -> Option<&str> {
    let first = artist.split([',', '&', '/']).next()?.trim();
    let lower = first.to_ascii_lowercase();
    let trimmed = if let Some(idx) = lower.find(" feat.").or_else(|| lower.find(" ft.")) {
        first[..idx].trim()
    } else {
        first
    };
    (!trimmed.is_empty()).then_some(trimmed)
}

fn clean_title_for_search(title: &str) -> String {
    static NOISE_RE: OnceLock<Regex> = OnceLock::new();
    let re = NOISE_RE.get_or_init(|| {
        Regex::new(
            r"(?i)\s*[\(\[](?:[^)\]]*\b(?:official|music video|lyric(?:\s+video)?s?|audio|mv|hd|4k|visualizer|feat\.?|ft\.?|clean version|explicit)\b[^)\]]*)[\)\]]\s*$",
        )
        .expect("valid title regex")
    });
    let mut s = title.trim().to_string();
    loop {
        let next = re.replace(&s, "").trim().to_string();
        if next == s {
            break;
        }
        s = next;
    }
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn pick_best_album_candidate(
    albums: Vec<Album>,
    target_album_l: Option<&str>,
    target_artist_l: Option<&str>,
    target_title_l: &str,
) -> Option<(i32, Album)> {
    let mut best: Option<(i32, Album)> = None;
    for cand in albums {
        let mut score = 0_i32;
        let cand_name_l = cand.name.trim().to_ascii_lowercase();
        if let Some(al_l) = target_album_l {
            if cand_name_l == al_l {
                score += 100;
            } else if cand_name_l.contains(al_l) || al_l.contains(&cand_name_l) {
                score += 40;
            }
        }
        if let (Some(ar_l), Some(cand_ar)) = (target_artist_l, cand.artist.as_deref()) {
            let cand_ar_l = cand_ar.trim().to_ascii_lowercase();
            if !cand_ar_l.is_empty() && (cand_ar_l.contains(ar_l) || ar_l.contains(&cand_ar_l)) {
                score += 30;
            }
        }
        if !target_title_l.is_empty() && cand_name_l == target_title_l {
            score += 20;
        }
        if cand.total_tracks.unwrap_or(0) > 1 {
            score += 15;
        }
        if best.as_ref().is_none_or(|(b_score, _)| score > *b_score) {
            best = Some((score, cand));
        }
    }
    best
}

fn pick_best_deezer_track_album(
    items: &[DeezerTrackItem],
    clean_title: &str,
    artist: Option<&str>,
    album: Option<&str>,
) -> Option<AlbumResolveResult> {
    let target_title_l = clean_title.trim().to_ascii_lowercase();
    let target_artist_l = artist.map(|s| s.trim().to_ascii_lowercase()).filter(|s| !s.is_empty());
    let target_album_l = album.map(|s| s.trim().to_ascii_lowercase()).filter(|s| !s.is_empty());

    let mut best: Option<(i32, AlbumResolveResult)> = None;
    for item in items {
        let Some(ref alb) = item.album else {
            continue;
        };
        if alb.id == 0 {
            continue;
        }
        let Some(alb_title) = alb.title.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };

        let mut score = 0_i32;
        let cand_title_raw = item
            .title_short
            .as_deref()
            .or(item.title.as_deref())
            .unwrap_or("");
        let cand_title_l = clean_title_for_search(cand_title_raw).to_ascii_lowercase();
        if !target_title_l.is_empty() && !cand_title_l.is_empty() {
            if cand_title_l == target_title_l {
                score += 60;
            } else if cand_title_l.contains(&target_title_l) || target_title_l.contains(&cand_title_l) {
                score += 25;
            }
        }

        if let Some(ref ar_l) = target_artist_l {
            let cand_ar_l = item
                .artist
                .as_ref()
                .and_then(|a| a.name.as_deref())
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if !cand_ar_l.is_empty() {
                if cand_ar_l == *ar_l || cand_ar_l.contains(ar_l) || ar_l.contains(&cand_ar_l) {
                    score += 50;
                } else {
                    score -= 60;
                }
            }
        }

        let cand_alb_l = alb_title.to_ascii_lowercase();
        if let Some(ref al_l) = target_album_l {
            if cand_alb_l == *al_l {
                score += 80;
            } else if cand_alb_l.contains(al_l) || al_l.contains(&cand_alb_l) {
                score += 35;
            }
        }

        if alb.record_type.as_deref() == Some("album") || alb.nb_tracks.unwrap_or(0) > 1 {
            score += 15;
        } else if alb.nb_tracks == Some(1) && cand_alb_l == target_title_l {
            score -= 10;
        }

        if score >= 40 && best.as_ref().is_none_or(|(b_score, _)| score > *b_score) {
            best = Some((
                score,
                AlbumResolveResult {
                    album_id: Some(alb.id.to_string()),
                    album_name: Some(alb_title.to_string()),
                    cover_url: alb.best_cover(),
                },
            ));
        }
    }

    best.map(|(_, res)| res)
}

fn load_cookies_dpapi(path: &Path) -> Option<CookieStore> {
    let encrypted = std::fs::read(path).ok()?;
    if encrypted.is_empty() {
        return None;
    }
    let plain = bs_win::dpapi::unprotect(&encrypted).ok()?;
    cookie_store::serde::json::load(Cursor::new(plain)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_web_cookies_parses_secure_nextauth_cookies() {
        let cfg = AppConfig::load();
        let mut api = ApiClient::new(&cfg).expect("api");
        api.cookie_file = std::env::temp_dir().join("bs_test_web_cookies.dpapi");
        let cookies = [
            bs_win::web_login::WebCookie {
                name: "__Secure-next-auth.session-token".to_string(),
                value: "tok_12345".to_string(),
                domain: "www.bluesymphony.site".to_string(),
                path: "/".to_string(),
                is_secure: true,
                is_http_only: true,
            },
            bs_win::web_login::WebCookie {
                name: "next-auth.csrf-token".to_string(),
                value: "csrf_abc".to_string(),
                domain: "www.bluesymphony.site".to_string(),
                path: "/".to_string(),
                is_secure: false,
                is_http_only: true,
            },
        ];
        api.import_web_cookies(&cookies);
        let guard = api.cookie_store.lock().expect("lock");
        let matched: Vec<_> = guard
            .matches(api.base_url())
            .into_iter()
            .map(|c| (c.name().to_string(), c.value().to_string()))
            .collect();
        assert!(
            matched
                .iter()
                .any(|(n, v)| n == "__Secure-next-auth.session-token" && v == "tok_12345")
        );
        assert!(
            matched
                .iter()
                .any(|(n, v)| n == "next-auth.csrf-token" && v == "csrf_abc")
        );
        drop(guard);
        api.clear_cookies();
    }

    #[test]
    fn clean_title_for_search_strips_video_and_feat_suffixes() {
        assert_eq!(
            clean_title_for_search("drop dead (Official Music Video)"),
            "drop dead"
        );
        assert_eq!(
            clean_title_for_search("Sincerely [Lyrics] (feat. Artist)"),
            "Sincerely"
        );
        assert_eq!(clean_title_for_search("u + me = <3"), "u + me = <3");
    }

    #[test]
    fn pick_best_deezer_track_album_prefers_studio_album_over_single_and_filters_wrong_artist() {
        let wrong_artist_item = DeezerTrackItem {
            id: 1,
            title: Some("drop dead".to_string()),
            title_short: Some("drop dead".to_string()),
            duration: Some(180.0),
            artist: Some(DeezerArtist {
                name: Some("Random Artist".to_string()),
            }),
            album: Some(DeezerAlbumItem {
                id: 111,
                title: Some("drop dead".to_string()),
                cover_xl: None,
                cover_big: None,
                cover_medium: None,
                cover: None,
                nb_tracks: Some(10),
                record_type: Some("album".to_string()),
                release_date: None,
                artist: None,
            }),
        };
        let single_item = DeezerTrackItem {
            id: 2,
            title: Some("drop dead".to_string()),
            title_short: Some("drop dead".to_string()),
            duration: Some(224.0),
            artist: Some(DeezerArtist {
                name: Some("Olivia Rodrigo".to_string()),
            }),
            album: Some(DeezerAlbumItem {
                id: 963061451,
                title: Some("drop dead".to_string()),
                cover_xl: Some("https://example.com/single.jpg".to_string()),
                cover_big: None,
                cover_medium: None,
                cover: None,
                nb_tracks: Some(1),
                record_type: Some("single".to_string()),
                release_date: None,
                artist: None,
            }),
        };
        let studio_item = DeezerTrackItem {
            id: 3,
            title: Some("drop dead".to_string()),
            title_short: Some("drop dead".to_string()),
            duration: Some(224.0),
            artist: Some(DeezerArtist {
                name: Some("Olivia Rodrigo".to_string()),
            }),
            album: Some(DeezerAlbumItem {
                id: 1002561451,
                title: Some("you seem pretty sad for a girl so in love".to_string()),
                cover_xl: Some("https://example.com/album.jpg".to_string()),
                cover_big: None,
                cover_medium: None,
                cover: None,
                nb_tracks: Some(13),
                record_type: Some("album".to_string()),
                release_date: None,
                artist: None,
            }),
        };

        let resolved = pick_best_deezer_track_album(
            &[wrong_artist_item, single_item, studio_item],
            "drop dead",
            Some("Olivia Rodrigo"),
            None,
        )
        .expect("should resolve studio album");
        assert_eq!(resolved.album_id.as_deref(), Some("1002561451"));
        assert_eq!(
            resolved.album_name.as_deref(),
            Some("you seem pretty sad for a girl so in love")
        );

        let only_wrong = pick_best_deezer_track_album(
            &[DeezerTrackItem {
                id: 9,
                title: Some("unrelated".to_string()),
                title_short: None,
                duration: None,
                artist: Some(DeezerArtist {
                    name: Some("Someone Else".to_string()),
                }),
                album: Some(DeezerAlbumItem {
                    id: 99,
                    title: Some("Nope".to_string()),
                    cover_xl: None,
                    cover_big: None,
                    cover_medium: None,
                    cover: None,
                    nb_tracks: None,
                    record_type: None,
                    release_date: None,
                    artist: None,
                }),
            }],
            "drop dead",
            Some("Olivia Rodrigo"),
            None,
        );
        assert!(only_wrong.is_none());
    }
}

