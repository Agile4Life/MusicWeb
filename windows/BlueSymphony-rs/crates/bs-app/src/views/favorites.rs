use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Element, Length};

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{FONT_BOLD, FONT_SEMIBOLD, Palette, ghost_button, glass_card, primary_button};
use crate::views::library::signed_out_prompt;
use crate::widgets::artwork::loading_banner;
use crate::widgets::micro::{hairline_divider, track_list_header};
use crate::widgets::track_row::track_row;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            row![
                text("Yêu thích").size(32).font(FONT_BOLD).color(p.text),
                space().width(Length::Fill),
                if !state.favorites_list.is_empty() {
                    Element::from(
                        row![
                            button(
                                row![
                                    icons::play(13.5, p.accent_fg),
                                    text("Phát")
                                        .size(13)
                                        .font(FONT_SEMIBOLD)
                                        .color(p.accent_fg),
                                ]
                                .spacing(6)
                                .align_y(Alignment::Center),
                            )
                            .padding([8, 20])
                            .style(primary_button(p, 7.0))
                            .on_press(Message::PlayTracks {
                                tracks: state.favorites_list.clone(),
                                start_at: 0,
                            }),
                            button(icons::refresh(15.0, p.text_muted))
                                .padding(8)
                                .style(ghost_button(p, 8.0))
                                .on_press(Message::LoadFavorites),
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
    .spacing(18)
    .width(Length::Fill);

    if !state.session_snap.is_signed_in() {
        col = col.push(signed_out_prompt("Đăng nhập để xem bài hát yêu thích", p));
        return col.into();
    }

    if state.favorites_loading {
        col = col.push(loading_banner("Đang tải bài hát yêu thích…", p));
        return col.into();
    }

    if state.favorites_list.is_empty() {
        col = col.push(
            container(
                text("Chưa có bài hát yêu thích nào. Nhấn biểu tượng trái tim để lưu bài hát.")
                    .size(14)
                    .color(p.text_muted),
            )
            .padding(32)
            .width(Length::Fill)
            .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let mut list = column![track_list_header(p)].spacing(2).width(Length::Fill);
    for (i, tr) in state.favorites_list.iter().enumerate() {
        list = list.push(track_row(
            state,
            tr,
            Some(format!("{}", i + 1)),
            state.favorites_list.clone(),
            i,
            None,
            p,
        ));
    }
    col = col.push(list);

    col = col.push(space().height(24));
    col.into()
}

