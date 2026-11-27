use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Color, Element, Length};

use bs_core::models::Album;

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_MEDIUM, Palette, apple_pill_action, ghost_button, glass_card,
};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::{hairline_divider, shimmer_skeleton_rows};
use crate::widgets::track_row::track_row_album;

pub fn view<'a>(state: &'a AppState, stub: &'a Album, p: Palette) -> Element<'a, Message> {
    let album = state
        .album_detail
        .as_ref()
        .filter(|a| a.id == stub.id)
        .unwrap_or(stub);
    let tracks = album.tracks.as_deref().unwrap_or(&[]);

    let mut col = column![].spacing(18).width(Length::Fill);

    let artist_name = album
        .artist
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("Various Artists")
        .to_string();

    let total_secs: f64 = tracks.iter().filter_map(|t| t.duration).sum();
    let mins = (total_secs / 60.0).round() as u32;

    let album_kind = album
        .album_type
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            let mut ch = s.chars();
            match ch.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), ch.as_str().to_lowercase()),
                None => "Album".to_string(),
            }
        })
        .unwrap_or_else(|| "Album".to_string());

    let mut meta_parts = vec![album_kind];
    if let Some(rel) = album
        .release_date
        .as_deref()
        .map(|s| s.split('-').next().unwrap_or(s).trim())
        .filter(|s| !s.is_empty())
    {
        meta_parts.push(rel.to_string());
    }
    meta_parts.push("Lossless".to_string());
    let meta_summary = meta_parts.join(" · ");

    let mut meta_col = column![
        text(album.name.clone()).size(26).font(FONT_BOLD).color(p.text),
        button(
            text(artist_name)
                .size(21)
                .font(FONT_MEDIUM)
                .color(p.accent)
        )
        .padding(0)
        .style(ghost_button(p, 4.0))
        .on_press_maybe(album.artist.as_ref().map(|a| Message::OpenArtist(a.clone()))),
        text(meta_summary).size(12).color(p.text_muted),
    ]
    .spacing(5);

    if let Some(first_track) = tracks.first() {
        meta_col = meta_col.push(space().height(16)).push(
            row![
                button(
                    container(icons::shuffle(14.5, Color::WHITE))
                        .width(36)
                        .height(36)
                        .align_x(Alignment::Center)
                        .align_y(Alignment::Center),
                )
                .padding(0)
                .style(apple_pill_action(p))
                .on_press(Message::PlayTracksShuffled(tracks.to_vec())),
                button(
                    container(
                        row![
                            icons::play(13.0, Color::WHITE),
                            text("Phát")
                                .size(13)
                                .font(FONT_MEDIUM)
                                .color(Color::WHITE),
                        ]
                        .spacing(7)
                        .align_y(Alignment::Center),
                    )
                    .height(36)
                    .padding([0, 26])
                    .align_y(Alignment::Center),
                )
                .padding(0)
                .style(apple_pill_action(p))
                .on_press(Message::PlayTracks {
                    tracks: tracks.to_vec(),
                    start_at: 0,
                }),
                space().width(Length::Fill),
                button(
                    container(icons::more(15.0, Color::WHITE))
                        .width(36)
                        .height(36)
                        .align_x(Alignment::Center)
                        .align_y(Alignment::Center),
                )
                .padding(0)
                .style(apple_pill_action(p))
                .on_press(Message::OpenContextMenu {
                    track: first_track.clone(),
                    playlist_id: None,
                }),
            ]
            .spacing(10)
            .align_y(Alignment::Center)
            .width(Length::Fill),
        );
    }

    let hero = container(
        row![
            artwork(&state.image_cache, album.cover_url.as_deref(), 244.0, 8.0, p),
            meta_col.width(Length::Fill),
        ]
        .spacing(28)
        .align_y(Alignment::End),
    )
    .padding([8, 0])
    .width(Length::Fill);

    col = col.push(hero);
    col = col.push(hairline_divider(p));

    if state.album_loading {
        col = col.push(shimmer_skeleton_rows(state.aurora_time, 6, p));
        return col.into();
    }

    if let Some(ref err) = state.album_error {
        col = col.push(
            container(text(err.clone()).size(14).color(p.danger))
                .padding(24)
                .width(Length::Fill)
                .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    if tracks.is_empty() {
        col = col.push(
            container(text("Không có danh sách bài hát cho album này.").size(14).color(p.text_muted))
                .padding(28)
                .width(Length::Fill)
                .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let mut list = column![].spacing(0).width(Length::Fill);
    for (i, tr) in tracks.iter().enumerate() {
        list = list.push(track_row_album(
            state,
            tr,
            Some(format!("{}", i + 1)),
            tracks.to_vec(),
            i,
            p,
        ));
    }
    col = col.push(list);

    let footer = if mins > 0 {
        format!("{} bài hát, {mins} phút", tracks.len())
    } else {
        format!("{} bài hát", tracks.len())
    };
    col = col.push(
        container(text(footer).size(12).color(p.text_dim))
            .padding([6, 4]),
    );

    col = col.push(space().height(24));
    col.into()
}
