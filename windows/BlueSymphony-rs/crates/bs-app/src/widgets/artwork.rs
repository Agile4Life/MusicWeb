use std::sync::OnceLock;

use iced::border;
use iced::widget::{container, image};
use iced::{Alignment, Background, Border, Color, ContentFit, Element, Gradient, Length, Radians, Shadow, Vector};

use crate::icons;
use crate::image_cache::ImageCache;
use crate::state::Message;
use crate::theme::Palette;

fn app_logo_handle() -> &'static image::Handle {
    static LOGO: OnceLock<image::Handle> = OnceLock::new();
    LOGO.get_or_init(|| {
        if let Ok(img) = ::image::load_from_memory(crate::app::APP_ICON_PNG) {
            let rgba = img
                .resize_exact(128, 128, ::image::imageops::FilterType::Lanczos3)
                .to_rgba8();
            let (w, h) = rgba.dimensions();
            image::Handle::from_rgba(w, h, rgba.into_raw())
        } else {
            image::Handle::from_bytes(crate::app::APP_ICON_PNG)
        }
    })
}

pub fn app_logo<'a>(size: f32, radius: f32) -> Element<'a, Message> {
    container(
        image(app_logo_handle().clone())
            .width(size)
            .height(size)
            .content_fit(ContentFit::Cover)
            .border_radius(border::radius(radius)),
    )
    .width(size)
    .height(size)
    .style(move |_| container::Style {
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.14),
            width: 1.0,
            radius: radius.into(),
        },
        ..Default::default()
    })
    .into()
}

pub fn artwork<'a>(
    cache: &'a ImageCache,
    url: Option<&str>,
    size: f32,
    radius: f32,
    palette: Palette,
) -> Element<'a, Message> {
    artwork_inner(cache, url, size, radius, None, 0.0, palette)
}

pub fn artwork_ambient<'a>(
    cache: &'a ImageCache,
    url: Option<&str>,
    size: f32,
    radius: f32,
    glow_color: Color,
    pulse: f32,
    palette: Palette,
) -> Element<'a, Message> {
    artwork_inner(cache, url, size, radius, Some(glow_color), pulse, palette)
}

fn artwork_inner<'a>(
    cache: &'a ImageCache,
    url: Option<&str>,
    size: f32,
    radius: f32,
    glow_color: Option<Color>,
    pulse: f32,
    palette: Palette,
) -> Element<'a, Message> {
    let shadow = if let Some(glow) = glow_color {
        let p_clamped = pulse.clamp(0.0, 1.0);
        Shadow {
            color: Color::from_rgba(glow.r, glow.g, glow.b, 0.24 + p_clamped * 0.14),
            offset: Vector::new(0.0, 12.0),
            blur_radius: 28.0 + p_clamped * 10.0,
        }
    } else {
        Shadow {
            color: Color::from_rgba(0.0, 0.0, 0.0, 0.34),
            offset: Vector::new(0.0, 6.0),
            blur_radius: 16.0,
        }
    };
    let border_color = if glow_color.is_some() {
        Color::from_rgba(1.0, 1.0, 1.0, 0.18)
    } else {
        Color::from_rgba(1.0, 1.0, 1.0, 0.10)
    };

    if let Some(u) = url.filter(|s| !s.is_empty()) {
        if let Some(cached) = cache.get(u) {
            return container(
                image(cached.handle.clone())
                    .width(size)
                    .height(size)
                    .content_fit(ContentFit::Cover)
                    .border_radius(border::radius(radius)),
            )
            .width(size)
            .height(size)
            .style(move |_| container::Style {
                border: Border {
                    color: border_color,
                    width: 1.0,
                    radius: radius.into(),
                },
                shadow,
                ..Default::default()
            })
            .into();
        }
    }

    let grad = Gradient::Linear(
        iced::gradient::Linear::new(Radians(0.75))
            .add_stop(0.0, Color::from_rgb8(46, 46, 50))
            .add_stop(1.0, Color::from_rgb8(34, 34, 37)),
    );

    container(icons::music_note(
        (size * 0.36).clamp(14.0, 38.0),
        palette.text_dim,
    ))
    .width(size)
    .height(size)
    .align_x(Alignment::Center)
    .align_y(Alignment::Center)
    .style(move |_| container::Style {
        background: Some(Background::Gradient(grad)),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: radius.into(),
        },
        shadow,
        ..Default::default()
    })
    .into()
}

pub fn artwork_lcd<'a>(
    cache: &'a ImageCache,
    url: Option<&str>,
    size: f32,
    left_radius: f32,
    palette: Palette,
) -> Element<'a, Message> {
    let radius = border::Radius {
        top_left: left_radius,
        top_right: 0.0,
        bottom_right: 0.0,
        bottom_left: left_radius,
    };
    if let Some(u) = url.filter(|s| !s.is_empty()) {
        if let Some(cached) = cache.get(u) {
            return image(cached.handle.clone())
                .width(size)
                .height(size)
                .content_fit(ContentFit::Cover)
                .border_radius(radius)
                .into();
        }
    }

    let grad = Gradient::Linear(
        iced::gradient::Linear::new(Radians(0.75))
            .add_stop(0.0, Color::from_rgb8(46, 46, 50))
            .add_stop(1.0, Color::from_rgb8(34, 34, 37)),
    );

    container(icons::music_note(
        (size * 0.38).clamp(14.0, 22.0),
        palette.text_dim,
    ))
    .width(size)
    .height(size)
    .align_x(Alignment::Center)
    .align_y(Alignment::Center)
    .style(move |_| container::Style {
        background: Some(Background::Gradient(grad)),
        border: Border {
            radius,
            ..Default::default()
        },
        ..Default::default()
    })
    .into()
}

pub fn artwork_fill<'a>(
    cache: &'a ImageCache,
    url: Option<&str>,
    radius: f32,
    palette: Palette,
) -> Element<'a, Message> {
    if let Some(u) = url.filter(|s| !s.is_empty()) {
        if let Some(cached) = cache.get(u) {
            return image(cached.handle.clone())
                .width(Length::Fill)
                .height(Length::Fill)
                .content_fit(ContentFit::Cover)
                .border_radius(border::radius(radius))
                .into();
        }
    }

    let grad = Gradient::Linear(
        iced::gradient::Linear::new(Radians(0.75))
            .add_stop(0.0, Color::from_rgb8(46, 46, 50))
            .add_stop(1.0, Color::from_rgb8(34, 34, 37)),
    );

    container(icons::music_note(36.0, palette.text_dim))
        .width(Length::Fill)
        .height(Length::Fill)
        .align_x(Alignment::Center)
        .align_y(Alignment::Center)
        .style(move |_| container::Style {
            background: Some(Background::Gradient(grad)),
            border: Border {
                radius: radius.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

pub fn loading_banner<'a>(text_label: &'a str, palette: Palette) -> Element<'a, Message> {
    container(
        iced::widget::text(text_label)
            .size(14)
            .color(palette.text_muted),
    )
    .width(Length::Fill)
    .padding(24)
    .align_x(Alignment::Center)
    .into()
}

