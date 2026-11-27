use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::lossy::lossy_vec;
use crate::models::{HistoryItem, TopItem, Track};
use crate::session::SessionStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopTimeframe {
    Days7,
    Days30,
    All,
}

impl TopTimeframe {
    pub fn as_param(self) -> &'static str {
        match self {
            Self::Days7 => "7days",
            Self::Days30 => "30days",
            Self::All => "all",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Days7 => "7 ngày",
            Self::Days30 => "30 ngày",
            Self::All => "Tất cả",
        }
    }
}

pub struct LibraryApi;

impl LibraryApi {
    /// Combined endpoint for Home recent shelf + favorite ids.
    pub async fn init_data(
        session: &SessionStore,
        history_limit: usize,
    ) -> Result<(Vec<String>, Vec<HistoryItem>), ApiError> {
        #[derive(Deserialize)]
        struct Hist {
            #[serde(default, deserialize_with = "lossy_vec")]
            items: Vec<HistoryItem>,
        }
        #[derive(Deserialize)]
        struct Reply {
            #[serde(rename = "trackIds", default)]
            track_ids: Vec<String>,
            history: Option<Hist>,
        }
        let lim = history_limit.to_string();
        let r: Reply = session
            .guarded(|api| async move {
                api.get_json("api/user/init-data", &[("history_limit", &lim)])
                    .await
            })
            .await?;
        let items = r.history.map(|h| h.items).unwrap_or_default();
        let tracks: Vec<Track> = items.iter().filter_map(|i| i.track.clone()).collect();
        session.learn_tracks(&tracks).await;
        Ok((r.track_ids, items))
    }

    pub async fn favorites_list(
        session: &SessionStore,
        limit: usize,
    ) -> Result<Vec<Track>, ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            #[serde(default, deserialize_with = "lossy_vec")]
            tracks: Vec<Track>,
        }
        let lim = limit.to_string();
        let r: Reply = session
            .guarded(|api| async move {
                api.get_json("api/favorites/list", &[("limit", &lim)]).await
            })
            .await?;
        session.learn_tracks(&r.tracks).await;
        Ok(r.tracks)
    }

    pub async fn history_list(
        session: &SessionStore,
        limit: usize,
    ) -> Result<Vec<HistoryItem>, ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            #[serde(default, deserialize_with = "lossy_vec")]
            items: Vec<HistoryItem>,
        }
        let lim = limit.to_string();
        let r: Reply = session
            .guarded(|api| async move { api.get_json("api/history/list", &[("limit", &lim)]).await })
            .await?;
        let tracks: Vec<Track> = r.items.iter().filter_map(|i| i.track.clone()).collect();
        session.learn_tracks(&tracks).await;
        Ok(r.items)
    }

    pub async fn history_delete_one(
        session: &SessionStore,
        history_id: &str,
    ) -> Result<(), ApiError> {
        let hid = history_id.to_string();
        session
            .guarded(|api| async move {
                api.post_void(
                    "api/history/delete",
                    &serde_json::json!({ "historyId": hid }),
                )
                .await
            })
            .await
    }

    pub async fn history_clear_all(session: &SessionStore) -> Result<(), ApiError> {
        session
            .guarded(|api| async move {
                api.post_void(
                    "api/history/delete",
                    &serde_json::json!({ "clearAll": true }),
                )
                .await
            })
            .await
    }

    pub async fn history_top(
        session: &SessionStore,
        timeframe: TopTimeframe,
        limit: usize,
    ) -> Result<(Vec<TopItem>, u32), ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            #[serde(default, deserialize_with = "lossy_vec")]
            items: Vec<TopItem>,
            #[serde(rename = "totalPlays", default)]
            total_plays: u32,
        }
        let tf = timeframe.as_param();
        let lim = limit.to_string();
        let r: Reply = session
            .guarded(|api| async move {
                api.get_json("api/history/top", &[("timeframe", tf), ("limit", &lim)])
                    .await
            })
            .await?;
        let tracks: Vec<Track> = r.items.iter().map(|i| i.track.clone()).collect();
        session.learn_tracks(&tracks).await;
        Ok((r.items, r.total_plays))
    }

    /// Fire-and-forget history record (only when signed in).
    pub async fn record_history(session: &SessionStore, track: &Track) {
        if !session.is_signed_in().await {
            return;
        }
        #[derive(Serialize)]
        struct Body<'a> {
            track: &'a Track,
        }
        let _ = session
            .api()
            .post_void("api/history/record", &Body { track })
            .await;
    }

    /// Fire-and-forget listen event telemetry (only when signed in).
    pub async fn report_listen_event(
        session: &SessionStore,
        track: &Track,
        completed: bool,
        skip_at_seconds: Option<u32>,
    ) {
        if !session.is_signed_in().await {
            return;
        }
        #[derive(Serialize)]
        struct Body<'a> {
            track_id: &'a str,
            artist: Option<&'a str>,
            completed: bool,
            skip_at_seconds: Option<u32>,
        }
        let _ = session
            .api()
            .post_void(
                "api/listen-events",
                &Body {
                    track_id: &track.id,
                    artist: track.artist.as_deref(),
                    completed,
                    skip_at_seconds,
                },
            )
            .await;
    }
}

