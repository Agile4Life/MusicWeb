use iced::widget::{button, column, container, mouse_area, row, space, text, text_input};
use iced::{Alignment, Background, Border, Color, Element, Length};

use crate::icons;
use crate::state::{AppState, AuthModalMode, AuthModalState, Message};
use crate::theme::{Palette, elevated_panel, ghost_button, glass_input, pill_button, primary_button};

pub fn view<'a>(
    state: &'a AppState,
    modal: &'a AuthModalState,
    p: Palette,
) -> Element<'a, Message> {
    let is_reg = modal.mode == AuthModalMode::Register;
    let configured = state.config.is_auth_configured();

    let header = row![
        column![
            text(if is_reg {
                "Tạo tài khoản BlueSymphony"
            } else {
                "Đăng nhập BlueSymphony"
            })
            .size(20)
            .color(p.text),
            text("Đồng bộ Yêu thích, Lịch sử & Playlist với www.bluesymphony.site")
                .size(12)
                .color(p.text_muted),
        ]
        .spacing(3),
        space().width(Length::Fill),
        button(icons::close(16.0, p.text_muted))
            .padding(6)
            .style(ghost_button(p, 8.0))
            .on_press(Message::CloseAuthModal),
    ]
    .align_y(Alignment::Center);

    let mode_tabs = row![
        button(text("Đăng nhập").size(13))
            .padding([7, 16])
            .style(pill_button(p, !is_reg))
            .on_press(Message::AuthModeChanged(AuthModalMode::SignIn)),
        button(text("Đăng ký").size(13))
            .padding([7, 16])
            .style(pill_button(p, is_reg))
            .on_press(Message::AuthModeChanged(AuthModalMode::Register)),
    ]
    .spacing(8);

    let mut form = column![header, mode_tabs].spacing(14);

    if !configured {
        form = form.push(
            container(
                column![
                    text("Chưa cấu hình đăng nhập (thiếu Supabase URL/Key).")
                        .size(13)
                        .color(p.accent),
                    text("Chạy scripts/make-secrets.ps1 hoặc đặt biến môi trường NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY (hoặc file config/secrets.toml).")
                        .size(12)
                        .color(p.text_muted),
                ]
                .spacing(4),
            )
            .padding(12)
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(Color::from_rgba(
                    p.accent.r,
                    p.accent.g,
                    p.accent.b,
                    0.12,
                ))),
                border: Border {
                    color: Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.35),
                    width: 1.0,
                    radius: 10.0.into(),
                },
                ..Default::default()
            }),
        );
    }

    form = form.push(
        column![
            text(if is_reg {
                "Tên tài khoản (3–30 ký tự chữ/số/_)"
            } else {
                "Tên tài khoản hoặc Email"
            })
            .size(12)
            .color(p.text_muted),
            text_input("VD: phongtct hoặc email@domain.com", &modal.account)
                .on_input(Message::AuthAccountChanged)
                .on_submit(Message::SubmitAuth)
                .padding([10, 12])
                .size(14)
                .style(glass_input(p)),
        ]
        .spacing(6),
    );

    form = form.push(
        column![
            text("Mật khẩu").size(12).color(p.text_muted),
            text_input("Nhập mật khẩu…", &modal.password)
                .secure(true)
                .on_input(Message::AuthPasswordChanged)
                .on_submit(Message::SubmitAuth)
                .padding([10, 12])
                .size(14)
                .style(glass_input(p)),
        ]
        .spacing(6),
    );

    if is_reg {
        form = form.push(
            column![
                text("Gmail liên kết (tuỳ chọn)").size(12).color(p.text_muted),
                text_input("tenban@gmail.com", &modal.real_email)
                    .on_input(Message::AuthRealEmailChanged)
                    .on_submit(Message::SubmitAuth)
                    .padding([10, 12])
                    .size(14)
                    .style(glass_input(p)),
            ]
            .spacing(6),
        );
    }

    if let Some(ref err) = modal.error {
        form = form.push(
            container(text(err.clone()).size(13).color(p.danger))
                .padding([10, 12])
                .width(Length::Fill)
                .style(move |_| container::Style {
                    background: Some(Background::Color(Color::from_rgba(
                        p.danger.r,
                        p.danger.g,
                        p.danger.b,
                        0.15,
                    ))),
                    border: Border {
                        color: Color::from_rgba(p.danger.r, p.danger.g, p.danger.b, 0.35),
                        width: 1.0,
                        radius: 10.0.into(),
                    },
                    ..Default::default()
                }),
        );
    }

    let submit_label = if modal.loading {
        "Đang xử lý…"
    } else if is_reg {
        "Tạo tài khoản"
    } else {
        "Đăng nhập"
    };

    let can_submit = !modal.loading
        && !modal.account.trim().is_empty()
        && !modal.password.is_empty();

    form = form.push(
        row![
            space().width(Length::Fill),
            button(text("Huỷ").size(13).color(p.text_muted))
                .padding([10, 18])
                .style(ghost_button(p, 999.0))
                .on_press(Message::CloseAuthModal),
            button(
                text(submit_label)
                    .size(14)
                    .color(p.accent_fg),
            )
            .padding([10, 24])
            .style(primary_button(p, 999.0))
            .on_press_maybe(can_submit.then_some(Message::SubmitAuth)),
        ]
        .spacing(10)
        .align_y(Alignment::Center),
    );

    let dialog = mouse_area(
        container(form)
            .width(440)
            .padding(24)
            .style(elevated_panel(p, 20.0)),
    )
    .on_press(Message::SystemTick); // swallow clicks inside dialog

    mouse_area(
        container(dialog)
            .width(Length::Fill)
            .height(Length::Fill)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .style(|_| container::Style {
                background: Some(Background::Color(Color::from_rgba(0.0, 0.0, 0.0, 0.65))),
                ..Default::default()
            }),
    )
    .on_press(Message::CloseAuthModal)
    .into()
}

