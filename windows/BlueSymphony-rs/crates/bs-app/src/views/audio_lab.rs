use bs_dsp::{BoundaryPreset, TargetCurveKind, compute_abl_bands, compute_auto_preamp_db};
use iced::widget::{button, column, container, row, slider, space, text, text_input, toggler};
use iced::{Alignment, Background, Border, Color, Element, Length};

use crate::icons;
use crate::state::{
    AppState, AudioLabTab, CalMicSource, IPhoneCalMode, Message, SweepChannelMode,
};
use crate::theme::{
    FONT_BOLD, FONT_MEDIUM, FONT_SEMIBOLD, Palette, accent_slider, accent_toggler, danger_button,
    ghost_button, glass_card, glass_input, nav_button, pill_button, primary_button, truncate_str,
};
use crate::widgets::eq_graph::{EqGraphConfig, eq_graph};
use crate::widgets::micro::{count_pill, hairline_divider, live_dot};
use crate::widgets::qr::qr_code;

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let tab_bar = row![
        tab_btn(
            "Bộ lọc EQ & Auto-EQ",
            icons::sliders(
                15.0,
                if state.audio_lab_tab == AudioLabTab::Eq {
                    p.accent_fg
                } else {
                    p.text_muted
                }
            ),
            state.audio_lab_tab == AudioLabTab::Eq,
            Message::SelectAudioLabTab(AudioLabTab::Eq),
            p,
        ),
        tab_btn(
            "Đo phòng (B&O ARC)",
            icons::activity(
                15.0,
                if state.audio_lab_tab == AudioLabTab::RoomCal {
                    p.accent_fg
                } else {
                    p.text_muted
                }
            ),
            state.audio_lab_tab == AudioLabTab::RoomCal,
            Message::SelectAudioLabTab(AudioLabTab::RoomCal),
            p,
        ),
        tab_btn(
            "Adaptive Audio",
            icons::mic(
                15.0,
                if state.audio_lab_tab == AudioLabTab::Adaptive {
                    p.accent_fg
                } else {
                    p.text_muted
                }
            ),
            state.audio_lab_tab == AudioLabTab::Adaptive,
            Message::SelectAudioLabTab(AudioLabTab::Adaptive),
            p,
        ),
        space().width(Length::Fill),
        backend_status_pill(state, p),
    ]
    .spacing(10)
    .align_y(Alignment::Center)
    .width(Length::Fill);

    let header = column![
        text("Âm thanh & Hiệu chỉnh phòng (Acoustic Suite)")
            .size(28)
            .font(FONT_BOLD)
            .color(p.text),
        text("Parametric EQ 64-bit, B&O ARC/ABL, Devialet ASC Boundary, Auto-EQ đo phòng & Adaptive Audio")
            .size(13)
            .color(p.text_muted),
    ]
    .spacing(4);

    let body = match state.audio_lab_tab {
        AudioLabTab::Eq => eq_tab(state, p),
        AudioLabTab::RoomCal => room_cal_tab(state, p),
        AudioLabTab::Adaptive => adaptive_tab(state, p),
    };

    column![header, tab_bar, body]
        .spacing(18)
        .width(Length::Fill)
        .into()
}

fn tab_btn<'a>(
    label: &'a str,
    icon: impl Into<Element<'a, Message>>,
    active: bool,
    msg: Message,
    p: Palette,
) -> Element<'a, Message> {
    let txt_col = if active { p.accent_fg } else { p.text };
    button(
        row![
            icon.into(),
            text(label).size(13).font(FONT_SEMIBOLD).color(txt_col),
        ]
        .spacing(7)
        .align_y(Alignment::Center),
    )
    .padding([9, 16])
    .style(pill_button(p, active))
    .on_press(msg)
    .into()
}

fn backend_status_pill<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let active = state.dsp_store.dsp_engine_enabled && state.dsp_active_backend;
    let (label, dot_col, lit) = if state.dsp_store.bit_perfect_enabled {
        match state.signal_path.as_ref() {
            Some(sp) if sp.exclusive => {
                let khz = sp.output_sample_rate as f32 / 1000.0;
                let txt = if sp.bit_exact {
                    format!("BIT-PERFECT · {khz:.1} kHz")
                } else {
                    format!("WASAPI Exclusive · {khz:.1} kHz")
                };
                (txt, if sp.bit_exact { p.accent } else { p.success }, true)
            }
            Some(sp) if sp.fallback_note.is_some() => (
                "Bit-Perfect · Fallback Shared".to_string(),
                p.accent,
                false,
            ),
            _ => ("Bit-Perfect · Sẵn sàng".to_string(), p.accent, true),
        }
    } else if !state.dsp_store.dsp_engine_enabled {
        ("DSP: Đang tắt (WinRT)".to_string(), p.accent, false)
    } else if state.dsp_store.bypass {
        ("Bypass (So sánh A/B)".to_string(), p.accent, false)
    } else if active {
        ("PCM DSP 64-bit · Bật".to_string(), p.success, true)
    } else {
        ("WinRT Fallback".to_string(), p.accent, false)
    };
    container(
        row![
            live_dot(state.aurora_time, lit, dot_col),
            text(label).size(11.5).font(FONT_MEDIUM).color(p.text_muted),
        ]
        .spacing(6)
        .align_y(Alignment::Center),
    )
    .padding([6, 12])
    .style(move |_| container::Style {
        background: Some(Background::Color(p.surface_elevated)),
        border: Border {
            color: p.border,
            width: 1.0,
            radius: 999.0.into(),
        },
        ..Default::default()
    })
    .into()
}

// ---------------------------------------------------------------------------
// TAB 1: EQ & AUTO-EQ
// ---------------------------------------------------------------------------

fn eq_tab<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let store = &state.dsp_store;
    let Some(prof) = store.active_profile() else {
        return container(text("Không có hồ sơ EQ").color(p.text_muted))
            .padding(20)
            .into();
    };

    // Profile bar + A/B Bypass
    let mut prof_pills = row![].spacing(6).align_y(Alignment::Center);
    for item in state.dsp_store.profiles.iter().take(6) {
        let is_act = item.id == prof.id;
        prof_pills = prof_pills.push(
            button(text(truncate_str(&item.name, 22)).size(12).font(FONT_MEDIUM))
                .padding([6, 12])
                .style(pill_button(p, is_act))
                .on_press(Message::SelectDspProfile(item.id.clone())),
        );
    }

    let dev_name = state
        .current_output_device
        .as_deref()
        .unwrap_or("Thiết bị mặc định");
    let is_bound = state
        .dsp_store
        .device_map
        .get(dev_name)
        .is_some_and(|id| id == &prof.id);

    let top_controls = container(
        column![
            row![
                prof_pills,
                space().width(Length::Fill),
                button(
                    row![
                        icons::plus(13.0, p.text),
                        text("Mới").size(12),
                    ]
                    .spacing(4)
                    .align_y(Alignment::Center),
                )
                .padding([6, 10])
                .style(ghost_button(p, 8.0))
                .on_press(Message::CreateDspProfile),
                button(text("Nhân bản").size(12))
                    .padding([6, 10])
                    .style(ghost_button(p, 8.0))
                    .on_press(Message::DuplicateDspProfile),
                if state.dsp_store.profiles.len() > 1 {
                    Element::from(
                        button(icons::trash(14.0, p.danger))
                            .padding([6, 8])
                            .style(danger_button(p, 8.0))
                            .on_press(Message::DeleteDspProfile(prof.id.clone())),
                    )
                } else {
                    space().width(0).into()
                },
            ]
            .spacing(8)
            .align_y(Alignment::Center),
            hairline_divider(p),
            row![
                text("Tên hồ sơ:").size(12.5).color(p.text_muted),
                text_input("Tên hồ sơ EQ…", &prof.name)
                    .on_input(Message::RenameDspProfile)
                    .padding([6, 10])
                    .size(13)
                    .style(glass_input(p))
                    .width(Length::Fixed(220.0)),
                button(
                    row![
                        icons::check(
                            13.0,
                            if is_bound { p.success } else { p.text_muted }
                        ),
                        text(if is_bound {
                            format!("Đã gắn: {}", truncate_str(dev_name, 22))
                        } else {
                            format!("Gắn vào: {}", truncate_str(dev_name, 22))
                        })
                        .size(11.5)
                        .color(if is_bound { p.success } else { p.text_muted }),
                    ]
                    .spacing(5)
                    .align_y(Alignment::Center),
                )
                .padding([6, 10])
                .style(nav_button(p, is_bound))
                .on_press(Message::BindProfileToCurrentOutput),
                space().width(Length::Fill),
                toggler(store.level_match_bypass)
                    .label("Cân bằng âm lượng A/B")
                    .on_toggle(|_| Message::ToggleLevelMatchBypass)
                    .size(16)
                    .text_size(12)
                    .style(accent_toggler(p)),
                button(
                    text(if store.bypass {
                        "A/B: ĐANG BYPASS (GỐC)"
                    } else {
                        "A/B: ĐANG BẬT EQ"
                    })
                    .size(12)
                    .font(FONT_BOLD)
                    .color(if store.bypass { p.text } else { p.accent_fg }),
                )
                .padding([8, 16])
                .style(pill_button(p, !store.bypass))
                .on_press(Message::ToggleDspBypass),
            ]
            .spacing(10)
            .align_y(Alignment::Center),
        ]
        .spacing(12),
    )
    .padding(16)
    .width(Length::Fill)
    .style(glass_card(p, 16.0));

    // Active channel & extra DSP bands (Boundary + ABL)
    let editing_right = prof.dual_mono && state.editing_right_ch;
    let ch = if editing_right { &prof.right } else { &prof.left };
    let boundary_bands = prof.boundary.bands();
    let abl_bands = compute_abl_bands(prof.abl_enabled, prof.abl_strength, state.player.volume);
    let mut extra_bands = boundary_bands;
    extra_bands.extend(abl_bands);

    let effective_preamp = if prof.auto_preamp {
        compute_auto_preamp_db(&ch.bands, &extra_bands, 48_000.0)
    } else {
        ch.preamp_db
    };

    let meas_slice = prof
        .measured_curve
        .as_ref()
        .map(|m| m.smoothed_db.as_slice());

    let graph_card = container(
        column![
            row![
                text("Đáp tuyến bộ lọc (kéo điểm để chỉnh Tần số/Gain, cuộn chuột chỉnh Q)")
                    .size(12)
                    .color(p.text_muted),
                space().width(Length::Fill),
                count_pill(format!("Preamp: {effective_preamp:+.1} dB"), p),
                toggler(prof.dual_mono)
                    .label("L/R độc lập")
                    .on_toggle(Message::ToggleDualMono)
                    .size(16)
                    .text_size(12)
                    .style(accent_toggler(p)),
                if prof.dual_mono {
                    Element::from(
                        row![
                            button(text("Trái (L)").size(11.5))
                                .padding([4, 10])
                                .style(pill_button(p, !state.editing_right_ch))
                                .on_press(Message::SelectEqChannel(false)),
                            button(text("Phải (R)").size(11.5))
                                .padding([4, 10])
                                .style(pill_button(p, state.editing_right_ch))
                                .on_press(Message::SelectEqChannel(true)),
                        ]
                        .spacing(4),
                    )
                } else {
                    space().width(0).into()
                },
            ]
            .spacing(10)
            .align_y(Alignment::Center),
            eq_graph(
                EqGraphConfig {
                    bands: &ch.bands,
                    extra_bands,
                    measured_db: meas_slice,
                    after_db: None,
                    target: prof.measured_curve.as_ref().map(|_| prof.target_curve),
                    bypass: store.bypass,
                    interactive: true,
                    selected_band: state.selected_eq_band,
                    palette: p,
                },
                265.0,
            ),
        ]
        .spacing(10),
    )
    .padding(16)
    .width(Length::Fill)
    .style(glass_card(p, 16.0));

    // Boundary (Devialet ASC) + ABL Loudness + Auto-Preamp + Import/Export
    let mut boundary_row = row![].spacing(6).align_y(Alignment::Center);
    for bp in BoundaryPreset::ALL {
        let active = prof.boundary == bp;
        boundary_row = boundary_row.push(
            button(text(bp.label()).size(11.5).font(FONT_MEDIUM))
                .padding([5, 11])
                .style(pill_button(p, active))
                .on_press(Message::SelectBoundaryPreset(bp)),
        );
    }

    let features_row = row![
        container(
            column![
                text("Vị trí đặt loa (Devialet ASC)")
                    .size(14)
                    .font(FONT_SEMIBOLD)
                    .color(p.text),
                text(prof.boundary.description())
                    .size(11.5)
                    .color(p.text_muted),
                boundary_row,
            ]
            .spacing(8),
        )
        .padding(16)
        .width(Length::FillPortion(3))
        .style(glass_card(p, 14.0)),
        container(
            column![
                row![
                    text("B&O ABL Dynamic Loudness")
                        .size(14)
                        .font(FONT_SEMIBOLD)
                        .color(p.text),
                    space().width(Length::Fill),
                    toggler(prof.abl_enabled)
                        .on_toggle(Message::ToggleAblLoudness)
                        .size(18)
                        .style(accent_toggler(p)),
                ]
                .align_y(Alignment::Center),
                text("Tự bù sub-bass & độ thoáng khi nghe ở âm lượng nhỏ")
                    .size(11.5)
                    .color(p.text_muted),
                row![
                    text("Cường độ:")
                        .size(12)
                        .color(p.text_muted),
                    slider(0.0..=1.0, prof.abl_strength, Message::SetAblStrength)
                        .step(0.05_f32)
                        .style(accent_slider(p))
                        .width(Length::Fill),
                    text(format!("{}%", (prof.abl_strength * 100.0).round() as u32))
                        .size(12)
                        .color(p.text),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(8),
        )
        .padding(16)
        .width(Length::FillPortion(2))
        .style(glass_card(p, 14.0)),
    ]
    .spacing(12)
    .width(Length::Fill);

    // Import / Export + DSP Engine Master Switch + Preamp slider
    let tools_bar = container(
        row![
            toggler(store.dsp_engine_enabled)
                .label("PCM DSP Engine")
                .on_toggle(Message::ToggleDspEngine)
                .size(18)
                .text_size(12.5)
                .style(accent_toggler(p)),
            toggler(prof.auto_preamp)
                .label("Auto-Preamp chống clip")
                .on_toggle(Message::ToggleAutoPreamp)
                .size(18)
                .text_size(12.5)
                .style(accent_toggler(p)),
            if !prof.auto_preamp {
                Element::from(
                    row![
                        slider(-18.0..=6.0, ch.preamp_db as f32, |v| {
                            Message::SetManualPreamp(f64::from(v))
                        })
                        .step(0.2_f32)
                        .style(accent_slider(p))
                        .width(Length::Fixed(100.0)),
                        text(format!("{:+.1} dB", ch.preamp_db))
                            .size(11.5)
                            .color(p.text_muted),
                    ]
                    .spacing(6)
                    .align_y(Alignment::Center),
                )
            } else {
                space().width(0).into()
            },
            space().width(Length::Fill),
            button(text("Import AutoEQ / REW (.txt)").size(12).font(FONT_MEDIUM))
                .padding([7, 13])
                .style(nav_button(p, false))
                .on_press(Message::ImportAutoEqFile),
            button(text("Export Equalizer APO (.txt)").size(12).font(FONT_MEDIUM))
                .padding([7, 13])
                .style(nav_button(p, false))
                .on_press(Message::ExportEqualizerApo),
            if prof.measured_curve.is_some() {
                Element::from(
                    button(text("Tính lại Auto-EQ từ đo phòng").size(12).font(FONT_SEMIBOLD))
                        .padding([7, 13])
                        .style(primary_button(p, 10.0))
                        .on_press(Message::RecomputeActiveProfileAutoEq),
                )
            } else {
                space().width(0).into()
            },
        ]
        .spacing(12)
        .align_y(Alignment::Center),
    )
    .padding([12, 16])
    .width(Length::Fill)
    .style(glass_card(p, 14.0));

    // Parametric EQ Band Table
    let mut band_rows = column![
        row![
            text(format!("Danh sách bộ lọc PEQ ({} band)", ch.bands.len()))
                .size(15)
                .font(FONT_SEMIBOLD)
                .color(p.text),
            space().width(Length::Fill),
            button(
                row![icons::plus(13.0, p.text), text("Thêm Band").size(12)]
                    .spacing(4)
                    .align_y(Alignment::Center),
            )
            .padding([6, 12])
            .style(nav_button(p, false))
            .on_press_maybe((ch.bands.len() < 16).then_some(Message::AddEqBand)),
            button(
                row![icons::refresh(13.0, p.text_muted), text("Đặt phẳng 0 dB").size(12)]
                    .spacing(4)
                    .align_y(Alignment::Center),
            )
            .padding([6, 12])
            .style(ghost_button(p, 8.0))
            .on_press(Message::ResetEqBands),
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    ]
    .spacing(8);

    for (idx, band) in ch.bands.iter().enumerate() {
        let is_sel = state.selected_eq_band == Some(idx);
        let freq_val = band.freq_hz;
        let gain_val = band.gain_db;
        let q_val = band.q;
        let freq_label = if freq_val >= 1000.0 {
            format!("{:.2} kHz", freq_val / 1000.0)
        } else {
            format!("{:.0} Hz", freq_val)
        };

        let row_box = container(
            row![
                toggler(band.enabled)
                    .on_toggle(move |_| Message::ToggleEqBandEnabled(idx))
                    .size(15)
                    .style(accent_toggler(p)),
                button(
                    text(band.kind.short_label())
                        .size(11)
                        .font(FONT_BOLD)
                        .color(p.accent),
                )
                .width(Length::Fixed(38.0))
                .padding([4, 6])
                .style(nav_button(p, is_sel))
                .on_press(Message::CycleEqBandKind(idx)),
                text(freq_label)
                    .size(12)
                    .font(FONT_MEDIUM)
                    .color(p.text)
                    .width(Length::Fixed(72.0)),
                slider(
                    20.0_f32.ln()..=20_000.0_f32.ln(),
                    (freq_val as f32).clamp(20.0, 20_000.0).ln(),
                    move |lf| Message::EqBandUpdated {
                        index: idx,
                        freq_hz: (lf as f64).exp(),
                        gain_db: gain_val,
                        q: q_val,
                    },
                )
                .step(0.01_f32)
                .style(accent_slider(p))
                .width(Length::FillPortion(2)),
                text(format!("{gain_val:+.1} dB"))
                    .size(12)
                    .font(FONT_SEMIBOLD)
                    .color(if gain_val.abs() > 0.1 {
                        p.accent
                    } else {
                        p.text_muted
                    })
                    .width(Length::Fixed(64.0)),
                slider(-15.0..=15.0, gain_val as f32, move |g| {
                    Message::EqBandUpdated {
                        index: idx,
                        freq_hz: freq_val,
                        gain_db: f64::from(g),
                        q: q_val,
                    }
                })
                .step(0.1_f32)
                .style(accent_slider(p))
                .width(Length::FillPortion(2)),
                text(format!("Q {q_val:.2}"))
                    .size(11.5)
                    .color(p.text_muted)
                    .width(Length::Fixed(52.0)),
                slider(0.3..=10.0, q_val as f32, move |qv| {
                    Message::EqBandUpdated {
                        index: idx,
                        freq_hz: freq_val,
                        gain_db: gain_val,
                        q: f64::from(qv),
                    }
                })
                .step(0.05_f32)
                .style(accent_slider(p))
                .width(Length::FillPortion(1)),
                button(icons::close(13.0, p.text_dim))
                    .padding(5)
                    .style(ghost_button(p, 6.0))
                    .on_press_maybe((ch.bands.len() > 1).then_some(Message::RemoveEqBand(idx))),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .padding([7, 10])
        .width(Length::Fill)
        .style(move |_| container::Style {
            background: Some(Background::Color(if is_sel {
                Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.10)
            } else {
                p.surface_elevated
            })),
            border: Border {
                color: if is_sel { p.accent } else { p.border },
                width: 1.0,
                radius: 10.0.into(),
            },
            ..Default::default()
        });

        band_rows = band_rows.push(row_box);
    }

    let bands_card = container(band_rows)
        .padding(16)
        .width(Length::Fill)
        .style(glass_card(p, 16.0));

    let bp_card = bit_perfect_card(state, p);

    let mut eq_col = column![bp_card, top_controls].spacing(14).width(Length::Fill);

    if store.bit_perfect_enabled {
        eq_col = eq_col.push(
            container(
                row![
                    icons::volume_2(14.0, p.accent),
                    text("Bit-Perfect đang bật: toàn bộ EQ, ABL Loudness, Boundary & Resampling được bỏ qua hoàn toàn để giữ nguyên tín hiệu gốc.")
                        .size(12)
                        .color(p.text_muted),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            )
            .padding([10, 14])
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(Color::from_rgba(
                    p.accent.r,
                    p.accent.g,
                    p.accent.b,
                    0.10,
                ))),
                border: Border {
                    color: Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.30),
                    width: 1.0,
                    radius: 12.0.into(),
                },
                ..Default::default()
            }),
        );
    }

    eq_col
        .push(graph_card)
        .push(features_row)
        .push(tools_bar)
        .push(bands_card)
        .into()
}

fn bit_perfect_card<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let store = &state.dsp_store;
    let enabled = store.bit_perfect_enabled;

    let mut inner = column![
        row![
            column![
                row![
                    text("Chế độ Bit-Perfect (WASAPI Exclusive)")
                        .size(15)
                        .font(FONT_BOLD)
                        .color(p.text),
                    if enabled {
                        Element::from(count_pill(
                            if state.signal_path.as_ref().is_some_and(|s| s.bit_exact) {
                                "Bit-Exact 1:1".to_string()
                            } else {
                                "Exclusive Active".to_string()
                            },
                            p,
                        ))
                    } else {
                        space().width(0).into()
                    },
                ]
                .spacing(8)
                .align_y(Alignment::Center),
                text("Bỏ qua Windows Audio Mixer, Equalizer và mọi resampling — xuất thẳng luồng PCM nguyên bản tới DAC/Loa.")
                    .size(12)
                    .color(p.text_muted),
            ]
            .spacing(3)
            .width(Length::Fill),
            toggler(enabled)
                .on_toggle(Message::ToggleBitPerfect)
                .size(20)
                .style(accent_toggler(p)),
        ]
        .spacing(12)
        .align_y(Alignment::Center),
    ]
    .spacing(12);

    if enabled {
        let mut dev_row = row![
            text("Thiết bị Exclusive:")
                .size(12)
                .color(p.text_muted),
            button(text("Mặc định Windows").size(11.5).font(FONT_MEDIUM))
                .padding([5, 11])
                .style(pill_button(p, store.bit_perfect_device.is_none()))
                .on_press(Message::SelectBitPerfectDevice(None)),
        ]
        .spacing(6)
        .align_y(Alignment::Center);

        for out in state.available_outputs.iter().take(4) {
            let active = store.bit_perfect_device.as_deref() == Some(out.as_str());
            dev_row = dev_row.push(
                button(text(truncate_str(out, 24)).size(11.5).font(FONT_MEDIUM))
                    .padding([5, 11])
                    .style(pill_button(p, active))
                    .on_press(Message::SelectBitPerfectDevice(Some(out.clone()))),
            );
        }
        dev_row = dev_row.push(space().width(Length::Fill));
        dev_row = dev_row.push(
            button(icons::refresh(14.0, p.text_muted))
                .padding([5, 8])
                .style(ghost_button(p, 8.0))
                .on_press(Message::CalRefreshDevices),
        );

        inner = inner.push(hairline_divider(p));
        inner = inner.push(dev_row);
        inner = inner.push(
            row![
                toggler(store.bit_perfect_lock_volume)
                    .label("Khoá âm lượng số 100% (chỉnh âm lượng trên DAC/Amp)")
                    .on_toggle(Message::ToggleBitPerfectLockVolume)
                    .size(16)
                    .text_size(12)
                    .style(accent_toggler(p)),
            ]
            .align_y(Alignment::Center),
        );

        if let Some(ref sp) = state.signal_path {
            let src_bits_txt = sp
                .source_bits
                .map(|b| format!("{b}-bit"))
                .unwrap_or_else(|| "Float".to_string());
            let src_label = format!(
                "{} · {:.1} kHz / {}",
                sp.codec_label,
                sp.source_sample_rate as f32 / 1000.0,
                src_bits_txt
            );
            let path_label = if !sp.exclusive {
                "Shared Mixer · Fallback".to_string()
            } else {
                let rs = if sp.resampled { "Resample DAC" } else { "0 Resample" };
                let vol = if sp.software_volume_locked {
                    "Unity 100%"
                } else {
                    "Digital Gain"
                };
                format!("0 DSP · {rs} · {vol}")
            };
            let out_label = format!(
                "{} · {:.1} kHz · {}",
                if sp.exclusive {
                    "WASAPI Exclusive"
                } else {
                    "WASAPI Shared"
                },
                sp.output_sample_rate as f32 / 1000.0,
                sp.output_format,
            );

            inner = inner.push(
                container(
                    row![
                        column![
                            text("NGUỒN").size(9.5).font(FONT_BOLD).color(p.text_dim),
                            text(src_label).size(12).font(FONT_MEDIUM).color(p.text),
                        ]
                        .spacing(2),
                        text("→").size(14).color(p.text_dim),
                        column![
                            text("SIGNAL PATH").size(9.5).font(FONT_BOLD).color(p.text_dim),
                            text(path_label)
                                .size(12)
                                .font(FONT_SEMIBOLD)
                                .color(if sp.bit_exact { p.accent } else { p.text }),
                        ]
                        .spacing(2),
                        text("→").size(14).color(p.text_dim),
                        column![
                            text(format!("ĐẦU RA ({})", truncate_str(&sp.device_name, 26)))
                                .size(9.5)
                                .font(FONT_BOLD)
                                .color(p.text_dim),
                            text(out_label).size(12).font(FONT_MEDIUM).color(p.text),
                        ]
                        .spacing(2),
                    ]
                    .spacing(14)
                    .align_y(Alignment::Center),
                )
                .padding([10, 14])
                .width(Length::Fill)
                .style(move |_| container::Style {
                    background: Some(Background::Color(p.surface_elevated)),
                    border: Border {
                        color: if sp.bit_exact {
                            Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.35)
                        } else {
                            p.border
                        },
                        width: 1.0,
                        radius: 12.0.into(),
                    },
                    ..Default::default()
                }),
            );

            if let Some(ref note) = sp.fallback_note {
                inner = inner.push(
                    text(format!("Lưu ý: {note} — đang phát qua WASAPI Shared."))
                        .size(11.5)
                        .color(p.accent),
                );
            }
        }
    }

    container(inner)
        .padding(16)
        .width(Length::Fill)
        .style(move |_| container::Style {
            background: Some(Background::Color(p.surface)),
            border: Border {
                color: if enabled { p.accent } else { p.border },
                width: if enabled { 1.4 } else { 1.0 },
                radius: 16.0.into(),
            },
            ..Default::default()
        })
        .into()
}

// ---------------------------------------------------------------------------
// TAB 2: ROOM CALIBRATION WIZARD (4 STEPS)
// ---------------------------------------------------------------------------

fn room_cal_tab<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let cal = &state.cal;

    let step_labels = [
        (1, "1. Micro & Độ ồn nền"),
        (2, "2. Cân mức Pink Noise"),
        (3, "3. Quét Farina ESS"),
        (4, "4. Kết quả Auto-EQ"),
    ];
    let mut stepper = row![].spacing(8).align_y(Alignment::Center);
    for (num, title) in step_labels {
        let active = cal.step == num;
        stepper = stepper.push(
            button(text(title).size(12.5).font(FONT_SEMIBOLD))
                .padding([7, 14])
                .style(pill_button(p, active))
                .on_press_maybe((!cal.sweep_running).then_some(Message::CalSetStep(num))),
        );
    }

    let mut content = column![stepper].spacing(14).width(Length::Fill);

    if let Some(ref err) = cal.error {
        content = content.push(
            container(
                row![
                    text(err.clone()).size(13).color(p.danger),
                    space().width(Length::Fill),
                ],
            )
            .padding([10, 14])
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(Color::from_rgba(
                    p.danger.r, p.danger.g, p.danger.b, 0.14,
                ))),
                border: Border {
                    color: p.danger,
                    width: 1.0,
                    radius: 10.0.into(),
                },
                ..Default::default()
            }),
        );
    }

    let step_card: Element<'a, Message> = match cal.step {
        1 => cal_step_1(state, p),
        2 => cal_step_2(state, p),
        3 => cal_step_3(state, p),
        _ => cal_step_4(state, p),
    };

    content.push(step_card).into()
}

fn cal_step_1<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let cal = &state.cal;
    let mut mic_list = row![].spacing(6).align_y(Alignment::Center);
    if state.available_inputs.is_empty() {
        mic_list = mic_list.push(
            text("Chưa phát hiện micro nào — kiểm tra Windows Sound Settings")
                .size(12)
                .color(p.danger),
        );
    } else {
        for mic in state.available_inputs.iter().take(4) {
            let active = cal.selected_mic.as_deref() == Some(mic.as_str());
            mic_list = mic_list.push(
                button(text(truncate_str(mic, 28)).size(12))
                    .padding([6, 12])
                    .style(pill_button(p, active))
                    .on_press(Message::CalSelectMic(mic.clone())),
            );
        }
    }

    let mut out_list = row![].spacing(6).align_y(Alignment::Center);
    for out in state.available_outputs.iter().take(4) {
        let active = cal.selected_output.as_deref() == Some(out.as_str())
            || (cal.selected_output.is_none()
                && state.current_output_device.as_deref() == Some(out.as_str()));
        out_list = out_list.push(
            button(text(truncate_str(out, 28)).size(12))
                .padding([6, 12])
                .style(pill_button(p, active))
                .on_press(Message::CalSelectOutput(out.clone())),
        );
    }

    let vu_col = if cal.mic_clipping {
        p.danger
    } else if cal.mic_rms_dbfs > -32.0 {
        Color::from_rgb8(245, 158, 11)
    } else {
        p.success
    };
    let vu_frac = ((cal.mic_rms_dbfs + 75.0) / 70.0).clamp(0.02, 1.0);

    let mic_source_row = row![
        text("Nguồn micro đo:").size(12.5).color(p.text_muted),
        button(text("Micro máy tính (Windows)").size(12).font(FONT_MEDIUM))
            .padding([6, 12])
            .style(pill_button(p, cal.mic_source == CalMicSource::WindowsMic))
            .on_press(Message::CalSelectMicSource(CalMicSource::WindowsMic)),
        button(text("Micro iPhone (HTTPS LAN)").size(12).font(FONT_MEDIUM))
            .padding([6, 12])
            .style(pill_button(p, cal.mic_source == CalMicSource::IPhoneCompanion))
            .on_press(Message::CalSelectMicSource(CalMicSource::IPhoneCompanion)),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let mic_section: Element<'a, Message> = match cal.mic_source {
        CalMicSource::WindowsMic => column![
            text("Micro thu đo:").size(12.5).color(p.text_muted),
            mic_list,
        ]
        .spacing(8)
        .into(),
        CalMicSource::IPhoneCompanion => {
            let qr_el: Element<'a, Message> = if let Some(ref url) = cal.companion_url {
                qr_code(url.clone(), 156.0)
            } else {
                container(
                    text("Đang khởi tạo HTTPS LAN…")
                        .size(12)
                        .color(p.text_muted),
                )
                .width(168)
                .height(168)
                .align_x(Alignment::Center)
                .align_y(Alignment::Center)
                .style(move |_| container::Style {
                    background: Some(Background::Color(p.surface)),
                    border: Border {
                        color: p.border,
                        width: 1.0,
                        radius: 12.0.into(),
                    },
                    ..Default::default()
                })
                .into()
            };

            let status_txt = if let Some(ref err) = cal.companion_error {
                err.clone()
            } else if cal.companion_connected {
                let label = cal
                    .companion_device_label
                    .as_deref()
                    .unwrap_or("iPhone (Safari LAN)");
                format!(
                    "Đã kết nối: {label} ({:.1} kHz)",
                    cal.companion_sample_rate as f32 / 1000.0
                )
            } else {
                "Đang chờ iPhone quét mã QR (cùng mạng Wi-Fi với PC)…".to_string()
            };

            let status_col = if cal.companion_error.is_some() {
                p.danger
            } else if cal.companion_connected {
                p.success
            } else {
                p.accent
            };

            let url_txt = cal
                .companion_url
                .clone()
                .unwrap_or_else(|| "Đang cấp phát địa chỉ LAN…".to_string());

            container(
                row![
                    qr_el,
                    column![
                        row![
                            live_dot(state.aurora_time, cal.companion_connected, status_col),
                            text(status_txt).size(13).font(FONT_SEMIBOLD).color(status_col),
                        ]
                        .spacing(8)
                        .align_y(Alignment::Center),
                        text(url_txt).size(12).color(p.text_muted),
                        text("1. Mở Camera iPhone quét mã QR bên trái (đảm bảo iPhone & PC chung Wi-Fi).\n2. Khi Safari báo kết nối không riêng tư: bấm Hiển thị chi tiết → Truy cập trang web này.\n3. Trên iPhone bấm nút đỏ 'Bật Micro iPhone' để truyền mức âm trực tiếp.")
                            .size(12)
                            .color(p.text_muted),
                        row![
                            button(text("Sao chép link").size(12).font(FONT_MEDIUM))
                                .padding([6, 12])
                                .style(nav_button(p, false))
                                .on_press_maybe(cal.companion_url.is_some().then_some(Message::CalCopyCompanionUrl)),
                            button(
                                row![icons::refresh(13.0, p.text_muted), text("Khởi động lại HTTPS").size(12)]
                                    .spacing(5)
                                    .align_y(Alignment::Center),
                            )
                            .padding([6, 12])
                            .style(ghost_button(p, 8.0))
                            .on_press(Message::CalRestartCompanion),
                        ]
                        .spacing(8),
                    ]
                    .spacing(8)
                    .width(Length::Fill),
                ]
                .spacing(16)
                .align_y(Alignment::Center),
            )
            .padding(14)
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(p.surface_elevated)),
                border: Border {
                    color: if cal.companion_connected { p.success } else { p.border },
                    width: 1.0,
                    radius: 12.0.into(),
                },
                ..Default::default()
            })
            .into()
        }
    };

    container(
        column![
            row![
                text("Bước 1: Chọn Micro, Loa & Kiểm tra độ ồn nền")
                    .size(17)
                    .font(FONT_BOLD)
                    .color(p.text),
                space().width(Length::Fill),
                button(
                    row![icons::refresh(13.0, p.text_muted), text("Quét lại thiết bị").size(12)]
                        .spacing(5)
                        .align_y(Alignment::Center),
                )
                .padding([6, 12])
                .style(nav_button(p, false))
                .on_press(Message::CalRefreshDevices),
            ]
            .align_y(Alignment::Center),
            text("Loa đầu ra (WASAPI):").size(12.5).color(p.text_muted),
            out_list,
            mic_source_row,
            mic_section,
            hairline_divider(p),
            row![
                toggler(cal.uncalibrated_safe_mode)
                    .label("Tự động nhận diện dải loa & chặn trên 6.5 kHz (khuyên dùng cho mic laptop/phổ thông)")
                    .on_toggle(Message::CalToggleSafeMode)
                    .size(18)
                    .text_size(13)
                    .style(accent_toggler(p)),
                space().width(Length::Fill),
                if let Some(ref c) = cal.mic_cal {
                    Element::from(
                        row![
                            count_pill(format!("Cal: {}", truncate_str(&c.name, 20)), p),
                            button(icons::close(13.0, p.text_muted))
                                .padding(4)
                                .style(ghost_button(p, 6.0))
                                .on_press(Message::CalClearMicFile),
                        ]
                        .spacing(4)
                        .align_y(Alignment::Center),
                    )
                } else {
                    button(text("Nạp file hiệu chuẩn mic (.cal / .txt)").size(12))
                        .padding([6, 12])
                        .style(nav_button(p, false))
                        .on_press(Message::CalLoadMicFile)
                        .into()
                },
            ]
            .spacing(10)
            .align_y(Alignment::Center),
            column![
                row![
                    text(format!(
                        "Mức ồn nền hiện tại: {:.1} dBFS  (Peak: {:.1} dBFS)",
                        cal.mic_rms_dbfs, cal.mic_peak_dbfs
                    ))
                    .size(12.5)
                    .color(p.text),
                    space().width(Length::Fill),
                    text(if cal.mic_clipping {
                        "BỊ CLIPPING! Giảm gain mic"
                    } else if cal.mic_rms_dbfs > -32.0 {
                        "Phòng hơi ồn — nên giữ yên lặng"
                    } else {
                        "Phòng yên tĩnh · Đạt chuẩn đo"
                    })
                    .size(12)
                    .font(FONT_SEMIBOLD)
                    .color(vu_col),
                ],
                vu_meter(vu_frac, vu_col, p),
            ]
            .spacing(6),
            row![
                space().width(Length::Fill),
                button(text("Tiếp theo: Cân mức âm lượng →").size(13).font(FONT_SEMIBOLD))
                    .padding([9, 18])
                    .style(primary_button(p, 999.0))
                    .on_press(Message::CalSetStep(2)),
            ],
        ]
        .spacing(14),
    )
    .padding(20)
    .width(Length::Fill)
    .style(glass_card(p, 16.0))
    .into()
}

fn cal_step_2<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let cal = &state.cal;
    let in_zone = (-26.0..=-10.0).contains(&cal.mic_rms_dbfs) && !cal.mic_clipping;
    let vu_col = if cal.mic_clipping {
        p.danger
    } else if in_zone {
        p.success
    } else {
        p.accent
    };
    let vu_frac = ((cal.mic_rms_dbfs + 75.0) / 70.0).clamp(0.02, 1.0);

    container(
        column![
            row![
                text("Bước 2: Phát Pink Noise cân mức âm lượng đo")
                    .size(17)
                    .font(FONT_BOLD)
                    .color(p.text),
                space().width(Length::Fill),
                if cal.mic_source == CalMicSource::IPhoneCompanion {
                    Element::from(count_pill("Đang nhận mức thu từ Micro iPhone".to_string(), p))
                } else {
                    space().width(0).into()
                },
            ]
            .align_y(Alignment::Center),
            text("Đặt micro tại vị trí tai nghe bình thường. Bật Pink Noise và kéo âm lượng sao cho mức thu nằm trong khoảng -26 đến -10 dBFS (vùng xanh), không bị Clipping.")
                .size(13)
                .color(p.text_muted),
            row![
                button(
                    text(if cal.pink_noise_playing {
                        "Dừng Pink Noise"
                    } else {
                        "Phát thử Pink Noise"
                    })
                    .size(13)
                    .font(FONT_SEMIBOLD),
                )
                .padding([9, 18])
                .style(if cal.pink_noise_playing {
                    pill_button(p, true)
                } else {
                    pill_button(p, false)
                })
                .on_press(Message::CalTogglePinkNoise),
                text("Âm lượng test:")
                    .size(12.5)
                    .color(p.text_muted),
                slider(0.05..=0.80, cal.test_volume, Message::CalSetTestVolume)
                    .step(0.02_f32)
                    .style(accent_slider(p))
                    .width(Length::Fixed(180.0)),
                text(format!("{}%", (cal.test_volume * 100.0).round() as u32))
                    .size(12.5)
                    .color(p.text),
            ]
            .spacing(12)
            .align_y(Alignment::Center),
            column![
                row![
                    text(format!("Tín hiệu vào micro: {:.1} dBFS", cal.mic_rms_dbfs))
                        .size(12.5)
                        .color(p.text),
                    space().width(Length::Fill),
                    text(if cal.mic_clipping {
                        "QUÁ LỚN (Clipping)!"
                    } else if in_zone {
                        "Mức âm lượng lý tưởng!"
                    } else {
                        "Mục tiêu: -26 đến -10 dBFS"
                    })
                    .size(12)
                    .font(FONT_SEMIBOLD)
                    .color(vu_col),
                ],
                vu_meter(vu_frac, vu_col, p),
            ]
            .spacing(6),
            row![
                button(text("← Quay lại").size(13))
                    .padding([8, 16])
                    .style(ghost_button(p, 999.0))
                    .on_press(Message::CalSetStep(1)),
                space().width(Length::Fill),
                button(text("Tiếp theo: Quét phòng →").size(13).font(FONT_SEMIBOLD))
                    .padding([9, 18])
                    .style(primary_button(p, 999.0))
                    .on_press(Message::CalSetStep(3)),
            ],
        ]
        .spacing(16),
    )
    .padding(20)
    .width(Length::Fill)
    .style(glass_card(p, 16.0))
    .into()
}

fn cal_step_3<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let cal = &state.cal;
    let collected = cal.collected_l.len();

    let status_line = if cal.sweep_running {
        cal.sweep_stage.clone()
    } else if cal.channel_mode == SweepChannelMode::IndependentLR
        && cal.collected_l.len() > cal.collected_r.len()
    {
        format!(
            "Đã xong kênh Trái ({}/{} điểm) — đang chuẩn bị đo kênh Phải…",
            cal.collected_l.len(),
            cal.target_points
        )
    } else if collected == 0 {
        if cal.mic_source == CalMicSource::IPhoneCompanion {
            match cal.iphone_mode {
                IPhoneCalMode::MmmPinkNoise => {
                    "Sẵn sàng đo MMM Pink Noise (12s · Trueplay) bằng micro iPhone".to_string()
                }
                IPhoneCalMode::SyncedFarinaEss => {
                    "Sẵn sàng quét Farina ESS đồng bộ 2 xung (20 Hz – 20 kHz) bằng micro iPhone"
                        .to_string()
                }
            }
        } else {
            "Sẵn sàng phát tín hiệu Farina Exponential Sine Sweep (20 Hz – 20 kHz)".to_string()
        }
    } else if (collected as u8) < cal.target_points {
        format!(
            "Đã đo xong điểm {collected}/{}. Hãy dịch micro lệch ~20 cm quanh vùng đầu ngồi rồi bấm đo điểm tiếp theo!",
            cal.target_points
        )
    } else {
        format!(
            "Đã thu thập đủ {}/{} điểm đo! Bấm Xem kết quả Auto-EQ.",
            collected, cal.target_points
        )
    };

    let mode_controls: Element<'a, Message> = if cal.mic_source == CalMicSource::IPhoneCompanion {
        let mut r = row![
            text("Phương pháp đo (iPhone):").size(13).color(p.text_muted),
            button(text("MMM Pink Noise (12s · Trueplay)").size(12))
                .padding([6, 12])
                .style(pill_button(
                    p,
                    cal.iphone_mode == IPhoneCalMode::MmmPinkNoise
                ))
                .on_press_maybe(
                    (!cal.sweep_running)
                        .then_some(Message::CalSelectIPhoneMode(IPhoneCalMode::MmmPinkNoise)),
                ),
            button(text("Farina ESS đồng bộ xung (RT60)").size(12))
                .padding([6, 12])
                .style(pill_button(
                    p,
                    cal.iphone_mode == IPhoneCalMode::SyncedFarinaEss
                ))
                .on_press_maybe(
                    (!cal.sweep_running)
                        .then_some(Message::CalSelectIPhoneMode(IPhoneCalMode::SyncedFarinaEss)),
                ),
            space().width(Length::Fixed(16.0)),
            text("Chế độ kênh:").size(13).color(p.text_muted),
            button(text("Stereo (L+R)").size(12))
                .padding([6, 12])
                .style(pill_button(p, cal.channel_mode == SweepChannelMode::Stereo))
                .on_press_maybe(
                    (!cal.sweep_running)
                        .then_some(Message::CalSetChannelMode(SweepChannelMode::Stereo)),
                ),
            button(text("Trái / Phải độc lập").size(12))
                .padding([6, 12])
                .style(pill_button(
                    p,
                    cal.channel_mode == SweepChannelMode::IndependentLR
                ))
                .on_press_maybe(
                    (!cal.sweep_running)
                        .then_some(Message::CalSetChannelMode(SweepChannelMode::IndependentLR)),
                ),
        ]
        .spacing(8)
        .align_y(Alignment::Center);
        if cal.iphone_mode == IPhoneCalMode::SyncedFarinaEss {
            r = r.push(space().width(Length::Fixed(12.0))).push(
                button(text(format!("{} điểm", cal.target_points)).size(12))
                    .padding([6, 10])
                    .style(nav_button(p, false))
                    .on_press_maybe(
                        (!cal.sweep_running).then_some(Message::CalSetTargetPoints(
                            if cal.target_points == 1 { 3 } else { 1 },
                        )),
                    ),
            );
        }
        column![
            r,
            text("Mẹo: Bạn có thể ngồi vào đúng vị trí nghe và bấm nút 'Bắt đầu đo phòng' ngay trên màn hình iPhone.")
                .size(12)
                .color(p.text_muted),
        ]
        .spacing(8)
        .into()
    } else {
        row![
            text("Số điểm đo:").size(13).color(p.text_muted),
            button(text("Nhanh (1 điểm)").size(12))
                .padding([6, 12])
                .style(pill_button(p, cal.target_points == 1))
                .on_press_maybe((!cal.sweep_running).then_some(Message::CalSetTargetPoints(1))),
            button(text("Chuẩn B&O/Dirac (3 điểm trung bình)").size(12))
                .padding([6, 12])
                .style(pill_button(p, cal.target_points == 3))
                .on_press_maybe((!cal.sweep_running).then_some(Message::CalSetTargetPoints(3))),
            space().width(Length::Fixed(16.0)),
            text("Chế độ kênh:").size(13).color(p.text_muted),
            button(text("Stereo (L+R)").size(12))
                .padding([6, 12])
                .style(pill_button(p, cal.channel_mode == SweepChannelMode::Stereo))
                .on_press_maybe(
                    (!cal.sweep_running)
                        .then_some(Message::CalSetChannelMode(SweepChannelMode::Stereo)),
                ),
            button(text("Trái / Phải độc lập").size(12))
                .padding([6, 12])
                .style(pill_button(
                    p,
                    cal.channel_mode == SweepChannelMode::IndependentLR
                ))
                .on_press_maybe(
                    (!cal.sweep_running)
                        .then_some(Message::CalSetChannelMode(SweepChannelMode::IndependentLR)),
                ),
        ]
        .spacing(8)
        .align_y(Alignment::Center)
        .into()
    };

    container(
        column![
            text(if cal.mic_source == CalMicSource::IPhoneCompanion {
                "Bước 3: Quét đáp tuyến phòng bằng Micro iPhone"
            } else {
                "Bước 3: Quét đáp tuyến phòng (Farina Exponential Sine Sweep)"
            })
            .size(17)
            .font(FONT_BOLD)
            .color(p.text),
            mode_controls,
            container(
                column![
                    row![
                        live_dot(state.aurora_time, cal.sweep_running, p.accent),
                        text(status_line).size(13).font(FONT_MEDIUM).color(p.text),
                    ]
                    .spacing(8)
                    .align_y(Alignment::Center),
                    vu_meter(cal.sweep_progress.clamp(0.0, 1.0), p.accent, p),
                ]
                .spacing(10),
            )
            .padding(16)
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(p.surface_elevated)),
                border: Border {
                    color: p.border,
                    width: 1.0,
                    radius: 12.0.into(),
                },
                ..Default::default()
            }),
            row![
                button(text("← Quay lại").size(13))
                    .padding([8, 16])
                    .style(ghost_button(p, 999.0))
                    .on_press_maybe((!cal.sweep_running).then_some(Message::CalSetStep(2))),
                if collected > 0 && !cal.sweep_running {
                    Element::from(
                        button(text("Đo lại từ đầu").size(12.5))
                            .padding([8, 14])
                            .style(danger_button(p, 999.0))
                            .on_press(Message::CalResetSweeps),
                    )
                } else {
                    space().width(0).into()
                },
                space().width(Length::Fill),
                button(
                    text(if cal.sweep_running {
                        "Đang quét…"
                    } else if collected == 0 {
                        "Bắt đầu đo phòng"
                    } else if (collected as u8) < cal.target_points {
                        "Đo điểm tiếp theo"
                    } else {
                        "Đo lại"
                    })
                    .size(13)
                    .font(FONT_SEMIBOLD),
                )
                .padding([9, 20])
                .style(primary_button(p, 999.0))
                .on_press_maybe((!cal.sweep_running).then_some(Message::CalStartSweep)),
                if (collected as u8) >= cal.target_points && !cal.sweep_running {
                    Element::from(
                        button(text("Xem kết quả Auto-EQ →").size(13).font(FONT_SEMIBOLD))
                            .padding([9, 18])
                            .style(pill_button(p, true))
                            .on_press(Message::CalSetStep(4)),
                    )
                } else {
                    space().width(0).into()
                },
            ]
            .spacing(10),
        ]
        .spacing(16),
    )
    .padding(20)
    .width(Length::Fill)
    .style(glass_card(p, 16.0))
    .into()
}

fn cal_step_4<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let cal = &state.cal;
    let Some(ref meas) = cal.averaged_l else {
        return container(
            column![
                text("Chưa có dữ liệu đo phòng. Quay lại Bước 3 để chạy quét Sweep.")
                    .size(13)
                    .color(p.text_muted),
                button(text("← Quay lại Bước 3").size(13))
                    .padding([8, 16])
                    .style(nav_button(p, false))
                    .on_press(Message::CalSetStep(3)),
            ]
            .spacing(12),
        )
        .padding(20)
        .width(Length::Fill)
        .style(glass_card(p, 16.0))
        .into();
    };

    let auto_l = cal.autoeq_l.as_ref();
    let mut targets_row = row![].spacing(6).align_y(Alignment::Center);
    for t in TargetCurveKind::ALL {
        targets_row = targets_row.push(
            button(text(t.label()).size(12).font(FONT_MEDIUM))
                .padding([6, 12])
                .style(pill_button(p, cal.target_curve == t))
                .on_press(Message::CalSetTargetCurve(t)),
        );
    }

    let stats = if let Some(res) = auto_l {
        format!(
            "Dải loa/mic: {:.0} Hz – {:.1} kHz · RT60: {:.2} s · fs: {:.0} Hz · Sai số RMS: {:.2} → {:.2} dB ({} band)",
            res.usable_min_hz,
            res.usable_max_hz / 1000.0,
            meas.rt60_sec,
            meas.schroeder_hz,
            res.rms_before_db,
            res.rms_after_db,
            res.bands.len()
        )
    } else {
        format!(
            "RT60: {:.2} s · Tần số Schroeder fs: {:.0} Hz",
            meas.rt60_sec, meas.schroeder_hz
        )
    };

    let mut chips_row = row![
        text("Bộ lọc đề xuất:").size(12).color(p.text_muted),
    ]
    .spacing(6)
    .align_y(Alignment::Center);
    if let Some(res) = auto_l {
        for b in res.bands.iter().take(7) {
            let f_txt = if b.freq_hz >= 1000.0 {
                format!("{:.1}k", b.freq_hz / 1000.0)
            } else {
                format!("{:.0}", b.freq_hz)
            };
            chips_row = chips_row.push(count_pill(format!("{f_txt} Hz {:+.1} dB", b.gain_db), p));
        }
    }

    let is_previewing = state.dsp_store.active_profile_id == "room-cal-preview";
    let preview_lbl = if is_previewing && !state.dsp_store.bypass {
        "Nghe thử: ĐANG BẬT Auto-EQ (bấm để Bypass)"
    } else if is_previewing {
        "Nghe thử: ĐANG BYPASS GỐC (bấm để bật)"
    } else {
        "Nghe thử A/B trực tiếp"
    };

    container(
        column![
            row![
                column![
                    text("Bước 4: Kết quả đo phòng & Tạo bộ lọc Auto-EQ")
                        .size(17)
                        .font(FONT_BOLD)
                        .color(p.text),
                    text(stats).size(12.5).color(p.accent),
                ]
                .spacing(4),
                space().width(Length::Fill),
                count_pill("Xám: Thực đo · Vàng: Mục tiêu · Xanh: Sau Auto-EQ".to_string(), p),
            ]
            .align_y(Alignment::Center),
            eq_graph(
                EqGraphConfig {
                    bands: auto_l.map(|r| r.bands.as_slice()).unwrap_or(&[]),
                    extra_bands: Vec::new(),
                    measured_db: Some(meas.smoothed_db.as_slice()),
                    after_db: auto_l.map(|r| r.after_db.as_slice()),
                    target: Some(cal.target_curve),
                    bypass: false,
                    interactive: false,
                    selected_band: None,
                    palette: p,
                },
                275.0,
            ),
            chips_row,
            row![
                text("Đường mục tiêu:").size(12.5).color(p.text_muted),
                targets_row,
                space().width(Length::Fill),
                text("Giới hạn boost hõm null:").size(12.5).color(p.text_muted),
                slider(0.0..=6.0, cal.max_boost_db, Message::CalSetMaxBoost)
                    .step(0.5_f32)
                    .style(accent_slider(p))
                    .width(Length::Fixed(120.0)),
                text(format!("+{:.1} dB", cal.max_boost_db))
                    .size(12)
                    .font(FONT_SEMIBOLD)
                    .color(p.text),
            ]
            .spacing(10)
            .align_y(Alignment::Center),
            row![
                button(text("← Đo lại").size(13))
                    .padding([8, 16])
                    .style(ghost_button(p, 999.0))
                    .on_press(Message::CalSetStep(3)),
                space().width(Length::Fill),
                button(text(preview_lbl).size(12.5).font(FONT_SEMIBOLD))
                    .padding([9, 16])
                    .style(pill_button(p, is_previewing && !state.dsp_store.bypass))
                    .on_press_maybe(auto_l.map(|_| Message::CalPreviewToggle)),
                button(text("Lưu & Áp dụng làm Hồ sơ EQ chính").size(13).font(FONT_BOLD))
                    .padding([10, 22])
                    .style(primary_button(p, 999.0))
                    .on_press(Message::CalSaveAsProfile),
            ]
            .spacing(10),
        ]
        .spacing(14),
    )
    .padding(20)
    .width(Length::Fill)
    .style(glass_card(p, 16.0))
    .into()
}

// ---------------------------------------------------------------------------
// TAB 3: APPLE ADAPTIVE AUDIO
// ---------------------------------------------------------------------------

fn adaptive_tab<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let cfg = &state.dsp_store.adaptive;
    let tel = &state.adaptive_status;
    let mic_on = cfg.ambient_enabled || cfg.ducking_enabled;
    let mic_stream_ok = mic_on && tel.mic_active;

    let mut mic_row = row![
        text("Micro nền:").size(12).color(p.text_muted),
        button(text("Mặc định Windows").size(11.5))
            .padding([4, 10])
            .style(pill_button(p, cfg.mic_name.is_none()))
            .on_press(Message::AdaptiveSelectMic(None)),
    ]
    .spacing(6)
    .align_y(Alignment::Center);

    for mic in state.available_inputs.iter().take(4) {
        let active = cfg.mic_name.as_deref() == Some(mic.as_str());
        mic_row = mic_row.push(
            button(text(truncate_str(mic, 26)).size(11.5))
                .padding([4, 10])
                .style(pill_button(p, active))
                .on_press(Message::AdaptiveSelectMic(Some(mic.clone()))),
        );
    }

    let status_headline = if !mic_on {
        "Micro nền đang tắt hoàn toàn — 0% CPU"
    } else if !tel.mic_active {
        "Đang chờ mở micro… (kiểm tra quyền Micro trong Windows Privacy Settings hoặc chọn micro khác)"
    } else {
        "Micro nền đang hoạt động (phân tích cục bộ 100%, không ghi âm)"
    };

    let status_sub = if mic_stream_ok {
        format!(
            "Tín hiệu Mic tức thời: {:.1} dBFS · Nền phòng: {:.1} dBFS · Bù âm lượng: {:+.1} dB · Ducking: {:+.1} dB",
            tel.raw_mic_dbfs, tel.room_dbfs, tel.applied_ambient_db, tel.applied_duck_db
        )
    } else if mic_on {
        "Chưa nhận được mẫu âm thanh từ micro được chọn — thử chọn micro khác hoặc bấm Quét lại."
            .to_string()
    } else {
        "Bật một trong hai tính năng dưới đây để cho phép phân tích độ ồn môi trường thời gian thực."
            .to_string()
    };

    let dot_col = if mic_stream_ok {
        p.success
    } else if mic_on {
        Color::from_rgb8(245, 158, 11)
    } else {
        p.text_dim
    };

    let raw_frac = ((tel.raw_mic_dbfs + 75.0) / 65.0).clamp(0.02, 1.0);
    let raw_col = if tel.raw_mic_dbfs > -18.0 {
        p.accent_secondary
    } else if tel.raw_mic_dbfs > -48.0 {
        p.success
    } else {
        p.accent
    };

    let privacy_banner = container(
        column![
            row![
                live_dot(state.aurora_time, mic_stream_ok, dot_col),
                column![
                    text(status_headline)
                        .size(13.5)
                        .font(FONT_SEMIBOLD)
                        .color(p.text),
                    text(status_sub).size(12).color(p.text_muted),
                ]
                .spacing(2)
                .width(Length::Fill),
                button(
                    row![
                        icons::refresh(12.0, p.text_muted),
                        text("Quét lại").size(11.5),
                    ]
                    .spacing(4)
                    .align_y(Alignment::Center),
                )
                .padding([5, 10])
                .style(nav_button(p, false))
                .on_press(Message::CalRefreshDevices),
            ]
            .spacing(12)
            .align_y(Alignment::Center),
            if mic_on {
                Element::from(column![
                    vu_meter(raw_frac, raw_col, p),
                    row![
                        mic_row,
                        space().width(Length::Fill),
                        toggler(cfg.headphone_mode)
                            .label("Đang đeo tai nghe (tắt trừ echo loa)")
                            .on_toggle(Message::AdaptiveToggleHeadphoneMode)
                            .size(16)
                            .text_size(12)
                            .style(accent_toggler(p)),
                    ]
                    .spacing(10)
                    .align_y(Alignment::Center),
                ]
                .spacing(8))
            } else {
                row![
                    mic_row,
                    space().width(Length::Fill),
                    toggler(cfg.headphone_mode)
                        .label("Đang đeo tai nghe (tắt trừ echo loa)")
                        .on_toggle(Message::AdaptiveToggleHeadphoneMode)
                        .size(16)
                        .text_size(12)
                        .style(accent_toggler(p)),
                ]
                .spacing(10)
                .align_y(Alignment::Center)
                .into()
            },
        ]
        .spacing(10),
    )
    .padding(16)
    .width(Length::Fill)
    .style(glass_card(p, 14.0));

    let amb_frac = ((tel.room_dbfs + 75.0) / 65.0).clamp(0.02, 1.0);
    let ambient_card = container(
        column![
            row![
                column![
                    text("Ambient Auto-Volume (Học thói quen âm lượng)")
                        .size(16)
                        .font(FONT_BOLD)
                        .color(p.text),
                    text("Lấy cảm hứng từ Apple Personalized Volume + B&O ABL: đo độ ồn phòng có bù trừ âm nhạc đang phát, tự tinh chỉnh gain và ghi nhớ sở thích mỗi khi bạn kéo thanh âm lượng.")
                        .size(12)
                        .color(p.text_muted),
                ]
                .spacing(3)
                .width(Length::Fill),
                toggler(cfg.ambient_enabled)
                    .on_toggle(Message::AdaptiveToggleAmbient)
                    .size(20)
                    .style(accent_toggler(p)),
            ]
            .spacing(12)
            .align_y(Alignment::Center),
            if cfg.ambient_enabled {
                Element::from(vu_meter(amb_frac, p.accent, p))
            } else {
                space().height(0).into()
            },
            row![
                text("Độ nhạy tự chỉnh:").size(12.5).color(p.text_muted),
                slider(0.0..=1.0, cfg.ambient_strength, Message::AdaptiveSetAmbientStrength)
                    .step(0.05_f32)
                    .style(accent_slider(p))
                    .width(Length::Fixed(160.0)),
                text(format!("{}%", (cfg.ambient_strength * 100.0).round() as u32))
                    .size(12)
                    .color(p.text),
                space().width(Length::Fixed(14.0)),
                text("Tăng tối đa:").size(12.5).color(p.text_muted),
                slider(1.0..=8.0, cfg.ambient_max_boost_db, Message::AdaptiveSetAmbientMaxBoost)
                    .step(0.5_f32)
                    .style(accent_slider(p))
                    .width(Length::Fixed(140.0)),
                text(format!("+{:.1} dB", cfg.ambient_max_boost_db))
                    .size(12)
                    .color(p.text),
                space().width(Length::Fill),
                count_pill(format!("Đã học: {} điểm", cfg.learned_points.len()), p),
                button(text("Đặt lại dữ liệu học").size(11.5))
                    .padding([5, 10])
                    .style(ghost_button(p, 8.0))
                    .on_press_maybe(
                        (!cfg.learned_points.is_empty()).then_some(Message::AdaptiveResetLearned)
                    ),
            ]
            .spacing(10)
            .align_y(Alignment::Center),
        ]
        .spacing(12),
    )
    .padding(18)
    .width(Length::Fill)
    .style(glass_card(p, 16.0));

    let ducking_card = container(
        column![
            row![
                column![
                    row![
                        text("Conversation Ducking (Tự hạ nhạc khi nói chuyện)")
                            .size(16)
                            .font(FONT_BOLD)
                            .color(p.text),
                        if tel.ducking_active {
                            Element::from(count_pill("ĐANG HẠ NHẠC".to_string(), p))
                        } else {
                            space().width(0).into()
                        },
                    ]
                    .spacing(8)
                    .align_y(Alignment::Center),
                    text("Phát hiện giọng nói dải 300–3400 Hz (lọc trừ tiếng nhạc phát ra loa) để tự hạ nhỏ nhạc khi bạn trò chuyện, sau đó tăng mượt lại khi kết thúc.")
                        .size(12)
                        .color(p.text_muted),
                ]
                .spacing(3)
                .width(Length::Fill),
                toggler(cfg.ducking_enabled)
                    .on_toggle(Message::AdaptiveToggleDucking)
                    .size(20)
                    .style(accent_toggler(p)),
            ]
            .spacing(12)
            .align_y(Alignment::Center),
            row![
                text("Độ nhạy giọng nói:").size(12.5).color(p.text_muted),
                slider(0.1..=1.0, cfg.ducking_sensitivity, Message::AdaptiveSetDuckSensitivity)
                    .step(0.05_f32)
                    .style(accent_slider(p))
                    .width(Length::Fixed(140.0)),
                text(format!("{}%", (cfg.ducking_sensitivity * 100.0).round() as u32))
                    .size(12)
                    .color(p.text),
                space().width(Length::Fixed(10.0)),
                text("Mức giảm nhạc:").size(12.5).color(p.text_muted),
                slider(6.0..=24.0, cfg.ducking_depth_db, Message::AdaptiveSetDuckDepth)
                    .step(1.0_f32)
                    .style(accent_slider(p))
                    .width(Length::Fixed(130.0)),
                text(format!("-{:.0} dB", cfg.ducking_depth_db))
                    .size(12)
                    .color(p.text),
                space().width(Length::Fixed(10.0)),
                text("Trễ nhả:").size(12.5).color(p.text_muted),
                slider(1.5..=7.0, cfg.ducking_release_sec, Message::AdaptiveSetDuckRelease)
                    .step(0.5_f32)
                    .style(accent_slider(p))
                    .width(Length::Fixed(110.0)),
                text(format!("{:.1} s", cfg.ducking_release_sec))
                    .size(12)
                    .color(p.text),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        ]
        .spacing(12),
    )
    .padding(18)
    .width(Length::Fill)
    .style(glass_card(p, 16.0));

    column![privacy_banner, ambient_card, ducking_card]
        .spacing(14)
        .width(Length::Fill)
        .into()
}

fn vu_meter<'a>(frac: f32, col: Color, p: Palette) -> Element<'a, Message> {
    let pct = (frac.clamp(0.01, 1.0) * 1000.0).round() as u16;
    let rem = 1000u16.saturating_sub(pct);
    container(
        row![
            container(space().width(Length::Fill).height(8))
                .width(Length::FillPortion(pct.max(1)))
                .style(move |_| container::Style {
                    background: Some(Background::Color(col)),
                    border: Border {
                        radius: 999.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }),
            if rem > 0 {
                space().width(Length::FillPortion(rem)).into()
            } else {
                Element::from(space().width(0))
            },
        ]
        .width(Length::Fill),
    )
    .height(8)
    .width(Length::Fill)
    .style(move |_| container::Style {
        background: Some(Background::Color(p.surface_elevated)),
        border: Border {
            color: p.border,
            width: 1.0,
            radius: 999.0.into(),
        },
        ..Default::default()
    })
    .into()
}

