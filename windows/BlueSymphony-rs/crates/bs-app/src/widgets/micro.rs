use iced::alignment;
use iced::widget::canvas::{self, Canvas, Frame, Geometry, Path};
use iced::widget::{column, container, row, space, text};
use iced::{Background, Border, Color, Element, Length, Point, Rectangle, Renderer, Size, Theme};

use crate::state::Message;
use crate::theme::{FONT_BOLD, FONT_MEDIUM, FONT_SEMIBOLD, Palette};

#[derive(Debug)]
struct EqBarsProgram {
    time: f32,
    playing: bool,
    color: Color,
}

impl canvas::Program<Message> for EqBarsProgram {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: iced::mouse::Cursor,
    ) -> Vec<Geometry<Renderer>> {
        let mut frame = Frame::new(renderer, bounds.size());
        let w = bounds.width.max(4.0);
        let h = bounds.height.max(4.0);

        let bars = 4usize;
        let gap = (w * 0.14).clamp(1.5, 3.0);
        let bar_w = ((w - gap * (bars as f32 - 1.0)) / bars as f32).max(1.5);
        let radius = bar_w * 0.5;

        let phases: [(f32, f32, f32); 4] = [
            (0.0, 5.2, 0.30),
            (1.4, 6.7, 0.52),
            (2.7, 4.8, 0.40),
            (0.8, 7.3, 0.26),
        ];

        for (i, (phase, speed, rest_ratio)) in phases.iter().enumerate() {
            let ratio = if self.playing {
                let s1 = (self.time * speed + phase).sin() * 0.5 + 0.5;
                let s2 = (self.time * (speed * 0.55) + phase * 1.7).cos() * 0.5 + 0.5;
                (0.24 + 0.76 * (s1 * 0.65 + s2 * 0.35)).clamp(0.22, 1.0)
            } else {
                *rest_ratio
            };

            let bh = (h * ratio).max(bar_w + 1.0);
            let x = i as f32 * (bar_w + gap);
            let y = h - bh;

            if self.playing {
                let glow = Path::rounded_rectangle(
                    Point::new((x - 0.6).max(0.0), (y - 0.6).max(0.0)),
                    Size::new(bar_w + 1.2, (bh + 1.2).min(h)),
                    (radius + 0.6).into(),
                );
                frame.fill(
                    &glow,
                    Color::from_rgba(self.color.r, self.color.g, self.color.b, 0.24),
                );
            }

            let rect = Path::rounded_rectangle(Point::new(x, y), Size::new(bar_w, bh), radius.into());
            let alpha = if self.playing { 1.0 } else { 0.55 };
            frame.fill(
                &rect,
                Color::from_rgba(self.color.r, self.color.g, self.color.b, alpha),
            );
        }

        vec![frame.into_geometry()]
    }
}

pub fn eq_bars<'a>(
    time: f32,
    playing: bool,
    color: Color,
    width: f32,
    height: f32,
) -> Element<'a, Message> {
    Canvas::new(EqBarsProgram {
        time,
        playing,
        color,
    })
    .width(width)
    .height(height)
    .into()
}

#[derive(Debug)]
struct LiveDotProgram {
    time: f32,
    active: bool,
    color: Color,
}

impl canvas::Program<Message> for LiveDotProgram {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: iced::mouse::Cursor,
    ) -> Vec<Geometry<Renderer>> {
        let mut frame = Frame::new(renderer, bounds.size());
        let center = Point::new(bounds.width * 0.5, bounds.height * 0.5);

        if self.active {
            let phase = (self.time * 2.2) % 1.0;
            let ring_r = 2.6 + phase * 3.2;
            let ring_alpha = (1.0 - phase) * 0.55;
            let ring = Path::circle(center, ring_r);
            frame.fill(
                &ring,
                Color::from_rgba(self.color.r, self.color.g, self.color.b, ring_alpha),
            );
        }

        let core_alpha = if self.active { 1.0 } else { 0.45 };
        let dot = Path::circle(center, 2.8);
        frame.fill(
            &dot,
            Color::from_rgba(self.color.r, self.color.g, self.color.b, core_alpha),
        );

        vec![frame.into_geometry()]
    }
}

pub fn live_dot<'a>(time: f32, active: bool, color: Color) -> Element<'a, Message> {
    Canvas::new(LiveDotProgram {
        time,
        active,
        color,
    })
    .width(12.0)
    .height(12.0)
    .into()
}

pub fn kbd_chip<'a>(label: &'a str, p: Palette) -> Element<'a, Message> {
    container(
        text(label)
            .size(10)
            .font(FONT_MEDIUM)
            .color(p.text_dim),
    )
    .padding([2, 6])
    .align_y(alignment::Vertical::Center)
    .style(move |_| container::Style {
        background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.06))),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.14),
            width: 1.0,
            radius: 6.0.into(),
        },
        ..Default::default()
    })
    .into()
}

pub fn hairline_divider<'a>(p: Palette) -> Element<'a, Message> {
    container(space().width(Length::Fill).height(1))
        .style(move |_| container::Style {
            background: Some(Background::Color(p.border)),
            ..Default::default()
        })
        .into()
}

pub fn vertical_hairline<'a>(p: Palette) -> Element<'a, Message> {
    container(space().width(1).height(Length::Fill))
        .style(move |_| container::Style {
            background: Some(Background::Color(p.border)),
            ..Default::default()
        })
        .into()
}

pub fn rank_badge<'a>(rank: usize, p: Palette) -> Element<'a, Message> {
    let (bg, fg, border_col) = if rank == 1 {
        (
            Color::from_rgba(p.accent.r, p.accent.g, p.accent.b, 0.90),
            Color::WHITE,
            Color::from_rgba(1.0, 1.0, 1.0, 0.22),
        )
    } else {
        (
            Color::from_rgba8(18, 18, 22, 0.78),
            Color::WHITE,
            Color::from_rgba(1.0, 1.0, 1.0, 0.16),
        )
    };

    container(
        text(format!("#{rank}"))
            .size(10)
            .font(FONT_BOLD)
            .color(fg),
    )
    .padding([2, 6])
    .style(move |_| container::Style {
        background: Some(Background::Color(bg)),
        border: Border {
            color: border_col,
            width: 1.0,
            radius: 6.0.into(),
        },
        ..Default::default()
    })
    .into()
}

pub fn count_pill<'a>(label: String, p: Palette) -> Element<'a, Message> {
    container(
        text(label)
            .size(10.5)
            .font(FONT_SEMIBOLD)
            .color(p.text_muted),
    )
    .padding([1, 6])
    .style(move |_| container::Style {
        background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.07))),
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: 999.0.into(),
        },
        ..Default::default()
    })
    .into()
}

pub fn track_list_header<'a>(p: Palette) -> Element<'a, Message> {
    column![
        container(
            row![
                container(text("#").size(11).font(FONT_SEMIBOLD).color(p.text_dim))
                    .width(28)
                    .align_x(iced::Alignment::Center),
                text("TIÊU ĐỀ")
                    .size(11)
                    .font(FONT_SEMIBOLD)
                    .color(p.text_dim)
                    .width(Length::Fill),
                text("THỜI LƯỢNG")
                    .size(11)
                    .font(FONT_SEMIBOLD)
                    .color(p.text_dim),
                space().width(74),
            ]
            .spacing(12)
            .align_y(iced::Alignment::Center),
        )
        .padding([4, 12]),
        hairline_divider(p),
    ]
    .spacing(4)
    .width(Length::Fill)
    .into()
}

#[derive(Debug)]
struct StorageBarProgram {
    ratio: f32,
    fill_color: Color,
}

impl canvas::Program<Message> for StorageBarProgram {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: iced::mouse::Cursor,
    ) -> Vec<Geometry<Renderer>> {
        let mut frame = Frame::new(renderer, bounds.size());
        let w = bounds.width.max(4.0);
        let h = bounds.height.max(4.0);
        let r = h * 0.5;

        let track = Path::rounded_rectangle(Point::ORIGIN, Size::new(w, h), r.into());
        frame.fill(&track, Color::from_rgba(1.0, 1.0, 1.0, 0.12));

        let fill_w = (w * self.ratio.clamp(0.0, 1.0)).max(if self.ratio > 0.0 { h } else { 0.0 });
        if fill_w > 0.5 {
            let fg = Path::rounded_rectangle(Point::ORIGIN, Size::new(fill_w, h), r.into());
            frame.fill(&fg, self.fill_color);
        }

        vec![frame.into_geometry()]
    }
}

pub fn storage_bar<'a>(used_mb: f64, max_mb: f64, p: Palette) -> Element<'a, Message> {
    let ratio = if max_mb > 0.0 {
        (used_mb / max_mb).clamp(0.0, 1.0) as f32
    } else {
        0.0
    };
    let fill_color = if ratio >= 0.85 { p.danger } else { p.accent };

    Canvas::new(StorageBarProgram { ratio, fill_color })
        .width(Length::Fill)
        .height(6.0)
        .into()
}

#[derive(Debug)]
struct ShimmerSkeletonProgram {
    time: f32,
    is_cards: bool,
    count: usize,
    surface: Color,
}

impl canvas::Program<Message> for ShimmerSkeletonProgram {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: iced::mouse::Cursor,
    ) -> Vec<Geometry<Renderer>> {
        let mut frame = Frame::new(renderer, bounds.size());
        let w = bounds.width.max(40.0);
        let sweep = ((self.time * 0.75) % 1.6) - 0.3;

        let shimmer_at = |x: f32| -> Color {
            let norm = (x / w).clamp(0.0, 1.0);
            let dist = (norm - sweep).abs();
            let boost = (1.0 - (dist / 0.22).min(1.0)) * 0.08;
            Color::from_rgba(
                (self.surface.r + boost).min(1.0),
                (self.surface.g + boost).min(1.0),
                (self.surface.b + boost).min(1.0),
                0.78,
            )
        };

        if self.is_cards {
            let card_w = 178.0;
            let gap = 14.0;
            for i in 0..self.count {
                let x = i as f32 * (card_w + gap);
                if x + 60.0 > w {
                    break;
                }
                let col = shimmer_at(x + card_w * 0.5);
                let art = Path::rounded_rectangle(
                    Point::new(x, 0.0),
                    Size::new(card_w, 158.0),
                    14.0.into(),
                );
                let line1 = Path::rounded_rectangle(
                    Point::new(x, 168.0),
                    Size::new(card_w * 0.82, 12.0),
                    6.0.into(),
                );
                let line2 = Path::rounded_rectangle(
                    Point::new(x, 186.0),
                    Size::new(card_w * 0.55, 10.0),
                    5.0.into(),
                );
                frame.fill(&art, col);
                frame.fill(&line1, col);
                frame.fill(&line2, col);
            }
        } else {
            let row_h = 56.0;
            let gap = 8.0;
            for i in 0..self.count {
                let y = i as f32 * (row_h + gap);
                let col = shimmer_at(w * (0.25 + (i % 3) as f32 * 0.2));
                let bg = Path::rounded_rectangle(
                    Point::new(0.0, y),
                    Size::new(w, row_h),
                    12.0.into(),
                );
                frame.fill(&bg, Color::from_rgba(self.surface.r, self.surface.g, self.surface.b, 0.42));

                let thumb = Path::rounded_rectangle(
                    Point::new(14.0, y + 6.0),
                    Size::new(44.0, 44.0),
                    8.0.into(),
                );
                let t1 = Path::rounded_rectangle(
                    Point::new(72.0, y + 14.0),
                    Size::new((w * 0.34).min(260.0), 12.0),
                    6.0.into(),
                );
                let t2 = Path::rounded_rectangle(
                    Point::new(72.0, y + 32.0),
                    Size::new((w * 0.20).min(160.0), 10.0),
                    5.0.into(),
                );
                frame.fill(&thumb, col);
                frame.fill(&t1, col);
                frame.fill(&t2, col);
            }
        }

        vec![frame.into_geometry()]
    }
}

pub fn shimmer_skeleton_cards<'a>(time: f32, count: usize, p: Palette) -> Element<'a, Message> {
    Canvas::new(ShimmerSkeletonProgram {
        time,
        is_cards: true,
        count,
        surface: p.surface_elevated,
    })
    .width(Length::Fill)
    .height(204.0)
    .into()
}

pub fn shimmer_skeleton_rows<'a>(time: f32, count: usize, p: Palette) -> Element<'a, Message> {
    let h = (count as f32) * 64.0;
    Canvas::new(ShimmerSkeletonProgram {
        time,
        is_cards: false,
        count,
        surface: p.surface_elevated,
    })
    .width(Length::Fill)
    .height(h)
    .into()
}
