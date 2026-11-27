use iced::widget::{button, column, container, row, space, text, toggler};
use iced::{Alignment, Background, Border, Color, Element, Length};

use crate::icons;
use crate::state::{AppState, AuthModalMode, Message};
use crate::theme::{
    AppThemeKind, FONT_BOLD, FONT_SEMIBOLD, Palette, accent_toggler, danger_button, ghost_button,
    glass_card, palette, primary_button,
};
use crate::widgets::micro::{hairline_divider, kbd_chip, storage_bar};

const SHORTCUTS: &[(&str, &str)] = &[
    ("Space", "Phát / Tạm dừng (bỏ qua khi đang gõ)"),
    ("Ctrl + K", "Mở Tìm kiếm nhanh"),
    ("Ctrl + L", "Mở / Đóng màn hình Đang phát"),
    ("Ctrl + Q", "Bật / Tắt Hàng chờ phát"),
    ("Ctrl + Shift + M", "Bật / Tắt Mini-Player"),
    ("Ctrl + ← / →", "Bài trước / Bài tiếp theo"),
    ("Ctrl + ↑ / ↓", "Tăng / Giảm âm lượng 5%"),
    ("Ctrl + Alt + Space", "Global Hotkey Phát / Dừng"),
];

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            text("Cài đặt & Tài khoản")
                .size(28)
                .font(FONT_BOLD)
                .color(p.text),
            text("Tuỳ chỉnh giao diện, hiệu năng và đồng bộ Windows 11")
                .size(13)
                .color(p.text_muted),
        ]
        .spacing(4),
    ]
    .spacing(20)
    .width(Length::Fill);

    // Account section
    let account_card: Element<'a, Message> = if state.session_snap.is_signed_in() {
        let email = state.session_snap.email.clone().unwrap_or_default();
        let name = state.session_snap.display_name();
        container(
            row![
                icons::user(26.0, p.accent),
                column![
                    text(name).size(17).font(FONT_SEMIBOLD).color(p.text),
                    text(email).size(13).color(p.text_muted),
                ]
                .spacing(2)
                .width(Length::Fill),
                button(text("Đăng xuất").size(13))
                    .padding([9, 18])
                    .style(danger_button(p, 999.0))
                    .on_press(Message::SignOut),
            ]
            .spacing(14)
            .align_y(Alignment::Center),
        )
        .padding(20)
        .width(Length::Fill)
        .style(glass_card(p, 16.0))
        .into()
    } else {
        container(
            row![
                icons::user(26.0, p.text_dim),
                column![
                    text("Chưa đăng nhập").size(17).font(FONT_SEMIBOLD).color(p.text),
                    text("Đăng nhập để đồng bộ Yêu thích, Lịch sử và Playlist cá nhân.")
                        .size(13)
                        .color(p.text_muted),
                ]
                .spacing(2)
                .width(Length::Fill),
                row![
                    button(
                        text(if state.web_login_in_progress {
                            "Đang mở…"
                        } else {
                            "Đăng nhập"
                        })
                        .size(13)
                        .font(FONT_SEMIBOLD)
                        .color(p.accent_fg),
                    )
                    .padding([9, 20])
                    .style(primary_button(p, 999.0))
                    .on_press_maybe((!state.web_login_in_progress).then_some(Message::StartWebLogin)),
                    if state.config.is_auth_configured() {
                        Element::from(
                            button(text("Mật khẩu").size(13).color(p.text_muted))
                                .padding([9, 14])
                                .style(ghost_button(p, 999.0))
                                .on_press(Message::OpenAuthModal(AuthModalMode::SignIn)),
                        )
                    } else {
                        space().width(0).into()
                    }
                ]
                .spacing(8),
            ]
            .spacing(14)
            .align_y(Alignment::Center),
        )
        .padding(20)
        .width(Length::Fill)
        .style(glass_card(p, 16.0))
        .into()
    };

    col = col.push(account_card);

    // Theme Picker (2x2 clean grid so all 4 themes breathe comfortably)
    let make_theme_card = |kind: AppThemeKind| -> Element<'a, Message> {
        let active = state.settings.theme == kind;
        let preview = palette(kind, false);
        let swatch = row![
            swatch_dot(preview.bg, p.border_strong),
            swatch_dot(preview.accent, preview.accent),
            swatch_dot(preview.accent_secondary, preview.accent_secondary),
        ]
        .spacing(5)
        .align_y(Alignment::Center);

        button(
            container(
                column![
                    row![
                        swatch,
                        space().width(Length::Fill),
                        if active {
                            Element::from(icons::check(16.0, p.accent))
                        } else {
                            space().width(0).into()
                        }
                    ]
                    .align_y(Alignment::Center),
                    text(kind.label()).size(15).font(FONT_SEMIBOLD).color(p.text),
                    text(kind.description()).size(12).color(p.text_muted),
                ]
                .spacing(7),
            )
            .padding(16)
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(if active {
                    Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.14)
                } else {
                    p.surface
                })),
                border: Border {
                    color: if active { p.accent } else { p.border },
                    width: if active { 1.5 } else { 1.0 },
                    radius: 14.0.into(),
                },
                ..Default::default()
            }),
        )
        .padding(0)
        .width(Length::Fill)
        .style(ghost_button(p, 14.0))
        .on_press(Message::SelectTheme(kind))
        .into()
    };

    let theme_cards = column![
        row(AppThemeKind::ALL.iter().take(2).copied().map(make_theme_card))
            .spacing(12)
            .width(Length::Fill),
        row(AppThemeKind::ALL.iter().skip(2).take(2).copied().map(make_theme_card))
            .spacing(12)
            .width(Length::Fill),
    ]
    .spacing(12)
    .width(Length::Fill);

    col = col.push(
        column![
            text("Chủ đề giao diện").size(17).font(FONT_SEMIBOLD).color(p.text),
            theme_cards,
        ]
        .spacing(10),
    );

    // Behavior & Windows switches
    let switches = container(
        column![
            setting_row(
                "Chế độ Bit-Perfect (WASAPI Exclusive)",
                "Xuất thẳng luồng PCM nguyên bản tới DAC/loa, bỏ qua Windows Mixer, EQ và resampling.",
                toggler(state.dsp_store.bit_perfect_enabled)
                    .style(accent_toggler(p))
                    .on_toggle(Message::ToggleBitPerfect)
                    .into(),
                p,
            ),
            hairline_divider(p),
            setting_row(
                "Chế độ chơi game (Gaming Mode)",
                "Tắt nền Aurora GPU shader và tối thiểu hoá tải đồ hoạ khi vừa chơi game vừa nghe nhạc.",
                toggler(state.settings.gaming_mode)
                    .style(accent_toggler(p))
                    .on_toggle(|_| Message::ToggleGamingMode)
                    .into(),
                p,
            ),
            hairline_divider(p),
            setting_row(
                "Thu nhỏ xuống khay hệ thống (System Tray)",
                "Khi bấm nút đóng (X) cửa sổ chính, tiếp tục phát nhạc ẩn trong khay hệ thống.",
                toggler(state.settings.close_to_tray)
                    .style(accent_toggler(p))
                    .on_toggle(Message::ToggleCloseToTray)
                    .into(),
                p,
            ),
            hairline_divider(p),
            setting_row(
                "Phím tắt toàn cục (Global Hotkeys)",
                "Ctrl+Alt+Space (Phát/Dừng), Ctrl+Alt+Trái/Phải (Chuyển bài), Ctrl+Shift+M (Mini-Player).",
                toggler(state.settings.global_hotkeys)
                    .style(accent_toggler(p))
                    .on_toggle(Message::ToggleGlobalHotkeys)
                    .into(),
                p,
            ),
            hairline_divider(p),
            setting_row(
                "Phiên âm Romaji cho lời bài hát Nhật/Hàn/Trung",
                "Hiển thị dòng phiên âm ngay bên dưới lời gốc trong màn hình Đang phát.",
                toggler(state.settings.romaji_enabled)
                    .style(accent_toggler(p))
                    .on_toggle(|_| Message::ToggleRomaji)
                    .into(),
                p,
            ),
        ]
        .spacing(14),
    )
    .padding(20)
    .width(Length::Fill)
    .style(glass_card(p, 16.0));

    col = col.push(switches);

    // Cache & storage bar
    let mb = state.cache_size_bytes as f64 / (1024.0 * 1024.0);
    let cache_card = container(
        column![
            row![
                column![
                    text("Bộ nhớ đệm (Cache)").size(16).font(FONT_SEMIBOLD).color(p.text),
                    text(format!(
                        "Ảnh bìa đã lưu: {:.1} MB / 250 MB · Tự dọn khi vượt giới hạn",
                        mb
                    ))
                    .size(13)
                    .color(p.text_muted),
                ]
                .spacing(3)
                .width(Length::Fill),
                button(text("Xoá bộ nhớ đệm").size(13))
                    .padding([9, 18])
                    .style(ghost_button(p, 999.0))
                    .on_press(Message::ClearCaches),
            ]
            .align_y(Alignment::Center),
            storage_bar(mb, 250.0, p),
        ]
        .spacing(12),
    )
    .padding(20)
    .width(Length::Fill)
    .style(glass_card(p, 16.0));

    col = col.push(cache_card);

    // Keyboard shortcuts reference
    let mut shortcut_col = column![
        text("Phím tắt nhanh").size(16).font(FONT_SEMIBOLD).color(p.text),
    ]
    .spacing(10);

    for (idx, (key, desc)) in SHORTCUTS.iter().enumerate() {
        if idx > 0 {
            shortcut_col = shortcut_col.push(hairline_divider(p));
        }
        shortcut_col = shortcut_col.push(
            row![
                text(*desc).size(13).color(p.text_muted).width(Length::Fill),
                kbd_chip(key, p),
            ]
            .align_y(Alignment::Center)
            .width(Length::Fill),
        );
    }

    col = col.push(
        container(shortcut_col)
            .padding(20)
            .width(Length::Fill)
            .style(glass_card(p, 16.0)),
    );

    col = col.push(
        container(
            row![
                text("BlueSymphony Native Windows · Pure Rust + Iced 0.14")
                    .size(12)
                    .color(p.text_dim),
                space().width(Length::Fill),
                text("v0.1.0 · https://www.bluesymphony.site")
                    .size(12)
                    .color(p.text_dim),
            ]
            .width(Length::Fill),
        )
        .padding([8, 4]),
    );

    col = col.push(space().height(24));
    col.into()
}

fn swatch_dot<'a>(fill: Color, border_col: Color) -> Element<'a, Message> {
    container(space().width(12).height(12))
        .style(move |_| container::Style {
            background: Some(Background::Color(fill)),
            border: Border {
                color: border_col,
                width: 1.0,
                radius: 999.0.into(),
            },
            ..Default::default()
        })
        .into()
}

fn setting_row<'a>(
    title: &'a str,
    desc: &'a str,
    control: Element<'a, Message>,
    p: Palette,
) -> Element<'a, Message> {
    row![
        column![
            text(title).size(14).font(FONT_SEMIBOLD).color(p.text),
            text(desc).size(12).color(p.text_muted),
        ]
        .spacing(2)
        .width(Length::Fill),
        control,
    ]
    .spacing(16)
    .align_y(Alignment::Center)
    .into()
}
