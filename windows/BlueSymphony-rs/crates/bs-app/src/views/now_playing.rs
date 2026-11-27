use iced::widget::scrollable::{Direction, Scrollbar};
use iced::widget::{
    Id, button, column, container, row, scrollable, shader, slider, space, stack, text,
};
use iced::{Alignment, Background, Border, Color, Element, Length, Vector};

use bs_core::session::SessionStore;

use crate::icons;
use crate::shaders::aurora::AuroraShader;
use crate::state::{AppState, LYRICS_SCROLL_ID, Message, format_duration};
use crate::theme::{
    FONT_BOLD, FONT_MEDIUM, FONT_SEMIBOLD, Palette, accent_slider, ghost_button,
    lyric_line_button, nav_button, primary_button, subtle_scrollable, truncate_str,
};
use crate::views;
use crate::widgets::artwork::artwork_ambient;
use crate::widgets::motion::{MotionOrigin, motion_box, scale_box};
use crate::widgets::seekbar::seekbar_apple_np;

pub fn view<'a>(state: &'a AppState, p: Palette, y_offset_px: f32) -> Element<'a, Message> {
    let snap = &state.player;
    let current = snap.current();
    let has_lyrics = state.lyrics.as_ref().is_some_and(|l| !l.lines.is_empty());
    let lyrics_available = state.lyrics_loading || has_lyrics;
    let show_lyrics_col = state.show_lyrics && lyrics_available;
    let show_romaji_toggle = show_lyrics_col && state.lyrics.as_ref().is_some_and(|l| l.has_cjk());

    let mut header = row![space().width(Length::Fill)]
        .spacing(6)
        .align_y(Alignment::Center)
        .width(Length::Fill);

    if show_romaji_toggle {
        header = header.push(
            button(
                text(if state.settings.romaji_enabled {
                    "Romaji: Bật"
                } else {
                    "Romaji: Tắt"
                })
                .size(12)
                .font(FONT_MEDIUM),
            )
            .padding([5, 10])
            .style(nav_button(p, state.settings.romaji_enabled))
            .on_press(Message::ToggleRomaji),
        );
    }

    let hdr_icon = Color::from_rgba(1.0, 1.0, 1.0, 0.72);
    header = header
        .push(
            button(icons::mini_player(
                15.0,
                if state.mini_window.is_some() {
                    p.accent
                } else {
                    hdr_icon
                },
            ))
            .padding(7)
            .style(nav_button(p, state.mini_window.is_some()))
            .on_press(Message::ToggleMiniPlayer),
        )
        .push(
            button(icons::close(16.0, hdr_icon))
                .padding(7)
                .style(ghost_button(p, 7.0))
                .on_press(Message::ToggleNowPlaying),
        );

    let left_panel: Element<'a, Message> = if let Some(track) = current {
        let is_fav =
            SessionStore::is_favorite_sync(&state.session_snap, &state.known_db_ids, track);

        let play_icon = if snap.is_loading {
            icons::refresh(24.0, Color::WHITE)
        } else if snap.is_playing {
            icons::pause(24.0, Color::WHITE)
        } else {
            icons::play(24.0, Color::WHITE)
        };
        let vol_col = Color::from_rgba(1.0, 1.0, 1.0, 0.66);
        let vol_low_icon = if snap.muted || snap.volume <= 0.01 {
            icons::volume_x(14.5, vol_col)
        } else {
            icons::volume_1(14.5, vol_col)
        };
        let vol_val = if snap.muted { 0.0 } else { snap.volume as f32 };

        let pulse = if snap.is_playing {
            (state.aurora_time * 1.4).sin() * 0.5 + 0.5
        } else {
            0.0
        };

        let art_size: f32 = if show_lyrics_col { 360.0 } else { 396.0 };
        let art_breathing = scale_box(
            state.artwork_scale_spring.value,
            MotionOrigin::Center,
            artwork_ambient(
                &state.image_cache,
                track.cover_url.as_deref(),
                art_size,
                10.0,
                state.aurora_current[0],
                pulse,
                p,
            ),
        );

        let artist_album_label = match track.album.as_deref().filter(|s| !s.is_empty()) {
            Some(alb) => format!("{} — {}", track.artist_name(), alb),
            None => track.artist_name().to_string(),
        };
        let artist_album_msg = if track.album.as_deref().is_some_and(|s| !s.is_empty())
            || track.spotify_album_id.is_some()
        {
            Some(Message::ResolveAndOpenAlbum(track.clone()))
        } else {
            track.primary_artist().map(Message::OpenArtist)
        };

        let quality_label = if let Some(ref sp) = state.signal_path {
            if sp.exclusive {
                let sr_khz = sp.output_sample_rate as f32 / 1000.0;
                if sp.bit_exact {
                    format!("Bit-Perfect · {sr_khz:.1}kHz")
                } else {
                    format!("WASAPI Ex · {sr_khz:.1}kHz")
                }
            } else {
                "Lossless".to_string()
            }
        } else {
            match track.source.as_deref() {
                Some("soundcloud") => "SoundCloud".to_string(),
                Some("nhaccuatui") => "NhacCuaTui".to_string(),
                _ => "Lossless".to_string(),
            }
        };

        let fav_btn = scale_box(
            state.heart_spring.value,
            MotionOrigin::Center,
            button(if is_fav {
                icons::heart_filled(15.0, p.heart)
            } else {
                icons::heart(15.0, Color::from_rgba(1.0, 1.0, 1.0, 0.68))
            })
            .padding(6)
            .style(ghost_button(p, 7.0))
            .on_press(Message::ToggleFavorite(track.clone())),
        );

        let play_btn = scale_box(
            state.play_btn_spring.value,
            MotionOrigin::Center,
            button(
                container(play_icon)
                    .width(34)
                    .height(34)
                    .align_x(Alignment::Center)
                    .align_y(Alignment::Center),
            )
            .padding(0)
            .style(ghost_button(p, 999.0))
            .on_press(Message::TogglePlay),
        );

        let rem_secs = (snap.duration - snap.current_time).max(0.0);

        let left_grp = row![
            button(vol_low_icon)
                .padding(5)
                .style(ghost_button(p, 6.0))
                .on_press(Message::ToggleMute),
            slider(0.0..=1.0, vol_val, |v| Message::SetVolume(f64::from(v)))
                .step(0.01_f32)
                .style(accent_slider(p))
                .width(46),
            button(icons::more(15.0, Color::from_rgba(1.0, 1.0, 1.0, 0.72)))
                .padding(5)
                .style(ghost_button(p, 6.0))
                .on_press(Message::OpenContextMenu {
                    track: track.clone(),
                    playlist_id: None,
                }),
            space().width(Length::Fill),
        ]
        .spacing(2)
        .align_y(Alignment::Center)
        .width(Length::Fill);

        let center_grp = row![
            button(icons::skip_back(20.0, Color::WHITE))
                .padding(6)
                .style(ghost_button(p, 999.0))
                .on_press(Message::PrevTrack),
            play_btn,
            button(icons::skip_forward(20.0, Color::WHITE))
                .padding(6)
                .style(ghost_button(p, 999.0))
                .on_press(Message::NextTrack),
        ]
        .spacing(10)
        .align_y(Alignment::Center);

        let lyrics_icon_col = if show_lyrics_col {
            Color::WHITE
        } else if lyrics_available {
            Color::from_rgba(1.0, 1.0, 1.0, 0.72)
        } else {
            Color::from_rgba(1.0, 1.0, 1.0, 0.28)
        };
        let lyrics_btn = button(
            container(icons::lyrics_bubble(15.0, lyrics_icon_col))
                .width(30)
                .height(30)
                .align_x(Alignment::Center)
                .align_y(Alignment::Center)
                .style(move |_| container::Style {
                    background: Some(Background::Color(if show_lyrics_col {
                        Color::from_rgba(1.0, 1.0, 1.0, 0.22)
                    } else {
                        Color::TRANSPARENT
                    })),
                    border: Border {
                        radius: 6.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }),
        )
        .padding(0)
        .style(ghost_button(p, 6.0))
        .on_press(Message::ToggleNowPlayingLyrics);

        let right_grp = row![
            space().width(Length::Fill),
            fav_btn,
            button(icons::queue(
                15.0,
                if state.show_queue {
                    p.accent
                } else {
                    Color::from_rgba(1.0, 1.0, 1.0, 0.72)
                },
            ))
            .padding(6)
            .style(nav_button(p, state.show_queue))
            .on_press(Message::ToggleQueueDrawer),
            lyrics_btn,
        ]
        .spacing(2)
        .align_y(Alignment::Center)
        .width(Length::Fill);

        column![
            art_breathing,
            space().height(4),
            column![
                text(truncate_str(&track.title, 44))
                    .size(15.5)
                    .font(FONT_SEMIBOLD)
                    .color(Color::WHITE),
                button(
                    text(truncate_str(&artist_album_label, 44))
                        .size(14.0)
                        .color(Color::from_rgba(1.0, 1.0, 1.0, 0.62)),
                )
                .padding(0)
                .style(ghost_button(p, 4.0))
                .on_press_maybe(artist_album_msg),
                text(quality_label)
                    .size(11.0)
                    .color(Color::from_rgba(1.0, 1.0, 1.0, 0.46)),
            ]
            .spacing(3)
            .align_x(Alignment::Center)
            .width(art_size),
            row![
                text(format_duration(snap.current_time))
                    .size(11.0)
                    .color(Color::from_rgba(1.0, 1.0, 1.0, 0.56)),
                seekbar_apple_np(
                    snap.current_time,
                    snap.duration,
                    snap.is_loading,
                    state.aurora_time,
                    p,
                ),
                text(if snap.duration > 0.0 {
                    format!("-{}", format_duration(rem_secs))
                } else {
                    "0:00".to_string()
                })
                .size(11.0)
                .color(Color::from_rgba(1.0, 1.0, 1.0, 0.56)),
            ]
            .spacing(10)
            .align_y(Alignment::Center)
            .width(art_size),
            row![left_grp, center_grp, right_grp]
                .spacing(6)
                .align_y(Alignment::Center)
                .width(art_size),
        ]
        .spacing(12)
        .align_x(Alignment::Center)
        .width(if show_lyrics_col {
            Length::FillPortion(5)
        } else {
            Length::Fill
        })
        .into()
    } else {
        container(
            column![
                icons::music_note(48.0, p.text_dim),
                text("Chưa có bài hát nào đang phát")
                    .size(18)
                    .font(FONT_SEMIBOLD)
                    .color(p.text_muted),
            ]
            .spacing(12)
            .align_x(Alignment::Center),
        )
        .width(if show_lyrics_col {
            Length::FillPortion(5)
        } else {
            Length::Fill
        })
        .height(Length::Fill)
        .align_x(Alignment::Center)
        .align_y(Alignment::Center)
        .into()
    };

    let queue_open = state.queue_spring.value > 0.005;
    let body_row: Element<'a, Message> = match (show_lyrics_col, queue_open) {
        (true, true) => row![
            left_panel,
            lyrics_column(state, p),
            views::queue_drawer::view_animated_immersive(state, p),
        ]
        .spacing(28)
        .align_y(Alignment::Center)
        .width(Length::Fill)
        .height(Length::Fill)
        .into(),
        (true, false) => row![left_panel, lyrics_column(state, p)]
            .spacing(36)
            .align_y(Alignment::Center)
            .width(Length::Fill)
            .height(Length::Fill)
            .into(),
        (false, true) => row![
            left_panel,
            views::queue_drawer::view_animated_immersive(state, p),
        ]
        .spacing(24)
        .align_y(Alignment::Center)
        .width(Length::Fill)
        .height(Length::Fill)
        .into(),
        (false, false) => container(left_panel)
            .width(Length::Fill)
            .height(Length::Fill)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .into(),
    };

    let stage = column![header, body_row]
        .spacing(16)
        .padding([20, 32])
        .width(Length::Fill)
        .height(Length::Fill);

    let stage_box = motion_box(
        Vector::new(0.0, y_offset_px),
        1.0,
        MotionOrigin::TopLeft,
        true,
        stage,
    );

    let mesh_layer: Element<'a, Message> = if state.settings.gaming_mode {
        motion_box(
            Vector::new(0.0, y_offset_px),
            1.0,
            MotionOrigin::TopLeft,
            true,
            container(space().width(Length::Fill).height(Length::Fill))
                .width(Length::Fill)
                .height(Length::Fill)
                .style(move |_| container::Style {
                    background: Some(Background::Color(p.bg)),
                    ..Default::default()
                }),
        )
    } else {
        shader(AuroraShader {
            time: state.aurora_time,
            base_bg: Color::from_rgb8(42, 46, 54),
            color_a: state.aurora_current[0],
            color_b: state.aurora_current[1],
            color_c: state.aurora_current[2],
            y_offset_px,
            intensity: 1.55,
        })
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
    };

    stack![mesh_layer, stage_box]
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}

fn lyrics_column<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let body: Element<'a, Message> = if state.player.current().is_none() {
        container(text("Chọn một bài hát để xem lời đồng bộ.").size(15).color(p.text_dim))
            .width(Length::Fill)
            .height(Length::Fill)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .into()
    } else if state.lyrics_loading {
        container(text("Đang tìm lời bài hát…").size(15).color(p.text_muted))
            .width(Length::Fill)
            .height(Length::Fill)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .into()
    } else if let Some(ref lyrics) = state.lyrics {
        if lyrics.lines.is_empty() {
            no_lyrics_view(p)
        } else {
            let synced = lyrics.is_synced();
            let active = lyrics.active_index(state.player.current_time);
            let spring_idx = state.lyrics_active_spring.value;
            let spring_vel = state.lyrics_active_spring.velocity;

            let mut list = column![space().height(90)].spacing(8).width(Length::Fill);

            for (idx, line) in lyrics.lines.iter().enumerate() {
                let is_active = active == Some(idx);
                let dist = (idx as f32 - spring_idx).abs();
                let focus = if synced {
                    (1.0 - (dist / 1.1).min(1.0)).powf(1.8)
                } else {
                    0.5
                };

                // Authentic Apple Music: uniform bold 26px lines, readable 0.44 idle white, subtle focus scale
                let line_scale = if synced { 1.0 + 0.025 * focus } else { 1.0 };
                let signed = idx as f32 - spring_idx;
                let vel_wave = (spring_vel * 1.6).clamp(-6.0, 6.0);
                let y_wave = if synced && dist < 3.0 {
                    (signed * 1.5 - vel_wave * (1.0 - dist / 3.0)).clamp(-7.0, 7.0)
                } else {
                    0.0
                };

                let alpha = if !synced {
                    0.90
                } else {
                    (0.42 + 0.58 * focus).clamp(0.42, 1.0)
                };
                let text_color = Color::from_rgba(1.0, 1.0, 1.0, alpha);
                let font_face = FONT_BOLD;

                let main_visual: Element<'a, Message> = if line.text.trim().is_empty() {
                    if is_active {
                        interlude_dots(state.aurora_time)
                    } else {
                        text("♪").size(22).font(font_face).color(text_color).into()
                    }
                } else {
                    text(line.text.as_str())
                        .size(if synced { 26.0 } else { 21.0 })
                        .font(font_face)
                        .color(text_color)
                        .into()
                };

                let mut text_col = column![main_visual].spacing(4).width(Length::Fill);

                if state.settings.romaji_enabled {
                    if let Some(rom) = state.lyrics_romaji.get(idx).filter(|s| !s.trim().is_empty()) {
                        let rom_alpha = if !synced {
                            0.65
                        } else {
                            (0.32 + 0.54 * focus).clamp(0.32, 0.88)
                        };
                        let rom_color = Color::from_rgba(1.0, 1.0, 1.0, rom_alpha);
                        text_col = text_col.push(text(rom.clone()).size(14.5).color(rom_color));
                    }
                }

                let flash_alpha = match state.lyrics_flash_idx {
                    Some((fi, f)) if fi == idx => (f * 0.20).clamp(0.0, 0.24),
                    _ => 0.0,
                };

                let btn = button(
                    container(text_col)
                        .padding([5, 10])
                        .width(Length::Fill)
                        .style(move |_| {
                            if flash_alpha > 0.005 {
                                container::Style {
                                    background: Some(Background::Color(Color::from_rgba(
                                        1.0,
                                        1.0,
                                        1.0,
                                        flash_alpha,
                                    ))),
                                    border: Border {
                                        color: Color::from_rgba(1.0, 1.0, 1.0, flash_alpha * 1.4),
                                        width: 1.0,
                                        radius: 12.0.into(),
                                    },
                                    ..Default::default()
                                }
                            } else {
                                container::Style::default()
                            }
                        }),
                )
                .padding(0)
                .width(Length::Fill)
                .style(lyric_line_button(p))
                .on_press_maybe(line.time.map(|t| Message::ClickLyricLine {
                    index: idx,
                    time: t,
                }));

                let animated_line = motion_box(
                    Vector::new(0.0, y_wave),
                    line_scale,
                    MotionOrigin::LeftCenter,
                    false,
                    btn,
                );
                list = list.push(animated_line);
            }
            list = list.push(space().height(180));

            let scroller = scrollable(list)
                .id(Id::new(LYRICS_SCROLL_ID))
                .direction(Direction::Vertical(Scrollbar::hidden()))
                .style(subtle_scrollable(p))
                .on_scroll(|vp| Message::LyricsScrolled(vp.absolute_offset().y))
                .width(Length::Fill)
                .height(Length::Fill);

            if state.lyrics_user_scrolled_until.is_some() && synced {
                let recenter_btn = container(
                    button(
                        row![
                            icons::refresh(13.0, p.accent_fg),
                            text("Quay về câu đang hát")
                                .size(12)
                                .font(FONT_SEMIBOLD)
                                .color(p.accent_fg),
                        ]
                        .spacing(6)
                        .align_y(Alignment::Center),
                    )
                    .padding([7, 14])
                    .style(primary_button(p, 999.0))
                    .on_press(Message::RecenterLyrics),
                )
                .width(Length::Fill)
                .height(Length::Fill)
                .padding([14, 16])
                .align_x(Alignment::End)
                .align_y(Alignment::End);

                stack![scroller, recenter_btn]
                    .width(Length::Fill)
                    .height(Length::Fill)
                    .into()
            } else {
                scroller.into()
            }
        }
    } else {
        no_lyrics_view(p)
    };

    container(body)
        .padding([8, 12])
        .width(Length::FillPortion(6))
        .height(Length::Fill)
        .into()
}

fn interlude_dots<'a>(time: f32) -> Element<'a, Message> {
    let mut dots = row![].spacing(10).align_y(Alignment::Center);
    for i in 0..3 {
        let phase = (time * 3.6 - i as f32 * 0.75).sin() * 0.5 + 0.5;
        let size = 7.0 + phase * 4.5;
        let col = Color::from_rgba(1.0, 1.0, 1.0, 0.36 + 0.64 * phase);
        dots = dots.push(container(space().width(size).height(size)).style(move |_| {
            container::Style {
                background: Some(Background::Color(col)),
                border: Border {
                    radius: 999.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            }
        }));
    }
    container(dots).padding([8, 2]).into()
}

fn no_lyrics_view<'a>(p: Palette) -> Element<'a, Message> {
    container(
        column![
            icons::lyrics_bubble(34.0, p.text_dim),
            text("Không có lời bài hát")
                .size(16)
                .font(FONT_SEMIBOLD)
                .color(p.text_muted),
            text("Bài hát này chưa có dữ liệu LRC trên hệ thống hoặc LRCLIB.")
                .size(12)
                .color(p.text_dim),
        ]
        .spacing(8)
        .align_x(Alignment::Center),
    )
    .width(Length::Fill)
    .height(Length::Fill)
    .align_x(Alignment::Center)
    .align_y(Alignment::Center)
    .into()
}
