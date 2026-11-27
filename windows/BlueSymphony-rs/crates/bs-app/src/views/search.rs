use iced::widget::{Id, button, column, container, grid, row, space, text, text_input};
use iced::{Alignment, Background, Border, Color, Element, Length};

use crate::icons;
use crate::state::{AppState, Message, SEARCH_PAGE_INPUT_ID, SearchScope};
use crate::theme::{
    FONT_BOLD, FONT_SEMIBOLD, Palette, borderless_input, ghost_button, glass_card, pill_button,
};
use crate::widgets::micro::{count_pill, hairline_divider, shimmer_skeleton_rows, track_list_header};
use crate::widgets::shelf::album_card;
use crate::widgets::track_row::track_row;

const QUICK_SUGGESTIONS: &[&str] = &[
    "Sơn Tùng M-TP",
    "V-Pop",
    "Rap Việt",
    "Lofi Việt",
    "Ballad",
];

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            text("Tìm kiếm").size(32).font(FONT_BOLD).color(p.text),
            hairline_divider(p),
        ]
        .spacing(12),
        container(
            row![
                icons::search(15.0, p.text_muted),
                text_input("Nhập tên bài hát, nghệ sĩ hoặc album…", &state.search_query)
                    .id(Id::new(SEARCH_PAGE_INPUT_ID))
                    .on_input(Message::SearchQueryChanged)
                    .padding([8, 6])
                    .size(14)
                    .style(borderless_input(p))
                    .width(Length::Fill),
                if !state.search_query.is_empty() {
                    Element::from(
                        button(icons::close(14.0, p.text_muted))
                            .padding(6)
                            .style(ghost_button(p, 7.0))
                            .on_press(Message::SearchQueryChanged(String::new())),
                    )
                } else {
                    space().width(0).into()
                }
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .padding([3, 12])
        .style(|_| container::Style {
            background: Some(Background::Color(Color::from_rgb8(24, 24, 26))),
            border: Border {
                color: Color::from_rgba(1.0, 1.0, 1.0, 0.11),
                width: 1.0,
                radius: 8.0.into(),
            },
            ..Default::default()
        }),
    ]
    .spacing(16)
    .width(Length::Fill);

    let result_count = match state.search_scope {
        SearchScope::Albums => state.search_albums.len(),
        _ => state.search_tracks.len(),
    };
    let mut scope_row = row(SearchScope::ALL.iter().map(|s| {
        let active = state.search_scope == *s;
        button(text(s.label()).size(13).font(FONT_SEMIBOLD))
            .padding([7, 16])
            .style(pill_button(p, active))
            .on_press(Message::SearchScopeChanged(*s))
            .into()
    }))
    .spacing(8)
    .align_y(Alignment::Center);

    if !state.search_query.trim().is_empty() && !state.search_loading {
        scope_row = scope_row
            .push(space().width(Length::Fill))
            .push(count_pill(format!("{result_count} kết quả"), p));
    }

    col = col.push(scope_row);

    let trimmed = state.search_query.trim();
    if trimmed.is_empty() {
        let suggestion_row = row(QUICK_SUGGESTIONS.iter().map(|term| {
            button(text(*term).size(12.5))
                .padding([6, 14])
                .style(pill_button(p, false))
                .on_press(Message::PickRecentSearch((*term).to_string()))
                .into()
        }))
        .spacing(8);

        col = col.push(
            column![
                text("Gợi ý phổ biến")
                    .size(13)
                    .font(FONT_SEMIBOLD)
                    .color(p.text_muted),
                suggestion_row,
            ]
            .spacing(8),
        );

        if state.settings.recent_searches.is_empty() {
            col = col.push(
                container(
                    column![
                        icons::search(28.0, p.text_dim),
                        text("Tìm kiếm đa nguồn")
                            .size(16)
                            .font(FONT_SEMIBOLD)
                            .color(p.text),
                        text("Gõ từ khoá để tìm trên NhacCuaTui, SoundCloud, Spotify và Album.")
                            .size(13)
                            .color(p.text_muted),
                    ]
                    .spacing(8)
                    .align_x(Alignment::Center),
                )
                .width(Length::Fill)
                .align_x(Alignment::Center)
                .padding(40)
                .style(glass_card(p, 16.0)),
            );
        } else {
            let mut rec_col = column![
                row![
                    text("Tìm kiếm gần đây")
                        .size(16)
                        .font(FONT_SEMIBOLD)
                        .color(p.text),
                    space().width(Length::Fill),
                    button(text("Xoá lịch sử").size(12).color(p.text_muted))
                        .padding([6, 10])
                        .style(ghost_button(p, 8.0))
                        .on_press(Message::ClearRecentSearches),
                ]
                .align_y(Alignment::Center),
            ]
            .spacing(6);

            for term in &state.settings.recent_searches {
                rec_col = rec_col.push(
                    button(
                        row![
                            icons::history(14.0, p.text_dim),
                            text(term.clone()).size(14).color(p.text),
                            space().width(Length::Fill),
                            icons::chevron_right(14.0, p.text_dim),
                        ]
                        .spacing(10)
                        .align_y(Alignment::Center),
                    )
                    .width(Length::Fill)
                    .padding([10, 14])
                    .style(ghost_button(p, 10.0))
                    .on_press(Message::PickRecentSearch(term.clone())),
                );
            }
            col = col.push(rec_col);
        }
        return col.into();
    }

    if state.search_loading {
        col = col.push(shimmer_skeleton_rows(state.aurora_time, 6, p));
        return col.into();
    }

    if state.search_failed {
        col = col.push(
            container(
                text("Không tìm được. Kiểm tra kết nối mạng rồi thử lại.")
                    .size(14)
                    .color(p.text_muted),
            )
            .padding(28)
            .width(Length::Fill)
            .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    match state.search_scope {
        SearchScope::Albums => {
            if state.search_albums.is_empty() {
                col = col.push(
                    container(text("Không tìm thấy album phù hợp.").size(14).color(p.text_muted))
                        .padding(28)
                        .width(Length::Fill)
                        .style(glass_card(p, 14.0)),
                );
            } else {
                let cards: Vec<Element<'a, Message>> = state
                    .search_albums
                    .iter()
                    .map(|a| album_card(state, a, p))
                    .collect();
                col = col.push(grid(cards).spacing(16).fluid(196.0).height(Length::Shrink));
            }
        }
        _ => {
            if state.search_tracks.is_empty() {
                col = col.push(
                    container(text("Không tìm thấy bài hát phù hợp.").size(14).color(p.text_muted))
                        .padding(28)
                        .width(Length::Fill)
                        .style(glass_card(p, 14.0)),
                );
            } else {
                let mut list = column![track_list_header(p)].spacing(2).width(Length::Fill);
                for (i, tr) in state.search_tracks.iter().enumerate() {
                    list = list.push(track_row(
                        state,
                        tr,
                        Some(format!("{}", i + 1)),
                        state.search_tracks.clone(),
                        i,
                        None,
                        p,
                    ));
                }
                col = col.push(list);
            }
        }
    }

    col = col.push(space().height(24));
    col.into()
}
