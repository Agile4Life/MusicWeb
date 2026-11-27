use iced::widget::{button, column, container, mouse_area, row, space, text};
use iced::{Alignment, Background, Color, Element, Length};

use bs_core::models::Track;

use crate::icons;
use crate::state::{AppState, Message, format_duration};
use crate::theme::{
    FONT_MEDIUM, FONT_SEMIBOLD, Palette, ghost_button, track_row_button, truncate_str,
};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::eq_bars;

pub fn track_row<'a>(
    state: &'a AppState,
    track: &'a Track,
    index_label: Option<String>,
    queue_tracks: Vec<Track>,
    start_at: usize,
    playlist_id_context: Option<String>,
    p: Palette,
) -> Element<'a, Message> {
    let is_current = state
        .player
        .current()
        .is_some_and(|c| c.id == track.id);
    let is_fav = bs_core::session::SessionStore::is_favorite_sync(
        &state.session_snap,
        &state.known_db_ids,
        track,
    );

    let leading: Element<'a, Message> = if is_current {
        container(eq_bars(
            state.aurora_time,
            state.player.is_playing,
            p.accent,
            16.0,
            14.0,
        ))
        .width(28)
        .align_x(Alignment::Center)
        .into()
    } else if let Some(lbl) = index_label {
        container(text(lbl).size(13).color(p.text_dim))
            .width(28)
            .align_x(Alignment::Center)
            .into()
    } else {
        container(icons::play(13.0, p.text_dim))
            .width(28)
            .align_x(Alignment::Center)
            .into()
    };

    let title_color = if is_current { p.accent } else { p.text };

    let sub_str = match track.album.as_deref().filter(|s| !s.is_empty()) {
        Some(alb) => format!(
            "{} · {}",
            truncate_str(track.artist_name(), 24),
            truncate_str(alb, 22)
        ),
        None => truncate_str(track.artist_name(), 34),
    };

    let meta = column![
        text(truncate_str(&track.title, 44))
            .size(14)
            .font(FONT_SEMIBOLD)
            .color(title_color),
        text(sub_str).size(12).color(p.text_muted),
    ]
    .spacing(2)
    .width(Length::Fill);

    let dur_str = track
        .duration
        .filter(|d| *d > 0.0)
        .map(format_duration)
        .unwrap_or_else(|| "—".to_string());

    let play_btn = button(
        row![
            leading,
            artwork(&state.image_cache, track.cover_url.as_deref(), 40.0, 5.0, p),
            meta,
            text(dur_str).size(12).color(p.text_dim),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
        .width(Length::Fill),
    )
    .padding([5, 10])
    .width(Length::Fill)
    .style(track_row_button(p, is_current, start_at % 2 == 1))
    .on_press(Message::PlayTracks {
        tracks: queue_tracks,
        start_at,
    });

    let heart_btn = button(if is_fav {
        icons::heart_filled(15.0, p.heart)
    } else {
        icons::heart(15.0, p.text_dim)
    })
    .padding(6)
    .style(ghost_button(p, 8.0))
    .on_press(Message::ToggleFavorite(track.clone()));

    let more_btn = button(icons::more(15.0, p.text_dim))
        .padding(6)
        .style(ghost_button(p, 8.0))
        .on_press(Message::OpenContextMenu {
            track: track.clone(),
            playlist_id: playlist_id_context.clone(),
        });

    let full_row = row![play_btn, heart_btn, more_btn]
        .spacing(4)
        .align_y(Alignment::Center)
        .width(Length::Fill);

    mouse_area(full_row)
        .on_right_press(Message::OpenContextMenu {
            track: track.clone(),
            playlist_id: playlist_id_context,
        })
        .into()
}

/// Authentic Apple Music album track row (no redundant cover thumbnail, faint hairline separator).
pub fn track_row_album<'a>(
    state: &'a AppState,
    track: &'a Track,
    index_label: Option<String>,
    queue_tracks: Vec<Track>,
    start_at: usize,
    p: Palette,
) -> Element<'a, Message> {
    let is_current = state.player.current().is_some_and(|c| c.id == track.id);
    let is_fav = bs_core::session::SessionStore::is_favorite_sync(
        &state.session_snap,
        &state.known_db_ids,
        track,
    );

    let leading: Element<'a, Message> = if is_current {
        container(eq_bars(
            state.aurora_time,
            state.player.is_playing,
            p.accent,
            15.0,
            13.0,
        ))
        .width(28)
        .align_x(Alignment::Center)
        .into()
    } else if let Some(lbl) = index_label {
        container(text(lbl).size(13).color(p.text_dim))
            .width(28)
            .align_x(Alignment::Center)
            .into()
    } else {
        container(icons::play(13.0, p.text_dim))
            .width(28)
            .align_x(Alignment::Center)
            .into()
    };

    let title_color = if is_current { p.accent } else { p.text };
    let title_font = if is_current { FONT_SEMIBOLD } else { FONT_MEDIUM };

    let dur_str = track
        .duration
        .filter(|d| *d > 0.0)
        .map(format_duration)
        .unwrap_or_else(|| "—".to_string());

    let play_btn = button(
        row![
            leading,
            text(truncate_str(&track.title, 60))
                .size(13.5)
                .font(title_font)
                .color(title_color)
                .width(Length::Fill),
            text(dur_str).size(12.5).color(p.text_dim),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
        .width(Length::Fill),
    )
    .padding([9, 10])
    .width(Length::Fill)
    .style(track_row_button(p, is_current, start_at % 2 == 1))
    .on_press(Message::PlayTracks {
        tracks: queue_tracks,
        start_at,
    });

    let heart_btn = button(if is_fav {
        icons::heart_filled(14.0, p.heart)
    } else {
        icons::heart(14.0, Color::from_rgba(1.0, 1.0, 1.0, 0.32))
    })
    .padding(6)
    .style(ghost_button(p, 6.0))
    .on_press(Message::ToggleFavorite(track.clone()));

    let more_btn = button(icons::more(14.0, p.text_dim))
        .padding(6)
        .style(ghost_button(p, 6.0))
        .on_press(Message::OpenContextMenu {
            track: track.clone(),
            playlist_id: None,
        });

    let full_row = row![play_btn, heart_btn, more_btn]
        .spacing(4)
        .align_y(Alignment::Center)
        .width(Length::Fill);

    let sep = container(space().width(Length::Fill).height(1)).style(|_| container::Style {
        background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.05))),
        ..Default::default()
    });

    mouse_area(column![full_row, sep].width(Length::Fill))
        .on_right_press(Message::OpenContextMenu {
            track: track.clone(),
            playlist_id: None,
        })
        .into()
}
