use iced::widget::{button, column, container, grid, row, space, text};
use iced::{Alignment, Element, Length};

use crate::icons;
use crate::router::Route;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_SEMIBOLD, Palette, card_button, ghost_button, glass_card, primary_button,
    truncate_str,
};
use crate::views::library::signed_out_prompt;
use crate::widgets::artwork::artwork;
use crate::widgets::micro::{hairline_divider, shimmer_skeleton_cards};
use crate::widgets::motion::hover_reveal;
use crate::widgets::shelf::apple_hover_play_overlay;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            row![
                text("Playlists").size(32).font(FONT_BOLD).color(p.text),
                space().width(Length::Fill),
                if state.session_snap.is_signed_in() {
                    Element::from(
                        row![
                            button(
                                row![
                                    icons::plus(14.0, p.accent_fg),
                                    text("Tạo playlist")
                                        .size(13)
                                        .font(FONT_SEMIBOLD)
                                        .color(p.accent_fg),
                                ]
                                .spacing(6)
                                .align_y(Alignment::Center),
                            )
                            .padding([8, 16])
                            .style(primary_button(p, 7.0))
                            .on_press(Message::OpenCreatePlaylist),
                            button(icons::refresh(15.0, p.text_muted))
                                .padding(8)
                                .style(ghost_button(p, 8.0))
                                .on_press(Message::LoadPlaylists),
                        ]
                        .spacing(8),
                    )
                } else {
                    space().width(0).into()
                }
            ]
            .align_y(Alignment::Center)
            .width(Length::Fill),
            hairline_divider(p),
        ]
        .spacing(12),
    ]
    .spacing(20)
    .width(Length::Fill);

    if !state.session_snap.is_signed_in() {
        col = col.push(signed_out_prompt("Đăng nhập để quản lý playlist cá nhân", p));
        return col.into();
    }

    if state.playlists_loading {
        col = col.push(shimmer_skeleton_cards(state.aurora_time, 4, p));
        return col.into();
    }

    if state.playlists.is_empty() {
        col = col.push(
            container(
                text("Bạn chưa có playlist nào. Nhấn \"Tạo playlist\" để bắt đầu.")
                    .size(14)
                    .color(p.text_muted),
            )
            .padding(32)
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let cards: Vec<Element<'a, Message>> = state
        .playlists
        .iter()
        .map(|pl| {
            let owned = state.session_snap.owns(pl);
            let sub = pl
                .description
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(if owned {
                    "Playlist của bạn"
                } else {
                    "Công khai"
                });

            let art = hover_reveal(
                artwork(&state.image_cache, pl.cover_url.as_deref(), 168.0, 10.0, p),
                apple_hover_play_overlay(10.0),
            );

            button(
                column![
                    art,
                    column![
                        text(truncate_str(&pl.name, 22))
                            .size(13.5)
                            .font(FONT_SEMIBOLD)
                            .color(p.text),
                        text(truncate_str(sub, 24)).size(12).color(p.text_muted),
                    ]
                    .spacing(2)
                    .width(168),
                ]
                .spacing(8),
            )
            .padding(2)
            .style(card_button(p, 10.0))
            .on_press(Message::Navigate(Route::PlaylistDetail(pl.id.clone())))
            .into()
        })
        .collect();

    col = col.push(grid(cards).spacing(16).fluid(196.0).height(Length::Shrink));
    col = col.push(space().height(24));
    col.into()
}
