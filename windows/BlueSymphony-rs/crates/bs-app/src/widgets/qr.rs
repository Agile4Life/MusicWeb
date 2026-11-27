use iced::widget::{canvas, container, text};
use iced::{Alignment, Background, Border, Color, Element, Point, Rectangle, Renderer, Size, Theme, mouse};
use qrcode::{Color as QrModule, EcLevel, QrCode};

use crate::state::Message;

struct QrCanvas {
    modules: Vec<bool>,
    dim: usize,
}

impl canvas::Program<Message> for QrCanvas {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: mouse::Cursor,
    ) -> Vec<canvas::Geometry<Renderer>> {
        let mut frame = canvas::Frame::new(renderer, bounds.size());
        frame.fill_rectangle(Point::ORIGIN, bounds.size(), Color::WHITE);

        if self.dim == 0 {
            return vec![frame.into_geometry()];
        }
        let quiet = 2.0_f32;
        let total = self.dim as f32 + quiet * 2.0;
        let side = bounds.width.min(bounds.height);
        let cell = side / total;
        let ox = (bounds.width - side) * 0.5 + quiet * cell;
        let oy = (bounds.height - side) * 0.5 + quiet * cell;
        let dark = Color::from_rgb8(9, 9, 11);

        for row in 0..self.dim {
            for col in 0..self.dim {
                if self.modules[row * self.dim + col] {
                    frame.fill_rectangle(
                        Point::new(ox + col as f32 * cell, oy + row as f32 * cell),
                        Size::new(cell + 0.35, cell + 0.35),
                        dark,
                    );
                }
            }
        }

        vec![frame.into_geometry()]
    }
}

pub fn qr_code<'a>(data: String, size: f32) -> Element<'a, Message> {
    match QrCode::with_error_correction_level(data.as_bytes(), EcLevel::M) {
        Ok(code) => {
            let dim = code.width();
            let modules: Vec<bool> = code
                .into_colors()
                .into_iter()
                .map(|c| c == QrModule::Dark)
                .collect();
            container(
                canvas(QrCanvas { modules, dim })
                    .width(size)
                    .height(size),
            )
            .padding(6)
            .style(|_| container::Style {
                background: Some(Background::Color(Color::WHITE)),
                border: Border {
                    radius: 12.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            })
            .into()
        }
        Err(_) => container(text("Không tạo được mã QR").size(12))
            .width(size)
            .height(size)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .into(),
    }
}
