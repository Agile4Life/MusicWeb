use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Element, Length};

use bs_core::library::TopTimeframe;
use bs_core::models::Track;

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{FONT_BOLD, Palette, ghost_button, glass_card, pill_button};
use crate::views::library::signed_out_prompt;
use crate::widgets::artwork::loading_banner;
use crate::widgets::micro::{count_pill, hairline_divider, track_list_header};
use crate::widgets::track_row::track_row;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            row![
                text("Top của bạn").size(32).font(FONT_BOLD).color(p.text),
                space().width(Length::Fill),
                text(format!("{} lượt nghe", state.top_total_plays))
                    .size(12.5)
                    .color(p.text_muted),
                button(icons::refresh(15.0, p.text_muted))
                    .padding(8)
                    .style(ghost_button(p, 8.0))
                    .on_press(Message::LoadTopTracks(state.top_timeframe)),
            ]
            .spacing(10)
            .align_y(Alignment::Center)
            .width(Length::Fill),
            hairline_divider(p),
        ]
        .spacing(12),
    ]
    .spacing(18)
    .width(Length::Fill);

    if !state.session_snap.is_signed_in() {
        col = col.push(signed_out_prompt("Đăng nhập để xem bảng xếp hạng cá nhân", p));
        return col.into();
    }

    let tabs = row([TopTimeframe::Days7, TopTimeframe::Days30, TopTimeframe::All]
        .into_iter()
        .map(|tf| {
            let active = state.top_timeframe == tf;
            button(text(tf.label()).size(13))
                .padding([7, 16])
                .style(pill_button(p, active))
                .on_press(Message::LoadTopTracks(tf))
                .into()
        }))
    .spacing(8);

    col = col.push(tabs);

    if state.top_loading {
        col = col.push(loading_banner("Đang tổng hợp thống kê…", p));
        return col.into();
    }

    if state.top_items.is_empty() {
        col = col.push(
            container(
                text("Chưa có đủ dữ liệu nghe trong khoảng thời gian này.")
                    .size(14)
                    .color(p.text_muted),
            )
            .padding(32)
            .width(Length::Fill)
            .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let tracks: Vec<Track> = state.top_items.iter().map(|i| i.track.clone()).collect();
    let mut list = column![track_list_header(p)].spacing(2).width(Length::Fill);
    for (i, item) in state.top_items.iter().enumerate() {
        let pill = count_pill(format!("{} lượt", item.play_count), p);

        list = list.push(
            row![
                track_row(
                    state,
                    &item.track,
                    Some(format!("{}", i + 1)),
                    tracks.clone(),
                    i,
                    None,
                    p,
                ),
                pill,
            ]
            .spacing(10)
            .align_y(Alignment::Center),
        );
    }
    col = col.push(list);

    col = col.push(space().height(24));
    col.into()
}

