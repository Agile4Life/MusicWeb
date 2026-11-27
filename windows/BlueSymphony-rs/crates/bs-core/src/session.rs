use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::api::ApiClient;
use crate::auth::{AuthService, SessionInfo};
use crate::config::AppConfig;
use crate::error::{ApiError, AuthError};
use crate::lossy::lossy_vec;
use crate::models::{HistoryItem, Playlist, Track};

#[derive(Debug, Clone, Default)]
pub struct SessionSnapshot {
    pub email: Option<String>,
    pub session_user_id: Option<String>,
    pub favorite_ids: HashSet<String>,
}

impl SessionSnapshot {
    pub fn is_signed_in(&self) -> bool {
        self.email.is_some()
    }

    pub fn display_name(&self) -> String {
        self.email
            .as_deref()
            .and_then(|e| e.split('@').next())
            .unwrap_or("")
            .to_string()
    }

    pub fn server_user_id(&self) -> Option<String> {
        self.email.as_deref().map(compute_server_user_id)
    }

    pub fn owns(&self, playlist: &Playlist) -> bool {
        let Some(owner) = playlist.user_id.as_deref() else {
            return true;
        };
        let owner_lc = owner.to_ascii_lowercase();
        if self.server_user_id().as_deref() == Some(owner_lc.as_str()) {
            return true;
        }
        self.session_user_id
            .as_deref()
            .is_some_and(|sid| sid.eq_ignore_ascii_case(&owner_lc))
    }
}

/// Reproduces `getValidUserId({ email })` from `lib/accessControl.ts` and `SessionStore.swift`.
pub fn compute_server_user_id(email: &str) -> String {
    let trimmed = email.trim().to_ascii_lowercase();
    let mut hex = String::with_capacity(trimmed.len() * 2 + 30);
    for code_unit in trimmed.encode_utf16() {
        hex.push_str(&format!("{code_unit:x}"));
    }
    while hex.len() < 30 {
        hex.push_str("0123456789abcdef");
    }
    let h = &hex[..30];
    format!(
        "{}-{}-4{}-a{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..15],
        &h[15..18],
        &h[18..30]
    )
}

#[derive(Clone)]
pub struct SessionStore {
    api: ApiClient,
    config: AppConfig,
    state: Arc<RwLock<SessionInner>>,
}

struct SessionInner {
    snapshot: SessionSnapshot,
    known_db_ids: HashMap<String, String>,
    known_db_ids_path: PathBuf,
}

impl SessionStore {
    pub fn new(api: ApiClient, config: AppConfig) -> Self {
        let known_path = config.known_db_ids_path();
        let known_db_ids = std::fs::read_to_string(&known_path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
            .unwrap_or_default();

        Self {
            api,
            config,
            state: Arc::new(RwLock::new(SessionInner {
                snapshot: SessionSnapshot::default(),
                known_db_ids,
                known_db_ids_path: known_path,
            })),
        }
    }

    pub fn api(&self) -> &ApiClient {
        &self.api
    }

    pub fn config(&self) -> &AppConfig {
        &self.config
    }

    pub async fn snapshot(&self) -> SessionSnapshot {
        self.state.read().await.snapshot.clone()
    }

    pub async fn is_signed_in(&self) -> bool {
        self.state.read().await.snapshot.is_signed_in()
    }

    pub async fn refresh(&self) -> SessionSnapshot {
        let info = AuthService::session_info(&self.api).await;
        self.apply_session_info(info).await;
        if self.is_signed_in().await {
            self.refresh_favorites().await;
        }
        self.snapshot().await
    }

    pub async fn sign_in(&self, account: &str, password: &str) -> Result<SessionSnapshot, AuthError> {
        let info = AuthService::sign_in(&self.api, &self.config, account, password).await?;
        self.apply_session_info(info).await;
        self.refresh_favorites().await;
        Ok(self.snapshot().await)
    }

    pub async fn complete_web_login(
        &self,
        cookies: &[bs_win::web_login::WebCookie],
    ) -> Result<SessionSnapshot, AuthError> {
        self.api.import_web_cookies(cookies);
        let snap = self.refresh().await;
        if snap.is_signed_in() {
            Ok(snap)
        } else {
            self.api.clear_cookies();
            Err(AuthError(
                "Không lấy được phiên đăng nhập từ web. Vui lòng thử lại.".to_string(),
            ))
        }
    }

    pub async fn register(
        &self,
        username: &str,
        password: &str,
        real_email: &str,
    ) -> Result<SessionSnapshot, AuthError> {
        let info =
            AuthService::register(&self.api, &self.config, username, password, real_email).await?;
        self.apply_session_info(info).await;
        self.refresh_favorites().await;
        Ok(self.snapshot().await)
    }

    pub async fn sign_out(&self) -> SessionSnapshot {
        AuthService::sign_out(&self.api).await;
        let mut inner = self.state.write().await;
        inner.snapshot = SessionSnapshot::default();
        inner.snapshot.clone()
    }

    pub async fn handle_unauthorized(&self) {
        let mut inner = self.state.write().await;
        inner.snapshot = SessionSnapshot::default();
    }

    pub async fn guarded<T, F, Fut>(&self, work: F) -> Result<T, ApiError>
    where
        F: FnOnce(ApiClient) -> Fut,
        Fut: std::future::Future<Output = Result<T, ApiError>>,
    {
        match work(self.api.clone()).await {
            Ok(v) => Ok(v),
            Err(ApiError::Unauthorized) => {
                self.handle_unauthorized().await;
                Err(ApiError::Unauthorized)
            }
            Err(e) => Err(e),
        }
    }

    pub async fn refresh_favorites(&self) {
        #[derive(Deserialize)]
        struct StatusReply {
            #[serde(rename = "trackIds", default)]
            track_ids: Vec<String>,
        }
        #[derive(Deserialize)]
        struct ListReply {
            #[serde(default, deserialize_with = "lossy_vec")]
            tracks: Vec<Track>,
        }

        if let Ok(s) = self
            .api
            .get_json::<StatusReply>("api/favorites/status", &[])
            .await
        {
            let mut inner = self.state.write().await;
            inner.snapshot.favorite_ids = s.track_ids.into_iter().collect();
        }
        if let Ok(l) = self
            .api
            .get_json::<ListReply>("api/favorites/list", &[("limit", "200")])
            .await
        {
            self.learn_tracks(&l.tracks).await;
        }
    }

    pub async fn learn_tracks(&self, tracks: &[Track]) {
        let mut inner = self.state.write().await;
        let mut changed = false;
        for t in tracks.iter().filter(|t| t.is_persisted()) {
            for key in t.external_keys() {
                if inner.known_db_ids.get(&key).map(String::as_str) != Some(t.id.as_str()) {
                    inner.known_db_ids.insert(key, t.id.clone());
                    changed = true;
                }
            }
        }
        if changed {
            persist_known_ids(&inner.known_db_ids_path, &inner.known_db_ids);
        }
    }

    pub async fn db_id_for(&self, track: &Track) -> Option<String> {
        if track.is_persisted() {
            return Some(track.id.clone());
        }
        let inner = self.state.read().await;
        if let Some(id) = inner.known_db_ids.get(&track.id) {
            return Some(id.clone());
        }
        for key in track.external_keys() {
            if let Some(id) = inner.known_db_ids.get(&key) {
                return Some(id.clone());
            }
        }
        None
    }

    pub async fn is_favorite(&self, track: &Track) -> bool {
        let Some(id) = self.db_id_for(track).await else {
            return false;
        };
        self.state.read().await.snapshot.favorite_ids.contains(&id)
    }

    pub fn is_favorite_sync(
        snapshot: &SessionSnapshot,
        known_db_ids: &HashMap<String, String>,
        track: &Track,
    ) -> bool {
        if track.is_persisted() {
            return snapshot.favorite_ids.contains(&track.id);
        }
        if let Some(id) = known_db_ids.get(&track.id) {
            return snapshot.favorite_ids.contains(id);
        }
        for key in track.external_keys() {
            if let Some(id) = known_db_ids.get(&key) {
                if snapshot.favorite_ids.contains(id) {
                    return true;
                }
            }
        }
        false
    }

    pub async fn known_db_ids_clone(&self) -> HashMap<String, String> {
        self.state.read().await.known_db_ids.clone()
    }

    pub async fn toggle_favorite(&self, track: &Track) -> Result<bool, ApiError> {
        let next_value = !self.is_favorite(track).await;
        self.set_favorite(track, next_value).await?;
        Ok(next_value)
    }

    pub async fn set_favorite(&self, track: &Track, next_value: bool) -> Result<(), ApiError> {
        let id = if next_value {
            self.persisted_id(track).await?
        } else if let Some(known) = self.db_id_for(track).await {
            known
        } else {
            return Ok(());
        };

        let before = {
            let mut inner = self.state.write().await;
            let before = inner.snapshot.favorite_ids.clone();
            if next_value {
                inner.snapshot.favorite_ids.insert(id.clone());
            } else {
                inner.snapshot.favorite_ids.remove(&id);
            }
            before
        };

        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(rename = "trackId")]
            track_id: &'a str,
            #[serde(rename = "nextValue")]
            next_value: bool,
        }

        let res = self
            .guarded(|api| async move {
                api.post_void(
                    "api/favorites/toggle",
                    &Body {
                        track_id: &id,
                        next_value,
                    },
                )
                .await
            })
            .await;

        if let Err(err) = res {
            let mut inner = self.state.write().await;
            inner.snapshot.favorite_ids = before;
            return Err(err);
        }

        Ok(())
    }

    async fn persisted_id(&self, track: &Track) -> Result<String, ApiError> {
        if let Some(id) = self.db_id_for(track).await {
            return Ok(id);
        }

        #[derive(Deserialize)]
        struct HistReply {
            #[serde(default, deserialize_with = "lossy_vec")]
            items: Vec<HistoryItem>,
        }
        if let Ok(hist) = self
            .api
            .get_json::<HistReply>("api/history/list", &[("limit", "60")])
            .await
        {
            let tracks: Vec<Track> = hist.items.into_iter().filter_map(|h| h.track).collect();
            self.learn_tracks(&tracks).await;
            if let Some(id) = self.db_id_for(track).await {
                return Ok(id);
            }
        }

        #[derive(Serialize)]
        struct CreateBody<'a> {
            title: &'a str,
            file_path: String,
            artist: Option<&'a str>,
            album: Option<&'a str>,
            cover_url: Option<&'a str>,
            source: Option<&'a str>,
            youtube_id: Option<&'a str>,
            spotify_id: Option<&'a str>,
            nhaccuatui_id: Option<&'a str>,
            duration: Option<f64>,
        }
        #[derive(Deserialize)]
        struct CreatedTrack {
            id: String,
        }
        #[derive(Deserialize)]
        struct CreateReply {
            track: Option<CreatedTrack>,
        }

        let body = CreateBody {
            title: &track.title,
            file_path: track.fallback_file_path(),
            artist: track.artist.as_deref(),
            album: track.album.as_deref(),
            cover_url: track.cover_url.as_deref(),
            source: track.source.as_deref(),
            youtube_id: track.youtube_id.as_deref(),
            spotify_id: track.spotify_id.as_deref(),
            nhaccuatui_id: track.nhaccuatui_id.as_deref(),
            duration: track.duration,
        };

        let reply: CreateReply = self
            .guarded(|api| async move { api.post_json("api/tracks/create", &body).await })
            .await?;

        let Some(created) = reply.track else {
            return Err(ApiError::Server(Some(
                "Không lưu được bài hát.".to_string(),
            )));
        };

        {
            let mut inner = self.state.write().await;
            inner.known_db_ids.insert(track.id.clone(), created.id.clone());
            for key in track.external_keys() {
                inner.known_db_ids.insert(key, created.id.clone());
            }
            persist_known_ids(&inner.known_db_ids_path, &inner.known_db_ids);
        }

        Ok(created.id)
    }

    async fn apply_session_info(&self, info: SessionInfo) {
        let mut inner = self.state.write().await;
        inner.snapshot.email = info.email;
        inner.snapshot.session_user_id = info.user_id;
        if inner.snapshot.email.is_none() {
            inner.snapshot.favorite_ids.clear();
        }
    }
}

fn persist_known_ids(path: &Path, map: &HashMap<String, String>) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(map) {
        let _ = std::fs::write(path, raw);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_user_id_matches_swift_and_ts_algorithm() {
        assert_eq!(
            compute_server_user_id(" A@B.C "),
            "6140622e-6301-4234-a567-89abcdef0123"
        );
    }

    #[test]
    fn snapshot_ownership_works() {
        let snap = SessionSnapshot {
            email: Some("a@b.c".into()),
            session_user_id: Some("11111111-1111-1111-1111-111111111111".into()),
            favorite_ids: HashSet::new(),
        };
        let own_pl = Playlist {
            id: "p1".into(),
            name: "Mine".into(),
            description: None,
            cover_url: None,
            is_public: Some(false),
            user_id: Some("6140622E-6301-4234-A567-89ABCDEF0123".into()),
        };
        let other_pl = Playlist {
            id: "p2".into(),
            name: "Other".into(),
            description: None,
            cover_url: None,
            is_public: Some(true),
            user_id: Some("99999999-9999-9999-9999-999999999999".into()),
        };
        assert!(snap.owns(&own_pl));
        assert!(!snap.owns(&other_pl));
    }
}
