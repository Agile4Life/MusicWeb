use iced::widget::{button, column, container, row, space, text};
use iced::{Alignment, Background, Border, Color, Element, Length, Shadow, Vector};

use crate::icons;
use crate::state::{Message, ToastState};
use crate::theme::{FONT_MEDIUM, Palette, ghost_button};
use crate::widgets::motion::slide_box;

pub fn toast_overlay<'a>(toast: &'a ToastState, anim: f32, p: Palette) -> Element<'a, Message> {
    let t = anim.clamp(0.0, 1.0);
    let accent = if toast.is_error { p.danger } else { p.accent };

    let badge = container(if toast.is_error {
        icons::close(11.5, accent)
    } else {
        icons::check(11.5, accent)
    })
    .width(22)
    .height(22)
    .align_x(Alignment::Center)
    .align_y(Alignment::Center)
    .style(move |_| container::Style {
        background: Some(Background::Color(Color::from_rgba(
            accent.r,
            accent.g,
            accent.b,
            0.18 * t,
        ))),
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: 999.0.into(),
        },
        ..Default::default()
    });

    let pill = container(
        row![
            badge,
            text(toast.message.clone())
                .size(13)
                .font(FONT_MEDIUM)
                .color(Color::from_rgba(p.text.r, p.text.g, p.text.b, t)),
            button(icons::close(13.5, p.text_muted))
                .padding(4)
                .style(ghost_button(p, 6.0))
                .on_press(Message::DismissToast(toast.seq)),
        ]
        .spacing(10)
        .align_y(Alignment::Center),
    )
    .padding([9, 14])
    .style(move |_| container::Style {
        background: Some(Background::Color(Color::from_rgba8(44, 44, 46, 0.96 * t))),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.14 * t),
            width: 1.0,
            radius: 10.0.into(),
        },
        shadow: Shadow {
            color: Color::from_rgba(0.0, 0.0, 0.0, 0.42 * t),
            offset: Vector::new(0.0, 8.0),
            blur_radius: 24.0,
        },
        text_color: Some(Color::from_rgba(p.text.r, p.text.g, p.text.b, t)),
        snap: false,
    });

    let animated_pill = slide_box(Vector::new(0.0, (1.0 - t) * -28.0), pill);

    column![
        space().height(72),
        row![space().width(Length::Fill), animated_pill]
            .padding([0, 24])
            .width(Length::Fill),
    ]
    .width(Length::Fill)
    .into()
}
