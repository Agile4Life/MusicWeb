use iced::widget::{button, column, container, mouse_area, row, space, text};
use iced::{Alignment, Color, Element, Length, Padding, Vector};

use bs_core::session::SessionStore;

use crate::icons;
use crate::state::{AppState, ContextMenuState, Message};
use crate::theme::{
    FONT_SEMIBOLD, Palette, danger_button, elevated_panel, ghost_button, truncate_str,
};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::hairline_divider;
use crate::widgets::motion::{MotionOrigin, motion_box};

pub fn context_menu_overlay<'a>(
    state: &'a AppState,
    menu: &'a ContextMenuState,
    p: Palette,
) -> Element<'a, Message> {
    let track = &menu.track;
    let is_fav =
        SessionStore::is_favorite_sync(&state.session_snap, &state.known_db_ids, track);

    let header = container(
        row![
            artwork(&state.image_cache, track.cover_url.as_deref(), 38.0, 5.0, p),
            column![
                text(truncate_str(&track.title, 22))
                    .size(13)
                    .font(FONT_SEMIBOLD)
                    .color(p.text),
                text(truncate_str(track.artist_name(), 24))
                    .size(11)
                    .color(p.text_muted),
            ]
            .spacing(2)
            .width(Length::Fill),
        ]
        .spacing(10)
        .align_y(Alignment::Center),
    )
    .padding([8, 10])
    .width(Length::Fill);

    let mut items = column![
        header,
        hairline_divider(p),
        menu_item(
            icons::play(14.0, p.accent),
            "Phát tiếp theo",
            Message::PlayNext(track.clone()),
            p,
        ),
        menu_item(
            icons::queue(14.0, p.text_muted),
            "Thêm vào hàng chờ",
            Message::EnqueueTrack(track.clone()),
            p,
        ),
        hairline_divider(p),
        menu_item(
            if is_fav {
                icons::heart_filled(14.0, p.heart)
            } else {
                icons::heart(14.0, p.text_muted)
            },
            if is_fav {
                "Bỏ yêu thích"
            } else {
                "Thêm vào yêu thích"
            },
            Message::ToggleFavorite(track.clone()),
            p,
        ),
        menu_item(
            icons::list_music(14.0, p.text_muted),
            "Thêm vào playlist…",
            Message::OpenPlaylistPicker(track.clone()),
            p,
        ),
    ]
    .spacing(3)
    .width(248);

    let has_nav = track.primary_artist().is_some()
        || track.album.as_deref().is_some_and(|a| !a.is_empty())
        || track.spotify_album_id.is_some();

    if has_nav {
        items = items.push(hairline_divider(p));
    }

    if let Some(artist) = track.primary_artist() {
        items = items.push(menu_item(
            icons::user(14.0, p.text_muted),
            "Đi tới nghệ sĩ",
            Message::OpenArtist(artist),
            p,
        ));
    }

    if track.album.as_deref().is_some_and(|a| !a.is_empty())
        || track.spotify_album_id.is_some()
    {
        items = items.push(menu_item(
            icons::disc(14.0, p.text_muted),
            "Xem album",
            Message::ResolveAndOpenAlbum(track.clone()),
            p,
        ));
    }

    if let Some(pl_id) = &menu.playlist_id_context {
        items = items.push(hairline_divider(p));
        items = items.push(
            button(
                row![
                    icons::trash(14.0, p.danger),
                    text("Xoá khỏi playlist").size(13).color(p.danger),
                ]
                .spacing(10)
                .align_y(Alignment::Center),
            )
            .width(Length::Fill)
            .padding([8, 12])
            .style(danger_button(p, 6.0))
            .on_press(Message::RemoveTrackFromPlaylist {
                playlist_id: pl_id.clone(),
                track_id: track.id.clone(),
            }),
        );
    }

    let card = container(items).padding(6).style(elevated_panel(p, 10.0));
    let ov_t = state.overlay_spring.value.clamp(0.0, 1.08);
    let animated_card = motion_box(
        Vector::new(0.0, (1.0 - ov_t) * -6.0),
        0.94 + 0.06 * ov_t,
        MotionOrigin::Center,
        false,
        card,
    );

    let max_x = (state.settings.window_width - 270.0).max(20.0);
    let max_y = (state.settings.window_height - 340.0).max(20.0);
    let left = menu.position.x.clamp(16.0, max_x);
    let top = menu.position.y.clamp(16.0, max_y);

    let positioned = column![
        space().height(top),
        row![space().width(left), animated_card],
    ]
    .width(Length::Fill)
    .height(Length::Fill);

    mouse_area(
        container(positioned)
            .width(Length::Fill)
            .height(Length::Fill)
            .padding(Padding::ZERO)
            .style(|_| container::Style {
                background: Some(iced::Background::Color(Color::from_rgba(0.0, 0.0, 0.0, 0.05))),
                ..Default::default()
            }),
    )
    .on_press(Message::CloseContextMenu)
    .on_right_press(Message::CloseContextMenu)
    .into()
}

fn menu_item<'a>(
    icon: impl Into<Element<'a, Message>>,
    label: &'a str,
    msg: Message,
    p: Palette,
) -> Element<'a, Message> {
    button(
        row![icon.into(), text(label).size(13).color(p.text)]
            .spacing(10)
            .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .padding([8, 12])
    .style(ghost_button(p, 6.0))
    .on_press(msg)
    .into()
}
