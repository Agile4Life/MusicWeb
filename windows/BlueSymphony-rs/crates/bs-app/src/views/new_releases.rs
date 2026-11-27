use iced::widget::{button, column, container, grid, row, space, text};
use iced::{Alignment, Element, Length};

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{FONT_BOLD, Palette, ghost_button, glass_card};
use crate::widgets::micro::{hairline_divider, shimmer_skeleton_cards, shimmer_skeleton_rows};
use crate::widgets::shelf::album_card;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        row![
            column![
                text("Album mới phát hành")
                    .size(28)
                    .font(FONT_BOLD)
                    .color(p.text),
                text("Cập nhật từ Spotify & Deezer")
                    .size(13)
                    .color(p.text_muted),
            ]
            .spacing(4),
            space().width(Length::Fill),
            button(
                row![
                    icons::refresh(15.0, p.text_muted),
                    text("Làm mới").size(13).color(p.text_muted),
                ]
                .spacing(6)
                .align_y(Alignment::Center),
            )
            .padding([8, 14])
            .style(ghost_button(p, 10.0))
            .on_press(Message::RefreshHome),
        ]
        .align_y(Alignment::Center)
        .width(Length::Fill),
        hairline_divider(p),
    ]
    .spacing(16)
    .width(Length::Fill);

    if state.home_loading && state.new_releases.is_empty() {
        col = col.push(
            column![
                shimmer_skeleton_cards(state.aurora_time, 5, p),
                shimmer_skeleton_rows(state.aurora_time, 4, p),
            ]
            .spacing(20),
        );
        return col.into();
    }

    if state.new_releases.is_empty() {
        col = col.push(
            container(text("Chưa có album mới.").size(14).color(p.text_muted))
                .padding(32)
                .width(Length::Fill)
                .align_x(Alignment::Center)
                .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let cards: Vec<Element<'a, Message>> = state
        .new_releases
        .iter()
        .map(|album| album_card(state, album, p))
        .collect();

    let album_grid = grid(cards).spacing(16).fluid(196.0).height(Length::Shrink);
    col = col.push(album_grid);
    col = col.push(space().height(24));
    col.into()
}
