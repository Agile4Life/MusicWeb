use bs_dsp::{EqBand, TargetCurveKind, combined_response_db, log_freq_grid};
use iced::mouse;
use iced::widget::canvas::{self, Canvas, Frame, Geometry, Path, Stroke, Text as CanvasText};
use iced::{Color, Element, Length, Point, Rectangle, Renderer, Size, Theme};

use crate::state::Message;
use crate::theme::Palette;

const DB_MIN: f32 = -18.0;
const DB_MAX: f32 = 18.0;
const F_MIN: f64 = 20.0;
const F_MAX: f64 = 20_000.0;
const PAD_L: f32 = 38.0;
const PAD_R: f32 = 14.0;
const PAD_T: f32 = 14.0;
const PAD_B: f32 = 24.0;

#[derive(Debug, Default)]
pub struct EqGraphInteraction {
    pub dragging_band: Option<usize>,
    pub hovered_band: Option<usize>,
}

pub struct EqGraphConfig<'a> {
    pub bands: &'a [EqBand],
    pub extra_bands: Vec<EqBand>,
    pub measured_db: Option<&'a [f32]>,
    pub after_db: Option<&'a [f32]>,
    pub target: Option<TargetCurveKind>,
    pub bypass: bool,
    pub interactive: bool,
    pub selected_band: Option<usize>,
    pub palette: Palette,
}

struct EqGraphProgram {
    bands: Vec<EqBand>,
    freqs: Vec<f32>,
    eq_curve: Vec<f32>,
    measured_db: Option<Vec<f32>>,
    after_db: Option<Vec<f32>>,
    target_db: Option<Vec<f32>>,
    bypass: bool,
    interactive: bool,
    selected_band: Option<usize>,
    p: Palette,
}

fn freq_to_x(freq: f64, plot_w: f32) -> f32 {
    let t = ((freq.clamp(F_MIN, F_MAX) / F_MIN).ln() / (F_MAX / F_MIN).ln()) as f32;
    PAD_L + t * plot_w
}

fn x_to_freq(x: f32, plot_w: f32) -> f64 {
    let t = ((x - PAD_L) / plot_w.max(1.0)).clamp(0.0, 1.0) as f64;
    F_MIN * (F_MAX / F_MIN).powf(t)
}

fn db_to_y(db: f32, plot_h: f32) -> f32 {
    let norm = ((db - DB_MIN) / (DB_MAX - DB_MIN)).clamp(0.0, 1.0);
    PAD_T + (1.0 - norm) * plot_h
}

fn y_to_db(y: f32, plot_h: f32) -> f32 {
    let norm = 1.0 - ((y - PAD_T) / plot_h.max(1.0)).clamp(0.0, 1.0);
    (DB_MIN + norm * (DB_MAX - DB_MIN)).clamp(-16.0, 16.0)
}

impl canvas::Program<Message> for EqGraphProgram {
    type State = EqGraphInteraction;

    fn update(
        &self,
        state: &mut Self::State,
        event: &canvas::Event,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Option<canvas::Action<Message>> {
        if !self.interactive {
            return None;
        }
        let plot_w = (bounds.width - PAD_L - PAD_R).max(40.0);
        let plot_h = (bounds.height - PAD_T - PAD_B).max(40.0);
        let pos = cursor.position_in(bounds);

        match event {
            canvas::Event::Mouse(mouse::Event::CursorMoved { .. }) => {
                if let Some(p) = pos {
                    if let Some(idx) = state.dragging_band {
                        if let Some(band) = self.bands.get(idx) {
                            let new_f = x_to_freq(p.x, plot_w);
                            let new_g = y_to_db(p.y, plot_h) as f64;
                            return Some(
                                canvas::Action::publish(Message::EqBandUpdated {
                                    index: idx,
                                    freq_hz: new_f,
                                    gain_db: new_g,
                                    q: band.q,
                                })
                                .and_capture(),
                            );
                        }
                    }
                    let mut nearest = None;
                    let mut best_d2 = 196.0_f32;
                    for (idx, b) in self.bands.iter().enumerate() {
                        let nx = freq_to_x(b.freq_hz, plot_w);
                        let ny = db_to_y(b.gain_db as f32, plot_h);
                        let d2 = (p.x - nx).powi(2) + (p.y - ny).powi(2);
                        if d2 < best_d2 {
                            best_d2 = d2;
                            nearest = Some(idx);
                        }
                    }
                    if state.hovered_band != nearest {
                        state.hovered_band = nearest;
                        return Some(canvas::Action::request_redraw());
                    }
                }
                None
            }
            canvas::Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)) => {
                let p = pos?;
                let mut best = None;
                let mut best_d2 = 225.0_f32;
                for (idx, b) in self.bands.iter().enumerate() {
                    let nx = freq_to_x(b.freq_hz, plot_w);
                    let ny = db_to_y(b.gain_db as f32, plot_h);
                    let d2 = (p.x - nx).powi(2) + (p.y - ny).powi(2);
                    if d2 < best_d2 {
                        best_d2 = d2;
                        best = Some(idx);
                    }
                }
                if let Some(idx) = best {
                    state.dragging_band = Some(idx);
                    return Some(canvas::Action::publish(Message::SelectEqBand(idx)).and_capture());
                }
                None
            }
            canvas::Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left)) => {
                if state.dragging_band.take().is_some() {
                    return Some(canvas::Action::publish(Message::SaveDspProfiles).and_capture());
                }
                None
            }
            canvas::Event::Mouse(mouse::Event::WheelScrolled { delta }) => {
                let idx = state.hovered_band.or(self.selected_band)?;
                let band = self.bands.get(idx)?;
                let step = match delta {
                    mouse::ScrollDelta::Lines { y, .. } => *y as f64 * 0.2,
                    mouse::ScrollDelta::Pixels { y, .. } => (*y as f64 / 40.0) * 0.2,
                };
                if step.abs() > 1e-4 {
                    let new_q = (band.q + step).clamp(0.3, 12.0);
                    return Some(
                        canvas::Action::publish(Message::EqBandUpdated {
                            index: idx,
                            freq_hz: band.freq_hz,
                            gain_db: band.gain_db,
                            q: new_q,
                        })
                        .and_capture(),
                    );
                }
                None
            }
            _ => None,
        }
    }

    fn mouse_interaction(
        &self,
        state: &Self::State,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> mouse::Interaction {
        if !self.interactive || !cursor.is_over(bounds) {
            return mouse::Interaction::default();
        }
        if state.dragging_band.is_some() {
            mouse::Interaction::Grabbing
        } else if state.hovered_band.is_some() {
            mouse::Interaction::Grab
        } else {
            mouse::Interaction::Crosshair
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
        let w = bounds.width.max(120.0);
        let h = bounds.height.max(100.0);
        let plot_w = (w - PAD_L - PAD_R).max(40.0);
        let plot_h = (h - PAD_T - PAD_B).max(40.0);

        // Background glass surface
        let bg = Path::rounded_rectangle(Point::ORIGIN, Size::new(w, h), 14.0.into());
        frame.fill(
            &bg,
            Color::from_rgba(self.p.bg.r, self.p.bg.g, self.p.bg.b, 0.72),
        );
        frame.stroke(
            &bg,
            Stroke::default()
                .with_width(1.0)
                .with_color(self.p.border),
        );

        // Frequency grid lines
        for &(f, label) in &[
            (20.0, "20"),
            (50.0, "50"),
            (100.0, "100"),
            (200.0, "200"),
            (500.0, "500"),
            (1000.0, "1k"),
            (2000.0, "2k"),
            (5000.0, "5k"),
            (10_000.0, "10k"),
            (20_000.0, "20k"),
        ] {
            let x = freq_to_x(f, plot_w);
            let line = Path::line(Point::new(x, PAD_T), Point::new(x, PAD_T + plot_h));
            frame.stroke(
                &line,
                Stroke::default()
                    .with_width(1.0)
                    .with_color(Color::from_rgba(1.0, 1.0, 1.0, 0.07)),
            );
            frame.fill_text(CanvasText {
                content: label.to_string(),
                position: Point::new(x - 10.0, PAD_T + plot_h + 6.0),
                color: self.p.text_dim,
                size: 10.0.into(),
                ..CanvasText::default()
            });
        }

        // dB grid lines
        for db in [-12.0_f32, -6.0, 0.0, 6.0, 12.0] {
            let y = db_to_y(db, plot_h);
            let line = Path::line(Point::new(PAD_L, y), Point::new(PAD_L + plot_w, y));
            let alpha = if db == 0.0 { 0.22 } else { 0.07 };
            frame.stroke(
                &line,
                Stroke::default()
                    .with_width(if db == 0.0 { 1.2 } else { 1.0 })
                    .with_color(Color::from_rgba(1.0, 1.0, 1.0, alpha)),
            );
            frame.fill_text(CanvasText {
                content: format!("{db:+.0}"),
                position: Point::new(6.0, y - 6.0),
                color: self.p.text_dim,
                size: 10.0.into(),
                ..CanvasText::default()
            });
        }

        // Helper to build polyline path from curve values
        let build_path = |vals: &[f32]| -> Path {
            Path::new(|b| {
                for (i, (&f, &db)) in self.freqs.iter().zip(vals.iter()).enumerate() {
                    let pt = Point::new(freq_to_x(f as f64, plot_w), db_to_y(db, plot_h));
                    if i == 0 {
                        b.move_to(pt);
                    } else {
                        b.line_to(pt);
                    }
                }
            })
        };

        // 1. Target curve (amber thin line)
        if let Some(ref targ) = self.target_db {
            let p_targ = build_path(targ);
            frame.stroke(
                &p_targ,
                Stroke::default()
                    .with_width(1.6)
                    .with_color(Color::from_rgba(0.98, 0.75, 0.14, 0.72)),
            );
        }

        // 2. Measured room curve (Before — slate gray)
        if let Some(ref meas) = self.measured_db {
            let p_meas = build_path(meas);
            frame.stroke(
                &p_meas,
                Stroke::default()
                    .with_width(1.8)
                    .with_color(Color::from_rgba(0.74, 0.78, 0.88, 0.58)),
            );
        }

        // 3. Primary curve (After Auto-EQ if room measurement exists, else EQ curve)
        let primary_vals = self.after_db.as_deref().unwrap_or(&self.eq_curve);
        if !primary_vals.is_empty() {
            let zero_y = db_to_y(0.0, plot_h);
            let fill_path = Path::new(|b| {
                let first_x = freq_to_x(self.freqs[0] as f64, plot_w);
                b.move_to(Point::new(first_x, zero_y));
                for (&f, &db) in self.freqs.iter().zip(primary_vals.iter()) {
                    b.line_to(Point::new(freq_to_x(f as f64, plot_w), db_to_y(db, plot_h)));
                }
                if let Some(&last_f) = self.freqs.last() {
                    b.line_to(Point::new(freq_to_x(last_f as f64, plot_w), zero_y));
                }
                b.close();
            });
            let line_col = if self.bypass {
                self.p.text_dim
            } else {
                self.p.accent
            };
            frame.fill(
                &fill_path,
                Color::from_rgba(line_col.r, line_col.g, line_col.b, 0.14),
            );
            let main_path = build_path(primary_vals);
            frame.stroke(
                &main_path,
                Stroke::default().with_width(2.4).with_color(line_col),
            );
        }

        // 4. Draggable band nodes (only when interactive and showing EQ curve)
        if self.interactive {
            for (idx, b) in self.bands.iter().enumerate() {
                let nx = freq_to_x(b.freq_hz, plot_w);
                let ny = db_to_y(b.gain_db as f32, plot_h);
                let is_sel = self.selected_band == Some(idx)
                    || state.hovered_band == Some(idx)
                    || state.dragging_band == Some(idx);

                let node_col = if !b.enabled || self.bypass {
                    self.p.text_dim
                } else if is_sel {
                    self.p.accent_secondary
                } else {
                    self.p.accent
                };

                if is_sel {
                    let halo = Path::circle(Point::new(nx, ny), 10.5);
                    frame.fill(
                        &halo,
                        Color::from_rgba(node_col.r, node_col.g, node_col.b, 0.25),
                    );
                }

                let dot = Path::circle(Point::new(nx, ny), if is_sel { 6.0 } else { 4.8 });
                frame.fill(&dot, node_col);
                frame.stroke(
                    &dot,
                    Stroke::default()
                        .with_width(1.2)
                        .with_color(Color::from_rgb8(10, 14, 24)),
                );
            }
        }

        vec![frame.into_geometry()]
    }
}

pub fn eq_graph<'a>(cfg: EqGraphConfig<'a>, height: f32) -> Element<'a, Message> {
    let freqs = log_freq_grid();
    let eq_curve = if cfg.bypass {
        vec![0.0_f32; freqs.len()]
    } else {
        combined_response_db(cfg.bands, &cfg.extra_bands, &freqs, 48_000.0)
    };
    let target_db = cfg
        .target
        .map(|t| freqs.iter().map(|&f| t.target_db(f as f64) as f32).collect());

    Canvas::new(EqGraphProgram {
        bands: cfg.bands.to_vec(),
        freqs,
        eq_curve,
        measured_db: cfg.measured_db.map(|s| s.to_vec()),
        after_db: cfg.after_db.map(|s| s.to_vec()),
        target_db,
        bypass: cfg.bypass,
        interactive: cfg.interactive,
        selected_band: cfg.selected_band,
        p: cfg.palette,
    })
    .width(Length::Fill)
    .height(height)
    .into()
}

