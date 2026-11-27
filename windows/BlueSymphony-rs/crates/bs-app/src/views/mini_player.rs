use iced::mouse;
use iced::widget::{button, column, container, mouse_area, row, space, text};
use iced::{Alignment, Background, Border, Color, Element, Gradient, Length, Radians, Shadow, Vector};

use bs_core::session::SessionStore;

use crate::icons;
use crate::state::{AppState, Message, format_duration};
use crate::theme::{FONT_SEMIBOLD, ghost_button, palette, truncate_str};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::eq_bars;
use crate::widgets::seekbar::seekbar_apple_np;

pub fn view<'a>(state: &'a AppState) -> Element<'a, Message> {
    let p = palette(state.settings.theme, state.settings.gaming_mode);
    let snap = &state.player;
    let current = snap.current();

    let title = current
        .map(|t| truncate_str(&t.title, 24))
        .unwrap_or_else(|| "BlueSymphony".to_string());
    let artist = current
        .map(|t| truncate_str(t.artist_name(), 30))
        .unwrap_or_else(|| "Chưa phát nhạc".to_string());
    let cover = current.and_then(|t| t.cover_url.as_deref());

    let lyric_preview = state
        .lyrics
        .as_ref()
        .and_then(|l| l.active_index(snap.current_time).and_then(|i| l.lines.get(i)))
        .map(|l| truncate_str(l.text.trim(), 38))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            format!(
                "{} / {}",
                format_duration(snap.current_time),
                format_duration(snap.duration)
            )
        });

    let play_icon = if snap.is_playing {
        icons::pause(20.0, Color::WHITE)
    } else {
        icons::play(20.0, Color::WHITE)
    };

    let heart_btn: Element<'a, Message> = if let Some(track) = current {
        let is_fav =
            SessionStore::is_favorite_sync(&state.session_snap, &state.known_db_ids, track);
        button(if is_fav {
            icons::heart_filled(15.0, p.heart)
        } else {
            icons::heart(15.0, p.text_muted)
        })
        .padding(6)
        .style(ghost_button(p, 999.0))
        .on_press(Message::ToggleFavorite(track.clone()))
        .into()
    } else {
        space().width(0).into()
    };

    let drag_handle = container(space().width(36).height(3))
        .style(move |_| container::Style {
            background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.24))),
            border: Border {
                radius: 999.0.into(),
                ..Default::default()
            },
            ..Default::default()
        });

    let top_drag_bar = container(drag_handle)
        .width(Length::Fill)
        .align_x(Alignment::Center);

    let main_row = row![
        artwork(&state.image_cache, cover, 80.0, 8.0, p),
        column![
            row![
                column![
                    text(title).size(15).font(FONT_SEMIBOLD).color(p.text),
                    text(artist).size(12).color(p.text_muted),
                ]
                .spacing(2)
                .width(Length::Fill),
                button(icons::maximize(14.0, p.text_muted))
                    .padding(6)
                    .style(ghost_button(p, 8.0))
                    .on_press(Message::FocusMainWindow),
                button(icons::close(14.0, p.text_muted))
                    .padding(6)
                    .style(ghost_button(p, 8.0))
                    .on_press(Message::ToggleMiniPlayer),
            ]
            .spacing(4)
            .align_y(Alignment::Start),
            row![
                eq_bars(state.aurora_time, snap.is_playing, p.accent, 13.0, 10.0),
                text(lyric_preview).size(11.5).color(p.accent),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
            row![
                heart_btn,
                button(icons::skip_back(15.0, p.text))
                    .padding(6)
                    .style(ghost_button(p, 999.0))
                    .on_press_maybe(current.map(|_| Message::PrevTrack)),
                button(
                    container(play_icon)
                        .width(34)
                        .height(34)
                        .align_x(Alignment::Center)
                        .align_y(Alignment::Center),
                )
                .padding(0)
                .style(ghost_button(p, 999.0))
                .on_press_maybe(current.map(|_| Message::TogglePlay)),
                button(icons::skip_forward(15.0, p.text))
                    .padding(6)
                    .style(ghost_button(p, 999.0))
                    .on_press_maybe(current.map(|_| Message::NextTrack)),
                space().width(Length::Fill),
                text(format!(
                    "{} / {}",
                    format_duration(snap.current_time),
                    format_duration(snap.duration)
                ))
                .size(11)
                .color(p.text_dim),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
        ]
        .spacing(5)
        .width(Length::Fill),
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let tint = state.aurora_current[0];
    let base_mini = Color::from_rgb8(36, 36, 38);
    let card_grad = Gradient::Linear(
        iced::gradient::Linear::new(Radians(0.55))
            .add_stop(
                0.0,
                Color::from_rgba(
                    (base_mini.r * 0.92 + tint.r * 0.08).min(1.0),
                    (base_mini.g * 0.92 + tint.g * 0.08).min(1.0),
                    (base_mini.b * 0.92 + tint.b * 0.08).min(1.0),
                    0.96,
                ),
            )
            .add_stop(
                1.0,
                Color::from_rgba(base_mini.r, base_mini.g, base_mini.b, 0.96),
            ),
    );

    let card = container(
        column![
            top_drag_bar,
            main_row,
            seekbar_apple_np(
                snap.current_time,
                snap.duration,
                snap.is_loading,
                state.aurora_time,
                p,
            ),
        ]
        .spacing(6),
    )
    .width(Length::Fill)
    .height(Length::Fill)
    .padding([8, 14])
    .style(move |_| container::Style {
        background: Some(Background::Gradient(card_grad)),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.12),
            width: 1.0,
            radius: 12.0.into(),
        },
        shadow: Shadow {
            color: Color::from_rgba(0.0, 0.0, 0.0, 0.45),
            offset: Vector::new(0.0, 6.0),
            blur_radius: 18.0,
        },
        text_color: Some(p.text),
        snap: false,
    });

    mouse_area(card)
        .on_press(Message::DragMiniWindow)
        .interaction(mouse::Interaction::Grab)
        .into()
}
