use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Element, Length};

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{FONT_BOLD, FONT_SEMIBOLD, Palette, glass_card, primary_button};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::{hairline_divider, shimmer_skeleton_rows, track_list_header};
use crate::widgets::shelf::section_header;
use crate::widgets::track_row::track_row;

pub fn view<'a>(state: &'a AppState, artist_name: &'a str, p: Palette) -> Element<'a, Message> {
    let mut col = column![].spacing(18).width(Length::Fill);

    if state.artist_loading {
        col = col.push(shimmer_skeleton_rows(state.aurora_time, 6, p));
        return col.into();
    }

    if let Some(ref err) = state.artist_error {
        col = col.push(
            container(text(err.clone()).size(14).color(p.danger))
                .padding(28)
                .width(Length::Fill)
                .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let display_name = state
        .artist_info
        .as_ref()
        .map(|a| a.name.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| artist_name.to_string());
    let cover = state
        .artist_info
        .as_ref()
        .and_then(|a| a.picture_url())
        .or_else(|| {
            state
                .artist_tracks
                .first()
                .and_then(|t| t.cover_url.as_deref())
        });
    let fans = state
        .artist_info
        .as_ref()
        .and_then(|a| a.nb_fan)
        .filter(|n| *n > 0.0)
        .map(|n| format!("{} người nghe", format_fans(n)));

    let mut meta = column![text(display_name).size(32).font(FONT_BOLD).color(p.text)].spacing(6);

    if let Some(f) = fans {
        meta = meta.push(text(f).size(13).color(p.text_muted));
    }

    if !state.artist_tracks.is_empty() {
        meta = meta.push(space().height(10)).push(
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
            .padding([8, 22])
            .style(primary_button(p, 7.0))
            .on_press(Message::PlayTracks {
                tracks: state.artist_tracks.clone(),
                start_at: 0,
            }),
        );
    }

    let hero = container(
        row![
            artwork(&state.image_cache, cover, 168.0, 84.0, p),
            meta.width(Length::Fill),
        ]
        .spacing(26)
        .align_y(Alignment::Center),
    )
    .padding([6, 0])
    .width(Length::Fill);

    col = col.push(hero);
    col = col.push(hairline_divider(p));

    if !state.artist_tracks.is_empty() {
        let mut list = column![
            section_header("Bài hát hàng đầu", None, None, p),
            track_list_header(p),
        ]
        .spacing(2)
        .width(Length::Fill);
        for (i, tr) in state.artist_tracks.iter().enumerate() {
            list = list.push(track_row(
                state,
                tr,
                Some(format!("{}", i + 1)),
                state.artist_tracks.clone(),
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

fn format_fans(n: f64) -> String {
    if n >= 1_000_000.0 {
        format!("{:.1}M", n / 1_000_000.0)
    } else if n >= 1_000.0 {
        format!("{:.1}K", n / 1_000.0)
    } else {
        format!("{:.0}", n)
    }
}
