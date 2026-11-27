use iced::widget::{button, column, container, row, space, stack, text};
use iced::{Alignment, Background, Border, Color, Element, Gradient, Length, Radians};

use crate::icons;
use crate::router::Route;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_SEMIBOLD, Palette, card_button, ghost_button, glass_card, primary_button,
    truncate_str,
};
use crate::widgets::artwork::artwork_fill;
use crate::widgets::micro::{
    hairline_divider, shimmer_skeleton_cards, shimmer_skeleton_rows, track_list_header,
};
use crate::widgets::motion::hover_reveal;
use crate::widgets::shelf::{album_shelf, apple_hover_play_overlay, section_header, track_shelf};
use crate::widgets::track_row::track_row;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![].spacing(24).width(Length::Fill);

    // Header row (Apple Music clean typography + hairline divider)
    col = col.push(
        column![
            row![
                text("Trang chủ").size(32).font(FONT_BOLD).color(p.text),
                space().width(Length::Fill),
                button(
                    row![
                        icons::refresh(15.0, p.text_muted),
                        text("Làm mới").size(13).color(p.text_muted),
                    ]
                    .spacing(6)
                    .align_y(Alignment::Center),
                )
                .padding([7, 12])
                .style(ghost_button(p, 8.0))
                .on_press(Message::RefreshHome),
            ]
            .align_y(Alignment::Center)
            .width(Length::Fill),
            hairline_divider(p),
        ]
        .spacing(12),
    );

    if state.home_loading
        && state.nct_tracks.is_empty()
        && state.trending_tracks.is_empty()
        && state.sc_shelves.is_empty()
    {
        col = col.push(
            column![
                shimmer_skeleton_cards(state.aurora_time, 5, p),
                shimmer_skeleton_rows(state.aurora_time, 5, p),
            ]
            .spacing(22),
        );
        return col.into();
    }

    if state.home_failed
        && state.nct_tracks.is_empty()
        && state.trending_tracks.is_empty()
        && state.sc_shelves.is_empty()
    {
        col = col.push(
            container(
                column![
                    text("Không tải được dữ liệu").size(18).color(p.text),
                    text("Kiểm tra kết nối mạng rồi nhấn Làm mới.")
                        .size(13)
                        .color(p.text_muted),
                    button(text("Thử lại").size(13))
                        .padding([8, 18])
                        .style(primary_button(p, 999.0))
                        .on_press(Message::RefreshHome),
                ]
                .spacing(10)
                .width(Length::Fill)
                .align_x(Alignment::Center),
            )
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .padding(32)
            .style(glass_card(p, 16.0)),
        );
        return col.into();
    }

    // Apple Music 3-column Editorial Showcase
    let mut showcase_items: Vec<(&'static str, String, String, Option<&str>, Message)> =
        Vec::new();

    if let Some(t) = state.nct_tracks.first() {
        showcase_items.push((
            "#1 NHACCUATUI",
            t.title.clone(),
            t.artist_name().to_string(),
            t.cover_url.as_deref(),
            Message::PlayTracks {
                tracks: state.nct_tracks.clone(),
                start_at: 0,
            },
        ));
    } else if let Some(t) = state.trending_tracks.first() {
        showcase_items.push((
            "ĐANG THỊNH HÀNH",
            t.title.clone(),
            t.artist_name().to_string(),
            t.cover_url.as_deref(),
            Message::PlayTracks {
                tracks: state.trending_tracks.clone(),
                start_at: 0,
            },
        ));
    }

    if let Some(shelf) = state.sc_shelves.first() {
        if let Some(t) = shelf.tracks.first() {
            showcase_items.push((
                "SOUNDCLOUD NỔI BẬT",
                t.title.clone(),
                t.artist_name().to_string(),
                t.cover_url.as_deref(),
                Message::PlayTracks {
                    tracks: shelf.tracks.clone(),
                    start_at: 0,
                },
            ));
        }
    } else if let Some(t) = state.nct_tracks.get(1) {
        showcase_items.push((
            "NGHE NHIỀU NHẤT",
            t.title.clone(),
            t.artist_name().to_string(),
            t.cover_url.as_deref(),
            Message::PlayTracks {
                tracks: state.nct_tracks.clone(),
                start_at: 1,
            },
        ));
    }

    if let Some(alb) = state.new_releases.first() {
        let sub = alb
            .artist
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("Various Artists")
            .to_string();
        showcase_items.push((
            "MỚI PHÁT HÀNH",
            alb.name.clone(),
            sub,
            alb.cover_url.as_deref(),
            Message::Navigate(Route::Album(alb.clone())),
        ));
    } else if let Some(t) = state.nct_tracks.get(2) {
        showcase_items.push((
            "BẢNG XẾP HẠNG",
            t.title.clone(),
            t.artist_name().to_string(),
            t.cover_url.as_deref(),
            Message::PlayTracks {
                tracks: state.nct_tracks.clone(),
                start_at: 2,
            },
        ));
    }

    if !showcase_items.is_empty() {
        let cards: Vec<Element<'a, Message>> = showcase_items
            .into_iter()
            .map(|(eyebrow, title, subtitle, cover_url, msg)| {
                let scrim_grad = Gradient::Linear(
                    iced::gradient::Linear::new(Radians(std::f32::consts::PI))
                        .add_stop(0.0, Color::TRANSPARENT)
                        .add_stop(0.45, Color::from_rgba8(12, 12, 16, 0.22))
                        .add_stop(1.0, Color::from_rgba8(12, 12, 16, 0.92)),
                );

                let scrim = container(
                    column![
                        text(truncate_str(&title, 26))
                            .size(15.5)
                            .font(FONT_BOLD)
                            .color(Color::WHITE),
                        text(truncate_str(&subtitle, 30))
                            .size(12.5)
                            .color(Color::from_rgba(1.0, 1.0, 1.0, 0.78)),
                    ]
                    .spacing(2),
                )
                .width(Length::Fill)
                .height(Length::Fill)
                .padding([12, 14])
                .align_y(Alignment::End)
                .style(move |_| container::Style {
                    background: Some(Background::Gradient(scrim_grad)),
                    border: Border {
                        radius: 12.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                });

                let rim = container(space().width(Length::Fill).height(Length::Fill))
                    .width(Length::Fill)
                    .height(Length::Fill)
                    .style(|_| container::Style {
                        border: Border {
                            color: Color::from_rgba(1.0, 1.0, 1.0, 0.12),
                            width: 1.0,
                            radius: 12.0.into(),
                        },
                        ..Default::default()
                    });

                let card_visual = container(stack![
                    artwork_fill(&state.image_cache, cover_url, 12.0, p),
                    scrim,
                    rim,
                ])
                .width(Length::Fill)
                .height(216);

                let clickable = button(hover_reveal(card_visual, apple_hover_play_overlay(12.0)))
                    .padding(0)
                    .width(Length::Fill)
                    .style(card_button(p, 12.0))
                    .on_press(msg);

                column![
                    text(eyebrow)
                        .size(10.5)
                        .font(FONT_SEMIBOLD)
                        .color(p.text_dim),
                    clickable,
                ]
                .spacing(6)
                .width(Length::FillPortion(1))
                .into()
            })
            .collect();

        col = col.push(
            column![
                text("Lựa chọn hàng đầu cho bạn")
                    .size(19)
                    .font(FONT_BOLD)
                    .color(p.text),
                row(cards).spacing(16).width(Length::Fill),
            ]
            .spacing(12)
            .width(Length::Fill),
        );
    }

    // Signed-in personalized shelves
    if state.session_snap.is_signed_in() {
        col = col.push(track_shelf(
            state,
            "recent",
            "Nghe gần đây",
            &state.recent_tracks,
            p,
        ));
        col = col.push(track_shelf(
            state,
            "favorites",
            "Yêu thích",
            &state.favorite_tracks,
            p,
        ));
    }

    // NCT Chart shelf
    col = col.push(track_shelf(
        state,
        "nct-chart",
        &state.nct_title,
        &state.nct_tracks,
        p,
    ));

    // SoundCloud Vietnamese shelves
    for shelf in &state.sc_shelves {
        col = col.push(track_shelf(state, &shelf.tag, &shelf.title, &shelf.tracks, p));
    }

    // Global trending
    col = col.push(track_shelf(
        state,
        "global-trending",
        "Thịnh hành quốc tế",
        &state.trending_tracks,
        p,
    ));

    // New Releases
    col = col.push(album_shelf(
        state,
        "new-releases",
        "Mới phát hành",
        &state.new_releases,
        p,
    ));

    // Quick Top 10 list at bottom for one-click browsing
    if !state.nct_tracks.is_empty() {
        let mut list = column![
            section_header("Bảng xếp hạng nhanh (Top 10)", None, None, p),
            track_list_header(p),
        ]
        .spacing(2)
        .width(Length::Fill);
        for (i, tr) in state.nct_tracks.iter().take(10).enumerate() {
            list = list.push(track_row(
                state,
                tr,
                Some(format!("{}", i + 1)),
                state.nct_tracks.clone(),
                i,
                None,
                p,
            ));
        }
        col = col.push(list);
    }

    col = col.push(space().height(24));
    col.into()
}

