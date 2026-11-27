use chrono::Local;
use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Element, Length};

use bs_core::models::Track;

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{FONT_BOLD, FONT_SEMIBOLD, Palette, danger_button, ghost_button, glass_card};
use crate::views::library::signed_out_prompt;
use crate::widgets::artwork::loading_banner;
use crate::widgets::micro::hairline_divider;
use crate::widgets::track_row::track_row;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            row![
                text("Lịch sử nghe").size(32).font(FONT_BOLD).color(p.text),
                space().width(Length::Fill),
                if state.session_snap.is_signed_in() && !state.history_items.is_empty() {
                    if state.confirm_clear_history {
                        Element::from(
                            row![
                                text("Xoá toàn bộ lịch sử?").size(13).color(p.danger),
                                button(text("Xác nhận xoá").size(13))
                                    .padding([7, 14])
                                    .style(danger_button(p, 7.0))
                                    .on_press(Message::ClearAllHistory),
                                button(text("Huỷ").size(13).color(p.text_muted))
                                    .padding([7, 12])
                                    .style(ghost_button(p, 7.0))
                                    .on_press(Message::AskClearHistory(false)),
                            ]
                            .spacing(8)
                            .align_y(Alignment::Center),
                        )
                    } else {
                        Element::from(
                            row![
                                button(
                                    row![
                                        icons::trash(14.0, p.danger),
                                        text("Xoá tất cả").size(13).color(p.danger),
                                    ]
                                    .spacing(6)
                                    .align_y(Alignment::Center),
                                )
                                .padding([8, 14])
                                .style(danger_button(p, 7.0))
                                .on_press(Message::AskClearHistory(true)),
                                button(icons::refresh(15.0, p.text_muted))
                                    .padding(8)
                                    .style(ghost_button(p, 8.0))
                                    .on_press(Message::LoadHistory),
                            ]
                            .spacing(8),
                        )
                    }
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
    .spacing(16)
    .width(Length::Fill);

    if !state.session_snap.is_signed_in() {
        col = col.push(signed_out_prompt("Đăng nhập để xem lịch sử nghe", p));
        return col.into();
    }

    if state.history_loading {
        col = col.push(loading_banner("Đang tải lịch sử nghe…", p));
        return col.into();
    }

    let valid_tracks: Vec<Track> = state
        .history_items
        .iter()
        .filter_map(|h| h.track.clone())
        .collect();

    if valid_tracks.is_empty() {
        col = col.push(
            container(text("Lịch sử nghe đang trống.").size(14).color(p.text_muted))
                .padding(32)
                .width(Length::Fill)
                .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let today = Local::now().date_naive();
    let yesterday = today.pred_opt();
    let mut current_group: Option<String> = None;
    let mut track_idx = 0usize;

    let mut list = column![].spacing(2).width(Length::Fill);
    for item in &state.history_items {
        let Some(ref tr) = item.track else {
            continue;
        };
        let label = item
            .played_date()
            .map(|d| {
                let local_date = d.with_timezone(&Local).date_naive();
                if local_date == today {
                    "Hôm nay".to_string()
                } else if Some(local_date) == yesterday {
                    "Hôm qua".to_string()
                } else {
                    local_date.format("%d/%m/%Y").to_string()
                }
            })
            .unwrap_or_else(|| "Gần đây".to_string());

        if current_group.as_deref() != Some(label.as_str()) {
            current_group = Some(label.clone());
            list = list.push(
                container(
                    text(label)
                        .size(14)
                        .font(FONT_SEMIBOLD)
                        .color(p.text_muted),
                )
                .padding([12, 4]),
            );
        }

        let item_row = row![
            track_row(
                state,
                tr,
                None,
                valid_tracks.clone(),
                track_idx,
                None,
                p,
            ),
            button(icons::trash(14.0, p.text_dim))
                .padding(10)
                .style(ghost_button(p, 8.0))
                .on_press(Message::DeleteHistoryItem(item.id.clone())),
        ]
        .spacing(6)
        .align_y(Alignment::Center);

        list = list.push(item_row);
        track_idx += 1;
    }
    col = col.push(list);

    col = col.push(space().height(24));
    col.into()
}

