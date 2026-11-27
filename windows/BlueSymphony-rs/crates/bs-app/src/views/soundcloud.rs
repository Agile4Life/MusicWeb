use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Element, Length};

use bs_core::models::SoundCloudPlaylistSummary;

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_MEDIUM, FONT_SEMIBOLD, Palette, card_button, glass_card, pill_button,
    primary_button, subtle_scrollable, truncate_str,
};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::{hairline_divider, shimmer_skeleton_rows, track_list_header};
use crate::widgets::motion::hover_reveal;
use crate::widgets::shelf::{apple_hover_play_overlay, section_header};
use crate::widgets::track_row::track_row;

const TAGS: &[(&str, &str)] = &[
    ("v-pop", "V-Pop"),
    ("rap viet", "Rap Việt"),
    ("lofi viet", "Lofi Việt"),
    ("remix viet", "Remix / EDM"),
    ("indie", "Indie"),
    ("all-music", "Thịnh hành"),
];

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            text("SoundCloud").size(32).font(FONT_BOLD).color(p.text),
            hairline_divider(p),
        ]
        .spacing(12),
    ]
    .spacing(18)
    .width(Length::Fill);

    let tag_pills = row(TAGS.iter().map(|(tag, label)| {
        let active = state.sc_hub_tag == *tag;
        button(text(*label).size(13).font(FONT_SEMIBOLD))
            .padding([7, 16])
            .style(pill_button(p, active))
            .on_press(Message::SelectSoundCloudHubTag((*tag).to_string()))
            .into()
    }))
    .spacing(8);

    col = col.push(tag_pills);

    if state.sc_hub_loading {
        col = col.push(shimmer_skeleton_rows(state.aurora_time, 6, p));
        return col.into();
    }

    if !state.sc_hub_playlists.is_empty() {
        let mut pl_row = row![].spacing(14).padding([4, 2]);
        for pl in state.sc_hub_playlists.iter().take(6) {
            let count_txt = pl
                .track_count
                .map(|c| format!("{c} bài hát"))
                .unwrap_or_else(|| "SoundCloud Set".to_string());
            let art = hover_reveal(
                artwork(&state.image_cache, pl.display_cover(), 168.0, 10.0, p),
                apple_hover_play_overlay(10.0),
            );
            pl_row = pl_row.push(
                button(
                    column![
                        art,
                        column![
                            text(truncate_str(&pl.title, 20))
                                .size(13.5)
                                .font(FONT_SEMIBOLD)
                                .color(p.text),
                            text(count_txt).size(12).color(p.text_muted),
                        ]
                        .spacing(2)
                        .width(168),
                    ]
                    .spacing(8),
                )
                .padding(2)
                .style(card_button(p, 10.0))
                .on_press(Message::OpenSoundCloudPlaylist(pl.clone())),
            );
        }
        col = col.push(
            column![
                section_header("Playlists nổi bật", None, None, p),
                iced::widget::scrollable(pl_row)
                    .direction(iced::widget::scrollable::Direction::Horizontal(
                        iced::widget::scrollable::Scrollbar::hidden(),
                    ))
                    .style(subtle_scrollable(p)),
            ]
            .spacing(12),
        );
    }

    if state.sc_hub_tracks.is_empty() {
        col = col.push(
            container(
                row![
                    icons::cloud(18.0, p.text_dim),
                    text("Không tìm thấy bài hát cho thể loại này.")
                        .size(14)
                        .color(p.text_muted),
                ]
                .spacing(10)
                .align_y(Alignment::Center),
            )
            .padding(28)
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .style(glass_card(p, 14.0)),
        );
    } else {
        let mut list = column![
            section_header("Bài hát đề xuất", None, None, p),
            track_list_header(p),
        ]
        .spacing(2)
        .width(Length::Fill);
        for (i, tr) in state.sc_hub_tracks.iter().enumerate() {
            list = list.push(track_row(
                state,
                tr,
                Some(format!("{}", i + 1)),
                state.sc_hub_tracks.clone(),
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

pub fn playlist_view<'a>(
    state: &'a AppState,
    stub: &'a SoundCloudPlaylistSummary,
    p: Palette,
) -> Element<'a, Message> {
    let (pl, tracks): (&SoundCloudPlaylistSummary, &[bs_core::models::Track]) =
        match state.sc_playlist_detail {
            Some((ref detail_pl, ref detail_tracks)) if detail_pl.id == stub.id => {
                (detail_pl, detail_tracks.as_slice())
            }
            _ => (stub, stub.tracks.as_deref().unwrap_or(&[])),
        };

    let mut col = column![].spacing(18).width(Length::Fill);

    let total_secs: f64 = tracks.iter().filter_map(|t| t.duration).sum();
    let duration_summary = if total_secs > 60.0 {
        format!(" · {} phút", (total_secs / 60.0).round() as u32)
    } else {
        String::new()
    };
    let count_display = if !tracks.is_empty() {
        tracks.len()
    } else {
        pl.track_count.unwrap_or(0) as usize
    };

    let mut meta_col = column![text(pl.title.clone()).size(28).font(FONT_BOLD).color(p.text)].spacing(5);

    if let Some(creator) = pl.creator_name() {
        meta_col = meta_col.push(
            text(creator.to_string())
                .size(18)
                .font(FONT_MEDIUM)
                .color(p.accent),
        );
    }

    meta_col = meta_col.push(
        text(format!(
            "SOUNDCLOUD PLAYLIST · {count_display} bài hát{duration_summary}"
        ))
        .size(11.5)
        .font(FONT_SEMIBOLD)
        .color(p.text_dim),
    );

    if !tracks.is_empty() {
        meta_col = meta_col.push(space().height(10)).push(
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
                tracks: tracks.to_vec(),
                start_at: 0,
            }),
        );
    }

    let hero = container(
        row![
            artwork(&state.image_cache, pl.display_cover(), 210.0, 10.0, p),
            meta_col.width(Length::Fill),
        ]
        .spacing(26)
        .align_y(Alignment::End),
    )
    .padding([6, 0])
    .width(Length::Fill);

    col = col.push(hero);
    col = col.push(hairline_divider(p));

    if state.sc_playlist_loading {
        col = col.push(shimmer_skeleton_rows(state.aurora_time, 6, p));
        return col.into();
    }

    if let Some(ref err) = state.sc_playlist_error {
        col = col.push(
            container(text(err.clone()).size(14).color(p.danger))
                .padding(24)
                .width(Length::Fill)
                .align_x(Alignment::Center)
                .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    if tracks.is_empty() {
        col = col.push(
            container(
                text("Playlist này chưa có bài hát nào khả dụng.")
                    .size(14)
                    .color(p.text_muted),
            )
            .padding(28)
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .style(glass_card(p, 14.0)),
        );
        return col.into();
    }

    let mut list = column![track_list_header(p)].spacing(2).width(Length::Fill);
    for (i, tr) in tracks.iter().enumerate() {
        list = list.push(track_row(
            state,
            tr,
            Some(format!("{}", i + 1)),
            tracks.to_vec(),
            i,
            None,
            p,
        ));
    }
    col = col.push(list);

    col = col.push(space().height(24));
    col.into()
}
