use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::lossy::lossy_vec;
use crate::models::{Playlist, Track};
use crate::session::SessionStore;

pub struct PlaylistApi;

impl PlaylistApi {
    pub async fn list(session: &SessionStore) -> Result<Vec<Playlist>, ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            #[serde(default, deserialize_with = "lossy_vec")]
            playlists: Vec<Playlist>,
        }
        let r: Reply = session
            .guarded(|api| async move { api.get_json("api/playlists", &[]).await })
            .await?;
        Ok(r.playlists)
    }

    pub async fn detail(
        session: &SessionStore,
        id: &str,
    ) -> Result<(Option<Playlist>, Vec<Track>), ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            playlist: Option<Playlist>,
            #[serde(default, deserialize_with = "lossy_vec")]
            tracks: Vec<Track>,
        }
        let path = format!("api/playlists/{id}");
        let r: Reply = session
            .guarded(|api| async move { api.get_json(&path, &[]).await })
            .await?;
        session.learn_tracks(&r.tracks).await;
        Ok((r.playlist, r.tracks))
    }

    pub async fn create(
        session: &SessionStore,
        name: &str,
        description: &str,
        is_public: bool,
    ) -> Result<Playlist, ApiError> {
        #[derive(Serialize)]
        struct Body<'a> {
            name: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            description: Option<&'a str>,
            #[serde(rename = "isPublic")]
            is_public: bool,
        }
        #[derive(Deserialize)]
        struct Reply {
            playlist: Option<Playlist>,
        }
        let desc = description.trim();
        let body = Body {
            name: name.trim(),
            description: if desc.is_empty() { None } else { Some(desc) },
            is_public,
        };
        let r: Reply = session
            .guarded(|api| async move { api.post_json("api/playlists", &body).await })
            .await?;
        r.playlist
            .ok_or_else(|| ApiError::Server(Some("Không tạo được playlist.".to_string())))
    }

    pub async fn update(
        session: &SessionStore,
        id: &str,
        name: &str,
        description: &str,
        is_public: bool,
    ) -> Result<Playlist, ApiError> {
        #[derive(Serialize)]
        struct Body<'a> {
            name: &'a str,
            description: &'a str,
            #[serde(rename = "isPublic")]
            is_public: bool,
        }
        #[derive(Deserialize)]
        struct Reply {
            playlist: Option<Playlist>,
        }
        let path = format!("api/playlists/{id}");
        let body = Body {
            name: name.trim(),
            description: description.trim(),
            is_public,
        };
        let r: Reply = session
            .guarded(|api| async move { api.patch_json(&path, &body).await })
            .await?;
        r.playlist
            .ok_or_else(|| ApiError::Server(Some("Không cập nhật được playlist.".to_string())))
    }

    pub async fn delete(session: &SessionStore, id: &str) -> Result<(), ApiError> {
        let path = format!("api/playlists/{id}");
        session
            .guarded(|api| async move { api.delete_void(&path, &[]).await })
            .await
    }

    pub async fn add_track(
        session: &SessionStore,
        playlist_id: &str,
        track: &Track,
    ) -> Result<String, ApiError> {
        #[derive(Serialize)]
        struct Body<'a> {
            track: &'a Track,
        }
        #[derive(Deserialize)]
        struct Reply {
            message: Option<String>,
        }
        let path = format!("api/playlists/{playlist_id}/tracks");
        let body = Body { track };
        let r: Reply = session
            .guarded(|api| async move { api.post_json(&path, &body).await })
            .await?;
        Ok(r.message
            .unwrap_or_else(|| "Đã thêm bài hát vào playlist!".to_string()))
    }

    pub async fn remove_track(
        session: &SessionStore,
        playlist_id: &str,
        track_id: &str,
    ) -> Result<(), ApiError> {
        let path = format!("api/playlists/{playlist_id}/tracks");
        let tid = track_id.to_string();
        session
            .guarded(|api| async move { api.delete_void(&path, &[("trackId", &tid)]).await })
            .await
    }
}

