use iced::widget::scrollable::{Direction, Scrollbar};
use iced::widget::{Id, button, column, container, mouse_area, row, scrollable, space, stack, text};
use iced::{Alignment, Background, Border, Color, Element, Length, Shadow, Vector};

use bs_core::models::{Album, Track};

use crate::icons;
use crate::router::Route;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_SEMIBOLD, Palette, card_button, ghost_button, subtle_scrollable, truncate_str,
};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::{eq_bars, rank_badge};
use crate::widgets::motion::hover_reveal;

pub fn apple_hover_play_overlay<'a>(radius: f32) -> Element<'a, Message> {
    let play_circle = container(icons::play(13.5, Color::WHITE))
        .width(34)
        .height(34)
        .align_x(Alignment::Center)
        .align_y(Alignment::Center)
        .style(|_| container::Style {
            background: Some(Background::Color(Color::from_rgba8(24, 24, 28, 0.76))),
            border: Border {
                color: Color::from_rgba(1.0, 1.0, 1.0, 0.26),
                width: 1.0,
                radius: 999.0.into(),
            },
            ..Default::default()
        });

    container(play_circle)
        .width(Length::Fill)
        .height(Length::Fill)
        .padding(10)
        .align_x(Alignment::Start)
        .align_y(Alignment::End)
        .style(move |_| container::Style {
            background: Some(Background::Color(Color::from_rgba(0.0, 0.0, 0.0, 0.28))),
            border: Border {
                radius: radius.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

pub fn section_header<'a>(
    title: &'a str,
    subtitle: Option<&'a str>,
    scroll_id: Option<Id>,
    p: Palette,
) -> Element<'a, Message> {
    let left = if let Some(sub) = subtitle {
        column![
            row![
                text(title).size(20).font(FONT_BOLD).color(p.text),
                icons::chevron_right(16.0, p.text_dim),
            ]
            .spacing(4)
            .align_y(Alignment::Center),
            text(sub).size(12).color(p.text_muted),
        ]
        .spacing(2)
    } else {
        column![
            row![
                text(title).size(20).font(FONT_BOLD).color(p.text),
                icons::chevron_right(16.0, p.text_dim),
            ]
            .spacing(4)
            .align_y(Alignment::Center),
        ]
    };

    let right: Element<'a, Message> = if let Some(id) = scroll_id {
        row![
            button(icons::chevron_left(16.0, p.text_muted))
                .padding([6, 8])
                .style(ghost_button(p, 8.0))
                .on_press(Message::ScrollHorizontal(id.clone(), -420.0)),
            button(icons::chevron_right(16.0, p.text_muted))
                .padding([6, 8])
                .style(ghost_button(p, 8.0))
                .on_press(Message::ScrollHorizontal(id, 420.0)),
        ]
        .spacing(4)
        .into()
    } else {
        space().width(0).into()
    };

    row![left, space().width(Length::Fill), right]
        .align_y(Alignment::Center)
        .width(Length::Fill)
        .into()
}

pub fn track_shelf<'a>(
    state: &'a AppState,
    id_key: &str,
    title: &'a str,
    tracks: &'a [Track],
    p: Palette,
) -> Element<'a, Message> {
    if tracks.is_empty() {
        return space().height(0).into();
    }

    let is_chart = id_key == "nct-chart";
    let scroll_id = Id::from(format!("shelf-{id_key}"));
    let cards: Vec<Element<'a, Message>> = tracks
        .iter()
        .enumerate()
        .take(24)
        .map(|(idx, track)| {
            let queue = tracks.to_vec();
            track_card(
                state,
                track,
                queue,
                idx,
                if is_chart { Some(idx + 1) } else { None },
                p,
            )
        })
        .collect();

    let scroller = scrollable(
        row(cards)
            .spacing(14)
            .padding([4, 2]),
    )
    .id(scroll_id.clone())
    .direction(Direction::Horizontal(Scrollbar::hidden()))
    .style(subtle_scrollable(p))
    .width(Length::Fill);

    column![section_header(title, None, Some(scroll_id), p), scroller]
        .spacing(12)
        .width(Length::Fill)
        .into()
}

fn track_card<'a>(
    state: &'a AppState,
    track: &'a Track,
    queue: Vec<Track>,
    start_at: usize,
    rank: Option<usize>,
    p: Palette,
) -> Element<'a, Message> {
    let is_current = state.player.current().is_some_and(|c| c.id == track.id);
    let title_color = if is_current { p.accent } else { p.text };

    let art_base = artwork(&state.image_cache, track.cover_url.as_deref(), 168.0, 10.0, p);
    let mut art_layers = stack![art_base];

    if let Some(r) = rank {
        let rank_overlay = container(rank_badge(r, p))
            .width(168)
            .height(168)
            .padding(8)
            .align_x(Alignment::Start)
            .align_y(Alignment::Start);
        art_layers = art_layers.push(rank_overlay);
    }

    if is_current {
        let playing_badge = container(
            container(eq_bars(
                state.aurora_time,
                state.player.is_playing,
                p.accent_fg,
                14.0,
                12.0,
            ))
            .width(28)
            .height(28)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .style(move |_| container::Style {
                background: Some(Background::Color(p.accent)),
                border: Border {
                    radius: 999.0.into(),
                    ..Default::default()
                },
                shadow: Shadow {
                    color: Color::from_rgba(0.0, 0.0, 0.0, 0.35),
                    offset: Vector::new(0.0, 2.0),
                    blur_radius: 8.0,
                },
                ..Default::default()
            }),
        )
        .width(168)
        .height(168)
        .padding(8)
        .align_x(Alignment::End)
        .align_y(Alignment::End);
        art_layers = art_layers.push(playing_badge);
    }

    let inner = column![
        hover_reveal(art_layers, apple_hover_play_overlay(10.0)),
        column![
            text(truncate_str(&track.title, 22))
                .size(13.5)
                .font(FONT_SEMIBOLD)
                .color(title_color),
            text(truncate_str(track.artist_name(), 24))
                .size(12)
                .color(p.text_muted),
        ]
        .spacing(2)
        .width(168),
    ]
    .spacing(8);

    let card_btn = button(inner)
        .padding(2)
        .style(card_button(p, 10.0))
        .on_press(Message::PlayTracks {
            tracks: queue,
            start_at,
        });

    mouse_area(card_btn)
        .on_right_press(Message::OpenContextMenu {
            track: track.clone(),
            playlist_id: None,
        })
        .into()
}

pub fn album_shelf<'a>(
    state: &'a AppState,
    id_key: &str,
    title: &'a str,
    albums: &'a [Album],
    p: Palette,
) -> Element<'a, Message> {
    if albums.is_empty() {
        return space().height(0).into();
    }

    let scroll_id = Id::from(format!("album-shelf-{id_key}"));
    let cards: Vec<Element<'a, Message>> = albums
        .iter()
        .take(24)
        .map(|album| album_card(state, album, p))
        .collect();

    let scroller = scrollable(row(cards).spacing(14).padding([4, 2]))
        .id(scroll_id.clone())
        .direction(Direction::Horizontal(Scrollbar::hidden()))
        .style(subtle_scrollable(p))
        .width(Length::Fill);

    column![section_header(title, None, Some(scroll_id), p), scroller]
        .spacing(12)
        .width(Length::Fill)
        .into()
}

pub fn album_card<'a>(state: &'a AppState, album: &'a Album, p: Palette) -> Element<'a, Message> {
    let artist_text = album
        .artist
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("Various Artists");

    let art = hover_reveal(
        artwork(&state.image_cache, album.cover_url.as_deref(), 168.0, 10.0, p),
        apple_hover_play_overlay(10.0),
    );

    let inner = column![
        art,
        column![
            text(truncate_str(&album.name, 22))
                .size(13.5)
                .font(FONT_SEMIBOLD)
                .color(p.text),
            text(truncate_str(artist_text, 24))
                .size(12)
                .color(p.text_muted),
        ]
        .spacing(2)
        .width(168),
    ]
    .spacing(8);

    button(inner)
        .padding(2)
        .style(card_button(p, 10.0))
        .on_press(Message::Navigate(Route::Album(album.clone())))
        .into()
}
