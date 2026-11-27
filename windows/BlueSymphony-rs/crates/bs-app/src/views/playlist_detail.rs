use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Element, Length};

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_SEMIBOLD, Palette, danger_button, ghost_button, glass_card, primary_button,
    secondary_button,
};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::{hairline_divider, shimmer_skeleton_rows, track_list_header};
use crate::widgets::track_row::track_row;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![].spacing(18).width(Length::Fill);

    if state.playlist_detail_loading {
        col = col.push(shimmer_skeleton_rows(state.aurora_time, 6, p));
        return col.into();
    }

    let Some((ref pl, ref tracks)) = state.playlist_detail else {
        col = col.push(
            container(text("Không tìm thấy playlist.").size(14).color(p.text_muted))
                .padding(32)
                .width(Length::Fill)
                .style(glass_card(p, 14.0)),
        );
        return col.into();
    };

    let owned = state.session_snap.owns(pl);
    let cover = pl
        .cover_url
        .as_deref()
        .or_else(|| tracks.first().and_then(|t| t.cover_url.as_deref()));

    let total_secs: f64 = tracks.iter().filter_map(|t| t.duration).sum();
    let duration_summary = if total_secs > 60.0 {
        format!(" · {} phút", (total_secs / 60.0).round() as u32)
    } else {
        String::new()
    };

    let mut actions = row![].spacing(10);
    if !tracks.is_empty() {
        actions = actions.push(
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
                tracks: tracks.clone(),
                start_at: 0,
            }),
        );
    }

    if owned {
        actions = actions.push(
            button(
                row![
                    icons::edit(13.5, p.accent),
                    text("Chỉnh sửa").size(13).font(FONT_SEMIBOLD).color(p.accent),
                ]
                .spacing(6)
                .align_y(Alignment::Center),
            )
            .padding([8, 14])
            .style(secondary_button(p, 7.0))
            .on_press(Message::OpenEditPlaylist(pl.clone())),
        );
        actions = actions.push(
            button(
                row![
                    icons::trash(13.5, p.danger),
                    text("Xoá").size(13).color(p.danger),
                ]
                .spacing(6)
                .align_y(Alignment::Center),
            )
            .padding([8, 14])
            .style(danger_button(p, 7.0))
            .on_press(Message::DeletePlaylist(pl.id.clone())),
        );
    }

    let kind_label = if pl.is_public == Some(true) {
        "PLAYLIST CÔNG KHAI"
    } else {
        "PLAYLIST CÁ NHÂN"
    };

    let hero = container(
        row![
            artwork(&state.image_cache, cover, 210.0, 10.0, p),
            column![
                text(pl.name.clone()).size(28).font(FONT_BOLD).color(p.text),
                text(
                    pl.description
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("Chưa có mô tả")
                        .to_string()
                )
                .size(14)
                .color(p.text_muted),
                text(format!("{kind_label} · {} bài hát{duration_summary}", tracks.len()))
                    .size(11.5)
                    .font(FONT_SEMIBOLD)
                    .color(p.text_dim),
                space().height(10),
                actions,
            ]
            .spacing(5)
            .width(Length::Fill),
        ]
        .spacing(26)
        .align_y(Alignment::End),
    )
    .padding([6, 0])
    .width(Length::Fill);

    col = col.push(hero);
    col = col.push(hairline_divider(p));

    if tracks.is_empty() {
        col = col.push(
            container(
                text("Playlist này chưa có bài hát. Chuột phải vào bài hát bất kỳ để thêm.")
                    .size(14)
                    .color(p.text_muted),
            )
            .padding(28)
            .width(Length::Fill)
            .style(glass_card(p, 14.0)),
        );
    } else {
        let mut list = column![track_list_header(p)].spacing(2).width(Length::Fill);
        for (i, tr) in tracks.iter().enumerate() {
            let ctx = if owned { Some(pl.id.clone()) } else { None };
            let row_el = track_row(
                state,
                tr,
                Some(format!("{}", i + 1)),
                tracks.clone(),
                i,
                ctx,
                p,
            );
            if owned {
                list = list.push(
                    row![
                        row_el,
                        button(icons::trash(14.0, p.text_dim))
                            .padding(10)
                            .style(ghost_button(p, 8.0))
                            .on_press(Message::RemoveTrackFromPlaylist {
                                playlist_id: pl.id.clone(),
                                track_id: tr.id.clone(),
                            }),
                    ]
                    .spacing(6)
                    .align_y(Alignment::Center),
                );
            } else {
                list = list.push(row_el);
            }
        }
        col = col.push(list);
    }

    col = col.push(space().height(24));
    col.into()
}
