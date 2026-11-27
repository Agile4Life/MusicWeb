use iced::alignment;
use iced::mouse;
use iced::widget::canvas::{self, Canvas, Frame, Geometry, Path, Stroke, Text};
use iced::{Color, Element, Length, Point, Rectangle, Renderer, Size, Theme};

use crate::state::{Message, format_duration};
use crate::theme::{FONT_MEDIUM, Palette};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeekbarStyle {
    AppleLcd,
    AppleNowPlaying,
}

#[derive(Debug)]
pub struct SeekbarProgram {
    pub current: f64,
    pub duration: f64,
    pub is_loading: bool,
    pub time: f32,
    pub palette: Palette,
    pub style: SeekbarStyle,
}

#[derive(Debug, Default)]
pub struct SeekbarState {
    pub dragging: bool,
    pub hover_ratio: Option<f32>,
}

impl canvas::Program<Message> for SeekbarProgram {
    type State = SeekbarState;

    fn update(
        &self,
        state: &mut Self::State,
        event: &canvas::Event,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Option<canvas::Action<Message>> {
        let width = bounds.width.max(1.0);

        match event {
            canvas::Event::Mouse(mouse_event) => match mouse_event {
                mouse::Event::CursorMoved { .. } => {
                    if let Some(pos) = cursor.position_in(bounds) {
                        let ratio = (pos.x / width).clamp(0.0, 1.0);
                        state.hover_ratio = Some(ratio);
                        if state.dragging && self.duration > 0.0 {
                            return Some(
                                canvas::Action::publish(Message::SeekTo(
                                    f64::from(ratio) * self.duration,
                                ))
                                .and_capture(),
                            );
                        }
                        return Some(canvas::Action::request_redraw());
                    } else if state.hover_ratio.is_some() {
                        state.hover_ratio = None;
                        return Some(canvas::Action::request_redraw());
                    }
                    None
                }
                mouse::Event::ButtonPressed(mouse::Button::Left) => {
                    if let Some(pos) = cursor.position_in(bounds) {
                        state.dragging = true;
                        let ratio = (pos.x / width).clamp(0.0, 1.0);
                        state.hover_ratio = Some(ratio);
                        if self.duration > 0.0 {
                            return Some(
                                canvas::Action::publish(Message::SeekTo(
                                    f64::from(ratio) * self.duration,
                                ))
                                .and_capture(),
                            );
                        }
                        return Some(canvas::Action::capture());
                    }
                    None
                }
                mouse::Event::ButtonReleased(mouse::Button::Left) => {
                    if state.dragging {
                        state.dragging = false;
                        return Some(canvas::Action::request_redraw().and_capture());
                    }
                    None
                }
                mouse::Event::CursorLeft => {
                    state.hover_ratio = None;
                    state.dragging = false;
                    Some(canvas::Action::request_redraw())
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn draw(
        &self,
        state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: mouse::Cursor,
    ) -> Vec<Geometry<Renderer>> {
        let mut frame = Frame::new(renderer, bounds.size());
        let w = bounds.width;
        let h = bounds.height;
        let cy = h * 0.5;
        let hovered = state.hover_ratio.is_some() || state.dragging;
        let track_h = match self.style {
            SeekbarStyle::AppleLcd => {
                if hovered { 3.0 } else { 2.5 }
            }
            SeekbarStyle::AppleNowPlaying => {
                if hovered { 6.5 } else { 4.0 }
            }
        };
        let y = match self.style {
            SeekbarStyle::AppleLcd => {
                if hovered {
                    (h - track_h - 2.5).max(0.0)
                } else {
                    (h - track_h).max(0.0)
                }
            }
            _ => cy - track_h * 0.5,
        };
        let draw_cy = y + track_h * 0.5;
        let r = match self.style {
            SeekbarStyle::AppleLcd => {
                if hovered { 1.5 } else { 0.0 }
            }
            _ => track_h * 0.5,
        };

        let progress = if self.duration > 0.0 {
            (self.current / self.duration).clamp(0.0, 1.0) as f32
        } else {
            0.0
        };
        let fill_w = (w * progress).max(0.0);

        // Background rail
        let rail_alpha = match self.style {
            SeekbarStyle::AppleLcd => 0.14,
            SeekbarStyle::AppleNowPlaying => 0.22,
        };
        let bg = Path::rounded_rectangle(Point::new(0.0, y), Size::new(w, track_h), r.into());
        frame.fill(&bg, Color::from_rgba(1.0, 1.0, 1.0, rail_alpha));

        // Loading buffer shimmer band
        if self.is_loading && w > 24.0 {
            let phase = ((self.time * 0.9) % 1.4) - 0.2;
            let band_w = (w * 0.26).clamp(24.0, 96.0);
            let bx = (w * phase).clamp(0.0, (w - band_w).max(0.0));
            let shimmer = Path::rounded_rectangle(
                Point::new(bx, y),
                Size::new(band_w.min(w), track_h),
                r.into(),
            );
            frame.fill(
                &shimmer,
                Color::from_rgba(
                    self.palette.accent.r,
                    self.palette.accent.g,
                    self.palette.accent.b,
                    0.35,
                ),
            );
        }

        // Hover preview ghost fill + hairline
        if let Some(hr) = state.hover_ratio {
            let hw = w * hr;
            let ghost =
                Path::rounded_rectangle(Point::new(0.0, y), Size::new(hw, track_h), r.into());
            frame.fill(&ghost, Color::from_rgba(1.0, 1.0, 1.0, 0.18));

            if self.style != SeekbarStyle::AppleLcd || self.duration > 0.0 {
                let mark_x = hw.clamp(1.0, (w - 1.0).max(1.0));
                let (y0, y1) = if self.style == SeekbarStyle::AppleLcd {
                    ((y - 1.5).max(1.0), (y + track_h + 1.5).min(h - 1.0))
                } else {
                    (y - 2.0, y + track_h + 2.0)
                };
                let hairline = Path::line(Point::new(mark_x, y0), Point::new(mark_x, y1));
                frame.stroke(
                    &hairline,
                    Stroke::default()
                        .with_width(if self.style == SeekbarStyle::AppleLcd {
                            1.0
                        } else {
                            1.4
                        })
                        .with_color(Color::from_rgba(1.0, 1.0, 1.0, 0.45)),
                );
            }
        }

        // Active fill
        if fill_w > 0.5 {
            let fg =
                Path::rounded_rectangle(Point::new(0.0, y), Size::new(fill_w, track_h), r.into());
            match self.style {
                SeekbarStyle::AppleLcd => {
                    let fill_col = if hovered {
                        self.palette.accent
                    } else {
                        Color::from_rgba(1.0, 1.0, 1.0, 0.55)
                    };
                    frame.fill(&fg, fill_col);
                }
                SeekbarStyle::AppleNowPlaying => {
                    let fill_col = Color::from_rgba(1.0, 1.0, 1.0, if hovered { 0.96 } else { 0.78 });
                    frame.fill(&fg, fill_col);
                }
            }
        }

        // Thumb & rounded hover timestamp pill
        let thumb_r = if self.style == SeekbarStyle::AppleLcd {
            3.6
        } else {
            4.0
        };
        let thumb_x = fill_w.clamp(thumb_r, (w - thumb_r).max(thumb_r));
        if hovered {
            match self.style {
                SeekbarStyle::AppleLcd => {
                    let thumb = Path::circle(Point::new(thumb_x, draw_cy), 3.6);
                    frame.fill(&thumb, Color::WHITE);
                }
                SeekbarStyle::AppleNowPlaying => {
                    let thumb = Path::circle(Point::new(thumb_x, draw_cy), 5.5);
                    frame.fill(&thumb, Color::WHITE);
                    if let Some(hr) = state.hover_ratio {
                        if self.duration > 0.0 {
                            let preview_time = format_duration(f64::from(hr) * self.duration);
                            let pill_w = 40.0;
                            let pill_h = 16.0;
                            let px = (w * hr - pill_w * 0.5).clamp(0.0, (w - pill_w).max(0.0));
                            let py = (draw_cy - pill_h - 6.0).max(0.0);
                            let pill = Path::rounded_rectangle(
                                Point::new(px, py),
                                Size::new(pill_w, pill_h),
                                6.0.into(),
                            );
                            frame.fill(&pill, Color::from_rgba8(14, 14, 18, 0.88));
                            frame.fill_text(Text {
                                content: preview_time,
                                position: Point::new(px + pill_w * 0.5, py + pill_h * 0.5),
                                color: Color::WHITE,
                                size: iced::Pixels(10.0),
                                font: FONT_MEDIUM,
                                align_x: alignment::Horizontal::Center.into(),
                                align_y: alignment::Vertical::Center,
                                ..Default::default()
                            });
                        }
                    }
                }
            }
        }

        vec![frame.into_geometry()]
    }

    fn mouse_interaction(
        &self,
        state: &Self::State,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> mouse::Interaction {
        if state.dragging || cursor.is_over(bounds) {
            mouse::Interaction::Pointer
        } else {
            mouse::Interaction::default()
        }
    }
}

pub fn seekbar_apple_lcd<'a>(
    current: f64,
    duration: f64,
    is_loading: bool,
    time: f32,
    palette: Palette,
) -> Element<'a, Message> {
    Canvas::new(SeekbarProgram {
        current,
        duration,
        is_loading,
        time,
        palette,
        style: SeekbarStyle::AppleLcd,
    })
    .width(Length::Fill)
    .height(10.0)
    .into()
}

pub fn seekbar_apple_np<'a>(
    current: f64,
    duration: f64,
    is_loading: bool,
    time: f32,
    palette: Palette,
) -> Element<'a, Message> {
    Canvas::new(SeekbarProgram {
        current,
        duration,
        is_loading,
        time,
        palette,
        style: SeekbarStyle::AppleNowPlaying,
    })
    .width(Length::Fill)
    .height(22.0)
    .into()
}
