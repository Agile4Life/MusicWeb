use iced::widget::scrollable::Direction;
use iced::widget::{
    Id, button, column, container, mouse_area, row, scrollable, shader, slider, space, stack,
    text, text_input,
};
use iced::{Alignment, Background, Border, Color, Element, Length, Vector};

use bs_core::queue::RepeatMode;
use bs_core::session::SessionStore;

use crate::icons;
use crate::router::Route;
use crate::shaders::aurora::AuroraShader;
use crate::state::{AppState, HEADER_SEARCH_INPUT_ID, Message, format_duration};
use crate::theme::{
    AppThemeKind, FONT_BOLD, FONT_MEDIUM, FONT_SEMIBOLD, Palette, accent_slider, apple_v_scrollbar,
    borderless_input, ghost_button, nav_button, palette, player_bar_surface, sidebar_surface,
    subtle_scrollable, truncate_str,
};
use crate::views;
use crate::widgets::artwork::{app_logo, artwork_lcd};
use crate::widgets::context_menu::context_menu_overlay;
use crate::widgets::micro::{count_pill, hairline_divider, vertical_hairline};
use crate::widgets::motion::{MotionOrigin, motion_box, scale_box, slide_box};
use crate::widgets::seekbar::seekbar_apple_lcd;
use crate::widgets::toast::toast_overlay;

pub fn main_view<'a>(state: &'a AppState) -> Element<'a, Message> {
    let p = palette(state.settings.theme, state.settings.gaming_mode);

    let background_layer: Element<'a, Message> =
        if state.settings.gaming_mode || state.settings.theme == AppThemeKind::AppleDark {
            container(space().width(Length::Fill).height(Length::Fill))
                .width(Length::Fill)
                .height(Length::Fill)
                .style(move |_| container::Style {
                    background: Some(Background::Color(p.bg)),
                    ..Default::default()
                })
                .into()
        } else {
            shader(AuroraShader {
                time: state.aurora_time,
                base_bg: p.bg,
                color_a: state.aurora_current[0],
                color_b: state.aurora_current[1],
                color_c: state.aurora_current[2],
                y_offset_px: 0.0,
                intensity: 1.0,
            })
            .width(Length::Fill)
            .height(Length::Fill)
            .into()
        };

    let main_shell = row![
        sidebar(state, p),
        vertical_hairline(p),
        column![
            apple_top_bar(state, p),
            hairline_divider(p),
            row![
                page_viewport(state, p),
                if state.queue_spring.value > 0.005 && state.now_playing_spring.value < 0.85 {
                    views::queue_drawer::view_animated(state, p)
                } else {
                    space().width(0).into()
                },
            ]
            .width(Length::Fill)
            .height(Length::Fill),
        ]
        .width(Length::Fill)
        .height(Length::Fill),
    ]
    .width(Length::Fill)
    .height(Length::Fill);

    let np_t = state.now_playing_spring.value.clamp(0.0, 1.0);
    let mut layers = stack![background_layer];

    if np_t < 0.995 {
        let shell_el: Element<'a, Message> = if np_t > 0.005 {
            scale_box(1.0 - 0.03 * np_t, MotionOrigin::Center, main_shell)
        } else {
            main_shell.into()
        };
        layers = layers.push(shell_el);
    }

    if np_t > 0.005 && np_t < 0.995 {
        let dim_alpha = 0.55 * np_t;
        layers = layers.push(
            container(space().width(Length::Fill).height(Length::Fill))
                .width(Length::Fill)
                .height(Length::Fill)
                .style(move |_| container::Style {
                    background: Some(Background::Color(Color::from_rgba(
                        0.0, 0.0, 0.0, dim_alpha,
                    ))),
                    ..Default::default()
                }),
        );
    }

    if np_t > 0.005 {
        let travel = state.settings.window_height.max(720.0);
        let y_offset_px = (1.0 - np_t) * travel;
        layers = layers.push(views::now_playing::view(state, p, y_offset_px));
    }

    let ov_t = state.overlay_spring.value.clamp(0.0, 1.15);
    let ov_offset = Vector::new(0.0, (1.0 - ov_t) * 16.0);
    let ov_scale = 0.96 + 0.04 * ov_t;

    if let Some(ref modal) = state.auth_modal {
        layers = layers.push(motion_box(
            ov_offset,
            ov_scale,
            MotionOrigin::Center,
            false,
            views::auth_modal::view(state, modal, p),
        ));
    }

    if let Some(ref editor) = state.playlist_editor {
        layers = layers.push(motion_box(
            ov_offset,
            ov_scale,
            MotionOrigin::Center,
            false,
            views::playlist_modals::editor_modal(editor, p),
        ));
    }

    if let Some(ref track) = state.playlist_picker_track {
        layers = layers.push(motion_box(
            ov_offset,
            ov_scale,
            MotionOrigin::Center,
            false,
            views::playlist_modals::picker_modal(state, track, p),
        ));
    }

    if let Some(ref menu) = state.context_menu {
        layers = layers.push(context_menu_overlay(state, menu, p));
    }

    if let Some(ref toast) = state.toast {
        layers = layers.push(toast_overlay(toast, state.toast_spring.value, p));
    }

    mouse_area(layers)
        .on_move(Message::CursorMoved)
        .into()
}

fn apple_top_bar<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let snap = &state.player;
    let current = snap.current();

    let back_btn = button(icons::chevron_left(
        15.0,
        if state.router.can_back() {
            p.text
        } else {
            p.text_dim
        },
    ))
    .padding(6)
    .style(ghost_button(p, 6.0))
    .on_press_maybe(state.router.can_back().then_some(Message::GoBack));

    let fwd_btn = button(icons::chevron_right(
        15.0,
        if state.router.can_forward() {
            p.text
        } else {
            p.text_dim
        },
    ))
    .padding(6)
    .style(ghost_button(p, 6.0))
    .on_press_maybe(state.router.can_forward().then_some(Message::GoForward));

    let shuffle_color = if snap.shuffle { p.accent } else { p.text_muted };
    let repeat_icon = match snap.repeat {
        RepeatMode::Off => icons::repeat(14.0, p.text_muted),
        RepeatMode::All => icons::repeat(14.0, p.accent),
        RepeatMode::One => icons::repeat_one(14.0, p.accent),
    };
    let play_icon = if snap.is_loading {
        icons::refresh(20.0, p.text_muted)
    } else if snap.is_playing {
        icons::pause(20.0, p.text)
    } else {
        icons::play(20.0, p.text)
    };
    let play_btn = scale_box(
        state.play_btn_spring.value,
        MotionOrigin::Center,
        button(play_icon)
            .padding([6, 8])
            .style(ghost_button(p, 7.0))
            .on_press_maybe(current.map(|_| Message::TogglePlay)),
    );

    let left_cluster = row![
        back_btn,
        fwd_btn,
        space().width(6),
        button(icons::shuffle(14.0, shuffle_color))
            .padding(6)
            .style(ghost_button(p, 6.0))
            .on_press(Message::ToggleShuffle),
        button(icons::skip_back(17.0, p.text))
            .padding(6)
            .style(ghost_button(p, 6.0))
            .on_press_maybe(current.map(|_| Message::PrevTrack)),
        play_btn,
        button(icons::skip_forward(17.0, p.text))
            .padding(6)
            .style(ghost_button(p, 6.0))
            .on_press_maybe(current.map(|_| Message::NextTrack)),
        button(repeat_icon)
            .padding(6)
            .style(ghost_button(p, 6.0))
            .on_press(Message::CycleRepeat),
    ]
    .spacing(2)
    .align_y(Alignment::Center)
    .width(Length::FillPortion(3));

    // Centered Apple Music LCD Now Playing Pill
    let lcd_inner: Element<'a, Message> = if let Some(track) = current {
        let is_fav =
            SessionStore::is_favorite_sync(&state.session_snap, &state.known_db_ids, track);
        let art_visual = artwork_lcd(&state.image_cache, track.cover_url.as_deref(), 44.0, 4.0, p);

        let art_btn = button(art_visual)
            .padding(0)
            .style(ghost_button(p, 4.0))
            .on_press(Message::ToggleNowPlaying);

        let sub_text = match track.album.as_deref().filter(|s| !s.is_empty()) {
            Some(alb) => format!(
                "{} — {}",
                truncate_str(track.artist_name(), 18),
                truncate_str(alb, 18)
            ),
            None => truncate_str(track.artist_name(), 30),
        };

        let rem_secs = (snap.duration - snap.current_time).max(0.0);
        let lcd_icon_col = Color::from_rgba(1.0, 1.0, 1.0, 0.62);
        let lcd_time_col = Color::from_rgba(1.0, 1.0, 1.0, 0.54);
        let lcd_sub_col = Color::from_rgba(1.0, 1.0, 1.0, 0.72);
        let mut right_actions = row![].spacing(2).align_y(Alignment::Center);
        if state.signal_path.as_ref().is_some_and(|s| s.exclusive) {
            right_actions = right_actions.push(
                container(
                    text("BP")
                        .size(9)
                        .font(FONT_BOLD)
                        .wrapping(text::Wrapping::None)
                        .color(p.accent),
                )
                .padding([1, 5])
                .style(move |_| container::Style {
                    background: Some(Background::Color(Color::from_rgba(
                        p.accent.r,
                        p.accent.g,
                        p.accent.b,
                        0.15,
                    ))),
                    border: Border {
                        radius: 4.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }),
            );
        }
        right_actions = right_actions.push(
            button(if is_fav {
                icons::heart_filled(12.5, p.heart)
            } else {
                icons::heart(12.5, lcd_icon_col)
            })
            .padding(4)
            .style(ghost_button(p, 5.0))
            .on_press(Message::ToggleFavorite(track.clone())),
        );
        right_actions = right_actions.push(
            button(icons::more(12.5, lcd_icon_col))
                .padding(4)
                .style(ghost_button(p, 5.0))
                .on_press(Message::OpenContextMenu {
                    track: track.clone(),
                    playlist_id: None,
                }),
        );

        let meta_row = row![
            container(
                text(format_duration(snap.current_time))
                    .size(9.5)
                    .wrapping(text::Wrapping::None)
                    .color(lcd_time_col),
            )
            .width(34)
            .align_x(Alignment::Start),
            column![
                button(
                    text(truncate_str(&track.title, 30))
                        .size(12.0)
                        .font(FONT_SEMIBOLD)
                        .wrapping(text::Wrapping::None)
                        .color(p.text),
                )
                .padding(0)
                .style(ghost_button(p, 3.0))
                .on_press(Message::ToggleNowPlaying),
                button(
                    text(sub_text)
                        .size(10.5)
                        .wrapping(text::Wrapping::None)
                        .color(lcd_sub_col),
                )
                .padding(0)
                .style(ghost_button(p, 3.0))
                .on_press_maybe(track.primary_artist().map(Message::OpenArtist)),
            ]
            .spacing(1)
            .align_x(Alignment::Center)
            .width(Length::Fill),
            right_actions,
            container(
                text(if snap.duration > 0.0 {
                    format!("-{}", format_duration(rem_secs))
                } else {
                    "0:00".to_string()
                })
                .size(9.5)
                .wrapping(text::Wrapping::None)
                .color(lcd_time_col),
            )
            .width(38)
            .align_x(Alignment::End),
        ]
        .spacing(6)
        .padding([0, 8])
        .align_y(Alignment::Center)
        .width(Length::Fill);

        let lcd_body = column![
            container(meta_row)
                .width(Length::Fill)
                .height(Length::Fill)
                .align_y(Alignment::Center),
            seekbar_apple_lcd(
                snap.current_time,
                snap.duration,
                snap.is_loading,
                state.aurora_time,
                p,
            ),
        ]
        .width(Length::Fill)
        .height(Length::Fill);

        let art_sep = container(space().width(1).height(Length::Fill)).style(|_| container::Style {
            background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.08))),
            ..Default::default()
        });

        row![art_btn, art_sep, lcd_body]
            .align_y(Alignment::Center)
            .width(Length::Fill)
            .height(Length::Fill)
            .into()
    } else {
        let idle_art = container(icons::music_note(
            16.0,
            Color::from_rgba(1.0, 1.0, 1.0, 0.35),
        ))
        .width(44)
        .height(44)
        .align_x(Alignment::Center)
        .align_y(Alignment::Center)
        .style(|_| container::Style {
            background: Some(Background::Color(Color::from_rgb8(48, 48, 50))),
            border: Border {
                radius: iced::border::Radius {
                    top_left: 4.0,
                    bottom_left: 4.0,
                    top_right: 0.0,
                    bottom_right: 0.0,
                },
                ..Default::default()
            },
            ..Default::default()
        });
        let art_sep = container(space().width(1).height(Length::Fill)).style(|_| container::Style {
            background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.08))),
            ..Default::default()
        });
        let idle_right = container(
            row![
                app_logo(18.0, 4.5),
                text("BlueSymphony")
                    .size(12.0)
                    .font(FONT_MEDIUM)
                    .color(Color::from_rgba(1.0, 1.0, 1.0, 0.45)),
            ]
            .spacing(7)
            .align_y(Alignment::Center),
        )
        .width(Length::Fill)
        .height(Length::Fill)
        .align_x(Alignment::Center)
        .align_y(Alignment::Center);

        row![idle_art, art_sep, idle_right]
            .align_y(Alignment::Center)
            .width(Length::Fill)
            .height(Length::Fill)
            .into()
    };

    let center_lcd = container(
        container(lcd_inner)
            .width(Length::Fill)
            .max_width(480)
            .height(46)
            .padding(1)
            .style(|_| container::Style {
                background: Some(Background::Color(Color::from_rgb8(42, 42, 44))),
                border: Border {
                    color: Color::from_rgba(1.0, 1.0, 1.0, 0.08),
                    width: 1.0,
                    radius: 5.0.into(),
                },
                ..Default::default()
            }),
    )
    .width(Length::FillPortion(5))
    .align_x(Alignment::Center)
    .align_y(Alignment::Center);

    let vol_icon = if snap.muted || snap.volume <= 0.01 {
        icons::volume_x(14.0, Color::from_rgba(1.0, 1.0, 1.0, 0.68))
    } else {
        icons::volume_1(14.0, Color::from_rgba(1.0, 1.0, 1.0, 0.68))
    };
    let vol_val = if snap.muted { 0.0 } else { snap.volume as f32 };
    let vol_bp_locked = state.dsp_store.bit_perfect_enabled
        && state.dsp_store.bit_perfect_lock_volume
        && !snap.muted;

    let eq_active = matches!(state.router.current, Route::AudioLab)
        || (state.dsp_store.dsp_engine_enabled && !state.dsp_store.bypass)
        || state.dsp_store.bit_perfect_enabled;
    let toolbar_idle = Color::from_rgba(1.0, 1.0, 1.0, 0.74);

    let mut right_cluster = row![
        space().width(Length::Fill),
        button(vol_icon)
            .padding(4)
            .style(ghost_button(p, 5.0))
            .on_press(Message::ToggleMute),
        slider(0.0..=1.0, vol_val, |v| Message::SetVolume(f64::from(v)))
            .step(0.01)
            .style(accent_slider(p))
            .width(Length::Fixed(76.0)),
        button(icons::volume_2(14.0, Color::from_rgba(1.0, 1.0, 1.0, 0.52)))
            .padding(4)
            .style(ghost_button(p, 5.0))
            .on_press(Message::SetVolume(1.0)),
    ]
    .spacing(3)
    .align_y(Alignment::Center)
    .width(Length::FillPortion(3));

    if vol_bp_locked {
        right_cluster = right_cluster.push(
            text("BP")
                .size(9.5)
                .font(FONT_BOLD)
                .wrapping(text::Wrapping::None)
                .color(p.accent),
        );
    }

    right_cluster = right_cluster
        .push(space().width(6))
        .push(
            button(icons::sliders(
                15.0,
                if eq_active { p.accent } else { toolbar_idle },
            ))
            .padding(6)
            .style(nav_button(p, matches!(state.router.current, Route::AudioLab)))
            .on_press(Message::Navigate(Route::AudioLab)),
        )
        .push(
            button(icons::lyrics_bubble(
                15.0,
                if state.show_now_playing {
                    p.accent
                } else {
                    toolbar_idle
                },
            ))
            .padding(6)
            .style(nav_button(p, state.show_now_playing))
            .on_press(Message::ToggleNowPlaying),
        )
        .push(
            button(icons::queue(
                15.0,
                if state.show_queue {
                    p.accent
                } else {
                    toolbar_idle
                },
            ))
            .padding(6)
            .style(nav_button(p, state.show_queue))
            .on_press(Message::ToggleQueueDrawer),
        )
        .push(
            button(icons::mini_player(
                15.0,
                if state.mini_window.is_some() {
                    p.accent
                } else {
                    toolbar_idle
                },
            ))
            .padding(6)
            .style(nav_button(p, state.mini_window.is_some()))
            .on_press(Message::ToggleMiniPlayer),
        );

    container(
        row![left_cluster, center_lcd, right_cluster]
            .spacing(12)
            .align_y(Alignment::Center)
            .width(Length::Fill),
    )
    .height(60)
    .padding([6, 16])
    .width(Length::Fill)
    .style(player_bar_surface(p))
    .into()
}

fn sidebar<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let s_t = state.sidebar_spring.value.clamp(0.0, 1.0);
    let collapsed = s_t >= 0.45;
    let width = 232.0 - 164.0 * s_t;

    let brand_badge = app_logo(24.0, 6.0);

    let brand_row: Element<'a, Message> = if collapsed {
        container(
            button(brand_badge)
                .padding(4)
                .style(ghost_button(p, 6.0))
                .on_press(Message::ToggleSidebar),
        )
        .width(Length::Fill)
        .align_x(Alignment::Center)
        .into()
    } else {
        container(
            row![
                brand_badge,
                text("BlueSymphony")
                    .size(13.5)
                    .font(FONT_SEMIBOLD)
                    .color(p.text),
                space().width(Length::Fill),
                button(icons::chevron_left(14.5, p.text_muted))
                    .padding(5)
                    .style(ghost_button(p, 6.0))
                    .on_press(Message::ToggleSidebar),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .padding([2, 2])
        .width(Length::Fill)
        .into()
    };

    let sidebar_search: Element<'a, Message> = if collapsed {
        space().height(4).into()
    } else {
        container(
            row![
                text_input("Tìm kiếm", &state.header_search)
                    .id(Id::new(HEADER_SEARCH_INPUT_ID))
                    .on_input(Message::HeaderSearchChanged)
                    .on_submit(Message::HeaderSearchSubmit)
                    .padding([3, 2])
                    .size(13)
                    .style(borderless_input(p))
                    .width(Length::Fill),
                icons::search(13.5, p.text_muted),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
        )
        .padding([2, 10])
        .width(Length::Fill)
        .style(|_| container::Style {
            background: Some(Background::Color(Color::from_rgb8(40, 40, 42))),
            border: Border {
                color: Color::from_rgba(1.0, 1.0, 1.0, 0.10),
                width: 1.0,
                radius: 5.0.into(),
            },
            ..Default::default()
        })
        .into()
    };

    let nav_icon_color = |active: bool| {
        if active {
            Color::WHITE
        } else {
            Color::from_rgba(1.0, 1.0, 1.0, 0.80)
        }
    };

    let mut nav_col = column![
        brand_row,
        if !collapsed {
            Element::from(space().height(6))
        } else {
            space().height(0).into()
        },
        sidebar_search,
        if !collapsed {
            Element::from(
                container(text("KHÁM PHÁ").size(10.5).font(FONT_SEMIBOLD).color(p.text_dim))
                    .padding([6, 8]),
            )
        } else {
            space().height(4).into()
        },
        sidebar_item(
            icons::home(16.0, nav_icon_color(matches!(state.router.current, Route::Home))),
            "Trang chủ",
            matches!(state.router.current, Route::Home),
            collapsed,
            None,
            Message::Navigate(Route::Home),
            p,
        ),
        sidebar_item(
            icons::disc(16.0, nav_icon_color(matches!(state.router.current, Route::NewReleases))),
            "Mới phát hành",
            matches!(state.router.current, Route::NewReleases),
            collapsed,
            None,
            Message::Navigate(Route::NewReleases),
            p,
        ),
        sidebar_item(
            icons::cloud(16.0, nav_icon_color(matches!(state.router.current, Route::SoundCloud))),
            "SoundCloud",
            matches!(state.router.current, Route::SoundCloud),
            collapsed,
            None,
            Message::Navigate(Route::SoundCloud),
            p,
        ),
        sidebar_item(
            icons::search(16.0, nav_icon_color(matches!(state.router.current, Route::Search))),
            "Khám phá & Tìm",
            matches!(state.router.current, Route::Search),
            collapsed,
            None,
            Message::Navigate(Route::Search),
            p,
        ),
        if !collapsed {
            Element::from(
                container(text("THƯ VIỆN").size(10.5).font(FONT_SEMIBOLD).color(p.text_dim))
                    .padding([8, 8]),
            )
        } else {
            hairline_divider(p)
        },
        sidebar_item(
            icons::library(16.0, nav_icon_color(matches!(state.router.current, Route::Library))),
            "Thư viện",
            matches!(state.router.current, Route::Library),
            collapsed,
            None,
            Message::Navigate(Route::Library),
            p,
        ),
        sidebar_item(
            icons::heart(16.0, nav_icon_color(matches!(state.router.current, Route::Favorites))),
            "Yêu thích",
            matches!(state.router.current, Route::Favorites),
            collapsed,
            (!state.session_snap.favorite_ids.is_empty())
                .then(|| state.session_snap.favorite_ids.len().to_string()),
            Message::Navigate(Route::Favorites),
            p,
        ),
        sidebar_item(
            icons::history(16.0, nav_icon_color(matches!(state.router.current, Route::History))),
            "Lịch sử nghe",
            matches!(state.router.current, Route::History),
            collapsed,
            None,
            Message::Navigate(Route::History),
            p,
        ),
        sidebar_item(
            icons::flame(16.0, nav_icon_color(matches!(state.router.current, Route::TopTracks))),
            "Top của bạn",
            matches!(state.router.current, Route::TopTracks),
            collapsed,
            None,
            Message::Navigate(Route::TopTracks),
            p,
        ),
        sidebar_item(
            icons::list_music(16.0, nav_icon_color(matches!(state.router.current, Route::Playlists))),
            "Playlist",
            matches!(state.router.current, Route::Playlists),
            collapsed,
            (!state.playlists.is_empty()).then(|| state.playlists.len().to_string()),
            Message::Navigate(Route::Playlists),
            p,
        ),
    ]
    .spacing(3);

    if !collapsed {
        let pl_header = row![
            text("PLAYLIST CÁ NHÂN")
                .size(10.5)
                .font(FONT_SEMIBOLD)
                .color(p.text_dim),
            space().width(Length::Fill),
            button(icons::plus(14.0, p.text_muted))
                .padding(4)
                .style(ghost_button(p, 6.0))
                .on_press(Message::OpenCreatePlaylist),
        ]
        .align_y(Alignment::Center)
        .padding([8, 8]);

        nav_col = nav_col.push(pl_header);

        let mut pl_list = column![].spacing(2);
        for pl in state.playlists.iter().take(20) {
            let active = matches!(&state.router.current, Route::PlaylistDetail(id) if id == &pl.id);
            pl_list = pl_list.push(
                button(
                    row![
                        icons::list_music(14.0, if active { p.accent } else { p.text_dim }),
                        text(pl.name.clone()).size(13).color(if active {
                            p.text
                        } else {
                            p.text_muted
                        }),
                    ]
                    .spacing(8)
                    .align_y(Alignment::Center),
                )
                .width(Length::Fill)
                .padding([6, 8])
                .style(nav_button(p, active))
                .on_press(Message::Navigate(Route::PlaylistDetail(pl.id.clone()))),
            );
        }

        let pl_scroll = scrollable(pl_list)
            .direction(Direction::Vertical(apple_v_scrollbar()))
            .style(subtle_scrollable(p))
            .height(Length::Fill);
        nav_col = nav_col.push(pl_scroll);
    } else {
        nav_col = nav_col.push(space().height(Length::Fill));
    }

    nav_col = nav_col.push(hairline_divider(p));
    let eq_badge = if state.dsp_store.bit_perfect_enabled {
        Some("BP".to_string())
    } else if state.dsp_store.dsp_engine_enabled && !state.dsp_store.bypass {
        Some("EQ".to_string())
    } else {
        None
    };
    nav_col = nav_col.push(sidebar_item(
        icons::sliders(
            16.0,
            nav_icon_color(matches!(state.router.current, Route::AudioLab)),
        ),
        "Âm thanh & EQ",
        matches!(state.router.current, Route::AudioLab),
        collapsed,
        eq_badge,
        Message::Navigate(Route::AudioLab),
        p,
    ));
    nav_col = nav_col.push(sidebar_item(
        icons::settings(16.0, nav_icon_color(matches!(state.router.current, Route::Settings))),
        "Cài đặt",
        matches!(state.router.current, Route::Settings),
        collapsed,
        None,
        Message::Navigate(Route::Settings),
        p,
    ));

    // Apple Music bottom-left sidebar user account anchor
    nav_col = nav_col.push(hairline_divider(p));
    let account_row: Element<'a, Message> = if state.session_snap.is_signed_in() {
        let name = state.session_snap.display_name();
        sidebar_item(
            icons::user(16.0, Color::from_rgba(1.0, 1.0, 1.0, 0.80)),
            truncate_str(&name, 16),
            false,
            collapsed,
            None,
            Message::Navigate(Route::Settings),
            p,
        )
    } else if collapsed {
        button(
            container(icons::user(16.0, Color::from_rgba(1.0, 1.0, 1.0, 0.80)))
                .width(Length::Fill)
                .align_x(Alignment::Center),
        )
        .width(Length::Fill)
        .padding([7, 10])
        .style(nav_button(p, false))
        .on_press_maybe((!state.web_login_in_progress).then_some(Message::StartWebLogin))
        .into()
    } else {
        let login_label = if state.web_login_in_progress {
            "Đang mở…"
        } else {
            "Đăng nhập"
        };
        let avatar_badge = container(icons::user(13.0, Color::from_rgba(1.0, 1.0, 1.0, 0.85)))
            .width(24)
            .height(24)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .style(|_| container::Style {
                background: Some(Background::Color(Color::from_rgb8(52, 52, 54))),
                border: Border {
                    radius: 999.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            });
        button(
            row![
                avatar_badge,
                text(login_label)
                    .size(13)
                    .font(FONT_MEDIUM)
                    .color(Color::from_rgba(1.0, 1.0, 1.0, 0.88)),
            ]
            .spacing(10)
            .align_y(Alignment::Center)
            .width(Length::Fill),
        )
        .width(Length::Fill)
        .padding([7, 10])
        .style(nav_button(p, false))
        .on_press_maybe((!state.web_login_in_progress).then_some(Message::StartWebLogin))
        .into()
    };
    nav_col = nav_col.push(account_row);

    container(nav_col)
        .width(width)
        .height(Length::Fill)
        .padding([12, 10])
        .style(sidebar_surface(p))
        .into()
}

fn sidebar_item<'a>(
    icon: impl Into<Element<'a, Message>>,
    label: impl Into<String>,
    active: bool,
    collapsed: bool,
    badge: Option<String>,
    msg: Message,
    p: Palette,
) -> Element<'a, Message> {
    let label = label.into();
    let indicator = container(space().width(3).height(16)).style(move |_| container::Style {
        background: Some(Background::Color(if active {
            p.accent
        } else {
            Color::TRANSPARENT
        })),
        border: Border {
            radius: 999.0.into(),
            ..Default::default()
        },
        ..Default::default()
    });
    let content: Element<'a, Message> = if collapsed {
        row![
            indicator,
            container(icon.into())
                .width(Length::Fill)
                .align_x(Alignment::Center),
        ]
        .align_y(Alignment::Center)
        .width(Length::Fill)
        .into()
    } else {
        let icon_box = container(icon.into())
            .width(18)
            .height(18)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center);
        let mut r = row![
            indicator,
            icon_box,
            text(label)
                .size(13.5)
                .font(if active { FONT_SEMIBOLD } else { FONT_MEDIUM })
                .color(if active {
                    p.text
                } else {
                    Color::from_rgba(p.text.r, p.text.g, p.text.b, 0.82)
                }),
            space().width(Length::Fill),
        ]
        .spacing(8)
        .align_y(Alignment::Center);

        if let Some(b) = badge {
            r = r.push(count_pill(b, p));
        }
        r.into()
    };

    button(content)
        .width(Length::Fill)
        .padding([6, 8])
        .style(nav_button(p, active))
        .on_press(msg)
        .into()
}

fn page_viewport<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let content: Element<'a, Message> = match &state.router.current {
        Route::Home => views::home::view(state, p),
        Route::NewReleases => views::new_releases::view(state, p),
        Route::SoundCloud => views::soundcloud::view(state, p),
        Route::SoundCloudPlaylist(pl) => views::soundcloud::playlist_view(state, pl, p),
        Route::Search => views::search::view(state, p),
        Route::Library => views::library::view(state, p),
        Route::Favorites => views::favorites::view(state, p),
        Route::History => views::history::view(state, p),
        Route::TopTracks => views::top_tracks::view(state, p),
        Route::Playlists => views::playlists::view(state, p),
        Route::PlaylistDetail(_) => views::playlist_detail::view(state, p),
        Route::Album(alb) => views::album::view(state, alb, p),
        Route::Artist(name) => views::artist::view(state, name, p),
        Route::AudioLab => views::audio_lab::view(state, p),
        Route::Settings => views::settings::view(state, p),
    };

    let rt_t = state.route_spring.value.clamp(0.0, 1.15);
    let animated_content = slide_box(Vector::new(0.0, (1.0 - rt_t) * 18.0), content);

    scrollable(container(animated_content).padding([16, 28]).width(Length::Fill))
        .direction(Direction::Vertical(apple_v_scrollbar()))
        .style(subtle_scrollable(p))
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
