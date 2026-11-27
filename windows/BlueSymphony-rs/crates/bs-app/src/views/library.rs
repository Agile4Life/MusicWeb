use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Background, Border, Color, Element, Length};

use crate::icons;
use crate::router::Route;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_SEMIBOLD, Palette, glass_card, primary_button, surface_tile_button,
};
use crate::widgets::micro::hairline_divider;

pub fn signed_out_prompt<'a>(title: &'a str, p: Palette) -> Element<'a, Message> {
    container(
        column![
            icons::user(32.0, p.accent),
            text(title).size(18).font(FONT_BOLD).color(p.text),
            text("Đăng nhập tài khoản BlueSymphony để đồng bộ danh sách yêu thích, lịch sử nghe và playlist cá nhân.")
                .size(13)
                .color(p.text_muted),
            button(
                text("Đăng nhập ngay")
                    .size(14)
                    .font(FONT_SEMIBOLD)
                    .color(p.accent_fg),
            )
            .padding([9, 22])
            .style(primary_button(p, 7.0))
            .on_press(Message::StartWebLogin),
        ]
        .spacing(12)
        .width(Length::Fill)
        .align_x(Alignment::Center),
    )
    .padding(40)
    .width(Length::Fill)
    .align_x(Alignment::Center)
    .style(glass_card(p, 16.0))
    .into()
}

pub fn view<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    let mut col = column![
        column![
            text("Thư viện")
                .size(32)
                .font(FONT_BOLD)
                .color(p.text),
            hairline_divider(p),
        ]
        .spacing(12),
    ]
    .spacing(20)
    .width(Length::Fill);

    if !state.session_snap.is_signed_in() {
        col = col.push(signed_out_prompt("Bạn chưa đăng nhập", p));
        return col.into();
    }

    let cards = row![
        lib_shortcut(
            icons::list_music(22.0, p.accent),
            p.accent,
            "Playlists",
            &format!("{} playlist", state.playlists.len()),
            Route::Playlists,
            p,
        ),
        lib_shortcut(
            icons::heart_filled(22.0, p.heart),
            p.heart,
            "Yêu thích",
            &format!("{} bài hát", state.session_snap.favorite_ids.len()),
            Route::Favorites,
            p,
        ),
        lib_shortcut(
            icons::history(22.0, p.accent),
            p.accent,
            "Lịch sử nghe",
            "Theo ngày",
            Route::History,
            p,
        ),
        lib_shortcut(
            icons::flame(22.0, p.accent_secondary),
            p.accent_secondary,
            "Top của bạn",
            "Thống kê lượt nghe",
            Route::TopTracks,
            p,
        ),
    ]
    .spacing(14)
    .width(Length::Fill);

    col = col.push(cards);
    col = col.push(space().height(20));
    col.into()
}

fn lib_shortcut<'a>(
    icon: impl Into<Element<'a, Message>>,
    tint: Color,
    title: &'a str,
    subtitle: &str,
    route: Route,
    p: Palette,
) -> Element<'a, Message> {
    let icon_badge = container(icon.into())
        .width(44)
        .height(44)
        .align_x(Alignment::Center)
        .align_y(Alignment::Center)
        .style(move |_| container::Style {
            background: Some(Background::Color(Color::from_rgba(
                tint.r, tint.g, tint.b, 0.16,
            ))),
            border: Border {
                color: Color::from_rgba(tint.r, tint.g, tint.b, 0.34),
                width: 1.0,
                radius: 12.0.into(),
            },
            ..Default::default()
        });

    button(
        column![
            row![
                icon_badge,
                space().width(Length::Fill),
                icons::chevron_right(16.0, p.text_dim),
            ]
            .align_y(Alignment::Center),
            column![
                text(title).size(16).font(FONT_SEMIBOLD).color(p.text),
                text(subtitle.to_string()).size(12).color(p.text_muted),
            ]
            .spacing(2),
        ]
        .spacing(14)
        .width(Length::Fill),
    )
    .padding(18)
    .width(Length::Fill)
    .style(surface_tile_button(p, 10.0))
    .on_press(Message::Navigate(route))
    .into()
}
