use iced::font::{Family, Stretch, Style as FontStyle, Weight};
use iced::widget::{button, container, scrollable, slider, text_input, toggler};
use iced::{Background, Border, Color, Font, Shadow, Theme, Vector};
use serde::{Deserialize, Serialize};

pub const FONT_BOLD: Font = Font {
    family: Family::SansSerif,
    weight: Weight::Bold,
    stretch: Stretch::Normal,
    style: FontStyle::Normal,
};

pub const FONT_SEMIBOLD: Font = Font {
    family: Family::SansSerif,
    weight: Weight::Semibold,
    stretch: Stretch::Normal,
    style: FontStyle::Normal,
};

pub const FONT_MEDIUM: Font = Font {
    family: Family::SansSerif,
    weight: Weight::Medium,
    stretch: Stretch::Normal,
    style: FontStyle::Normal,
};

/// Unicode-safe single-line truncation with ellipsis.
pub fn truncate_str(s: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let count = s.chars().count();
    if count <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AppThemeKind {
    #[default]
    AppleDark,
    AuroraGlass,
    MidnightDark,
    VinylEditorial,
}

impl AppThemeKind {
    pub const ALL: [Self; 4] = [
        Self::AppleDark,
        Self::AuroraGlass,
        Self::MidnightDark,
        Self::VinylEditorial,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::AppleDark => "Apple Music Dark",
            Self::AuroraGlass => "Aurora Glass",
            Self::MidnightDark => "Midnight Dark",
            Self::VinylEditorial => "Vinyl Editorial",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::AppleDark => "Phong cách Apple Music chuẩn: nền than sâu, nhấn đỏ hồng #FA233B & thanh phát trên",
            Self::AuroraGlass => "Hiệu ứng cực quang lỏng đa sắc kết hợp kính mờ hiện đại",
            Self::MidnightDark => "Tối sâu OLED tương phản cao, tập trung vào âm nhạc",
            Self::VinylEditorial => "Tông ấm cổ điển lấy cảm hứng từ đĩa than và tạp chí",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Palette {
    pub bg: Color,
    pub surface: Color,
    pub surface_elevated: Color,
    pub surface_hover: Color,
    pub sidebar_bg: Color,
    pub player_bg: Color,
    pub border: Color,
    pub border_strong: Color,
    pub text: Color,
    pub text_muted: Color,
    pub text_dim: Color,
    pub accent: Color,
    pub accent_secondary: Color,
    pub accent_fg: Color,
    pub heart: Color,
    pub danger: Color,
    pub success: Color,
}

pub fn palette(kind: AppThemeKind, gaming_mode: bool) -> Palette {
    let alpha_card = if gaming_mode { 0.96 } else { 0.72 };
    let alpha_elev = if gaming_mode { 0.98 } else { 0.84 };
    let alpha_bar = if gaming_mode { 0.97 } else { 0.86 };

    match kind {
        AppThemeKind::AppleDark => Palette {
            bg: Color::from_rgb8(26, 26, 26),
            surface: Color::from_rgba8(38, 38, 40, if gaming_mode { 0.99 } else { 0.96 }),
            surface_elevated: Color::from_rgba8(44, 44, 46, if gaming_mode { 0.99 } else { 0.98 }),
            surface_hover: Color::from_rgba8(56, 56, 60, 0.95),
            sidebar_bg: Color::from_rgb8(32, 32, 32),
            player_bg: Color::from_rgb8(31, 31, 31),
            border: Color::from_rgba(1.0, 1.0, 1.0, 0.065),
            border_strong: Color::from_rgba(1.0, 1.0, 1.0, 0.11),
            text: Color::from_rgb8(255, 255, 255),
            text_muted: Color::from_rgb8(152, 152, 157),
            text_dim: Color::from_rgb8(99, 99, 102),
            accent: Color::from_rgb8(250, 35, 59),
            accent_secondary: Color::from_rgb8(251, 92, 116),
            accent_fg: Color::WHITE,
            heart: Color::from_rgb8(250, 35, 59),
            danger: Color::from_rgb8(255, 69, 58),
            success: Color::from_rgb8(48, 209, 88),
        },
        AppThemeKind::AuroraGlass => Palette {
            bg: Color::from_rgb8(7, 10, 18),
            surface: Color::from_rgba8(18, 24, 40, alpha_card),
            surface_elevated: Color::from_rgba8(26, 35, 58, alpha_elev),
            surface_hover: Color::from_rgba8(44, 58, 92, 0.80),
            sidebar_bg: Color::from_rgba8(11, 15, 27, alpha_bar),
            player_bg: Color::from_rgba8(13, 18, 32, 0.94),
            border: Color::from_rgba(1.0, 1.0, 1.0, 0.11),
            border_strong: Color::from_rgba(1.0, 1.0, 1.0, 0.20),
            text: Color::from_rgb8(245, 248, 255),
            text_muted: Color::from_rgb8(172, 183, 212),
            text_dim: Color::from_rgb8(114, 126, 158),
            accent: Color::from_rgb8(56, 189, 248),
            accent_secondary: Color::from_rgb8(236, 72, 153),
            accent_fg: Color::from_rgb8(8, 12, 20),
            heart: Color::from_rgb8(244, 63, 94),
            danger: Color::from_rgb8(239, 68, 68),
            success: Color::from_rgb8(34, 197, 94),
        },
        AppThemeKind::MidnightDark => Palette {
            bg: Color::from_rgb8(9, 9, 13),
            surface: Color::from_rgba8(19, 20, 26, alpha_card),
            surface_elevated: Color::from_rgba8(28, 29, 38, alpha_elev),
            surface_hover: Color::from_rgba8(45, 47, 60, 0.84),
            sidebar_bg: Color::from_rgba8(12, 12, 17, alpha_bar),
            player_bg: Color::from_rgba8(15, 16, 22, 0.95),
            border: Color::from_rgba(1.0, 1.0, 1.0, 0.09),
            border_strong: Color::from_rgba(1.0, 1.0, 1.0, 0.18),
            text: Color::from_rgb8(245, 245, 247),
            text_muted: Color::from_rgb8(165, 165, 176),
            text_dim: Color::from_rgb8(110, 110, 124),
            accent: Color::from_rgb8(96, 165, 250),
            accent_secondary: Color::from_rgb8(167, 139, 250),
            accent_fg: Color::from_rgb8(8, 12, 20),
            heart: Color::from_rgb8(244, 63, 94),
            danger: Color::from_rgb8(239, 68, 68),
            success: Color::from_rgb8(34, 197, 94),
        },
        AppThemeKind::VinylEditorial => Palette {
            bg: Color::from_rgb8(16, 13, 12),
            surface: Color::from_rgba8(26, 22, 20, alpha_card),
            surface_elevated: Color::from_rgba8(38, 32, 28, alpha_elev),
            surface_hover: Color::from_rgba8(54, 45, 39, 0.86),
            sidebar_bg: Color::from_rgba8(19, 16, 14, alpha_bar),
            player_bg: Color::from_rgba8(21, 17, 15, 0.95),
            border: Color::from_rgba(1.0, 0.94, 0.86, 0.11),
            border_strong: Color::from_rgba(1.0, 0.94, 0.86, 0.22),
            text: Color::from_rgb8(248, 242, 234),
            text_muted: Color::from_rgb8(196, 181, 166),
            text_dim: Color::from_rgb8(142, 127, 114),
            accent: Color::from_rgb8(251, 191, 36),
            accent_secondary: Color::from_rgb8(249, 115, 22),
            accent_fg: Color::from_rgb8(8, 12, 20),
            heart: Color::from_rgb8(239, 68, 68),
            danger: Color::from_rgb8(239, 68, 68),
            success: Color::from_rgb8(74, 222, 128),
        },
    }
}

pub fn iced_theme(kind: AppThemeKind, gaming_mode: bool) -> Theme {
    let p = palette(kind, gaming_mode);
    Theme::custom(
        kind.label().to_string(),
        iced::theme::Palette {
            background: p.bg,
            text: p.text,
            primary: p.accent,
            success: p.success,
            warning: Color::from_rgb8(245, 158, 11),
            danger: p.danger,
        },
    )
}

pub fn glass_card(p: Palette, radius: f32) -> impl Fn(&Theme) -> container::Style {
    move |_| container::Style {
        background: Some(Background::Color(p.surface)),
        border: Border {
            color: p.border,
            width: 1.0,
            radius: radius.into(),
        },
        shadow: Shadow {
            color: Color::from_rgba(0.0, 0.0, 0.0, 0.30),
            offset: Vector::new(0.0, 8.0),
            blur_radius: 22.0,
        },
        text_color: Some(p.text),
        snap: false,
    }
}

pub fn elevated_panel(p: Palette, radius: f32) -> impl Fn(&Theme) -> container::Style {
    move |_| container::Style {
        background: Some(Background::Color(p.surface_elevated)),
        border: Border {
            color: p.border_strong,
            width: 1.0,
            radius: radius.into(),
        },
        shadow: Shadow {
            color: Color::from_rgba(0.0, 0.0, 0.0, 0.45),
            offset: Vector::new(0.0, 14.0),
            blur_radius: 32.0,
        },
        text_color: Some(p.text),
        snap: false,
    }
}

pub fn sidebar_surface(p: Palette) -> impl Fn(&Theme) -> container::Style {
    move |_| container::Style {
        background: Some(Background::Color(p.sidebar_bg)),
        border: Border::default(),
        text_color: Some(p.text),
        ..Default::default()
    }
}

pub fn player_bar_surface(p: Palette) -> impl Fn(&Theme) -> container::Style {
    move |_| container::Style {
        background: Some(Background::Color(p.player_bg)),
        border: Border::default(),
        shadow: Shadow::default(),
        text_color: Some(p.text),
        snap: false,
    }
}

pub fn nav_button(p: Palette, active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = if active {
            Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.068)))
        } else if matches!(status, button::Status::Hovered | button::Status::Pressed) {
            Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.045)))
        } else {
            None
        };
        button::Style {
            background: bg,
            text_color: if active { p.text } else { p.text_muted },
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 5.0.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn apple_pill_action(p: Palette) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = match status {
            button::Status::Hovered => Color::from_rgb8(58, 58, 61),
            button::Status::Pressed => Color::from_rgb8(68, 68, 72),
            _ => Color::from_rgb8(44, 44, 46),
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: p.text,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 999.0.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn ghost_button(p: Palette, radius: f32) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = match status {
            button::Status::Hovered => Some(Background::Color(p.surface_hover)),
            button::Status::Pressed => Some(Background::Color(p.surface_elevated)),
            _ => None,
        };
        button::Style {
            background: bg,
            text_color: p.text,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: radius.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn pill_button(p: Palette, active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = if active {
            p.accent
        } else if matches!(status, button::Status::Hovered) {
            Color::from_rgba(1.0, 1.0, 1.0, 0.13)
        } else {
            Color::from_rgba(1.0, 1.0, 1.0, 0.07)
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: if active { p.accent_fg } else { p.text },
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 7.0.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn secondary_button(p: Palette, radius: f32) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = match status {
            button::Status::Hovered => Color::from_rgba(1.0, 1.0, 1.0, 0.14),
            button::Status::Pressed => Color::from_rgba(1.0, 1.0, 1.0, 0.19),
            _ => Color::from_rgba(1.0, 1.0, 1.0, 0.09),
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: p.accent,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: radius.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn surface_tile_button(p: Palette, radius: f32) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = match status {
            button::Status::Hovered => p.surface_hover,
            button::Status::Pressed => p.surface_elevated,
            _ => p.surface,
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: p.text,
            border: Border {
                color: p.border,
                width: 1.0,
                radius: radius.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn primary_button(p: Palette, radius: f32) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = match status {
            button::Status::Hovered => Color::from_rgb(
                (p.accent.r + 0.08).min(1.0),
                (p.accent.g + 0.08).min(1.0),
                (p.accent.b + 0.08).min(1.0),
            ),
            button::Status::Pressed => Color::from_rgb(
                (p.accent.r - 0.08).max(0.0),
                (p.accent.g - 0.08).max(0.0),
                (p.accent.b - 0.08).max(0.0),
            ),
            button::Status::Disabled => p.surface_elevated,
            _ => p.accent,
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: if matches!(status, button::Status::Disabled) {
                p.text_dim
            } else {
                p.accent_fg
            },
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: radius.into(),
            },
            shadow: Shadow {
                color: Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.24),
                offset: Vector::new(0.0, 3.0),
                blur_radius: 12.0,
            },
            snap: false,
        }
    }
}

pub fn danger_button(p: Palette, radius: f32) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let alpha = if matches!(status, button::Status::Hovered) {
            0.28
        } else {
            0.16
        };
        button::Style {
            background: Some(Background::Color(Color::from_rgba(
                p.danger.r,
                p.danger.g,
                p.danger.b,
                alpha,
            ))),
            text_color: p.danger,
            border: Border {
                color: Color::from_rgba(p.danger.r, p.danger.g, p.danger.b, 0.40),
                width: 1.0,
                radius: radius.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn glass_input(p: Palette) -> impl Fn(&Theme, text_input::Status) -> text_input::Style {
    move |_, status| {
        let border_color = match status {
            text_input::Status::Focused { .. } => p.accent,
            text_input::Status::Hovered => p.border_strong,
            _ => p.border,
        };
        text_input::Style {
            background: Background::Color(p.surface_elevated),
            border: Border {
                color: border_color,
                width: 1.0,
                radius: 10.0.into(),
            },
            icon: p.text_muted,
            placeholder: p.text_dim,
            value: p.text,
            selection: Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.35),
        }
    }
}

pub fn borderless_input(p: Palette) -> impl Fn(&Theme, text_input::Status) -> text_input::Style {
    move |_, _| text_input::Style {
        background: Background::Color(Color::TRANSPARENT),
        border: Border::default(),
        icon: p.text_muted,
        placeholder: p.text_dim,
        value: p.text,
        selection: Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.35),
    }
}

pub fn apple_v_scrollbar() -> scrollable::Scrollbar {
    scrollable::Scrollbar::new()
        .width(4)
        .scroller_width(4)
        .margin(2)
}

pub fn subtle_scrollable(
    p: Palette,
) -> impl Fn(&Theme, scrollable::Status) -> scrollable::Style {
    move |_, status| {
        let hovered = matches!(
            status,
            scrollable::Status::Hovered { .. } | scrollable::Status::Dragged { .. }
        );
        let scroller_color = if hovered {
            Color::from_rgba(1.0, 1.0, 1.0, 0.34)
        } else {
            Color::from_rgba(1.0, 1.0, 1.0, 0.14)
        };
        let rail = scrollable::Rail {
            background: None,
            border: Border::default(),
            scroller: scrollable::Scroller {
                background: Background::Color(scroller_color),
                border: Border {
                    radius: 999.0.into(),
                    ..Default::default()
                },
            },
        };
        scrollable::Style {
            container: container::Style::default(),
            vertical_rail: rail,
            horizontal_rail: rail,
            gap: None,
            auto_scroll: scrollable::AutoScroll {
                background: Background::Color(p.surface_elevated),
                border: Border {
                    color: p.border,
                    width: 1.0,
                    radius: 999.0.into(),
                },
                shadow: Shadow::default(),
                icon: p.text,
            },
        }
    }
}

pub fn card_button(_p: Palette, _radius: f32) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, _status| button::Style {
        background: None,
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: 10.0.into(),
        },
        shadow: Shadow::default(),
        snap: false,
    }
}

pub fn lyric_line_button(p: Palette) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = match status {
            button::Status::Hovered => Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.06))),
            button::Status::Pressed => Some(Background::Color(Color::from_rgba(
                p.accent.r,
                p.accent.g,
                p.accent.b,
                0.12,
            ))),
            _ => None,
        };
        button::Style {
            background: bg,
            text_color: p.text,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 14.0.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn accent_slider(p: Palette) -> impl Fn(&Theme, slider::Status) -> slider::Style {
    move |_, status| {
        let active_color = match status {
            slider::Status::Hovered | slider::Status::Dragged => p.accent,
            slider::Status::Active => Color::from_rgba(1.0, 1.0, 1.0, 0.72),
        };
        let handle_radius = match status {
            slider::Status::Hovered | slider::Status::Dragged => 5.5,
            slider::Status::Active => 4.5,
        };
        slider::Style {
            rail: slider::Rail {
                backgrounds: (
                    Background::Color(active_color),
                    Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.18)),
                ),
                width: 3.0,
                border: Border {
                    color: Color::TRANSPARENT,
                    width: 0.0,
                    radius: 2.0.into(),
                },
            },
            handle: slider::Handle {
                shape: slider::HandleShape::Circle {
                    radius: handle_radius,
                },
                background: Background::Color(p.text),
                border_width: 0.0,
                border_color: Color::TRANSPARENT,
            },
        }
    }
}

pub fn track_row_button(
    p: Palette,
    is_current: bool,
    striped: bool,
) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let bg = match status {
            button::Status::Pressed => Color::from_rgba(1.0, 1.0, 1.0, 0.12),
            button::Status::Hovered => Color::from_rgba(1.0, 1.0, 1.0, 0.075),
            _ if is_current => Color::from_rgba(1.0, 1.0, 1.0, 0.10),
            _ if striped => Color::from_rgba(1.0, 1.0, 1.0, 0.028),
            _ => Color::TRANSPARENT,
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: p.text,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 6.0.into(),
            },
            shadow: Shadow::default(),
            snap: false,
        }
    }
}

pub fn accent_toggler(p: Palette) -> impl Fn(&Theme, toggler::Status) -> toggler::Style {
    move |_, status| {
        let (toggled, hovered, disabled) = match status {
            toggler::Status::Active { is_toggled } => (is_toggled, false, false),
            toggler::Status::Hovered { is_toggled } => (is_toggled, true, false),
            toggler::Status::Disabled { is_toggled } => (is_toggled, false, true),
        };

        let bg = if disabled {
            p.surface
        } else if toggled {
            if hovered {
                Color::from_rgb(
                    (p.accent.r + 0.08).min(1.0),
                    (p.accent.g + 0.08).min(1.0),
                    (p.accent.b + 0.08).min(1.0),
                )
            } else {
                p.accent
            }
        } else if hovered {
            p.surface_hover
        } else {
            p.surface_elevated
        };

        let fg = if toggled {
            Color::WHITE
        } else if hovered {
            p.text
        } else {
            p.text_muted
        };

        toggler::Style {
            background: Background::Color(bg),
            background_border_width: if toggled { 0.0 } else { 1.0 },
            background_border_color: if toggled {
                Color::TRANSPARENT
            } else {
                p.border_strong
            },
            foreground: Background::Color(fg),
            foreground_border_width: 0.0,
            foreground_border_color: Color::TRANSPARENT,
            text_color: Some(p.text),
            border_radius: None,
            padding_ratio: 0.14,
        }
    }
}

